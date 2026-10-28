import { createHash, timingSafeEqual } from 'node:crypto';
import express, { type Request, type Response, type Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { TOTP, Secret } from 'otpauth';
import type { Config } from '../config.js';
import type { AuthReqClaims, StatelessOAuthProvider } from './provider.js';
import { log } from '../log.js';

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export interface LoginPageOptions {
  authReq: string;
  clientName: string;
  redirectHost: string;
  needsTotp: boolean;
  mode: string;
  error?: string;
}

export function renderLoginPage(res: Response, o: LoginPageOptions, status = 200) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const modeText =
    o.mode === 'send'
      ? 'read your mail, save drafts, and send mail'
      : o.mode === 'draft'
        ? 'read your mail and save drafts'
        : 'read your mail';
  res.status(status).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · IMAP MCP Connector</title>
<style>
body{font:16px/1.5 system-ui,-apple-system,sans-serif;background:#f5f5f4;color:#1c1917;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}
main{background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:28px;max-width:380px;width:calc(100% - 32px);box-sizing:border-box}
h1{font-size:20px;margin:0 0 8px}p{margin:0 0 16px;color:#57534e;font-size:14px}
label{display:block;font-size:14px;font-weight:600;margin:12px 0 4px}
input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #d6d3d1;border-radius:8px;font-size:16px}
button{margin-top:20px;width:100%;padding:11px;border:0;border-radius:8px;background:#1c1917;color:#fff;font-size:16px;font-weight:600;cursor:pointer}
.err{background:#fef2f2;color:#991b1b;border:1px solid #fecaca;padding:8px 10px;border-radius:8px;font-size:14px}
.note{font-size:13px;margin-top:16px}
</style></head><body><main>
<h1>Connect your mailbox</h1>
<p><strong>${esc(o.clientName)}</strong> wants to ${esc(modeText)}. After you sign in you'll be sent back to <strong>${esc(o.redirectHost)}</strong>.</p>
${o.error ? `<p class="err">${esc(o.error)}</p>` : ''}
<form method="post" action="login" autocomplete="on">
<input type="hidden" name="req" value="${esc(o.authReq)}">
<label for="u">Username</label><input id="u" name="username" autocomplete="username" required autofocus>
<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required>
${o.needsTotp ? '<label for="t">Authenticator code</label><input id="t" name="totp" inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" required>' : ''}
<button type="submit">Sign in and allow</button>
</form>
<p class="note">Only continue if you just added this connector yourself.</p>
</main></body></html>`);
}

function sha(s: string) {
  return createHash('sha256').update(s, 'utf8').digest();
}

function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha(a), sha(b));
}

export function makePasswordChecker(config: Config) {
  const { password, passwordHash } = config.auth;
  return async (candidate: string): Promise<boolean> => {
    if (passwordHash) return bcrypt.compare(candidate, passwordHash);
    return safeEqual(candidate, password ?? '');
  };
}

export function makeTotpChecker(config: Config) {
  const secret = config.auth.totpSecret;
  if (!secret) return (_: string) => true;
  const totp = new TOTP({ secret: Secret.fromBase32(secret.replace(/\s+/g, '').toUpperCase()), digits: 6, period: 30 });
  let lastUsed = -1;
  return (code: string): boolean => {
    const delta = totp.validate({ token: (code ?? '').trim(), window: 1 });
    if (delta === null) return false;
    // Block replay of the same code within its window.
    const counter = Math.floor(Date.now() / 30000) + delta;
    if (counter <= lastUsed) return false;
    lastUsed = counter;
    return true;
  };
}

export function loginRouter(config: Config, provider: StatelessOAuthProvider): Router {
  const router = express.Router();
  const checkPassword = makePasswordChecker(config);
  const checkTotp = makeTotpChecker(config);

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      log.warn('login_rate_limited');
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
      res.status(429).type('text').send('Too many sign-in attempts. Try again in 15 minutes.');
    },
  });

  router.post('/login', limiter, express.urlencoded({ extended: false, limit: '8kb' }), async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, string>;
    let authReq: AuthReqClaims;
    try {
      authReq = await provider.tokens.verify<AuthReqClaims & Record<string, unknown>>('authreq', String(body.req ?? ''));
    } catch {
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
      res.status(400).type('text').send('This sign-in page expired. Go back to Claude and start connecting again.');
      return;
    }
    const client = await provider.clientsStore.getClient(authReq.cid);
    if (!client || !client.redirect_uris.map(String).includes(authReq.ru)) {
      res.status(400).type('text').send('Unknown client.');
      return;
    }

    const userOk = safeEqual(String(body.username ?? ''), config.auth.user);
    const passOk = await checkPassword(String(body.password ?? ''));
    const totpOk = userOk && passOk ? checkTotp(String(body.totp ?? '')) : false;

    if (!(userOk && passOk && totpOk)) {
      log.warn('login_failed');
      // Count this as a failure for rate limiting (non-2xx).
      renderLoginPage(
        res,
        {
          authReq: String(body.req),
          clientName: client.client_name ?? 'An MCP client',
          redirectHost: new URL(authReq.ru).host,
          needsTotp: Boolean(config.auth.totpSecret),
          mode: config.mode,
          error: 'Incorrect sign-in details.',
        },
        401,
      );
      return;
    }

    const code = await provider.issueCode(authReq);
    const target = new URL(authReq.ru);
    target.searchParams.set('code', code);
    if (authReq.st) target.searchParams.set('state', authReq.st);
    log.info('login_succeeded');
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, target.href);
  });

  return router;
}
