/**
 * Google OAuth Service
 *
 * Handles OAuth 2.0 authentication for Google Gemini API.
 * Supports both API key and OAuth token authentication.
 *
 * @see https://ai.google.dev/gemini-api/docs/oauth
 */

import { OAuth2Client, Credentials } from 'google-auth-library';
import { GoogleGenAI } from '@google/genai';

// OAuth configuration interface
export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: string[];
}

// Token storage interface
export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiryDate?: number;
  tokenType?: string;
}

// User OAuth session
export interface UserOAuthSession {
  userId: number;
  tokens: OAuthTokens;
  createdAt: Date;
  expiresAt?: Date;
}

// Default scopes for Gemini API
const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/generative-language',
  'https://www.googleapis.com/auth/cloud-platform'
];

/**
 * Google OAuth Service
 * Manages OAuth authentication for Google Gemini API
 */
export class GoogleOAuthService {
  private oauth2Client: OAuth2Client | null = null;
  private config: GoogleOAuthConfig | null = null;
  private userSessions: Map<number, UserOAuthSession> = new Map();

  constructor() {
    // Initialize from environment variables if available
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback';

    if (clientId && clientSecret) {
      this.configure({
        clientId,
        clientSecret,
        redirectUri
      });
    }
  }

  /**
   * Configure OAuth client
   */
  configure(config: GoogleOAuthConfig): void {
    this.config = {
      ...config,
      scopes: config.scopes || DEFAULT_SCOPES
    };

    this.oauth2Client = new OAuth2Client(
      config.clientId,
      config.clientSecret,
      config.redirectUri
    );

    console.log('[GoogleOAuth] Configured OAuth client with redirect URI:', config.redirectUri);
  }

  /**
   * Check if OAuth is configured
   */
  isConfigured(): boolean {
    return this.oauth2Client !== null && this.config !== null;
  }

  /**
   * Generate authorization URL for user consent
   */
  generateAuthUrl(state?: string): string {
    if (!this.oauth2Client || !this.config) {
      throw new Error('Google OAuth not configured');
    }

    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline', // Request refresh token
      scope: this.config.scopes,
      state: state, // Optional state parameter for CSRF protection
      prompt: 'consent' // Force consent screen to get refresh token
    });

    console.log('[GoogleOAuth] Generated auth URL');
    return authUrl;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code: string): Promise<OAuthTokens> {
    if (!this.oauth2Client) {
      throw new Error('Google OAuth not configured');
    }

    console.log('[GoogleOAuth] Exchanging authorization code for tokens');

    const { tokens } = await this.oauth2Client.getToken(code);

    return {
      accessToken: tokens.access_token || '',
      refreshToken: tokens.refresh_token || undefined,
      expiryDate: tokens.expiry_date || undefined,
      tokenType: tokens.token_type || 'Bearer'
    };
  }

  /**
   * Store tokens for a user
   */
  storeUserTokens(userId: number, tokens: OAuthTokens): void {
    const session: UserOAuthSession = {
      userId,
      tokens,
      createdAt: new Date(),
      expiresAt: tokens.expiryDate ? new Date(tokens.expiryDate) : undefined
    };

    this.userSessions.set(userId, session);
    console.log(`[GoogleOAuth] Stored tokens for user ${userId}`);
  }

  /**
   * Get tokens for a user
   */
  getUserTokens(userId: number): OAuthTokens | null {
    const session = this.userSessions.get(userId);
    if (!session) return null;

    // Check if tokens are expired
    if (session.expiresAt && new Date() > session.expiresAt) {
      console.log(`[GoogleOAuth] Tokens expired for user ${userId}, attempting refresh`);
      // Token expired, try to refresh
      return null;
    }

    return session.tokens;
  }

  /**
   * Refresh tokens for a user
   */
  async refreshUserTokens(userId: number): Promise<OAuthTokens | null> {
    if (!this.oauth2Client) {
      throw new Error('Google OAuth not configured');
    }

    const session = this.userSessions.get(userId);
    if (!session?.tokens.refreshToken) {
      console.log(`[GoogleOAuth] No refresh token for user ${userId}`);
      return null;
    }

    console.log(`[GoogleOAuth] Refreshing tokens for user ${userId}`);

    this.oauth2Client.setCredentials({
      refresh_token: session.tokens.refreshToken
    });

    const { credentials } = await this.oauth2Client.refreshAccessToken();

    const newTokens: OAuthTokens = {
      accessToken: credentials.access_token || '',
      refreshToken: credentials.refresh_token || session.tokens.refreshToken || undefined,
      expiryDate: credentials.expiry_date || undefined,
      tokenType: credentials.token_type || 'Bearer'
    };

    this.storeUserTokens(userId, newTokens);
    return newTokens;
  }

  /**
   * Revoke tokens for a user
   */
  async revokeUserTokens(userId: number): Promise<void> {
    if (!this.oauth2Client) {
      throw new Error('Google OAuth not configured');
    }

    const session = this.userSessions.get(userId);
    if (session?.tokens.accessToken) {
      try {
        await this.oauth2Client.revokeToken(session.tokens.accessToken);
        console.log(`[GoogleOAuth] Revoked tokens for user ${userId}`);
      } catch (error) {
        console.error(`[GoogleOAuth] Error revoking tokens for user ${userId}:`, error);
      }
    }

    this.userSessions.delete(userId);
  }

  /**
   * Create a GoogleGenAI client with OAuth tokens
   */
  createClientWithOAuth(tokens: OAuthTokens): GoogleGenAI {
    // The @google/genai SDK supports OAuth tokens via the authClient option
    // For now, we'll use the access token directly
    return new GoogleGenAI({
      apiKey: tokens.accessToken // OAuth access token can be used as API key equivalent
    });
  }

  /**
   * Get or create a GoogleGenAI client for a user
   * Falls back to API key if OAuth not available
   */
  async getClientForUser(userId: number): Promise<GoogleGenAI> {
    // Try OAuth tokens first
    let tokens = this.getUserTokens(userId);

    if (!tokens) {
      // Try to refresh
      tokens = await this.refreshUserTokens(userId);
    }

    if (tokens) {
      console.log(`[GoogleOAuth] Using OAuth tokens for user ${userId}`);
      return this.createClientWithOAuth(tokens);
    }

    // Fall back to API key
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (apiKey) {
      console.log(`[GoogleOAuth] Falling back to API key for user ${userId}`);
      return new GoogleGenAI({ apiKey });
    }

    throw new Error('No Google authentication available. Configure OAuth or provide API key.');
  }

  /**
   * Check if a user has valid OAuth tokens
   */
  hasValidTokens(userId: number): boolean {
    const session = this.userSessions.get(userId);
    if (!session) return false;

    if (session.expiresAt && new Date() > session.expiresAt) {
      // Tokens expired, but might be refreshable
      return !!session.tokens.refreshToken;
    }

    return true;
  }

  /**
   * Get OAuth status for a user
   */
  getOAuthStatus(userId: number): {
    connected: boolean;
    expiresAt?: Date;
    hasRefreshToken: boolean
  } {
    const session = this.userSessions.get(userId);

    return {
      connected: !!session,
      expiresAt: session?.expiresAt,
      hasRefreshToken: !!session?.tokens.refreshToken
    };
  }
}

// Singleton instance
let oauthService: GoogleOAuthService | null = null;

export function getGoogleOAuthService(): GoogleOAuthService {
  if (!oauthService) {
    oauthService = new GoogleOAuthService();
  }
  return oauthService;
}

export default GoogleOAuthService;
