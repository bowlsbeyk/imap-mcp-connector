import type { Response } from 'express';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidTargetError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { Config } from '../config.js';
import { TokenService, UsedTokenCache } from './tokens.js';
import { renderLoginPage } from './login.js';

const CLIENT_ID_PREFIX = 'mcpc_';
const AUTHREQ_TTL = 10 * 60;
const CODE_TTL = 60;

/** True if a redirect URI is allowed by the configured allowlist. */
export function redirectAllowed(uri: string, allowlist: string[]): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  for (const entry of allowlist) {
    if (entry === uri) return true;
    // "http://localhost:*" allows any port and path on loopback, for local tools (MCP Inspector, Claude Code).
    if (entry === 'http://localhost:*' && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      return true;
    }
  }
  return false;
}

function sameResource(a: string | URL, b: URL): boolean {
  const norm = (u: string) => u.replace(/#.*$/, '').replace(/\/$/, '');
  return norm(a.toString()) === norm(b.toString());
}

type ClientClaims = {
  ru: string[];
  am?: string;
  gt?: string[];
  rt?: string[];
  cn?: string;
};

export type AuthReqClaims = {
  cid: string;
  ru: string;
  cc: string;
  st?: string;
  sc?: string[];
};

type CodeClaims = { cid: string; ru: string; cc: string; sc?: string[] };
type RefreshClaims = { cid: string; sc?: string[] };
type AccessClaims = { cid: string; sc?: string[] };

export class StatelessOAuthProvider implements OAuthServerProvider {
  readonly tokens: TokenService;
  private usedCodes = new UsedTokenCache();
  private usedRefresh = new UsedTokenCache();

  constructor(private config: Config) {
    this.tokens = new TokenService(config.auth.tokenSecret, config.publicUrl.href);
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: async (clientId: string) => {
        if (!clientId.startsWith(CLIENT_ID_PREFIX)) return undefined;
        let c: ClientClaims;
        try {
          c = await this.tokens.verify<ClientClaims & { iat?: number }>('client', clientId.slice(CLIENT_ID_PREFIX.length));
        } catch {
          return undefined;
        }
        // Re-check the allowlist so tightening it also cuts off clients registered earlier.
        if (!c.ru.every((u) => redirectAllowed(u, this.config.auth.redirectAllowlist))) return undefined;
        const info: OAuthClientInformationFull = {
          client_id: clientId,
          redirect_uris: c.ru,
          token_endpoint_auth_method: c.am ?? 'none',
          grant_types: c.gt ?? ['authorization_code', 'refresh_token'],
          response_types: c.rt ?? ['code'],
          client_name: c.cn,
        };
        if (info.token_endpoint_auth_method !== 'none') {
          info.client_secret = this.tokens.clientSecret(clientId);
          info.client_secret_expires_at = 0;
        }
        return info;
      },

      registerClient: async (client) => {
        const bad = client.redirect_uris.filter((u) => !redirectAllowed(String(u), this.config.auth.redirectAllowlist));
        if (bad.length > 0) {
          throw new InvalidClientMetadataError(
            'redirect_uri not allowed by this server. Add it to EXTRA_REDIRECT_URIS if you trust this client.',
          );
        }
        const claims: ClientClaims = {
          ru: client.redirect_uris.map(String),
          am: client.token_endpoint_auth_method,
          gt: client.grant_types,
          rt: client.response_types,
          cn: typeof client.client_name === 'string' ? client.client_name.slice(0, 100) : undefined,
        };
        const clientId = CLIENT_ID_PREFIX + (await this.tokens.sign('client', claims));
        const isPublic = (client.token_endpoint_auth_method ?? 'none') === 'none';
        return {
          ...client,
          client_id: clientId,
          client_id_issued_at: Math.floor(Date.now() / 1000),
          client_secret: isPublic ? undefined : this.tokens.clientSecret(clientId),
          client_secret_expires_at: isPublic ? undefined : 0,
        };
      },
    };
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    if (params.resource && !sameResource(params.resource, this.config.mcpUrl)) {
      const u = new URL(params.redirectUri);
      u.searchParams.set('error', 'invalid_target');
      u.searchParams.set('error_description', 'resource does not match this server');
      if (params.state) u.searchParams.set('state', params.state);
      res.redirect(302, u.href);
      return;
    }
    const claims: AuthReqClaims = {
      cid: client.client_id,
      ru: params.redirectUri,
      cc: params.codeChallenge,
      st: params.state,
      sc: params.scopes,
    };
    const authReq = await this.tokens.sign('authreq', claims, AUTHREQ_TTL);
    renderLoginPage(res, {
      authReq,
      clientName: client.client_name ?? 'An MCP client',
      redirectHost: new URL(params.redirectUri).host,
      needsTotp: Boolean(this.config.auth.totpSecret),
      mode: this.config.mode,
    });
  }

  /** Called by the login handler after the owner signs in. */
  async issueCode(req: AuthReqClaims): Promise<string> {
    const claims: CodeClaims = { cid: req.cid, ru: req.ru, cc: req.cc, sc: req.sc };
    return this.tokens.sign('code', claims, CODE_TTL);
  }

  private async readCode(client: OAuthClientInformationFull, code: string) {
    let c: CodeClaims & { jti?: string; exp?: number };
    try {
      c = await this.tokens.verify('code', code);
    } catch {
      throw new InvalidGrantError('invalid or expired authorization code');
    }
    if (c.cid !== client.client_id) throw new InvalidGrantError('authorization code was issued to another client');
    return c;
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    return (await this.readCode(client, authorizationCode)).cc;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const c = await this.readCode(client, authorizationCode);
    if (redirectUri !== undefined && redirectUri !== c.ru) throw new InvalidGrantError('redirect_uri mismatch');
    if (resource && !sameResource(resource, this.config.mcpUrl)) throw new InvalidTargetError('resource does not match this server');
    if (!c.jti || !this.usedCodes.consume(c.jti, c.exp ?? 0)) throw new InvalidGrantError('authorization code already used');
    return this.issueTokens(client.client_id, c.sc);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    _scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    let r: RefreshClaims & { jti?: string; exp?: number };
    try {
      r = await this.tokens.verify('refresh', refreshToken);
    } catch {
      throw new InvalidGrantError('invalid or expired refresh token');
    }
    if (r.cid !== client.client_id) throw new InvalidGrantError('refresh token was issued to another client');
    if (resource && !sameResource(resource, this.config.mcpUrl)) throw new InvalidTargetError('resource does not match this server');
    if (!r.jti || !this.usedRefresh.consume(r.jti, r.exp ?? 0)) throw new InvalidGrantError('refresh token already used');
    return this.issueTokens(client.client_id, r.sc);
  }

  private async issueTokens(clientId: string, scopes?: string[]): Promise<OAuthTokens> {
    const { accessTtl, refreshTtl } = this.config.auth;
    const access = await this.tokens.sign('access', { cid: clientId, sc: scopes, aud: this.config.mcpUrl.href } as AccessClaims, accessTtl);
    const refresh = await this.tokens.sign('refresh', { cid: clientId, sc: scopes } as RefreshClaims, refreshTtl);
    return {
      access_token: access,
      token_type: 'Bearer',
      expires_in: accessTtl,
      refresh_token: refresh,
      scope: scopes?.join(' '),
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    let a: AccessClaims & { exp?: number; aud?: string | string[] };
    try {
      a = await this.tokens.verify('access', token);
    } catch {
      throw new InvalidTokenError('invalid or expired access token');
    }
    // Make sure the client registration behind this token is still acceptable.
    const client = await this.clientsStore.getClient(a.cid);
    if (!client) throw new InvalidTokenError('client no longer allowed');
    const aud = Array.isArray(a.aud) ? a.aud[0] : a.aud;
    return {
      token,
      clientId: a.cid,
      scopes: a.sc ?? [],
      expiresAt: a.exp,
      resource: aud ? new URL(aud) : undefined,
    };
  }
}
