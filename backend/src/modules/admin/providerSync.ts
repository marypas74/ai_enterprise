import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findOne, findAll, insertOne } from '../../database/index.js';
import { decrypt } from '../../utils/crypto.js';
import { inferModelCapabilities } from '../../utils/model-capabilities.js';
import { requireAdmin } from '../../middleware/index.js';

// Validation schemas
const ollamaDeploySchema = z.object({
  port: z.number().min(1024).max(65535).optional(),
  gpuEnabled: z.boolean().optional(),
  memoryLimit: z.string().regex(/^\d+[mg]$/i).optional(),
  models: z.array(z.string()).optional(),
});

const ollamaPullModelSchema = z.object({
  model: z.string().min(1),
});

// Types
interface Provider {
  id: number;
  name: string;
  display_name: string;
  provider_type: string;
  is_enabled: boolean;
  is_local: boolean;
  config_schema: string;
  created_at: Date;
  updated_at: Date;
}

interface ProviderSetting {
  id: number;
  provider_id: number;
  setting_key: string;
  setting_value: string;
  is_secret: boolean;
}

export async function providerSyncRoutes(fastify: FastifyInstance) {

  // ==========================================
  // SYNC ENDPOINTS
  // ==========================================

  // Placeholder - OAuth providers have been removed
  // See migration: remove_oauth_providers.sql

  // Sync OpenAI models
  fastify.post('/providers/openai/sync', {
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Sync OpenAI models',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // Get OpenAI provider
    const provider = await findOne<Provider>(
      fastify.db,
      "SELECT * FROM ai_providers WHERE name = 'openai'",
      []
    );

    if (!provider) {
      return reply.status(404).send({ error: 'OpenAI provider not found' });
    }

    // OpenAI models to add
    const openaiModels = [
      { id: 'gpt-4o', name: 'GPT-4o', desc: 'Most capable and multimodal model', context: 128000, output: 16384 },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', desc: 'Fast and affordable for everyday tasks', context: 128000, output: 16384 },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', desc: 'High performance with vision capabilities', context: 128000, output: 4096 },
      { id: 'gpt-4', name: 'GPT-4', desc: 'Original GPT-4 model', context: 8192, output: 4096 },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', desc: 'Fast and cost-effective', context: 16385, output: 4096 },
      { id: 'o1', name: 'o1', desc: 'Advanced reasoning model', context: 200000, output: 100000 },
      { id: 'o1-mini', name: 'o1 Mini', desc: 'Smaller reasoning model', context: 128000, output: 65536 },
      { id: 'o1-preview', name: 'o1 Preview', desc: 'Preview of o1 model', context: 128000, output: 32768 },
      { id: 'o3-mini', name: 'o3 Mini', desc: 'Latest reasoning model', context: 200000, output: 100000 }
    ];

    try {
      let added = 0;
      for (const model of openaiModels) {
        const existing = await findOne(
          fastify.db,
          'SELECT id FROM ai_models WHERE provider_id = ? AND model_id = ?',
          [provider.id, model.id]
        );

        if (!existing) {
          const caps = inferModelCapabilities(model.id);
          await insertOne(
            fastify.db,
            `INSERT INTO ai_models (
              provider_id, model_id, display_name, description, model_type,
              context_window, max_output_tokens, supports_streaming, supports_functions,
              supports_vision, supports_thinking, is_enabled, sort_order
            ) VALUES (?, ?, ?, ?, 'chat', ?, ?, ?, ?, ?, ?, TRUE, ?)`,
            [provider.id, model.id, model.name, model.desc, model.context, model.output,
             caps.supports_streaming, caps.supports_functions, caps.supports_vision, caps.supports_thinking, added]
          );
          added++;
        }
      }

      return {
        success: true,
        message: `Synced ${openaiModels.length} OpenAI models, added ${added} new`,
        models: openaiModels.map(m => m.id)
      };
    } catch (error: any) {
      return reply.status(400).send({
        success: false,
        error: error.message || 'Failed to sync OpenAI models'
      });
    }
  });

  // Sync Ollama models (fetch from Ollama server)
  fastify.post('/providers/ollama/sync', {
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Sync models from Ollama server',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // Get Ollama provider
    const provider = await findOne<Provider>(
      fastify.db,
      "SELECT * FROM ai_providers WHERE name = 'ollama'",
      []
    );

    if (!provider) {
      return reply.status(404).send({ error: 'Ollama provider not found' });
    }

    // Get settings
    const settings = await findAll<ProviderSetting>(
      fastify.db,
      'SELECT * FROM ai_provider_settings WHERE provider_id = ?',
      [provider.id]
    );

    const config: Record<string, string> = {};
    for (const s of settings) {
      config[s.setting_key] = s.is_secret ? decrypt(s.setting_value) : s.setting_value;
    }

    const baseUrl = config.base_url || 'http://localhost:11434';

    try {
      const ollamaSyncHeaders: Record<string, string> = {};
      if (process.env.OLLAMA_AUTH_KEY) ollamaSyncHeaders['X-Ollama-Key'] = process.env.OLLAMA_AUTH_KEY;
      const response = await fetch(`${baseUrl}/api/tags`, { headers: ollamaSyncHeaders });
      if (!response.ok) throw new Error(`Ollama API error: ${response.status}`);

      const data = await response.json() as { models: Array<{ name: string; details?: { family?: string; parameter_size?: string } }> };
      const ollamaModels = data.models || [];

      let added = 0;
      for (const model of ollamaModels) {
        // Check if model already exists
        const existing = await findOne(
          fastify.db,
          'SELECT id FROM ai_models WHERE provider_id = ? AND model_id = ?',
          [provider.id, model.name]
        );

        if (!existing) {
          const caps = inferModelCapabilities(model.name);
          await insertOne(
            fastify.db,
            `INSERT INTO ai_models (
              provider_id, model_id, display_name, description, model_type,
              context_window, max_output_tokens, supports_streaming, supports_functions,
              supports_vision, supports_thinking, is_enabled, sort_order
            ) VALUES (?, ?, ?, ?, 'chat', 4096, 4096, ?, ?, ?, ?, TRUE, ?)`,
            [
              provider.id,
              model.name,
              model.name,
              `${model.details?.family || 'Unknown'} - ${model.details?.parameter_size || 'Unknown size'}`,
              caps.supports_streaming, caps.supports_functions, caps.supports_vision, caps.supports_thinking,
              100 + added
            ]
          );
          added++;
        }
      }

      return {
        success: true,
        message: `Synced ${ollamaModels.length} models, added ${added} new`,
        models: ollamaModels.map(m => m.name)
      };
    } catch (error: any) {
      return reply.status(400).send({
        success: false,
        error: error.message || 'Failed to sync Ollama models'
      });
    }
  });

  // ==========================================
  // OLLAMA DOCKER MANAGEMENT
  // ==========================================

  const OLLAMA_CONTAINER_NAME = 'enterprise-ai-ollama';

  // Helper to execute commands safely using execFile
  const execCommand = (cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
    return new Promise((resolve, reject) => {
      const { execFile } = require('child_process');
      execFile(cmd, args, { timeout: 300000 }, (error: any, stdout: string, stderr: string) => {
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  };

  // Deploy Ollama Docker container
  fastify.post('/providers/ollama/docker/deploy', {
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Deploy Ollama Docker container',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    let body: z.infer<typeof ollamaDeploySchema>;
    try {
      body = ollamaDeploySchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }

    const port = body.port || 11434;
    const gpuEnabled = body.gpuEnabled ?? false;
    const memoryLimit = body.memoryLimit || '8g';
    const models = body.models || [];

    try {
      // Check if Docker is available
      await execCommand('docker', ['--version']);

      // Stop existing container if running
      try {
        await execCommand('docker', ['stop', OLLAMA_CONTAINER_NAME]);
      } catch {}
      try {
        await execCommand('docker', ['rm', OLLAMA_CONTAINER_NAME]);
      } catch {}

      // Build docker run arguments
      const dockerArgs = [
        'run', '-d',
        '--name', OLLAMA_CONTAINER_NAME,
        '-p', `${port}:11434`,
        '-v', 'ollama-data:/root/.ollama',
        `--memory=${memoryLimit}`,
        '--restart=unless-stopped'
      ];

      // Add GPU support if enabled
      if (gpuEnabled) {
        dockerArgs.push('--gpus', 'all');
      }

      dockerArgs.push('ollama/ollama');

      fastify.log.info(`Starting Ollama container with args: ${dockerArgs.join(' ')}`);
      const { stdout } = await execCommand('docker', dockerArgs);
      const containerId = stdout.trim().substring(0, 12);

      // Wait for container to be ready
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Pull requested models
      const pulledModels: string[] = [];
      for (const model of models) {
        // Validate model name (alphanumeric, dots, colons, hyphens only)
        if (!/^[a-zA-Z0-9.:_-]+$/.test(model)) {
          fastify.log.warn(`Invalid model name: ${model}`);
          continue;
        }
        try {
          fastify.log.info(`Pulling model: ${model}`);
          await execCommand('docker', ['exec', OLLAMA_CONTAINER_NAME, 'ollama', 'pull', model]);
          pulledModels.push(model);
        } catch (err: any) {
          fastify.log.warn(`Failed to pull model ${model}: ${err.message}`);
        }
      }

      // Update provider settings with new base_url
      const provider = await findOne<Provider>(
        fastify.db,
        "SELECT * FROM ai_providers WHERE name = 'ollama'",
        []
      );

      if (provider) {
        const baseUrl = `http://localhost:${port}`;
        await fastify.db.execute(
          `INSERT INTO ai_provider_settings (provider_id, setting_key, setting_value, is_secret)
           VALUES (?, 'base_url', ?, FALSE)
           ON DUPLICATE KEY UPDATE setting_value = ?`,
          [provider.id, baseUrl, baseUrl]
        );

        // Enable the provider
        await fastify.db.execute(
          'UPDATE ai_providers SET is_enabled = TRUE WHERE id = ?',
          [provider.id]
        );
      }

      return {
        success: true,
        containerId,
        port,
        gpuEnabled,
        memoryLimit,
        pulledModels,
        message: `Ollama container started on port ${port}. ${pulledModels.length} models pulled.`
      };
    } catch (error: any) {
      fastify.log.error(`Ollama deploy error: ${error.message}`);
      return reply.status(400).send({
        success: false,
        error: error.message || 'Failed to deploy Ollama container'
      });
    }
  });

  // Get Ollama Docker status
  fastify.get('/providers/ollama/docker/status', {
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Get Ollama Docker container status',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { stdout } = await execCommand('docker', [
        'inspect', OLLAMA_CONTAINER_NAME,
        '--format', '{{.State.Status}}|{{.State.StartedAt}}'
      ]);

      const parts = stdout.trim().split('|');
      const status = parts[0];
      const startedAt = parts[1];

      // Get available models
      let models: string[] = [];
      if (status === 'running') {
        try {
          const { stdout: modelsOutput } = await execCommand('docker', [
            'exec', OLLAMA_CONTAINER_NAME, 'ollama', 'list'
          ]);
          // Parse ollama list output (skip header line)
          const lines = modelsOutput.trim().split('\n').slice(1);
          models = lines.map(line => line.split(/\s+/)[0]).filter(m => m.length > 0);
        } catch {}
      }

      return {
        running: status === 'running',
        status,
        startedAt,
        containerName: OLLAMA_CONTAINER_NAME,
        models
      };
    } catch (error: any) {
      return { running: false, status: 'not_deployed', models: [] };
    }
  });

  // Pull a model to Ollama container
  fastify.post('/providers/ollama/docker/pull-model', {
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Pull a model to Ollama container',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    let parsedBody: z.infer<typeof ollamaPullModelSchema>;
    try {
      parsedBody = ollamaPullModelSchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }

    // Validate model name
    const model = parsedBody.model.trim();
    if (!/^[a-zA-Z0-9.:_-]+$/.test(model)) {
      return reply.status(400).send({ error: 'Invalid model name' });
    }

    try {
      fastify.log.info(`Pulling model: ${model}`);
      await execCommand('docker', ['exec', OLLAMA_CONTAINER_NAME, 'ollama', 'pull', model]);

      return {
        success: true,
        message: `Model ${model} pulled successfully`
      };
    } catch (error: any) {
      return reply.status(400).send({
        success: false,
        error: error.message || 'Failed to pull model'
      });
    }
  });

  // Stop Ollama Docker container
  fastify.delete('/providers/ollama/docker/stop', {
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Stop Ollama Docker container',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await execCommand('docker', ['stop', OLLAMA_CONTAINER_NAME]);
      await execCommand('docker', ['rm', OLLAMA_CONTAINER_NAME]);

      return {
        success: true,
        message: 'Ollama container stopped and removed'
      };
    } catch (error: any) {
      return reply.status(400).send({
        success: false,
        error: error.message || 'Failed to stop container'
      });
    }
  });

  // Get available Ollama models from registry
  fastify.get('/providers/ollama/models/available', {
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Get list of popular Ollama models',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    // Popular models with their info
    return {
      models: [
        { id: 'llama3.2', name: 'Llama 3.2', size: '2B/3B', description: 'Meta latest small model' },
        { id: 'llama3.1:8b', name: 'Llama 3.1 8B', size: '8B', description: 'Meta Llama 3.1 8B' },
        { id: 'llama3.1:70b', name: 'Llama 3.1 70B', size: '70B', description: 'Meta Llama 3.1 70B (requires 48GB+ VRAM)' },
        { id: 'mistral', name: 'Mistral 7B', size: '7B', description: 'Fast and efficient' },
        { id: 'mixtral', name: 'Mixtral 8x7B', size: '47B', description: 'Mixture of experts' },
        { id: 'codellama', name: 'Code Llama', size: '7B/13B/34B', description: 'Optimized for code' },
        { id: 'deepseek-coder-v2', name: 'DeepSeek Coder V2', size: '16B/236B', description: 'Advanced coding model' },
        { id: 'qwen2.5', name: 'Qwen 2.5', size: '0.5B-72B', description: 'Alibaba multilingual model' },
        { id: 'phi3', name: 'Phi-3', size: '3.8B', description: 'Microsoft small but capable' },
        { id: 'gemma2', name: 'Gemma 2', size: '2B/9B/27B', description: 'Google open model' },
        { id: 'llava', name: 'LLaVA', size: '7B/13B', description: 'Vision-enabled model' },
        { id: 'nomic-embed-text', name: 'Nomic Embed', size: '137M', description: 'Text embeddings' }
      ]
    };
  });
}
