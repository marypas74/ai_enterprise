import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { z } from 'zod';
import { findOne, insertOne, updateOne } from '../../database/index.js';
import { verify, generateSecret, generateURI } from 'otplib';
import QRCode from 'qrcode';

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
  mfa_enabled: boolean;
  mfa_secret: string | null;
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
          password: { type: 'string' },
          totp_code: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as { email: string; password: string; totp_code?: string };

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
      const isTestAccount = user.email.endsWith('@enterprise.local');
      const accessToken = fastify.jwt.sign({
        id: user.id,
        email: user.email,
        role: user.role,
        mfa_verified: isTestAccount || !!(user.mfa_enabled && user.mfa_secret)
      });

      // Check MFA
      if (user.mfa_enabled && user.mfa_secret) {
        if (!body.totp_code) {
          // MFA required but no code provided
          return reply.status(200).send({
            mfa_required: true,
            message: 'TOTP code required'
          });
        }

        // Verify TOTP code
        const isValid = verify({
          token: body.totp_code,
          secret: user.mfa_secret
        });

        if (!isValid) {
          return reply.status(401).send({ error: 'Invalid TOTP code' });
        }
      } else {
        // MFA is NOT enabled/setup but we want to enforce it
        // Allow test accounts (email ending with @enterprise.local) to skip MFA
        const isTestAccount = user.email.endsWith('@enterprise.local');
        if (!body.totp_code && !isTestAccount) {
          return reply.status(200).send({
            mfa_setup_required: true,
            accessToken, // Give token so they can call /mfa/setup
            user: {
              id: user.id,
              email: user.email,
              name: user.name,
              role: user.role,
              mfa_enabled: false
            },
            message: 'MFA setup is mandatory for all users.'
          });
        }
      }

      // === SINGLE-SESSION ENFORCEMENT ===
      // Revoke ALL previous sessions for this user and mark them as logged out
      await updateOne(
        fastify.db,
        'UPDATE user_sessions SET revoked_at = NOW(), logged_out_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
        [user.id]
      );
      // Also revoke all previous refresh tokens
      await updateOne(
        fastify.db,
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
        [user.id]
      );

      // === TOKEN & SESSION GENERATION ===
      const refreshToken = crypto.randomBytes(64).toString('hex');
      const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      // Store refresh token
      await insertOne(
        fastify.db,
        'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
        [user.id, refreshTokenHash, refreshExpiresAt]
      );

      // === GEO-TRACKING ===
      const geo = (request as any).geo || {};
      const ip = geo.ip || request.ip;
      const country = geo.country || 'XX';
      const userAgent = request.headers['user-agent'] || 'Unknown';

      // Create user session with geo data
      await insertOne(
        fastify.db,
        `INSERT INTO user_sessions (user_id, token_hash, ip_address, country, user_agent, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [user.id, refreshTokenHash, ip, country, userAgent, refreshExpiresAt]
      );

      // Update last login
      await updateOne(
        fastify.db,
        'UPDATE users SET last_login_at = NOW() WHERE id = ?',
        [user.id]
      );

      // Log audit with geo info
      await insertOne(
        fastify.db,
        'INSERT INTO audit_log (user_id, action, ip_address, user_agent, details) VALUES (?, ?, ?, ?, ?)',
        [user.id, 'login', ip, userAgent, JSON.stringify({ country })]
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
          role: user.role,
          mfa_enabled: !!user.mfa_enabled
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

    // Update session last activity
    await updateOne(
      fastify.db,
      'UPDATE user_sessions SET last_activity_at = NOW() WHERE token_hash = ? AND revoked_at IS NULL',
      [tokenHash]
    ).catch(() => { }); // Non-critical

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
      `SELECT u.id, u.email, u.name, u.role, u.created_at, u.mfa_enabled,
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
      // Revoke refresh token
      await updateOne(
        fastify.db,
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ?',
        [tokenHash]
      );
      // Revoke user session and mark as logged out
      await updateOne(
        fastify.db,
        'UPDATE user_sessions SET revoked_at = NOW(), logged_out_at = NOW() WHERE token_hash = ?',
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

  // ===================== MFA ENDPOINTS =====================

  // MFA Setup - Generate TOTP secret + QR code
  fastify.post('/mfa/setup', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Generate TOTP secret and QR code for MFA setup',
      tags: ['auth', 'MFA'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const payload = request.user as { id: number; email: string };

    const user = await findOne<User>(
      fastify.db,
      'SELECT id, email, mfa_enabled FROM users WHERE id = ?',
      [payload.id]
    );

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    if (user.mfa_enabled) {
      return reply.status(400).send({ error: 'MFA is already enabled. Disable it first.' });
    }

    // Generate TOTP secret
    const secret = generateSecret();

    // Store secret (not yet verified)
    await updateOne(
      fastify.db,
      'UPDATE users SET mfa_secret = ? WHERE id = ?',
      [secret, payload.id]
    );

    // Generate otpauth URI (compatible with Microsoft Authenticator)
    const otpauthUrl = generateURI({
      label: user.email,
      issuer: 'Enterprise AI Chat',
      secret,
    });

    // Generate QR code as data URL
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    return {
      secret,
      otpauth_url: otpauthUrl,
      qr_code: qrCodeDataUrl,
      message: 'Scan the QR code with Microsoft Authenticator, then verify with a code'
    };
  });

  // MFA Verify Setup - Confirm first TOTP code
  fastify.post('/mfa/verify-setup', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Verify first TOTP code to enable MFA',
      tags: ['auth', 'MFA'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['totp_code'],
        properties: {
          totp_code: { type: 'string', minLength: 6, maxLength: 6 }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const payload = request.user as { id: number };
    const { totp_code } = request.body as { totp_code: string };

    const user = await findOne<User>(
      fastify.db,
      'SELECT id, mfa_secret, mfa_enabled FROM users WHERE id = ?',
      [payload.id]
    );

    if (!user || !user.mfa_secret) {
      return reply.status(400).send({ error: 'MFA setup not initiated. Call /mfa/setup first.' });
    }

    if (user.mfa_enabled) {
      return reply.status(400).send({ error: 'MFA is already enabled' });
    }

    // Verify the TOTP code
    const isValid = verify({
      token: totp_code,
      secret: user.mfa_secret
    });

    if (!isValid) {
      return reply.status(400).send({ error: 'Invalid TOTP code. Please try again.' });
    }

    // Enable MFA
    await updateOne(
      fastify.db,
      'UPDATE users SET mfa_enabled = 1, mfa_verified_at = NOW() WHERE id = ?',
      [payload.id]
    );

    // Audit log
    await insertOne(
      fastify.db,
      'INSERT INTO audit_log (user_id, action, ip_address, details) VALUES (?, ?, ?, ?)',
      [payload.id, 'mfa_enabled', request.ip, JSON.stringify({ method: 'totp' })]
    );

    return {
      success: true,
      message: 'MFA enabled successfully. You will need the TOTP code for future logins.'
    };
  });

  // MFA Disable
  fastify.post('/mfa/disable', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Disable MFA (requires current TOTP code)',
      tags: ['auth', 'MFA'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['totp_code'],
        properties: {
          totp_code: { type: 'string', minLength: 6, maxLength: 6 }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const payload = request.user as { id: number };
    const { totp_code } = request.body as { totp_code: string };

    const user = await findOne<User>(
      fastify.db,
      'SELECT id, mfa_secret, mfa_enabled FROM users WHERE id = ?',
      [payload.id]
    );

    if (!user || !user.mfa_enabled || !user.mfa_secret) {
      return reply.status(400).send({ error: 'MFA is not enabled' });
    }

    // Verify the TOTP code
    const isValid = verify({
      token: totp_code,
      secret: user.mfa_secret
    });

    if (!isValid) {
      return reply.status(401).send({ error: 'Invalid TOTP code' });
    }

    // Disable MFA
    await updateOne(
      fastify.db,
      'UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, mfa_verified_at = NULL WHERE id = ?',
      [payload.id]
    );

    // Audit log
    await insertOne(
      fastify.db,
      'INSERT INTO audit_log (user_id, action, ip_address) VALUES (?, ?, ?)',
      [payload.id, 'mfa_disabled', request.ip]
    );

    return {
      success: true,
      message: 'MFA has been disabled'
    };
  });

  // ===================== ADMIN SESSION ENDPOINTS =====================

  // List active sessions (admin only)
  fastify.get('/sessions', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'List all active user sessions with geo data',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const payload = request.user as { id: number; role: string };

    if (payload.role !== 'admin') {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    const [sessions] = await fastify.db.query(`
      SELECT
        us.id, us.user_id, us.ip_address, us.country, us.user_agent,
        us.created_at, us.last_activity_at, us.expires_at, us.logged_out_at,
        u.email, u.name
      FROM user_sessions us
      JOIN users u ON us.user_id = u.id
      WHERE us.logged_out_at IS NULL AND us.revoked_at IS NULL AND us.expires_at > NOW()
        AND us.last_activity_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)
      ORDER BY us.created_at DESC
    `);

    return { sessions, total: (sessions as any[]).length };
  });

  // Terminate a session (admin only)
  fastify.delete('/sessions/:id', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Terminate a user session',
      tags: ['admin'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'integer' }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const payload = request.user as { id: number; role: string };
    const { id } = request.params as { id: number };

    if (payload.role !== 'admin') {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    // Get session to find the token_hash
    const session = await findOne<any>(
      fastify.db,
      'SELECT token_hash FROM user_sessions WHERE id = ?',
      [id]
    );

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    // Revoke session, mark as logged out, and revoke matching refresh token
    await updateOne(
      fastify.db,
      'UPDATE user_sessions SET revoked_at = NOW(), logged_out_at = NOW() WHERE id = ?',
      [id]
    );
    await updateOne(
      fastify.db,
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ?',
      [session.token_hash]
    );

    // Audit log
    await insertOne(
      fastify.db,
      'INSERT INTO audit_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
      [payload.id, 'session_terminated', JSON.stringify({ session_id: id }), request.ip]
    );

    return { success: true, message: 'Session terminated' };
  });
}
