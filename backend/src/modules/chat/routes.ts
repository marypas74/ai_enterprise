import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findOne, findMany, insertOne, updateOne } from '../../database/index.js';
import { AIProviderFactory, calculateCost, Message } from '../ai/providers.js';
import { fetchAllModels, clearModelsCache } from '../../services/ModelFetcher.js';
import { ParlantProviderFactory, fetchParlantAgents, checkParlantHealth } from '../../services/ParlantProvider.js';
import { enhanceWithWebSearch } from '../../services/WebSearchService.js';
import { saveCodeBlocks, formatSavedFilesNotification, isAutoSaveModel } from '../../services/CodeAutoSaveService.js';
import { getToolDefinitions, executeTool } from '../../services/ToolService.js';
import { MemoryService } from '../memory/service.js';
import { getProjectFolder } from '../../services/StorageService.js';
import { decryptSecret } from '../../utils/crypto.js';

// Validation schemas
const completionSchema = z.object({
  conversationId: z.number().optional(),
  model: z.string(),
  message: z.string().min(1),
  systemPrompt: z.string().optional(),
  attachmentIds: z.array(z.number()).optional()
});

// Types
interface Conversation {
  id: number;
  user_id: number;
  title: string;
  model: string;
  provider: string;
  system_prompt: string;
  is_archived: boolean;
  created_at: Date;
  updated_at: Date;
}

interface DbMessage {
  id: number;
  conversation_id: number;
  role: 'system' | 'user' | 'assistant';
  content: string;
  tokens_input: number;
  tokens_output: number;
  created_at: Date;
}

export async function chatRoutes(fastify: FastifyInstance) {
  // Streaming chat completion
  fastify.post('/completions', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Send message and get AI response (streaming)',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };

    try {
      const body = completionSchema.parse(request.body);

      // DEBUG: Log entry point
      console.log(`[Chat-DEBUG] ============ REQUEST START ============`);
      console.log(`[Chat-DEBUG] Model: "${body.model}"`);
      console.log(`[Chat-DEBUG] Message length: ${body.message?.length || 0}`);
      console.log(`[Chat-DEBUG] User ID: ${user.id}`);
      console.log(`[Chat-DEBUG] AttachmentIds: ${JSON.stringify(body.attachmentIds || 'none')}`);
      fastify.log.info(`[Chat] Request for model: ${body.model}`);

      // Check if this is a Parlant agent (model format: "parlant:{agentId}")
      const isParlantAgent = body.model.startsWith('parlant:');
      let provider;
      let providerName: string;

      if (isParlantAgent) {
        // Parse agent ID safely
        const agentId = body.model.split(':')[1];
        if (!agentId || agentId.trim() === '') {
          return reply.status(400).send({
            error: 'Invalid Parlant model format',
            message: 'Expected format: parlant:{agentId}'
          });
        }

        // Check if Parlant service is reachable BEFORE attempting to use it
        const parlantHealthy = await checkParlantHealth();
        if (!parlantHealthy) {
          fastify.log.error(`[Chat] Parlant service is not reachable`);
          return reply.status(503).send({
            error: 'Parlant service unavailable',
            message: 'The Parlant AI Agent service is not running or not reachable. Please contact your administrator.',
            hint: 'Ensure PARLANT_URL is configured and the Parlant service is running.'
          });
        }

        provider = ParlantProviderFactory.getProvider(agentId.trim(), 'Parlant Agent', `user_${user.id}`);
        providerName = 'parlant';
        fastify.log.info(`[Chat] Using Parlant agent: ${agentId}`);
      } else {
        providerName = AIProviderFactory.getProviderName(body.model);
        console.log(`[Chat-DEBUG] Provider determined: "${providerName}" for model "${body.model}"`);
        fastify.log.info(`[Chat] Using ${providerName} provider for model: ${body.model}`);
        provider = AIProviderFactory.getProvider(body.model);
        console.log(`[Chat-DEBUG] Provider instance created: ${provider?.name || 'NULL'}`);
      }

      let conversationId = body.conversationId;
      let messages: Message[] = [];
      let toolContext: any = null;

      // Check if model supports tools before preparing context
      let supportsTools = false;
      if (!isParlantAgent) {
        try {
          const modelInfo = await findOne<{ supports_functions: number }>(
            fastify.db,
            'SELECT supports_functions FROM ai_models WHERE model_id = ?',
            [body.model]
          );
          supportsTools = modelInfo?.supports_functions === 1;
          fastify.log.info(`[Chat] Model ${body.model} tool support: ${supportsTools}`);
        } catch (err) {
          fastify.log.warn(`[Chat] Failed to check model capabilities: ${err}`);
        }
      }

      // Prepare Tool Context (Project) for standard chat - ONLY if model supports tools
      if (supportsTools) {
        try {
          let firstProject = await findOne<{ id: number, name: string, owner_id: number }>(
            fastify.db,
            'SELECT id, name, owner_id FROM projects WHERE owner_id = ? ORDER BY id ASC LIMIT 1',
            [user.id]
          );

          // If no project exists, create a default one to ensure tool functionality
          if (!firstProject) {
            fastify.log.info(`[Chat] Auto-creating default project for user ${user.id}`);
            const projectId = await insertOne(
              fastify.db,
              'INSERT INTO projects (name, description, owner_id, color, icon) VALUES (?, ?, ?, ?, ?)',
              ['Progetto Predefinito', 'Creato automaticamente per abilitare gli strumenti AI.', user.id, '#3b82f6', 'folder']
            );

            firstProject = {
              id: projectId,
              name: 'Progetto Predefinito',
              owner_id: user.id
            };
          }

          if (firstProject) {
            const owner = await findOne<{ name: string; email: string }>(
              fastify.db,
              'SELECT name, email FROM users WHERE id = ?',
              [firstProject.owner_id]
            );

            toolContext = {
              userName: owner?.name || owner?.email?.split('@')[0] || `user_${firstProject.owner_id}`,
              projectName: firstProject.name,
              projectId: firstProject.id,
              userId: user.id
            };

            // Ensure folder exists
            const { createProjectFolder } = await import('../../services/StorageService.js');
            await createProjectFolder(toolContext.userName, toolContext.projectName);
          }
        } catch (err) {
          fastify.log.warn(`[Chat] Failed to load or create tool context: ${err}`);
        }
      }

      // Get or create conversation
      (global as any).fastifyDb = fastify.db;
      if (conversationId) {
        // Load existing conversation
        const conversation = await findOne<Conversation>(
          fastify.db,
          'SELECT * FROM conversations WHERE id = ? AND user_id = ?',
          [conversationId, user.id]
        );

        if (!conversation) {
          return reply.status(404).send({ error: 'Conversation not found' });
        }

        // Load previous messages
        const dbMessages = await findMany<DbMessage>(
          fastify.db,
          'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
          [conversationId]
        );

        messages = dbMessages.map(m => ({ role: m.role, content: m.content }));
      } else {
        // Create new conversation
        const title = body.message.slice(0, 100);
        conversationId = await insertOne(
          fastify.db,
          'INSERT INTO conversations (user_id, title, model, provider, system_prompt) VALUES (?, ?, ?, ?, ?)',
          [user.id, title, body.model, providerName, body.systemPrompt || null]
        );

        // Add system prompt if provided
        if (body.systemPrompt) {
          messages.push({ role: 'system', content: body.systemPrompt });
          await insertOne(
            fastify.db,
            'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)',
            [conversationId, 'system', body.systemPrompt]
          );
        }
      }

      // Add user message
      // Add user message
      let userMessage = body.message;

      // Handle attachments if present
      if (body.attachmentIds && body.attachmentIds.length > 0) {
        // Wait for processing to complete (up to 30 seconds)
        const placeholders = body.attachmentIds.map(() => '?').join(',');
        let attachments: any[] = [];
        for (let attempt = 0; attempt < 90; attempt++) {
          attachments = await findMany<any>(
            fastify.db,
            `SELECT id, original_name, content_type, processing_status, processed_content
             FROM chat_attachments
             WHERE id IN (${placeholders}) AND user_id = ?`,
            [...body.attachmentIds, user.id]
          );
          const allDone = attachments.every((a: any) => a.processing_status === 'completed' || a.processing_status === 'failed');
          if (allDone || attachments.length === 0) break;
          console.log(`[Chat-DEBUG] Waiting for attachment processing... attempt ${attempt + 1}/30, status: ${attachments.map((a: any) => `${a.original_name}=${a.processing_status}`).join(', ')}`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Build context — for small documents (<30KB), inject full content directly
        // This prevents the model from saying "I can't read the file"
        const contextParts: string[] = [];

        for (const a of attachments) {
          if (!a.processed_content) continue;

          // For small documents, always use full content (no chunking/search)
          if (a.processed_content.length < 30000) {
            contextParts.push(
              `[Allegato ID=${a.id}: ${a.original_name} (${a.content_type})]\n` +
              `${a.processed_content}\n` +
              `[Fine allegato]`
            );
            console.log(`[Chat-DEBUG] Injected FULL content for ${a.original_name} (${a.processed_content.length} chars)`);
          } else {
            // Large docs: use semantic search or keyword chunks
            let chunkContext: string | null = null;

            // Try semantic search (Layer 3)
            try {
              const { searchSimilar } = await import('../../services/VectorStoreService.js');
              const semanticResults = await searchSimilar(fastify.db, body.message, {
                attachmentIds: [a.id],
                limit: 8,
                scoreThreshold: 0.3,
              });
              if (semanticResults.length > 0) {
                chunkContext = semanticResults.map((r: any) => r.content).join('\n\n---\n\n');
                console.log(`[Chat-DEBUG] Used ${semanticResults.length} semantic chunks for ${a.original_name}`);
              }
            } catch { /* Vector store not available */ }

            // Fallback to keyword chunks (Layer 2)
            if (!chunkContext) {
              try {
                const chunks = await findMany<{ content: string; chunk_index: number; metadata: string }>(
                  fastify.db,
                  'SELECT content, chunk_index, metadata FROM document_chunks WHERE attachment_id = ? ORDER BY chunk_index ASC',
                  [a.id]
                );
                if (chunks.length > 1) {
                  const { selectRelevantChunks } = await import('../../services/ChunkingService.js');
                  const chunkObjs = chunks.map((c: any) => ({
                    index: c.chunk_index,
                    content: c.content,
                    charCount: c.content.length,
                    metadata: JSON.parse(c.metadata || '{}')
                  }));
                  const relevant = selectRelevantChunks(chunkObjs, body.message, 5);
                  if (relevant.length > 0) {
                    chunkContext = relevant.map(c => c.content).join('\n\n---\n\n');
                  }
                }
              } catch { /* Chunking not available */ }
            }

            // Final fallback: truncated full content
            const content = chunkContext || a.processed_content.substring(0, 15000) + '\n... [contenuto troncato, usa get_attachment_text per il testo completo]';
            contextParts.push(
              `[Allegato ID=${a.id}: ${a.original_name} (${a.content_type})]\n` +
              `${content}\n` +
              `[Fine allegato]`
            );
          }
        }

        if (contextParts.length > 0) {
          const attachmentContext = contextParts.join('\n\n');
          userMessage = `${attachmentContext}\n\n---\nDomanda utente: ${body.message}`;
          console.log(`[Chat-DEBUG] Added context from ${contextParts.length} attachments`);
        } else {
          console.log(`[Chat-DEBUG] Attachments found but no processed content available yet`);
        }
      }

      messages.push({ role: 'user', content: userMessage });
      await insertOne(
        fastify.db,
        'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)',
        [conversationId, 'user', userMessage]
      );

      // Add coding system prompt for coder models
      if (isAutoSaveModel(body.model)) {
        const codingSystemPrompt = `Sei un esperto assistente di programmazione. Quando generi codice:
1. Scrivi codice completo e pronto per la produzione
2. Includi tutti gli import e le dipendenze necessarie
3. Aggiungi commenti chiari in italiano che spiegano ogni sezione
4. Usa il formato commento per il nome file: # filename.py o // filename.js
5. Genera applicazioni complete, non solo frammenti
6. Includi gestione errori e validazione input
7. Segui le best practice del linguaggio

Il codice che generi verrà salvato automaticamente nella cartella condivisa. Usa commenti chiari per i nomi dei file.`;

        const systemIndex = messages.findIndex(m => m.role === 'system');
        if (systemIndex >= 0) {
          messages[systemIndex].content = codingSystemPrompt + '\n\n' + messages[systemIndex].content;
        } else {
          messages.unshift({ role: 'system', content: codingSystemPrompt });
        }
      }

      // Check if web search is needed and enhance context
      let webSearchPerformed = false;
      try {
        const searchResult = await enhanceWithWebSearch(body.message);
        if (searchResult.shouldSearch && searchResult.searchContext) {
          webSearchPerformed = true;
          fastify.log.info(`[Chat] Web search performed, found ${searchResult.searchResponse?.results?.length || 0} results`);

          // Add search context to the system prompt or create one
          const searchSystemMessage = `You have access to current web search results. Use them to provide accurate, up-to-date information.\n${searchResult.searchContext}`;

          // Check if there's already a system message
          const systemIndex = messages.findIndex(m => m.role === 'system');
          if (systemIndex >= 0) {
            messages[systemIndex].content += '\n\n' + searchSystemMessage;
          } else {
            messages.unshift({ role: 'system', content: searchSystemMessage });
          }
        }
      } catch (searchError: any) {
        fastify.log.warn(`[Chat] Web search failed: ${searchError.message}`);
        // Continue without search results
      }

      // Inject Tool System Prompt if context is available (tool-calling models)
      if (toolContext) {
        const toolSystemPrompt = `\n\n[CAPABILITIES]
You have access to the following tools to help the user. YOU MUST USE THEM when requested to create files or read attachments:
1. generate_word_document(path, content, title): Create Word (.docx) files. The user will receive a download link.
2. generate_excel_document(path, data, sheetName): Create Excel (.xlsx) files.
3. generate_powerpoint_document(path, slides, title): Create PowerPoint (.pptx) files.
4. get_attachment_text(attachment_id): Read the FULL text of an uploaded file.

[CRITICAL INSTRUCTIONS]
- The content of any uploaded file (PDF, DOCX, etc.) is ALREADY INCLUDED in the user message above, between [Allegato ...] and [Fine allegato] markers.
- You CAN read it. DO NOT say you cannot read or see the file. The text IS the file content.
- If the user asks to translate a file and save it as DOCX:
  1. Read the file content from the [Allegato] section above.
  2. Translate ALL the content to the requested language.
  3. Use generate_word_document to save the translated text as a .docx file.
- ALWAYS use tools for file operations. NEVER say you cannot create files.
- Use relative paths like "output/translated.docx".`;

        const systemIndex = messages.findIndex(m => m.role === 'system');
        if (systemIndex >= 0) {
          messages[systemIndex].content += toolSystemPrompt;
        } else {
          messages.unshift({ role: 'system', content: toolSystemPrompt });
        }
      }

      // Detect document generation requests for ALL models
      // For tool-calling models: acts as fallback if the model doesn't generate a tool call
      // For non-tool models: auto-generates DOCX from the AI's response server-side
      let autoGenerateDocx = false;
      {
        const msgLower = body.message.toLowerCase();
        const hasAttachments = body.attachmentIds && body.attachmentIds.length > 0;

        // Strategy 1: Explicit document creation keywords
        const docGenKeywords = ['crea word', 'genera docx', 'crea documento', 'salva come word',
          'traduci e crea', 'traduci e salva', 'crea un file', 'create a word', 'create a document',
          'generate a docx', 'save as word', 'make a word', 'creami un file', 'crea file word',
          'creami un documento', 'crea un documento', 'converti in word', 'esporta in word',
          'genera un documento', 'genera documento', 'crea il word', 'crea il documento',
          'salva in word', 'salva come documento', 'converti in docx', 'trasforma in word',
          'convertilo in word', 'fai un word', 'fai un documento', 'crea il file'];
        const hasExplicitKeyword = docGenKeywords.some(kw => msgLower.includes(kw));

        // Strategy 2: Message mentions "word" or "docx" anywhere (broader match)
        const mentionsWord = /\b(word|docx|\.docx)\b/i.test(msgLower);

        // Strategy 3: Message mentions document creation verbs + file concept
        const hasCreationVerb = /\b(crea|genera|salva|esporta|converti|trasforma|fai|scrivi|produci|create|generate|save|export|convert|make|write)\b/i.test(msgLower);

        // Auto-generate if:
        // - Explicit keyword match, OR
        // - Has attachments AND mentions "word"/"docx", OR
        // - Has creation verb + mentions "word"/"docx"
        autoGenerateDocx = hasExplicitKeyword ||
          (hasAttachments && mentionsWord) ||
          (hasCreationVerb && mentionsWord);

        fastify.log.info(`[Chat] DocGen detection (all models): explicit=${hasExplicitKeyword}, attachments+word=${hasAttachments && mentionsWord}, verb+word=${hasCreationVerb && mentionsWord} => autoGenerateDocx=${autoGenerateDocx}, supportsTools=${supportsTools}`);

        // For non-tool models: inject system prompt to guide the AI to just write content
        if (autoGenerateDocx && !supportsTools) {
          const docGenSystemPrompt = `\n\n[ISTRUZIONI IMPORTANTI]
Il contenuto di qualsiasi file caricato (PDF, DOCX, ecc.) è GIÀ INCLUSO nel messaggio utente sopra, tra i marcatori [Allegato ...] e [Fine allegato].
Tu PUOI leggerlo. NON dire che non puoi leggere o vedere il file. Il testo È il contenuto del file.

Quando l'utente chiede di tradurre, creare o elaborare un documento:
1. Elabora la richiesta completamente (traduci, modifica, formatta, ecc.)
2. Scrivi il contenuto COMPLETO del documento tradotto/elaborato nella tua risposta
3. NON suggerire codice Python o librerie esterne
4. NON dire che non puoi creare file — il sistema genererà automaticamente il file Word dalla tua risposta
5. Concentrati SOLO sul contenuto: traduci/elabora tutto il testo e scrivilo nella risposta`;

          const systemIndex = messages.findIndex(m => m.role === 'system');
          if (systemIndex >= 0) {
            messages[systemIndex].content += docGenSystemPrompt;
          } else {
            messages.unshift({ role: 'system', content: docGenSystemPrompt });
          }
        }
      }

      // Inject memory context for new conversations (first user message)
      try {
        const memoryService = new MemoryService(fastify.db);
        const msgCount = messages.filter(m => m.role === 'user').length;
        if (msgCount <= 1) {
          const memoryContext = await memoryService.getContextForNewChat(user.id);
          if (memoryContext) {
            const systemIndex = messages.findIndex(m => m.role === 'system');
            if (systemIndex >= 0) {
              messages[systemIndex].content += '\n\n[Memory Context]\n' + memoryContext;
            } else {
              messages.unshift({ role: 'system', content: '[Memory Context]\n' + memoryContext });
            }
            fastify.log.info(`[Memory] Injected context for user ${user.id}`);
          }
        }
      } catch (memErr: any) {
        fastify.log.warn(`[Memory] Context injection failed: ${memErr.message}`);
      }

      // Set up SSE streaming
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Conversation-Id': conversationId.toString(),
        'X-Web-Search': webSearchPerformed ? 'true' : 'false'
      });

      // Stream response
      let fullResponse = '';
      let tokensInput = 0;
      let tokensOutput = 0;

      try {
        const stream = provider.streamComplete({
          model: body.model,
          messages,
          maxTokens: 4096,
          temperature: 0.7,
          stream: true,
          tools: toolContext ? getToolDefinitions() : undefined
        });

        let accumulatedToolCalls: any[] = [];
        let currentToolCall: any = null;

        for await (const chunk of stream) {
          // Handle Tool Definitions in Stream
          if (chunk.toolCalls && chunk.toolCalls.length > 0) {
            for (const tc of chunk.toolCalls) {
              if (tc.function && tc.function.name) {
                // Start new tool call
                if (currentToolCall) accumulatedToolCalls.push(currentToolCall);
                currentToolCall = {
                  id: tc.id,
                  name: tc.function.name,
                  arguments: tc.function.arguments || ''
                };
              } else if (tc.function && tc.function.arguments && currentToolCall) {
                // Append arguments
                currentToolCall.arguments += tc.function.arguments;
              }
            }
          }

          if (chunk.content) {
            fullResponse += chunk.content;
            reply.raw.write(`data: ${JSON.stringify({ content: chunk.content, done: false })}\n\n`);
          }
          if (chunk.done) {
            // If there's a pending tool call, finish it
            if (currentToolCall) accumulatedToolCalls.push(currentToolCall);

            // Execute tools if any
            if (accumulatedToolCalls.length > 0 && toolContext) {
              for (const tc of accumulatedToolCalls) {
                try {
                  const args = JSON.parse(tc.arguments);
                  fastify.log.info(`[Chat] Auto-executing tool in chat: ${tc.name}`);

                  const result = await executeTool(tc.name, args, toolContext);

                  if (result.success) {
                    // Build notification with download link if available
                    let notification: string;
                    if (result.output.downloadUrl) {
                      notification = `\n\n📄 **Documento generato**: [Scarica ${result.output.downloadFilename || result.output.path}](${result.output.downloadUrl})`;
                    } else {
                      notification = `\n\n> **System**: Generated file \`${result.output.path}\``;
                    }
                    reply.raw.write(`data: ${JSON.stringify({ content: notification, done: false })}\n\n`);
                    fullResponse += notification;
                  } else {
                    const err = `\n\n> **System**: Tool usage failed: ${result.error}`;
                    reply.raw.write(`data: ${JSON.stringify({ content: err, done: false })}\n\n`);
                    fullResponse += err;
                  }
                } catch (e: any) {
                  fastify.log.error(`[Chat] Tool execution error: ${e.message}`);
                }
              }
            }

            reply.raw.write(`data: ${JSON.stringify({ content: '', done: true, conversationId })}\n\n`);
          }
        }

        // Estimate tokens (rough approximation)
        tokensInput = Math.ceil(messages.reduce((acc, m) => acc + m.content.length / 4, 0));
        tokensOutput = Math.ceil(fullResponse.length / 4);

        // Post-processing: auto-generate DOCX from full AI response
        // This works for ALL models (including Ollama/Qwen that don't support tool calling)
        // The AI just needs to provide the translated/processed content - we generate the file server-side
        // Skip if a tool already generated a document (downloadUrl already in the response)
        const toolAlreadyGeneratedDoc = fullResponse.includes('/api/tools/download/');
        if (autoGenerateDocx && !toolAlreadyGeneratedDoc && fullResponse.trim().length > 50) {
          try {
            // Strip any markdown meta-commentary from the response, keep the actual content
            // Remove lines that are clearly AI meta-commentary (not document content)
            let docContent = fullResponse;

            // Also check for legacy [GENERATE_DOCX] markers and extract content if present
            const markerRegex = /\[GENERATE_DOCX(?:\s+title="([^"]*)")?\]\s*([\s\S]*?)\s*\[\/GENERATE_DOCX\]/;
            const markerMatch = docContent.match(markerRegex);
            if (markerMatch) {
              docContent = markerMatch[2].trim();
            }

            // Clean up: remove common AI preambles like "Ecco la traduzione:" or "Here is the translation:"
            const preamblePatterns = [
              /^(?:ecco|qui|di seguito)[^:.\n]*[:.]?\s*\n/i,
              /^(?:here is|below is|the following is)[^:.\n]*[:.]?\s*\n/i,
              /^(?:certamente|certo|ok|sì)[^:.\n]*[:.]?\s*\n/i,
            ];
            for (const pattern of preamblePatterns) {
              docContent = docContent.replace(pattern, '');
            }

            // Remove trailing AI commentary (e.g., "Let me know if you need changes")
            const trailingPatterns = [
              /\n\n(?:se hai|fammi sapere|spero|non esitare|let me know|feel free|hope this)[^\n]*$/i,
              /\n\n---\n\n?(?:nota|note|n\.b\.)[^\n]*$/i,
            ];
            for (const pattern of trailingPatterns) {
              docContent = docContent.replace(pattern, '');
            }

            docContent = docContent.trim();

            if (docContent.length > 30) {
              // Determine title from user message or use default
              const titleMatch = body.message.match(/(?:titolo|title)[:\s]+"?([^"\n]+)"?/i);
              const docTitle = titleMatch ? titleMatch[1].trim() : 'Documento_Tradotto';

              const { generateDocxBuffer } = await import('../../services/DocumentProcessorService.js');
              const buffer = await generateDocxBuffer(docContent, docTitle);

              const fsImport = await import('fs');
              const pathImport = await import('path');
              const generatedDir = pathImport.default.join(process.cwd(), 'public', 'generated');
              if (!fsImport.default.existsSync(generatedDir)) {
                fsImport.default.mkdirSync(generatedDir, { recursive: true });
              }

              const filename = `${docTitle.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.docx`;
              const filePath = pathImport.default.join(generatedDir, filename);
              fsImport.default.writeFileSync(filePath, buffer);

              const downloadUrl = `/api/tools/download/${filename}`;
              const downloadNotification = `\n\n📄 **Documento generato con successo!** [Scarica ${docTitle}.docx](${downloadUrl})`;

              reply.raw.write(`data: ${JSON.stringify({ content: downloadNotification, done: false })}\n\n`);
              fullResponse += downloadNotification;

              fastify.log.info(`[Chat] Auto-generated DOCX from AI response -> ${filename} (${docContent.length} chars)`);
            }
          } catch (docErr: any) {
            fastify.log.error(`[Chat] Auto DOCX generation failed: ${docErr.message}`);
            // Notify user of the error
            const errorNotice = `\n\n⚠️ Generazione documento fallita: ${docErr.message}`;
            reply.raw.write(`data: ${JSON.stringify({ content: errorNotice, done: false })}\n\n`);
            fullResponse += errorNotice;
          }
        }

        // Auto-save code blocks for coding models
        if (isAutoSaveModel(body.model) && fullResponse.length > 50) {
          try {
            const saveResult = await saveCodeBlocks(fullResponse, {
              projectName: `session_${conversationId}`
            });

            if (saveResult.savedFiles.length > 0) {
              const notification = formatSavedFilesNotification(saveResult);
              // Send notification as additional SSE event
              reply.raw.write(`data: ${JSON.stringify({
                content: notification,
                done: false,
                autoSave: true,
                savedFiles: saveResult.savedFiles.map(f => ({
                  filename: f.filename,
                  language: f.language,
                  path: f.path.replace('/data/shared-projects', '\\\\192.168.1.123\\projects').replace(/\//g, '\\\\')
                }))
              })}\n\n`);
              fastify.log.info(`[Chat] Auto-saved ${saveResult.savedFiles.length} code files for model ${body.model}`);
            }
          } catch (saveError: unknown) {
            const errMsg = saveError instanceof Error ? saveError.message : 'Unknown error';
            fastify.log.warn(`[Chat] Auto-save failed: ${errMsg}`);
          }
        }

      } catch (streamError: any) {
        const errorMessage = streamError?.message || 'Unknown stream error';
        console.log(`[Chat-DEBUG] ============ STREAM ERROR ============`);
        console.log(`[Chat-DEBUG] Error name: ${streamError?.name}`);
        console.log(`[Chat-DEBUG] Error message: ${errorMessage}`);
        console.log(`[Chat-DEBUG] Error stack: ${streamError?.stack?.substring(0, 500)}`);
        fastify.log.error(`[Chat] Stream error: ${errorMessage}`);

        // Provide specific error messages for known issues
        let userMessage = 'An error occurred while processing your request.';
        if (errorMessage.includes('Parlant')) {
          userMessage = 'Parlant AI Agent service error: ' + errorMessage;
        } else if (errorMessage.includes('timeout')) {
          userMessage = 'Request timed out. The AI service took too long to respond.';
        } else if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed')) {
          userMessage = 'Could not connect to the AI service. Please try again later.';
        }

        reply.raw.write(`data: ${JSON.stringify({ error: userMessage, done: true })}\n\n`);
        reply.raw.end();
        return;
      }

      // Save assistant message
      await insertOne(
        fastify.db,
        'INSERT INTO messages (conversation_id, role, content, tokens_input, tokens_output) VALUES (?, ?, ?, ?, ?)',
        [conversationId, 'assistant', fullResponse, tokensInput, tokensOutput]
      );

      // Record token usage
      const cost = calculateCost(body.model, tokensInput, tokensOutput);
      await insertOne(
        fastify.db,
        'INSERT INTO token_usage (user_id, conversation_id, provider, model, tokens_input, tokens_output, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [user.id, conversationId, providerName, body.model, tokensInput, tokensOutput, cost]
      );

      // Update monthly usage
      const yearMonth = new Date().toISOString().slice(0, 7);
      await fastify.db.execute(
        `INSERT INTO monthly_usage (user_id, \`year_month\`, provider, total_tokens_input, total_tokens_output, total_cost_usd, request_count)
         VALUES (?, ?, ?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE
         total_tokens_input = total_tokens_input + VALUES(total_tokens_input),
         total_tokens_output = total_tokens_output + VALUES(total_tokens_output),
         total_cost_usd = total_cost_usd + VALUES(total_cost_usd),
         request_count = request_count + 1`,
        [user.id, yearMonth, providerName, tokensInput, tokensOutput, cost]
      );

      // Update conversation timestamp
      await updateOne(
        fastify.db,
        'UPDATE conversations SET updated_at = NOW() WHERE id = ?',
        [conversationId]
      );

      // Auto-capture memory observations (async, non-blocking)
      try {
        const memoryService = new MemoryService(fastify.db);
        memoryService.autoCapture(user.id, conversationId, userMessage, fullResponse)
          .catch(err => fastify.log.warn(`[Memory] Auto-capture failed: ${err.message}`));
      } catch (memErr: any) {
        fastify.log.warn(`[Memory] Auto-capture init failed: ${memErr.message}`);
      }

      reply.raw.end();

    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }
  });

  // List conversations
  fastify.get('/conversations', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'List user conversations',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest) => {
    const user = request.user as { id: number };
    const query = request.query as { archived?: string; limit?: string; offset?: string };

    const isArchived = query.archived === 'true';
    const limit = parseInt(query.limit || '20');
    const offset = parseInt(query.offset || '0');

    const conversations = await findMany<Conversation>(
      fastify.db,
      `SELECT c.*,
              (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
       FROM conversations c
       WHERE c.user_id = ? AND c.is_archived = ?
       ORDER BY c.updated_at DESC
       LIMIT ? OFFSET ?`,
      [user.id, isArchived, limit, offset]
    );

    return conversations;
  });

  // Get conversation messages
  fastify.get('/conversations/:id/messages', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get conversation messages',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const params = request.params as { id: string };

    // Verify ownership
    const conversation = await findOne<Conversation>(
      fastify.db,
      'SELECT * FROM conversations WHERE id = ? AND user_id = ?',
      [params.id, user.id]
    );

    if (!conversation) {
      return reply.status(404).send({ error: 'Conversation not found' });
    }

    const messages = await findMany<DbMessage>(
      fastify.db,
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [params.id]
    );

    return {
      conversation,
      messages
    };
  });

  fastify.delete('/conversations/:id/undo', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Undo the last message in a conversation',
      tags: ['chat'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        },
        required: ['id']
      },
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const conversationId = parseInt(request.params.id);

    // Verify ownership
    const conversation = await findOne<Conversation>(
      fastify.db,
      'SELECT id FROM conversations WHERE id = ? AND user_id = ?',
      [conversationId, user.id]
    );

    if (!conversation) {
      return reply.status(404).send({ error: 'Conversation not found' });
    }

    // Find the last assistant message and the user message immediately preceding it
    // We order by ID desc to get the most recent ones
    const lastAssistantMessage = await findOne<{ id: number; role: string }>(
      fastify.db,
      'SELECT id, role FROM messages WHERE conversation_id = ? AND role = "assistant" ORDER BY id DESC LIMIT 1',
      [conversationId]
    );

    const idsToDelete: number[] = [];

    if (lastAssistantMessage) {
      idsToDelete.push(lastAssistantMessage.id);

      // Find the user message before this assistant message
      const lastUserMessage = await findOne<{ id: number; role: string }>(
        fastify.db,
        'SELECT id, role FROM messages WHERE conversation_id = ? AND role = "user" AND id < ? ORDER BY id DESC LIMIT 1',
        [conversationId, lastAssistantMessage.id]
      );

      if (lastUserMessage) {
        idsToDelete.push(lastUserMessage.id);
      }
    } else {
      // If no assistant message, maybe just undo the last user message
      const lastUserMessage = await findOne<{ id: number; role: string }>(
        fastify.db,
        'SELECT id, role FROM messages WHERE conversation_id = ? AND role = "user" ORDER BY id DESC LIMIT 1',
        [conversationId]
      );
      if (lastUserMessage) {
        idsToDelete.push(lastUserMessage.id);
      }
    }

    if (idsToDelete.length > 0) {
      const placeholders = idsToDelete.map(() => '?').join(',');
      await fastify.db.execute(
        `DELETE FROM messages WHERE id IN (${placeholders})`,
        idsToDelete
      );
    }

    return {
      message: 'Undone successfully',
      deletedCount: idsToDelete.length,
      conversationId
    };
  });

  // Delete conversation
  fastify.delete('/conversations/:id', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Delete a conversation',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const params = request.params as { id: string };

    const result = await updateOne(
      fastify.db,
      'DELETE FROM conversations WHERE id = ? AND user_id = ?',
      [params.id, user.id]
    );

    if (result === 0) {
      return reply.status(404).send({ error: 'Conversation not found' });
    }

    // Log audit
    await insertOne(
      fastify.db,
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address) VALUES (?, ?, ?, ?, ?)',
      [user.id, 'delete_conversation', 'conversation', params.id, request.ip]
    );

    return { message: 'Conversation deleted' };
  });

  // Archive/unarchive conversation
  fastify.patch('/conversations/:id/archive', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Archive or unarchive a conversation',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const params = request.params as { id: string };
    const body = request.body as { archived: boolean };

    const result = await updateOne(
      fastify.db,
      'UPDATE conversations SET is_archived = ? WHERE id = ? AND user_id = ?',
      [body.archived, params.id, user.id]
    );

    if (result === 0) {
      return reply.status(404).send({ error: 'Conversation not found' });
    }

    return { message: body.archived ? 'Conversation archived' : 'Conversation unarchived' };
  });

  // Bulk Delete Conversations
  fastify.delete('/conversations', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Delete multiple or all conversations',
      tags: ['chat'],
      body: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'number' } },
          all: { type: 'boolean' }
        }
      },
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const body = request.body as { ids?: number[], all?: boolean };

    if (body.all) {
      // Delete ALL conversations for this user
      await fastify.db.execute(
        'DELETE FROM conversations WHERE user_id = ?',
        [user.id]
      );
      // Audit log (generic)
      await insertOne(
        fastify.db,
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address) VALUES (?, ?, ?, ?, ?)',
        [user.id, 'bulk_delete_all', 'conversation', 0, request.ip]
      );
      return { message: 'All conversations deleted' };
    } else if (body.ids && body.ids.length > 0) {
      // Delete specific IDs
      const placeholders = body.ids.map(() => '?').join(',');
      await fastify.db.execute(
        `DELETE FROM conversations WHERE id IN (${placeholders}) AND user_id = ?`,
        [...body.ids, user.id]
      );
      // Audit log ?? Too many entries. Just log one action.
      await insertOne(
        fastify.db,
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address) VALUES (?, ?, ?, ?, ?)',
        [user.id, 'bulk_delete', 'conversation', body.ids.length, request.ip]
      );
      return { message: `${body.ids.length} conversations deleted` };
    } else {
      return reply.status(400).send({ error: 'Must provide "ids" array or "all": true' });
    }
  });

  // Bulk Archive Conversations
  fastify.patch('/conversations/archive', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Archive or unarchive multiple/all conversations',
      tags: ['chat'],
      body: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'number' } },
          all: { type: 'boolean' },
          archived: { type: 'boolean' }
        },
        required: ['archived']
      },
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const body = request.body as { ids?: number[], all?: boolean, archived: boolean }; // default to true if undefined? No, required.

    const targetState = body.archived;

    if (body.all) {
      // Archive ALL
      await fastify.db.execute(
        'UPDATE conversations SET is_archived = ? WHERE user_id = ?',
        [targetState, user.id]
      );
      return { message: targetState ? 'All conversations archived' : 'All conversations unarchived' };
    } else if (body.ids && body.ids.length > 0) {
      const placeholders = body.ids.map(() => '?').join(',');
      await fastify.db.execute(
        `UPDATE conversations SET is_archived = ? WHERE id IN (${placeholders}) AND user_id = ?`,
        [targetState, ...body.ids, user.id]
      );
      return { message: targetState ? `${body.ids.length} conversations archived` : `${body.ids.length} conversations unarchived` };
    } else {
      return reply.status(400).send({ error: 'Must provide "ids" array or "all": true' });
    }
  });

  // Get available models - from database (admin-enabled only)
  fastify.get('/models', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get AI models enabled by admin',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    // Get enabled models from database with their provider info
    interface EnabledModel {
      model_id: string;
      display_name: string;
      description: string | null;
      provider_name: string;
      provider_type: string;
      supports_streaming: boolean;
      supports_functions: boolean;
      supports_vision: boolean;
    }

    const models = await findMany<EnabledModel>(
      fastify.db,
      `SELECT m.model_id, m.display_name, m.description,
              p.name as provider_name, p.provider_type,
              m.supports_streaming, m.supports_functions, m.supports_vision
       FROM ai_models m
       JOIN ai_providers p ON m.provider_id = p.id
       WHERE m.is_enabled = TRUE
         AND p.is_enabled = TRUE
       ORDER BY p.name, m.sort_order, m.display_name`
    );

    // Transform to expected format
    const result = models.map(m => ({
      id: m.model_id,
      name: m.display_name,
      provider: m.provider_name,
      description: m.description || undefined,
      supportsStreaming: m.supports_streaming,
      supportsFunctions: m.supports_functions,
      supportsVision: m.supports_vision
    }));

    // Also fetch Parlant agents if the service is healthy
    try {
      const parlantHealthy = await checkParlantHealth();
      if (parlantHealthy) {
        const parlantAgents = await fetchParlantAgents();
        fastify.log.info(`Found ${parlantAgents.length} Parlant agents`);

        // Add Parlant agents as "models"
        for (const agent of parlantAgents) {
          result.push({
            id: `parlant:${agent.id}`,
            name: agent.name || `Parlant Agent`,
            provider: 'Parlant',
            description: agent.description || 'Controlled AI Agent with Guidelines',
            supportsStreaming: true,
            supportsFunctions: false,
            supportsVision: false
          });
        }
      }
    } catch (err: any) {
      fastify.log.warn(`Failed to fetch Parlant agents: ${err?.message || err}`);
    }

    fastify.log.info(`Returning ${result.length} enabled models from database`);
    return result;
  });

  // Clear models cache (useful when provider settings change)
  fastify.post('/models/refresh', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Clear the models cache to force refresh',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    clearModelsCache();
    return { message: 'Models cache cleared' };
  });

  // Agentic chat with tool support (for task execution)
  const agenticSchema = z.object({
    conversationId: z.number().optional(),
    projectId: z.number(),
    model: z.string(),
    message: z.string().min(1),
    systemPrompt: z.string().optional(),
    enableTools: z.boolean().optional().default(true)
  });

  fastify.post('/agentic', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Agentic chat with tool support for file operations',
      tags: ['chat'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };
    const reqId = `AG-${Date.now()}`; // Unique request ID for tracing

    fastify.log.info(`[${reqId}] ============ AGENTIC CHAT REQUEST ============`);
    fastify.log.info(`[${reqId}] STEP 1: User: ${user.id}, Time: ${new Date().toISOString()}`);

    try {
      const body = agenticSchema.parse(request.body);
      fastify.log.info(`[${reqId}] STEP 1b: Body parsed - Model: ${body.model}, Message length: ${body.message?.length || 0}`);

      // ============================================================
      // ECHO MODE TEST - Send "/test" to verify SSE streaming works
      // ============================================================
      if (body.message.startsWith('/test')) {
        fastify.log.info(`[${reqId}] ECHO MODE: Testing SSE stream...`);
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });
        reply.raw.write(`data: ${JSON.stringify({ content: 'Echo test: Stream working! ', done: false })}\n\n`);
        await new Promise(resolve => setTimeout(resolve, 500));
        reply.raw.write(`data: ${JSON.stringify({ content: 'Second chunk received. ', done: false })}\n\n`);
        await new Promise(resolve => setTimeout(resolve, 500));
        reply.raw.write(`data: ${JSON.stringify({ content: 'Third chunk. Stream OK!', done: false })}\n\n`);
        reply.raw.write(`data: ${JSON.stringify({ content: '', done: true, conversationId: 0 })}\n\n`);
        reply.raw.end();
        fastify.log.info(`[${reqId}] ECHO MODE: Test complete`);
        return;
      }
      // ============================================================

      // Dynamically import tool service
      const { getToolDefinitions, executeTool } = await import('../../services/ToolService.js');

      // Validate projectId - fallback to default if invalid
      let validProjectId = body.projectId;
      if (!validProjectId || validProjectId === 0 || validProjectId < 1) {
        fastify.log.warn(`[${reqId}] Invalid projectId: ${body.projectId} - attempting to use user's first project`);
        // Try to get user's first project as fallback
        const firstProject = await findOne<{ id: number }>(
          fastify.db,
          'SELECT id FROM projects WHERE owner_id = ? ORDER BY id ASC LIMIT 1',
          [user.id]
        );
        if (firstProject) {
          validProjectId = firstProject.id;
          fastify.log.info(`[${reqId}] Using fallback project ID: ${validProjectId}`);
        } else {
          return reply.status(400).send({
            error: 'Invalid project ID and no default project found',
            hint: 'Please select a valid project before running tasks'
          });
        }
      }

      // Get project context for tools
      const project = await findOne<{ name: string; owner_id: number }>(
        fastify.db,
        'SELECT name, owner_id FROM projects WHERE id = ?',
        [validProjectId]
      );

      if (!project) {
        return reply.status(404).send({ error: `Project ${validProjectId} not found` });
      }

      const owner = await findOne<{ name: string; email: string }>(
        fastify.db,
        'SELECT name, email FROM users WHERE id = ?',
        [project.owner_id]
      );

      const toolContext = {
        userName: owner?.name || owner?.email?.split('@')[0] || `user_${project.owner_id}`,
        projectName: project.name,
        projectId: validProjectId,
        userId: user.id
      };

      // Ensure project folder exists
      const { createProjectFolder } = await import('../../services/StorageService.js');
      await createProjectFolder(toolContext.userName, toolContext.projectName);

      // Get tool definitions
      const tools = body.enableTools ? getToolDefinitions() : [];

      // Build messages
      let conversationId = body.conversationId;
      let messages: { role: 'user' | 'assistant' | 'system' | 'tool'; content: any; tool_calls?: any[]; tool_call_id?: string; name?: string }[] = [];

      if (conversationId) {
        const conversation = await findOne<Conversation>(
          fastify.db,
          'SELECT * FROM conversations WHERE id = ? AND user_id = ?',
          [conversationId, user.id]
        );

        if (!conversation) {
          return reply.status(404).send({ error: 'Conversation not found' });
        }

        const dbMessages = await findMany<DbMessage>(
          fastify.db,
          'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
          [conversationId]
        );

        messages = dbMessages.map(m => ({
          role: m.role as any,
          content: m.content
        }));
      } else {
        const title = body.message.slice(0, 100);
        const providerName = AIProviderFactory.getProviderName(body.model);
        conversationId = await insertOne(
          fastify.db,
          'INSERT INTO conversations (user_id, title, model, provider, system_prompt) VALUES (?, ?, ?, ?, ?)',
          [user.id, title, body.model, providerName, body.systemPrompt || null]
        );
      }

      // Add user message
      messages.push({ role: 'user', content: body.message });
      await insertOne(
        fastify.db,
        'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)',
        [conversationId, 'user', body.message]
      );

      // Set up SSE streaming
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Conversation-Id': conversationId.toString()
      });

      const sendDebug = (msg: string) => {
        fastify.log.info(`[AGENTIC-DEBUG] ${msg}`);
      };

      // ============================================================
      // ECHO MODE TEST - Send "/test" to verify SSE streaming works
      // ============================================================
      if (body.message.startsWith('/test')) {
        fastify.log.info(`[${reqId}] ECHO MODE: Testing SSE stream...`);
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });
        reply.raw.write(`data: ${JSON.stringify({ content: 'Echo test: Stream working! ', done: false })}\n\n`);
        await new Promise(resolve => setTimeout(resolve, 500));
        reply.raw.write(`data: ${JSON.stringify({ content: 'Second chunk received. ', done: false })}\n\n`);
        await new Promise(resolve => setTimeout(resolve, 500));
        reply.raw.write(`data: ${JSON.stringify({ content: 'Third chunk. Stream OK!', done: false })}\n\n`);
        reply.raw.write(`data: ${JSON.stringify({ content: '', done: true, conversationId: 0 })}\n\n`);
        reply.raw.end();
        fastify.log.info(`[${reqId}] ECHO MODE: Test complete`);
        return;
      }
      // ============================================================

      // AI provider setup
      const providerName = AIProviderFactory.getProviderName(body.model);
      const provider = AIProviderFactory.getProvider(body.model);
      fastify.log.info(`[${reqId}] STEP 2: Using provider ${providerName} for model ${body.model}`);

      // Agentic loop - continue until no tool calls
      let fullResponse = '';
      let tokensInput = 0;
      let tokensOutput = 0;
      let iteration = 0;
      const maxIterations = 10; // Prevent infinite loops

      // ============================================================
      // 30-SECOND WATCHDOG TIMER - Prevents stalled requests
      // ============================================================
      const TIMEOUT_MS = 30000;
      let watchdogTimer: NodeJS.Timeout | null = null;
      let requestAborted = false;

      const resetWatchdog = (context: string) => {
        if (watchdogTimer) clearTimeout(watchdogTimer);
        watchdogTimer = setTimeout(() => {
          if (!requestAborted) {
            requestAborted = true;
            const timeoutMsg = `⏱️ TIMEOUT: No response after 30s during "${context}"`;
            fastify.log.error(`[${reqId}] ${timeoutMsg}`);
            sendDebug(`❌ ${timeoutMsg}`);
            reply.raw.write(`data: ${JSON.stringify({
              error: 'REQUEST_TIMEOUT_30S',
              message: timeoutMsg,
              context,
              done: true
            })}\n\n`);
            reply.raw.end();
          }
        }, TIMEOUT_MS);
      };

      const clearWatchdog = () => {
        if (watchdogTimer) {
          clearTimeout(watchdogTimer);
          watchdogTimer = null;
        }
      };

      // Start the watchdog
      resetWatchdog('initial_connection');

      // Send immediate "thinking" notification to keep connection alive
      reply.raw.write(`data: ${JSON.stringify({ status: 'thinking', message: 'Connecting to AI...', reqId })}\n\n`);
      resetWatchdog('connecting_to_ai');

      const systemPrompt = body.systemPrompt || `You are a skilled software developer AI assistant. Your ONLY purpose is to write and manage code files and Office documents.

CRITICAL INSTRUCTIONS:
1. You DO NOT have the ability to update Kanban board status or move cards. Do not try.
2. Your available tools are: write_file, read_file, list_files, create_folder, generate_word_document, generate_excel_document, generate_powerpoint_document
3. When asked to create code or documents, immediately use the appropriate tool to save them.
4. Save files to the project storage using relative paths (e.g., "src/main.py", "index.html", "outputs/report.docx")
5. Always create complete, working content - never leave placeholders
6. After writing files, briefly explain what you created

Focus 100% on generation. Start writing files immediately.`;

      // Inject system prompt if not present in messages
      if (!messages.find(m => m.role === 'system')) {
        messages.unshift({ role: 'system', content: systemPrompt });
      }

      while (iteration < maxIterations && !requestAborted) {
        iteration++;
        resetWatchdog(`iteration_${iteration}_start`);
        sendDebug(`🔄 Iteration ${iteration}/${maxIterations} - Calling AI...`);
        fastify.log.info(`[${reqId}] STEP 3: Starting iteration ${iteration}, messages count: ${messages.length}`);

        try {
          const apiStartTime = Date.now();

          // Call provider.complete (non-streaming for tool handling in a loop is usually more robust)
          // Though we could stream if we wanted chunked text + tool calls later.
          const response = await provider.complete({
            model: body.model,
            messages,
            maxTokens: 4096,
            temperature: 0.7,
            tools: tools as any
          });

          // AI responded - reset watchdog
          resetWatchdog(`iteration_${iteration}_processing`);
          const apiDuration = Date.now() - apiStartTime;
          sendDebug(`✅ AI responded in ${apiDuration}ms`);
          fastify.log.info(`[${reqId}] STEP 3b: Provider responded in ${apiDuration}ms`);

          tokensInput += response.tokensInput;
          tokensOutput += response.tokensOutput;

          if (response.content) {
            fullResponse += response.content;
            reply.raw.write(`data: ${JSON.stringify({ content: response.content, done: false, iteration })}\n\n`);
          }

          // Process tool calls
          const toolCalls = response.toolCalls;
          if (toolCalls && toolCalls.length > 0) {
            sendDebug(`🔧 Processing ${toolCalls.length} tool calls...`);
            fastify.log.info(`[${reqId}] STEP 4: Tool calls detected: ${toolCalls.length}`);

            const toolResults: any[] = [];

            // Add assistant message with tool calls to history
            messages.push({
              role: 'assistant',
              content: response.content || '',
              tool_calls: toolCalls
            } as any);

            for (const toolCall of toolCalls) {
              const name = toolCall.function?.name || toolCall.name;
              const input = typeof toolCall.function?.arguments === 'string'
                ? JSON.parse(toolCall.function.arguments)
                : (toolCall.function?.arguments || toolCall.input);
              const id = toolCall.id;

              sendDebug(`🛠️ Tool: ${name}`);

              // Notify client
              reply.raw.write(`data: ${JSON.stringify({
                toolUse: { name, input },
                done: false,
                iteration
              })}\n\n`);

              let result: { success: boolean; output?: any; error?: string };
              try {
                resetWatchdog(`tool_${name}`);
                result = await executeTool(name, input, toolContext);
                resetWatchdog(`tool_${name}_done`);
                sendDebug(`✅ ${name} result: ${result.success ? 'Success' : 'Error'}`);
              } catch (toolError: any) {
                sendDebug(`⚠️ ${name} crashed: ${toolError.message}`);
                result = { success: false, error: toolError.message };
              }

              // Notify client
              reply.raw.write(`data: ${JSON.stringify({
                toolResult: { name, success: result.success, output: result.output, error: result.error },
                done: false,
                iteration
              })}\n\n`);

              toolResults.push({
                role: 'tool',
                tool_call_id: id,
                name: name,
                content: result.success ? JSON.stringify(result.output) : `Error: ${result.error}`
              });
            }

            // Add tool results to history
            messages.push(...toolResults);
          } else {
            // No tool calls, loop finished
            break;
          }
        } catch (error: any) {
          clearWatchdog();
          const isAbort = error.name === 'AbortError' || error.message?.includes('abort');

          if (isAbort) {
            const timeoutMsg = `⏱️ TIMEOUT: Request aborted after ${TIMEOUT_MS / 1000}s - AI model did not respond`;
            sendDebug(`❌ ${timeoutMsg}`);
            fastify.log.error({
              msg: timeoutMsg,
              reqId,
              iteration,
              source: 'backend',
              type: 'HARD_TIMEOUT'
            });
            reply.raw.write(`data: ${JSON.stringify({
              error: 'REQUEST_TIMEOUT_30S',
              message: timeoutMsg,
              done: true
            })}\n\n`);
          } else {
            sendDebug(`❌ ERROR in iteration ${iteration}: ${error.message}`);
            fastify.log.error({
              msg: `Agentic error in iteration ${iteration}: ${error.message}`,
              reqId,
              source: 'backend',
              error: error.stack
            });
            reply.raw.write(`data: ${JSON.stringify({ error: error.message, done: true })}\n\n`);
          }

          reply.raw.end();
          return;
        }
      }

      // Clear watchdog - agent completed successfully
      clearWatchdog();

      // Final done message
      sendDebug(`🎉 AGENT COMPLETE - ${iteration} iterations, ${tokensInput + tokensOutput} tokens used`);
      reply.raw.write(`data: ${JSON.stringify({ content: '', done: true, conversationId, iterations: iteration })}\n\n`);

      // Save assistant message
      if (fullResponse) {
        await insertOne(
          fastify.db,
          'INSERT INTO messages (conversation_id, role, content, tokens_input, tokens_output) VALUES (?, ?, ?, ?, ?)',
          [conversationId, 'assistant', fullResponse, tokensInput, tokensOutput]
        );
      }

      // Record usage
      const cost = calculateCost(body.model, tokensInput, tokensOutput);
      await insertOne(
        fastify.db,
        'INSERT INTO token_usage (user_id, conversation_id, provider, model, tokens_input, tokens_output, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [user.id, conversationId, providerName, body.model, tokensInput, tokensOutput, cost]
      );

      await updateOne(
        fastify.db,
        'UPDATE conversations SET updated_at = NOW() WHERE id = ?',
        [conversationId]
      );

      reply.raw.end();

    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }
  });
}
