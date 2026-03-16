export const CONFIG_SECTION = 'enterprise-ai';

export const CONFIG_KEYS = {
  SERVER_URL: 'serverUrl',
  ALLOW_SELF_SIGNED: 'allowSelfSignedCerts',
  BOT_ICON_STYLE: 'botIconStyle',
  ORCHESTRATOR_POLLING: 'orchestrator.pollingInterval',
  ORCHESTRATOR_SHOW: 'orchestrator.showStatusBar',
} as const;

export const DEFAULTS = {
  SERVER_URL: 'https://plane.lushlolli.com',
  ALLOW_SELF_SIGNED: false,
  ORCHESTRATOR_POLLING: 10000,
  ORCHESTRATOR_SHOW: true,
} as const;

export const API_PATHS = {
  LOGIN: '/api/auth/login',
  MODELS: '/api/chat/models',
  COMPLETIONS: '/api/chat/completions',
  CONVERSATIONS: '/api/chat/conversations',
  DOCUMENTS: '/api/documents',
  AGENT_SESSIONS: '/api/agents/sessions',
  AGENT_TEMPLATES: '/api/agents/templates',
  ORCHESTRATOR_STATUS: '/api/orchestrator/status',
  ORCHESTRATOR_EVENTS: '/api/orchestrator/events',
  ORCHESTRATOR_WORKTREES: '/api/orchestrator/worktrees',
  ORCHESTRATOR_SLOT_RELEASE: '/api/orchestrator/slots/release',
  TOOLS_GENERATE_DOCX: '/api/tools/generate-docx',
  TOOLS_GENERATE_EXCEL: '/api/tools/generate-excel',
  TOOLS_GENERATE_PPTX: '/api/tools/generate-pptx',
  TOOLS_CONVERT_PDF: '/api/tools/convert-to-pdf',
} as const;

export const OUTPUT_CHANNEL_NAME = 'Enterprise AI';
