/**
 * Hello World Plugin — Reference implementation
 *
 * Demonstrates all plugin capabilities:
 *   - hooks: intercept pipeline events
 *   - tools: register callable tools
 *   - forms: register conversational forms
 *   - endpoints: register custom API routes
 *   - activate/deactivate: lifecycle hooks
 */

// ---- Lifecycle ----

export async function activate(ctx) {
  ctx.log.info('Plugin activated!');
  const settings = await ctx.getSettings();
  ctx.log.info(`Settings: ${JSON.stringify(settings)}`);
}

export async function deactivate(ctx) {
  ctx.log.info('Plugin deactivated!');
}

// ---- Hooks ----

export const hooks = {
  // Pipe hook: modify the user message before processing
  before_message_read(data, context) {
    // Example: log messages (if settings enable it)
    // In a real plugin you'd check settings via async DB call
    return data; // Return unchanged to pass through
  },

  // Pipe hook: modify the system prompt prefix
  agent_prompt_prefix(data, context) {
    // Example: append a personality trait
    if (typeof data === 'string') {
      return data + '\nYou occasionally reference curious facts about cats.';
    }
    return data;
  },
};

// ---- Tools ----

export const tools = [
  {
    name: 'hello_greet',
    display_name: 'Greeting Generator',
    description: 'Generate a personalized greeting for the user',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the person to greet' },
        language: { type: 'string', enum: ['en', 'it', 'fr', 'de', 'es'], description: 'Language for the greeting' },
      },
      required: ['name'],
    },
    start_examples: ['greet John', 'say hello to Maria', 'saluta Marco'],
    requires_approval: false,
    return_direct: false,
    async execute(input, ctx) {
      const greetings = {
        en: 'Hello',
        it: 'Ciao',
        fr: 'Bonjour',
        de: 'Hallo',
        es: 'Hola',
      };
      const lang = input.language || 'en';
      const greeting = greetings[lang] || 'Hello';
      return { result: `${greeting}, ${input.name}! Welcome to the AI chat.` };
    },
  },
];

// ---- Forms ----

export const forms = [
  {
    name: 'feedback_form',
    display_name: 'Feedback Form',
    description: 'Collect user feedback about the AI assistant',
    json_schema: {
      type: 'object',
      properties: {
        rating: {
          type: 'integer',
          minimum: 1,
          maximum: 5,
          description: 'Rating from 1 (poor) to 5 (excellent)',
        },
        category: {
          type: 'string',
          enum: ['accuracy', 'speed', 'helpfulness', 'ui', 'other'],
          description: 'Feedback category',
        },
        comment: {
          type: 'string',
          description: 'Free-text comment',
        },
      },
      required: ['rating', 'category'],
    },
    start_examples: ['give feedback', 'leave a review', 'voglio dare un feedback'],
    stop_examples: ['cancel feedback', 'annulla'],
    ask_confirm: true,
    async on_submit(data, ctx) {
      ctx.log.info(`Feedback received: ${JSON.stringify(data)}`);
      return { success: true, message: 'Thank you for your feedback!' };
    },
  },
];

// ---- Custom Endpoints ----

export const endpoints = [
  {
    method: 'GET',
    path: '/status',
    description: 'Get plugin status and stats',
    requiresAuth: true,
    requiresAdmin: false,
    async handler(request, reply) {
      return {
        plugin: 'hello-world',
        version: '1.0.0',
        status: 'active',
        uptime: process.uptime(),
      };
    },
  },
];
