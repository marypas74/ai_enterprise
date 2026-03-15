import * as vscode from 'vscode';
import type { ApiClient } from './ApiClient';
import type { EventBus } from './EventBus';
import type { LoginResponse, UserInfo } from './types';
import { API_PATHS } from '../utils/constants';

const TOKEN_KEY = 'enterprise-ai.token';
const USER_KEY = 'enterprise-ai.user';

export class AuthService {
  private currentUser: UserInfo | null = null;

  constructor(
    private readonly apiClient: ApiClient,
    private readonly eventBus: EventBus,
    private readonly context: vscode.ExtensionContext,
    private readonly outputChannel: vscode.OutputChannel,
  ) {
    this.eventBus.on('auth:logout', () => this.handleLogout());
  }

  async login(email: string, password: string, totp?: string): Promise<boolean> {
    try {
      const response = await this.apiClient.post<LoginResponse>(API_PATHS.LOGIN, {
        email,
        password,
        ...(totp ? { totp } : {}),
      });

      this.apiClient.setToken(response.token);
      this.currentUser = response.user;

      await this.context.globalState.update(TOKEN_KEY, response.token);
      await this.context.globalState.update(USER_KEY, JSON.stringify(response.user));

      this.eventBus.emit('auth:login', {
        userId: String(response.user.id),
        email: response.user.email,
      });

      this.outputChannel.appendLine(`[Auth] Login successful: ${response.user.email}`);
      return true;
    } catch (error) {
      this.outputChannel.appendLine(`[Auth] Login failed: ${error}`);
      vscode.window.showErrorMessage('Login failed. Check credentials.');
      return false;
    }
  }

  logout(): void {
    this.eventBus.emit('auth:logout', undefined);
    this.outputChannel.appendLine('[Auth] Logged out');
  }

  tryRestoreSession(): boolean {
    const token = this.context.globalState.get<string>(TOKEN_KEY);
    const userJson = this.context.globalState.get<string>(USER_KEY);

    if (token && userJson) {
      try {
        this.currentUser = JSON.parse(userJson) as UserInfo;
        this.apiClient.setToken(token);
        this.eventBus.emit('auth:login', {
          userId: String(this.currentUser.id),
          email: this.currentUser.email,
        });
        this.outputChannel.appendLine(`[Auth] Session restored: ${this.currentUser.email}`);
        return true;
      } catch {
        this.outputChannel.appendLine('[Auth] Failed to restore session');
      }
    }
    return false;
  }

  getUser(): UserInfo | null {
    return this.currentUser ? { ...this.currentUser } : null;
  }

  isAuthenticated(): boolean {
    return this.currentUser !== null && this.apiClient.hasToken();
  }

  private handleLogout(): void {
    this.currentUser = null;
    this.apiClient.clearToken();
    this.context.globalState.update(TOKEN_KEY, undefined).then(undefined, (err) => {
      this.outputChannel.appendLine(`[Auth] Failed to clear token: ${err}`);
    });
    this.context.globalState.update(USER_KEY, undefined).then(undefined, (err) => {
      this.outputChannel.appendLine(`[Auth] Failed to clear user: ${err}`);
    });
  }
}
