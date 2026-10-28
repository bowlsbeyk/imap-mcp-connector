import { describe, it, expect } from 'vitest';
import { encodeId, decodeId, checkValidity } from '../../src/mail/ids.js';
import { redirectAllowed } from '../../src/auth/provider.js';
import { recipientAllowed, bareAddress, SendBudget } from '../../src/mail/smtp.js';
import { loadConfig, DEFAULT_REDIRECT_URIS } from '../../src/config.js';
import { TokenService } from '../../src/auth/tokens.js';

const baseEnv = {
  IMAP_HOST: 'imap.example.com',
  MAIL_USER: 'me@example.com',
  MAIL_PASSWORD: 'x',
  AUTH_USER: 'owner',
  AUTH_PASSWORD: 'a-long-enough-password',
  TOKEN_SECRET: 'q7Rk2vLp9Zt4Wm8Hc3Nf6Bj1Xs5Dg0Ya',
  PUBLIC_URL: 'https://mail.example.com',
};

describe('message ids', () => {
  it('round-trips folder, uidvalidity and uid', () => {
    const ref = { folder: 'INBOX/Sub folder', uidValidity: '12345', uid: 42 };
    expect(decodeId(encodeId(ref))).toEqual(ref);
  });
  it('rejects garbage', () => {
    expect(() => decodeId('not-an-id')).toThrow(/not valid/);
  });
  it('rejects stale uidvalidity', () => {
    expect(() => checkValidity({ folder: 'INBOX', uidValidity: '1', uid: 1 }, 2n)).toThrow(/expired/);
    expect(() => checkValidity({ folder: 'INBOX', uidValidity: '2', uid: 1 }, 2n)).not.toThrow();
  });
});

describe('redirect allowlist', () => {
  it('allows Claude callbacks exactly', () => {
    for (const u of DEFAULT_REDIRECT_URIS) expect(redirectAllowed(u, DEFAULT_REDIRECT_URIS)).toBe(true);
    expect(redirectAllowed('https://claude.ai/api/mcp/auth_callback/evil', DEFAULT_REDIRECT_URIS)).toBe(false);
    expect(redirectAllowed('https://evil.example/api/mcp/auth_callback', DEFAULT_REDIRECT_URIS)).toBe(false);
  });
  it('supports the localhost wildcard only when configured', () => {
    expect(redirectAllowed('http://localhost:6274/oauth/callback', DEFAULT_REDIRECT_URIS)).toBe(false);
    expect(redirectAllowed('http://localhost:6274/oauth/callback', ['http://localhost:*'])).toBe(true);
    expect(redirectAllowed('http://127.0.0.1:9/x', ['http://localhost:*'])).toBe(true);
    expect(redirectAllowed('http://evil.com/x', ['http://localhost:*'])).toBe(false);
  });
});

describe('send allowlist', () => {
  it('matches domains and exact addresses', () => {
    const list = ['@acme.com', 'partner@example.org'];
    expect(recipientAllowed('Bob <bob@acme.com>', list)).toBe(true);
    expect(recipientAllowed('bob@acme.com.evil.io', list)).toBe(false);
    expect(recipientAllowed('partner@example.org', list)).toBe(true);
    expect(recipientAllowed('other@example.org', list)).toBe(false);
    expect(recipientAllowed('anyone@anywhere.com', [])).toBe(true);
    expect(bareAddress('"A, B" <A@B.com>')).toBe('a@b.com');
  });
  it('limits sends per hour', () => {
    const b = new SendBudget(2);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
  });
});

describe('config', () => {
  it('loads defaults', () => {
    const c = loadConfig(baseEnv);
    expect(c.mode).toBe('read');
    expect(c.mcpUrl.href).toBe('https://mail.example.com/mcp');
    expect(c.imap.port).toBe(993);
  });
  it('uses RAILWAY_PUBLIC_DOMAIN when PUBLIC_URL is missing', () => {
    const { PUBLIC_URL, ...rest } = baseEnv;
    const c = loadConfig({ ...rest, RAILWAY_PUBLIC_DOMAIN: 'x.up.railway.app' });
    expect(c.publicUrl.href).toBe('https://x.up.railway.app/');
  });
  it('rejects weak or missing settings with readable errors', () => {
    expect(() => loadConfig({ ...baseEnv, AUTH_PASSWORD: 'short' })).toThrow(/at least 16/);
    expect(() => loadConfig({ ...baseEnv, TOKEN_SECRET: 'short' })).toThrow(/TOKEN_SECRET/);
    expect(() => loadConfig({ ...baseEnv, MODE: 'send' })).toThrow(/SMTP_HOST/);
    expect(() => loadConfig({ ...baseEnv, PUBLIC_URL: 'http://mail.example.com' })).toThrow(/https/);
    expect(() => loadConfig({ ...baseEnv, MODE: 'yolo' })).toThrow();
    expect(() => loadConfig({ ...baseEnv, TOKEN_SECRET: 'paste-a-random-40+-character-string-here' })).toThrow(/placeholder/);
  });
});

describe('tokens', () => {
  it('cannot replay one token type as another', async () => {
    const t = new TokenService('s'.repeat(40), 'https://x');
    const code = await t.sign('code', { cid: 'c' }, 60);
    await expect(t.verify('access', code)).rejects.toThrow();
    await expect(t.verify('code', code)).resolves.toMatchObject({ cid: 'c' });
  });
  it('rejects tokens signed with another secret', async () => {
    const a = new TokenService('a'.repeat(40), 'https://x');
    const b = new TokenService('b'.repeat(40), 'https://x');
    await expect(b.verify('access', await a.sign('access', {}, 60))).rejects.toThrow();
  });
});

import { envelopeOf } from '../../src/mail/smtp.js';
import { simpleParser } from 'mailparser';

describe('send allowlist bypass regression', () => {
  it('a display name cannot smuggle extra envelope recipients', async () => {
    // What a malicious draft header looks like after being saved.
    const parsed = await simpleParser('To: "evil@bad.example, x" <ok@allowed.example>\r\nSubject: t\r\n\r\nbody');
    const to = (Array.isArray(parsed.to) ? parsed.to : [parsed.to!]).flatMap((o) => o.value);
    const addrs = to.map((v) => ({ name: v.name ?? '', address: v.address! }));
    expect(addrs.map((a) => a.address)).toEqual(['ok@allowed.example']);
    expect(envelopeOf({ from: 'me@x.example', to: addrs, text: 'x' })).toEqual(['ok@allowed.example']);
  });
});
