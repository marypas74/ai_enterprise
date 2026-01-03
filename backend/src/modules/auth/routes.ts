import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { z } from 'zod';
import { findOne, insertOne, updateOne } from '../../database/index.js';

// Validation schemas
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2).max(100)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string()
});

// Types
interface User {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  role: 'admin' | 'user';
  is_active: boolean;
}

interface RefreshToken {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
}

export async function authRoutes(fastify: FastifyInstance) {
  // Register
  fastify.post('/register', {
    schema: {
      description: 'Register a new user',
      tags: ['auth'],
      body: {
        type: 'object',
        required: ['email', 'password', 'name'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
          name: { type: 'string', minLength: 2 }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = registerSchema.parse(request.body);

      // Check if user exists
      const existing = await findOne<User>(
        fastify.db,
        'SELECT id FROM users WHERE email = ?',
        [body.email]
      );

      if (existing) {
        return reply.status(409).send({ error: 'Email already registered' });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(body.password, 10);

      // Create user
      const userId = await insertOne(
        fastify.db,
        'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
        [body.email, passwordHash, body.name]
      );

      // Add to default group
      await insertOne(
        fastify.db,
        'INSERT INTO user_groups (user_id, group_id) VALUES (?, 1)',
        [userId]
      );

      // Log audit
      await insertOne(
        fastify.db,
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address) VALUES (?, ?, ?, ?, ?)',
        [userId, 'register', 'user', userId, request.ip]
      );

      return reply.status(201).send({
        message: 'User registered successfully',
        userId
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }
  });

  // Login
  fastify.post('/login', {
    schema: {
      description: 'Login and get tokens',
      tags: ['auth'],
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = loginSchema.parse(request.body);

      // Find user
      const user = await findOne<User>(
        fastify.db,
        'SELECT * FROM users WHERE email = ? AND is_active = TRUE',
        [body.email]
      );

      if (!user) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      // Verify password
      const validPassword = await bcrypt.compare(body.password, user.password_hash);
      if (!validPassword) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      // Generate tokens
      const accessToken = fastify.jwt.sign({
        id: user.id,
        email: user.email,
        role: user.role
      });

      const refreshToken = crypto.randomBytes(64).toString('hex');
      const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      // Store refresh token
      await insertOne(
        fastify.db,
        'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
        [user.id, refreshTokenHash, refreshExpiresAt]
      );

      // Update last login
      await updateOne(
        fastify.db,
        'UPDATE users SET last_login_at = NOW() WHERE id = ?',
        [user.id]
      );

      // Log audit
      await insertOne(
        fastify.db,
        'INSERT INTO audit_log (user_id, action, ip_address) VALUES (?, ?, ?)',
        [user.id, 'login', request.ip]
      );

      // Set refresh token in HTTP-only cookie
      reply.setCookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/api/auth/refresh',
        maxAge: 7 * 24 * 60 * 60 // 7 days in seconds
      });

      return {
        accessToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role
        }
      };
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation failed', details: err.errors });
      }
      throw err;
    }
  });

  // Refresh token
  fastify.post('/refresh', {
    schema: {
      description: 'Refresh access token',
      tags: ['auth']
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const refreshToken = request.cookies.refreshToken;

    if (!refreshToken) {
      return reply.status(401).send({ error: 'Refresh token required' });
    }

    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    // Find valid refresh token
    const storedToken = await findOne<RefreshToken>(
      fastify.db,
      `SELECT rt.*, u.id as user_id, u.email, u.role, u.name
       FROM refresh_tokens rt
       JOIN users u ON rt.user_id = u.id
       WHERE rt.token_hash = ? AND rt.expires_at > NOW() AND rt.revoked_at IS NULL AND u.is_active = TRUE`,
      [tokenHash]
    );

    if (!storedToken) {
      return reply.status(401).send({ error: 'Invalid refresh token' });
    }

    // Generate new access token
    const accessToken = fastify.jwt.sign({
      id: (storedToken as any).user_id,
      email: (storedToken as any).email,
      role: (storedToken as any).role
    });

    return { accessToken };
  });

  // Get current user
  fastify.get('/me', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get current user profile',
      tags: ['auth'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const payload = request.user as { id: number };

    const user = await findOne<User>(
      fastify.db,
      `SELECT u.id, u.email, u.name, u.role, u.created_at,
              JSON_ARRAYAGG(g.name) as groups
       FROM users u
       LEFT JOIN user_groups ug ON u.id = ug.user_id
       LEFT JOIN \`groups\` g ON ug.group_id = g.id
       WHERE u.id = ?
       GROUP BY u.id`,
      [payload.id]
    );

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    return user;
  });

  // Logout
  fastify.post('/logout', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Logout and revoke refresh token',
      tags: ['auth'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const refreshToken = request.cookies.refreshToken;
    const payload = request.user as { id: number };

    if (refreshToken) {
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      await updateOne(
        fastify.db,
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ?',
        [tokenHash]
      );
    }

    // Log audit
    await insertOne(
      fastify.db,
      'INSERT INTO audit_log (user_id, action, ip_address) VALUES (?, ?, ?)',
      [payload.id, 'logout', request.ip]
    );

    reply.clearCookie('refreshToken', { path: '/api/auth/refresh' });
    return { message: 'Logged out successfully' };
  });
}
