/**
 * Google OAuth Routes
 *
 * Handles OAuth 2.0 authentication flow for Google Gemini API.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getGoogleOAuthService } from '../../services/GoogleOAuthService.js';
import { insertOne, findOne, updateOne } from '../../database/index.js';

// Store OAuth tokens in database
interface UserGoogleAuth {
  id: number;
  user_id: number;
  access_token: string;
  refresh_token: string | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function googleOAuthRoutes(fastify: FastifyInstance) {
  const oauthService = getGoogleOAuthService();

  // Check if OAuth is configured
  fastify.get('/google/status', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Check Google OAuth configuration status',
      tags: ['auth', 'google'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };

    const isConfigured = oauthService.isConfigured();
    const hasApiKey = !!process.env.GOOGLE_AI_API_KEY;

    // Check if user has OAuth tokens in database
    const userAuth = await findOne<UserGoogleAuth>(
      fastify.db,
      'SELECT * FROM user_google_auth WHERE user_id = ?',
      [user.id]
    );

    const userOAuthStatus = oauthService.getOAuthStatus(user.id);

    return {
      configured: isConfigured,
      hasApiKey,
      user: {
        hasOAuth: !!userAuth || userOAuthStatus.connected,
        expiresAt: userAuth?.expires_at || userOAuthStatus.expiresAt,
        hasRefreshToken: !!userAuth?.refresh_token || userOAuthStatus.hasRefreshToken
      }
    };
  });

  // Start OAuth flow - redirect to Google
  fastify.get('/google/authorize', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Start Google OAuth authorization flow',
      tags: ['auth', 'google'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!oauthService.isConfigured()) {
      return reply.status(400).send({
        error: 'Google OAuth not configured',
        message: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables'
      });
    }

    const user = request.user as { id: number };

    // Create state with user ID for verification
    const state = Buffer.from(JSON.stringify({
      userId: user.id,
      timestamp: Date.now()
    })).toString('base64');

    const authUrl = oauthService.generateAuthUrl(state);

    // Return URL for client to redirect
    return { authUrl };
  });

  // OAuth callback - exchange code for tokens
  fastify.get('/google/callback', {
    schema: {
      description: 'Google OAuth callback endpoint',
      tags: ['auth', 'google'],
      querystring: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          state: { type: 'string' },
          error: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { code?: string; state?: string; error?: string };

    // Handle error from Google
    if (query.error) {
      console.error('[GoogleOAuth] Authorization error:', query.error);
      return reply.redirect(`/settings?error=${encodeURIComponent(query.error)}`);
    }

    if (!query.code || !query.state) {
      return reply.redirect('/settings?error=missing_params');
    }

    try {
      // Decode state to get user ID
      const stateData = JSON.parse(Buffer.from(query.state, 'base64').toString());
      const userId = stateData.userId;

      // Verify timestamp is recent (within 10 minutes)
      if (Date.now() - stateData.timestamp > 600000) {
        return reply.redirect('/settings?error=state_expired');
      }

      // Exchange code for tokens
      const tokens = await oauthService.exchangeCode(query.code);

      // Store tokens in memory
      oauthService.storeUserTokens(userId, tokens);

      // Store tokens in database
      const existingAuth = await findOne<UserGoogleAuth>(
        fastify.db,
        'SELECT id FROM user_google_auth WHERE user_id = ?',
        [userId]
      );

      const expiresAt = tokens.expiryDate ? new Date(tokens.expiryDate) : null;

      if (existingAuth) {
        await updateOne(
          fastify.db,
          `UPDATE user_google_auth
           SET access_token = ?, refresh_token = COALESCE(?, refresh_token), expires_at = ?, updated_at = NOW()
           WHERE user_id = ?`,
          [tokens.accessToken, tokens.refreshToken, expiresAt, userId]
        );
      } else {
        await insertOne(
          fastify.db,
          `INSERT INTO user_google_auth (user_id, access_token, refresh_token, expires_at)
           VALUES (?, ?, ?, ?)`,
          [userId, tokens.accessToken, tokens.refreshToken, expiresAt]
        );
      }

      console.log(`[GoogleOAuth] Successfully stored tokens for user ${userId}`);

      // Redirect to settings with success
      return reply.redirect('/settings?google_auth=success');

    } catch (error) {
      console.error('[GoogleOAuth] Callback error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return reply.redirect(`/settings?error=${encodeURIComponent(errorMessage)}`);
    }
  });

  // Disconnect Google account
  fastify.post('/google/disconnect', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Disconnect Google account and revoke OAuth tokens',
      tags: ['auth', 'google'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };

    try {
      // Revoke tokens in memory
      await oauthService.revokeUserTokens(user.id);

      // Remove from database
      await fastify.db.execute(
        'DELETE FROM user_google_auth WHERE user_id = ?',
        [user.id]
      );

      console.log(`[GoogleOAuth] Disconnected Google account for user ${user.id}`);

      return { success: true, message: 'Google account disconnected' };
    } catch (error) {
      console.error('[GoogleOAuth] Disconnect error:', error);
      return reply.status(500).send({ error: 'Failed to disconnect Google account' });
    }
  });

  // Test Google connection
  fastify.get('/google/test', {
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Test Google API connection with current credentials',
      tags: ['auth', 'google'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: number };

    try {
      // Try to get a client for the user
      const client = await oauthService.getClientForUser(user.id);

      // Test by listing models
      const response = await client.models.list();
      const modelCount = Array.isArray(response) ? response.length : 0;

      return {
        success: true,
        message: 'Google API connection successful',
        modelsAvailable: modelCount
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(400).send({
        success: false,
        error: errorMessage
      });
    }
  });
}

export default googleOAuthRoutes;
