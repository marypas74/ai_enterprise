import path from 'path';
import { promises as fsPromises } from 'fs';
import { FastifyInstance } from 'fastify';
import { findOne, findMany, insertOne } from '../../database/index.js';
import { AIProviderFactory, Message } from '../ai/providers.js';
import { isAutoSaveModel } from '../../services/CodeAutoSaveService.js';
import { enhanceWithWebSearch } from '../../services/WebSearchService.js';
import { MemoryService } from '../memory/service.js';
import { ConversationalFormService } from '../../services/ConversationalFormService.js';
import { NativeDocBlock, ToolContext, Conversation, DbMessage } from './types.js';
import { detectDocumentFormat } from './streaming.js';

/**
 * Prepare tool context for the current user's project, creating one if needed.
 */
export async function prepareToolContext(
  fastify: FastifyInstance,
  userId: number
): Promise<ToolContext | null> {
  let firstProject = await findOne<{ id: number, name: string, owner_id: number }>(
    fastify.db,
    'SELECT id, name, owner_id FROM projects WHERE owner_id = ? ORDER BY id ASC LIMIT 1',
    [userId]
  );

  if (!firstProject) {
    fastify.log.info(`[Chat] Auto-creating default project for user ${userId}`);
    const projectId = await insertOne(
      fastify.db,
      'INSERT INTO projects (name, description, owner_id, color, icon) VALUES (?, ?, ?, ?, ?)',
      ['Progetto Predefinito', 'Creato automaticamente per abilitare gli strumenti AI.', userId, '#3b82f6', 'folder']
    );

    firstProject = {
      id: projectId,
      name: 'Progetto Predefinito',
      owner_id: userId
    };
  }

  if (!firstProject) return null;

  const owner = await findOne<{ name: string; email: string }>(
    fastify.db,
    'SELECT name, email FROM users WHERE id = ?',
    [firstProject.owner_id]
  );

  const toolContext: ToolContext = {
    userName: owner?.name || owner?.email?.split('@')[0] || `user_${firstProject.owner_id}`,
    projectName: firstProject.name,
    projectId: firstProject.id,
    userId,
    db: fastify.db,
    log: fastify.log
  };

  const { createProjectFolder } = await import('../../services/StorageService.js');
  await createProjectFolder(toolContext.userName, toolContext.projectName);

  return toolContext;
}

/**
 * Load or create a conversation and return the initial messages array.
 */
export async function loadOrCreateConversation(
  fastify: FastifyInstance,
  opts: {
    userId: number;
    conversationId?: number;
    model: string;
    providerName: string;
    systemPrompt?: string;
    messageText: string;
  }
): Promise<{ conversationId: number; messages: Message[] }> {
  let conversationId = opts.conversationId;
  let messages: Message[] = [];

  if (conversationId) {
    const conversation = await findOne<Conversation>(
      fastify.db,
      'SELECT * FROM conversations WHERE id = ? AND user_id = ?',
      [conversationId, opts.userId]
    );

    if (!conversation) {
      throw Object.assign(new Error('Conversation not found'), { statusCode: 404 });
    }

    const dbMessages = await findMany<DbMessage>(
      fastify.db,
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [conversationId]
    );

    messages = dbMessages.map(m => ({ role: m.role, content: m.content }));

    if (conversation.system_prompt && !messages.some(m => m.role === 'system')) {
      messages.unshift({ role: 'system', content: conversation.system_prompt });
    }
  } else {
    const title = opts.messageText.slice(0, 100);
    conversationId = await insertOne(
      fastify.db,
      'INSERT INTO conversations (user_id, title, model, provider, system_prompt) VALUES (?, ?, ?, ?, ?)',
      [opts.userId, title, opts.model, opts.providerName, opts.systemPrompt || null]
    );

    if (opts.systemPrompt) {
      messages.push({ role: 'system', content: opts.systemPrompt });
      await insertOne(
        fastify.db,
        'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)',
        [conversationId, 'system', opts.systemPrompt]
      );
    }
  }

  return { conversationId: conversationId!, messages };
}

/**
 * Inject conversational form extraction context into messages if there is an active form session.
 * Returns the active form session (or null).
 */
export async function injectFormContext(
  fastify: FastifyInstance,
  userId: number,
  conversationId: number,
  userMessage: string,
  messages: Message[]
): Promise<any> {
  const formService = new ConversationalFormService(fastify.db);
  const activeFormSession = await formService.getActiveSession(userId, conversationId);
  if (!activeFormSession || activeFormSession.state === 'closed') return null;

  const formDef = await findOne<any>(fastify.db, 'SELECT * FROM conversational_forms WHERE id = ?', [activeFormSession.form_id]);
  if (!formDef) return activeFormSession;

  const parsedForm = {
    ...formDef,
    json_schema: typeof formDef.json_schema === 'string' ? JSON.parse(formDef.json_schema) : formDef.json_schema,
  };
  const parsedSession = {
    ...activeFormSession,
    collected_data: typeof activeFormSession.collected_data === 'string' ? JSON.parse(activeFormSession.collected_data) : activeFormSession.collected_data,
    missing_fields: typeof activeFormSession.missing_fields === 'string' ? JSON.parse(activeFormSession.missing_fields) : activeFormSession.missing_fields,
  };
  const extractionPrompt = formService.buildExtractionPrompt(parsedForm, parsedSession, userMessage);
  const formSystemMsg = `[ACTIVE FORM SESSION]\n${extractionPrompt}\n\nAfter extracting form data, ALSO respond naturally to the user. If you extracted data, mention what you captured. If fields are still missing, ask about the next missing field conversationally.`;
  const systemIndex = messages.findIndex(m => m.role === 'system');
  if (systemIndex >= 0) {
    messages[systemIndex].content += '\n\n' + formSystemMsg;
  } else {
    messages.unshift({ role: 'system', content: formSystemMsg });
  }
  fastify.log.info(`[Form] Active form session ${activeFormSession.id} for conversation ${conversationId}, injected extraction prompt`);

  return activeFormSession;
}

/**
 * Process attachments and return native doc blocks + the modified user message.
 */
export async function processAttachments(
  fastify: FastifyInstance,
  opts: {
    attachmentIds: number[];
    userId: number;
    model: string;
    originalMessage: string;
    userMessage: string;
  }
): Promise<{ nativeDocBlocks: NativeDocBlock[]; userMessage: string }> {
  const nativeDocBlocks: NativeDocBlock[] = [];
  const placeholders = opts.attachmentIds.map(() => '?').join(',');
  let attachments: any[] = [];

  for (let attempt = 0; attempt < 90; attempt++) {
    attachments = await findMany<any>(
      fastify.db,
      `SELECT id, original_name, content_type, processing_status, processed_content, file_path, file_size
       FROM chat_attachments
       WHERE id IN (${placeholders}) AND user_id = ?`,
      [...opts.attachmentIds, opts.userId]
    );
    const allDone = attachments.every((a: any) => a.processing_status === 'completed' || a.processing_status === 'failed');
    if (allDone || attachments.length === 0) break;
    fastify.log.debug(`[Chat] Waiting for attachment processing... attempt ${attempt + 1}/30`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  const contextParts: string[] = [];
  const isAnthropicProvider = AIProviderFactory.getProviderName(opts.model) === 'anthropic';

  for (const a of attachments) {
    if (isAnthropicProvider && a.content_type === 'application/pdf'
        && a.file_path && a.file_size && a.file_size < 32 * 1024 * 1024) {
      try {
        const storageRoot = path.resolve(process.env.STORAGE_ROOT || process.cwd());
        const resolvedPath = path.resolve(a.file_path);
        if (!resolvedPath.startsWith(storageRoot + path.sep) && resolvedPath !== storageRoot) {
          throw new Error('Invalid attachment path');
        }
        const pdfBuffer = await fsPromises.readFile(resolvedPath);
        const pdfBase64 = pdfBuffer.toString('base64');
        nativeDocBlocks.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          title: a.original_name,
          citations: { enabled: true },
          cache_control: { type: 'ephemeral' },
        });
        fastify.log.debug(`[Chat] Native PDF document block: ${a.original_name} (${Math.round(a.file_size / 1024)} KB)`);
        continue;
      } catch (nativePdfErr: any) {
        fastify.log.warn(`[Chat] Native PDF failed for ${a.original_name}, falling back to text: ${nativePdfErr.message}`);
      }
    }

    if (!a.processed_content) continue;

    if (a.processed_content.length < 30000) {
      contextParts.push(
        `[Allegato ID=${a.id}: ${a.original_name} (${a.content_type})]\n` +
        `${a.processed_content}\n` +
        `[Fine allegato]`
      );
      fastify.log.debug(`[Chat] Injected FULL content for ${a.original_name} (${a.processed_content.length} chars)`);
    } else {
      let chunkContext: string | null = null;

      try {
        const { searchSimilar } = await import('../../services/VectorStoreService.js');
        const semanticResults = await searchSimilar(fastify.db, opts.originalMessage, {
          attachmentIds: [a.id],
          limit: 8,
          scoreThreshold: 0.3,
        });
        if (semanticResults.length > 0) {
          chunkContext = semanticResults.map((r: any) => r.content).join('\n\n---\n\n');
          fastify.log.debug(`[Chat] Used ${semanticResults.length} semantic chunks for ${a.original_name}`);
        }
      } catch { /* Vector store not available */ }

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
            const relevant = selectRelevantChunks(chunkObjs, opts.originalMessage, 5);
            if (relevant.length > 0) {
              chunkContext = relevant.map(c => c.content).join('\n\n---\n\n');
            }
          }
        } catch { /* Chunking not available */ }
      }

      const content = chunkContext || a.processed_content.substring(0, 15000) + '\n... [contenuto troncato, usa get_attachment_text per il testo completo]';
      contextParts.push(
        `[Allegato ID=${a.id}: ${a.original_name} (${a.content_type})]\n` +
        `${content}\n` +
        `[Fine allegato]`
      );
    }
  }

  let userMessage = opts.userMessage;
  if (contextParts.length > 0) {
    const attachmentContext = contextParts.join('\n\n');
    userMessage = `${attachmentContext}\n\n---\nDomanda utente: ${opts.originalMessage}`;
    fastify.log.debug(`[Chat] Added context from ${contextParts.length} attachments`);
  } else {
    fastify.log.debug('[Chat] Attachments found but no processed content available yet');
  }

  return { nativeDocBlocks, userMessage };
}

/**
 * Inject system prompts for coding models, web search, tools, doc generation, and memory.
 */
export async function injectSystemPrompts(
  fastify: FastifyInstance,
  messages: Message[],
  opts: {
    model: string;
    userMessage: string;
    userId: number;
    supportsTools: boolean;
    toolContext: ToolContext | null;
    attachmentIds?: number[];
  }
): Promise<{ webSearchPerformed: boolean; autoGenerateDoc: false | 'docx' | 'pptx' | 'xlsx' | 'pdf' }> {
  // Add coding system prompt for coder models
  if (isAutoSaveModel(opts.model)) {
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

  // Check if web search is needed
  let webSearchPerformed = false;
  try {
    const searchResult = await enhanceWithWebSearch(opts.userMessage);
    if (searchResult.shouldSearch && searchResult.searchContext) {
      webSearchPerformed = true;
      fastify.log.info(`[Chat] Web search performed, found ${searchResult.searchResponse?.results?.length || 0} results`);
      const searchSystemMessage = `Hai accesso ai risultati di ricerca web aggiornati. Usali per fornire informazioni accurate e attuali.\n${searchResult.searchContext}`;
      const systemIndex = messages.findIndex(m => m.role === 'system');
      if (systemIndex >= 0) {
        messages[systemIndex].content += '\n\n' + searchSystemMessage;
      } else {
        messages.unshift({ role: 'system', content: searchSystemMessage });
      }
    }
  } catch (searchError: any) {
    fastify.log.warn(`[Chat] Web search failed: ${searchError.message}`);
  }

  // Inject Tool System Prompt
  if (opts.toolContext) {
    const toolSystemPrompt = `\n\n[STRUMENTI DISPONIBILI]
Hai accesso a questi strumenti:
1. **execute_python(code)**: Esegui Python in una sandbox. In Python, usa l'oggetto "tool" pre-inizializzato:
   - tool.read_file(path), tool.write_file(path, content), tool.list_files(path)
   - tool.web_search(query), tool.http_get(url), tool.web_extract(url)
   - tool.vector_search(query), tool.vector_upsert(text, metadata)
   - tool.dataframe(data) per DataFrame pandas. Usa print() per l'output.
2. **vector_memory_search(query)**: Cerca nella memoria vettoriale contesto rilevante.
3. **generate_word_document / generate_excel_document / generate_powerpoint_document**: Crea file Office.
4. **get_attachment_text(attachment_id)**: Leggi il testo COMPLETO di un file caricato.
5. **web_search(query)**: Cerca informazioni aggiornate sul web.

[ISTRUZIONI CRITICHE]
- Il contenuto di qualsiasi file caricato (PDF, DOCX, ecc.) è GIÀ INCLUSO nel messaggio utente sopra, tra i marcatori [Allegato ...] e [Fine allegato].
- PUOI leggerlo. NON dire che non puoi leggere o vedere il file. Il testo È il contenuto del file.
- Per compiti complessi multi-step, preferisci execute_python per orchestrare tutto in una sola chiamata.
- USA SEMPRE gli strumenti per le operazioni sui file. NON dire MAI che non puoi creare file.
- Usa percorsi relativi come "output/translated.docx".`;

    const systemIndex = messages.findIndex(m => m.role === 'system');
    if (systemIndex >= 0) {
      messages[systemIndex].content += toolSystemPrompt;
    } else {
      messages.unshift({ role: 'system', content: toolSystemPrompt });
    }
  }

  // Detect document generation requests
  const autoGenerateDoc = detectDocumentFormat(opts.userMessage, opts.attachmentIds);
  fastify.log.info(`[Chat] DocGen detection: format=${autoGenerateDoc}, supportsTools=${opts.supportsTools}`);

  if (autoGenerateDoc) {
    const formatName = autoGenerateDoc === 'pptx' ? 'presentazione PowerPoint' :
      autoGenerateDoc === 'xlsx' ? 'foglio Excel' :
      autoGenerateDoc === 'pdf' ? 'PDF' : 'documento Word';

    let docGenSystemPrompt: string;
    if (opts.supportsTools) {
      const toolHint = autoGenerateDoc === 'pptx'
        ? `Hai a disposizione il tool "generate_powerpoint_document". DEVI usarlo per generare la presentazione.
Crea slide ben strutturate con titoli chiari e contenuto organizzato in punti.
Se il messaggio contiene un allegato, il suo contenuto testuale è GIÀ INCLUSO nel messaggio tra i marcatori [Allegato ...] e [Fine allegato].
NON dire che non puoi leggere il file. Il testo È il contenuto del file.
Se per qualche motivo non riesci a usare il tool, scrivi il contenuto strutturato con titoli ## o ### per separare le slide — il sistema genererà automaticamente il file.`
        : autoGenerateDoc === 'xlsx'
        ? `Hai a disposizione il tool "generate_excel_document". DEVI usarlo per generare il foglio Excel.
Se il messaggio contiene un allegato, il suo contenuto testuale è GIÀ INCLUSO nel messaggio.
Se non riesci a usare il tool, scrivi i dati in formato tabellare nella risposta.`
        : `Se il messaggio contiene un allegato, il suo contenuto testuale è GIÀ INCLUSO nel messaggio tra i marcatori [Allegato ...] e [Fine allegato].
NON dire che non puoi leggere il file. Il testo È il contenuto del file.

REGOLA CRITICA PER CONVERSIONE FORMATO:
- Se l'utente chiede di CONVERTIRE un file in un altro formato (es. "converti il PDF in DOCX", "trasforma in Word"), devi RIPRODURRE il contenuto INTERO e INTEGRALE dell'allegato nella tua risposta, senza riassumerlo, senza ometterne parti, senza aggiungere commenti.
- Copia TUTTO il testo dell'allegato nella risposta, mantenendo la struttura originale (paragrafi, titoli, elenchi).
- NON aggiungere introduzioni come "Ecco il contenuto..." o "Il documento contiene...". Scrivi DIRETTAMENTE il contenuto.

Se invece l'utente chiede di elaborare, tradurre o modificare il contenuto, elabora come richiesto.
Il sistema genererà automaticamente il ${formatName} dalla tua risposta.`;
      docGenSystemPrompt = `\n\n[ISTRUZIONI GENERAZIONE DOCUMENTO]\n${toolHint}`;
    } else {
      const pptxExtra = autoGenerateDoc === 'pptx' ? `
6. Struttura il contenuto con titoli (## o ###) per separare le slide
7. Ogni sezione diventerà una slide nella presentazione
8. Per ogni slide, scrivi un titolo chiaro e poi il contenuto con punti elenco` : '';
      docGenSystemPrompt = `\n\n[ISTRUZIONI IMPORTANTI]
Il contenuto di qualsiasi file caricato (PDF, DOCX, ecc.) è GIÀ INCLUSO nel messaggio utente sopra, tra i marcatori [Allegato ...] e [Fine allegato].
Tu PUOI leggerlo. NON dire che non puoi leggere o vedere il file. Il testo È il contenuto del file.

Quando l'utente chiede di tradurre, creare o elaborare un documento:
1. Elabora la richiesta completamente (traduci, modifica, formatta, ecc.)
2. Scrivi il contenuto COMPLETO del documento tradotto/elaborato nella tua risposta
3. NON suggerire codice Python o librerie esterne
4. NON dire che non puoi creare file — il sistema genererà automaticamente il ${formatName} dalla tua risposta
5. Concentrati SOLO sul contenuto: traduci/elabora tutto il testo e scrivilo nella risposta${pptxExtra}

REGOLA CRITICA PER CONVERSIONE FORMATO:
Se l'utente chiede di CONVERTIRE un file in un altro formato (es. "converti il PDF in DOCX/Word"):
- RIPRODUCE il contenuto INTERO e INTEGRALE dell'allegato, senza riassumerlo o ometterne parti
- NON aggiungere introduzioni, spiegazioni o commenti — scrivi DIRETTAMENTE il contenuto del file
- Mantieni la struttura originale: paragrafi, titoli, elenchi, tabelle`;
    }

    const systemIndex = messages.findIndex(m => m.role === 'system');
    if (systemIndex >= 0) {
      messages[systemIndex].content += docGenSystemPrompt;
    } else {
      messages.unshift({ role: 'system', content: docGenSystemPrompt });
    }
  }

  // Inject memory context for new conversations
  try {
    const memoryService = new MemoryService(fastify.db);
    const msgCount = messages.filter(m => m.role === 'user').length;
    if (msgCount <= 1) {
      const memoryContext = await memoryService.getContextForNewChat(opts.userId);
      if (memoryContext) {
        const systemIndex = messages.findIndex(m => m.role === 'system');
        if (systemIndex >= 0) {
          messages[systemIndex].content += '\n\n[Memory Context]\n' + memoryContext;
        } else {
          messages.unshift({ role: 'system', content: '[Memory Context]\n' + memoryContext });
        }
        fastify.log.info(`[Memory] Injected context for user ${opts.userId}`);
      }
    }
  } catch (memErr: any) {
    fastify.log.warn(`[Memory] Context injection failed: ${memErr.message}`);
  }

  return { webSearchPerformed, autoGenerateDoc };
}

/**
 * Ensure a base system prompt exists with Italian language instruction.
 */
export function ensureItalianSystemPrompt(messages: Message[]): void {
  const systemIndex = messages.findIndex(m => m.role === 'system');
  const italianLanguageInstruction = 'IMPORTANT: Rispondi SEMPRE in italiano, indipendentemente dalla lingua del system prompt. Usa un tono preciso, amichevole e professionale.';
  if (systemIndex >= 0) {
    if (!messages[systemIndex].content.includes('Rispondi SEMPRE in italiano')) {
      messages[systemIndex] = {
        ...messages[systemIndex],
        content: messages[systemIndex].content + '\n\n' + italianLanguageInstruction,
      };
    }
  } else {
    const currentDate = new Date().toLocaleDateString('it-IT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    messages.unshift({ role: 'system', content: `Sei un assistente AI utile e competente. Oggi è ${currentDate}.\n${italianLanguageInstruction}` });
  }
}

/**
 * Fallback model chain map and logic for retriable errors.
 */
export const FALLBACK_MAP: Record<string, string[]> = {
  'gpt-4o': ['gpt-4o-mini', 'gemini-2.0-flash'],
  'gpt-4-turbo': ['gpt-4o-mini', 'gemini-2.0-flash'],
  'gpt-4.1': ['gpt-4.1-mini', 'claude-sonnet-4-20250514'],
  'gpt-4.1-mini': ['gpt-4.1-nano', 'gemini-2.0-flash'],
  'claude-opus-4-6': ['claude-sonnet-4-6', 'claude-sonnet-4-20250514', 'gpt-4o'],
  'claude-opus-4-20250514': ['claude-sonnet-4-20250514', 'gpt-4o'],
  'claude-sonnet-4-6': ['claude-sonnet-4-20250514', 'gpt-4o-mini'],
  'claude-sonnet-4-20250514': ['claude-haiku-4-5-20251001', 'gpt-4o-mini'],
  'gemini-1.5-pro': ['gemini-2.0-flash', 'gpt-4o-mini'],
  'gemini-2.0-flash-thinking': ['gemini-2.0-flash'],
};

/**
 * Check if an error is retriable for the fallback chain.
 */
export function isRetriableError(errorMessage: string): boolean {
  return errorMessage.includes('timeout')
    || errorMessage.includes('ECONNREFUSED')
    || errorMessage.includes('fetch failed')
    || errorMessage.includes('500')
    || errorMessage.includes('502')
    || errorMessage.includes('503')
    || errorMessage.includes('overloaded');
}
