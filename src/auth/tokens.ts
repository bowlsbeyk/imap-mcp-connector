import { hkdfSync, createHmac, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

/**
 * Stateless token service. Every OAuth artifact (client registration, pending
 * authorization request, auth code, access token, refresh token) is a JWT
 * signed with a key derived from TOKEN_SECRET for that purpose only, so one
 * kind of token can never be replayed as another. Rotating TOKEN_SECRET
 * invalidates everything at once.
 */
export type Purpose = 'client' | 'authreq' | 'code' | 'access' | 'refresh' | 'client-secret';

export class TokenService {
  private keys = new Map<Purpose, Uint8Array>();
  private issuer: string;

  constructor(secret: string, issuer: string) {
    this.issuer = issuer;
    const purposes: Purpose[] = ['client', 'authreq', 'code', 'access', 'refresh', 'client-secret'];
    for (const p of purposes) {
      const key = hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from('imap-mcp-connector'), Buffer.from(`v1:${p}`), 32);
      this.keys.set(p, new Uint8Array(key));
    }
  }

  async sign(purpose: Exclude<Purpose, 'client-secret'>, claims: JWTPayload, ttlSeconds?: number): Promise<string> {
    let jwt = new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'HS256', typ: purpose })
      .setIssuer(this.issuer)
      .setIssuedAt()
      .setJti(randomUUID());
    if (ttlSeconds !== undefined) jwt = jwt.setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds);
    return jwt.sign(this.keys.get(purpose)!);
  }

  async verify<T extends JWTPayload = JWTPayload>(purpose: Exclude<Purpose, 'client-secret'>, token: string): Promise<T> {
    const { payload, protectedHeader } = await jwtVerify(token, this.keys.get(purpose)!, {
      issuer: this.issuer,
      algorithms: ['HS256'],
    });
    if (protectedHeader.typ !== purpose) throw new Error('wrong token type');
    return payload as T;
  }

  /** Deterministic client secret for a confidential client, so it never needs storing. */
  clientSecret(clientId: string): string {
    return createHmac('sha256', this.keys.get('client-secret')!).update(clientId).digest('base64url');
  }
}

/** Best-effort single-use tracking for auth codes and refresh tokens (in memory; resets on restart). */
export class UsedTokenCache {
  private used = new Map<string, number>();

  /** Returns false if the jti was already used. */
  consume(jti: string, expiresAt: number): boolean {
    this.prune();
    if (this.used.has(jti)) return false;
    this.used.set(jti, expiresAt);
    return true;
  }

  private prune() {
    const now = Math.floor(Date.now() / 1000);
    for (const [k, exp] of this.used) if (exp < now) this.used.delete(k);
  }
}
