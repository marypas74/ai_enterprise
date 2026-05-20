import path from 'path';
import { promises as fsPromises } from 'fs';
import { FastifyInstance } from 'fastify';
import { findOne, findMany, insertOne } from '../../../database/index.js';
import { AIProviderFactory, Message } from '../../ai/providers.js';
import { ConversationalFormService } from '../../../services/ConversationalFormService.js';
import { NativeDocBlock, ToolContext, Conversation, DbMessage } from '../types.js';

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

  const { createProjectFolder } = await import('../../../services/StorageService.js');
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
    chatMode?: 'free' | 'rag' | 'brainstorm';
    documentIds?: number[];
  }
): Promise<{ conversationId: number; messages: Message[]; conversation?: Conversation }> {
  let conversationId = opts.conversationId;
  let messages: Message[] = [];
  let conversationObj: Conversation | undefined;

  if (conversationId) {
    const conversation = await findOne<Conversation>(
      fastify.db,
      'SELECT * FROM conversations WHERE id = ? AND user_id = ?',
      [conversationId, opts.userId]
    );

    if (!conversation) {
      throw Object.assign(new Error('Conversation not found'), { statusCode: 404 });
    }
    conversationObj = conversation;

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
      'INSERT INTO conversations (user_id, title, model, provider, system_prompt, chat_mode, document_ids) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [opts.userId, title, opts.model, opts.providerName, opts.systemPrompt || null, opts.chatMode || 'free', opts.documentIds ? JSON.stringify(opts.documentIds) : null]
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

  return { conversationId: conversationId!, messages, conversation: conversationObj };
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
): Promise<any> {
  const formService = new ConversationalFormService(fastify.db);
  const activeFormSession = await formService.getActiveSession(userId, conversationId);
  if (!activeFormSession || activeFormSession.state === 'closed') return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  let attachments: any[] = [];

  for (let attempt = 0; attempt < 90; attempt++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    attachments = await findMany<any>(
      fastify.db,
      `SELECT id, original_name, content_type, processing_status, processed_content, file_path, file_size
       FROM chat_attachments
       WHERE id IN (${placeholders}) AND user_id = ?`,
      [...opts.attachmentIds, opts.userId]
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
        const { searchSimilar } = await import('../../../services/VectorStoreService.js');
        const semanticResults = await searchSimilar(fastify.db, opts.originalMessage, {
          attachmentIds: [a.id],
          limit: 8,
          scoreThreshold: 0.3,
        });
        if (semanticResults.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
            const { selectRelevantChunks } = await import('../../../services/ChunkingService.js');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
