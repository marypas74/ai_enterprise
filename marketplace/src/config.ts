import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3100'),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'enterprise_ai',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'enterprise_ai_chat',
    connectionLimit: 10,
  },
  qdrantUrl: process.env.QDRANT_URL || 'http://localhost:6333',
  backendUrl: process.env.BACKEND_INTERNAL_URL || 'http://backend:3000',
  serviceToken: process.env.MARKETPLACE_SERVICE_TOKEN || '',
  jwtSecret: (() => {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET environment variable is required');
    return secret;
  })(),
} as const;
