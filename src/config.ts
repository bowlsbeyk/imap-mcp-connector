import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === '') return def;
      const s = v.trim().toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(s)) return true;
      if (['0', 'false', 'no', 'off'].includes(s)) return false;
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `expected true or false, got "${v}"` });
      return z.NEVER;
    });

const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === '') return def;
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `expected an integer between ${min} and ${max}, got "${v}"` });
        return z.NEVER;
      }
      return n;
    });

const optStr = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const list = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const EnvSchema = z
  .object({
    PORT: int(3000, 0, 65535),

    // Mailbox
    IMAP_HOST: z.string().min(1, 'IMAP_HOST is required'),
    IMAP_PORT: int(993, 1, 65535),
    IMAP_SECURE: bool(true),
    SMTP_HOST: optStr,
    SMTP_PORT: int(465, 1, 65535),
    SMTP_SECURE: bool(true),
    MAIL_USER: z.string().min(1, 'MAIL_USER is required'),
    MAIL_PASSWORD: z.string().min(1, 'MAIL_PASSWORD is required'),
    SMTP_USER: optStr,
    SMTP_PASSWORD: optStr,
    MAIL_FROM: optStr,
    SENT_FOLDER: optStr,
    DRAFTS_FOLDER: optStr,
    SAVE_TO_SENT: bool(true),
    ALLOW_INSECURE: bool(false),
    TLS_ALLOW_INVALID_CERT: bool(false),
    SMTP_ALLOW_PLAINTEXT: bool(false),

    // Access
    MODE: z
      .string()
      .optional()
      .transform((v) => (v ?? 'read').trim().toLowerCase())
      .pipe(z.enum(['read', 'draft', 'send'])),
    SEND_ALLOWLIST: list,
    MAX_SENDS_PER_HOUR: int(20, 0, 10000),
    MAX_RESULTS: int(50, 1, 500),
    TOOL_CALLS_PER_MINUTE: int(60, 1, 10000),

    // Connector sign-in
    PUBLIC_URL: optStr,
    RAILWAY_PUBLIC_DOMAIN: optStr,
    AUTH_USER: z.string().min(1, 'AUTH_USER is required'),
    AUTH_PASSWORD: optStr,
    AUTH_PASSWORD_HASH: optStr,
    AUTH_TOTP_SECRET: optStr,
    TOKEN_SECRET: z.string().min(32, 'TOKEN_SECRET must be at least 32 characters (run `npm run gen-secret`)'),
    ACCESS_TOKEN_TTL_SECONDS: int(3600, 60, 86400),
    REFRESH_TOKEN_TTL_DAYS: int(30, 1, 365),
    EXTRA_REDIRECT_URIS: list,
    TRUST_PROXY: int(1, 0, 10),
  })
  .superRefine((env, ctx) => {
    const placeholder = /change-?me|replace|paste|your-|example|placeholder|xxxx/i;
    for (const k of ['AUTH_PASSWORD', 'TOKEN_SECRET'] as const) {
      const v = env[k];
      if (v && placeholder.test(v)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [k], message: `${k} looks like a placeholder; set a real value` });
      }
    }
    if (!env.AUTH_PASSWORD && !env.AUTH_PASSWORD_HASH) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['AUTH_PASSWORD'], message: 'set AUTH_PASSWORD or AUTH_PASSWORD_HASH' });
    }
    if (env.AUTH_PASSWORD && env.AUTH_PASSWORD.length < 16) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['AUTH_PASSWORD'], message: 'AUTH_PASSWORD must be at least 16 characters' });
    }
    if (!env.PUBLIC_URL && !env.RAILWAY_PUBLIC_DOMAIN) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['PUBLIC_URL'], message: 'PUBLIC_URL is required (e.g. https://your-app.up.railway.app)' });
    }
    if (env.MODE !== 'read' && env.MODE !== 'draft' && !env.SMTP_HOST) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SMTP_HOST'], message: 'SMTP_HOST is required when MODE=send' });
    }
    const loopback = (h?: string) => !!h && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(h.toLowerCase());
    if (env.ALLOW_INSECURE && !(loopback(env.IMAP_HOST) && (!env.SMTP_HOST || loopback(env.SMTP_HOST)))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ALLOW_INSECURE'],
        message: 'ALLOW_INSECURE is only for local test servers (localhost). For a real provider with a broken certificate use TLS_ALLOW_INVALID_CERT; for SMTP without encryption use SMTP_ALLOW_PLAINTEXT',
      });
    }
    if (!env.ALLOW_INSECURE && !env.IMAP_SECURE && env.IMAP_PORT !== 143) {
      // STARTTLS on 143 is upgraded and required below; anything else plaintext is refused.
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['IMAP_SECURE'], message: 'IMAP without TLS is refused; set IMAP_SECURE=true or ALLOW_INSECURE=true for local testing' });
    }
  });

export type Mode = 'read' | 'draft' | 'send';

export interface Config {
  port: number;
  imap: { host: string; port: number; secure: boolean; user: string; pass: string; allowInsecure: boolean; allowInvalidCert: boolean };
  smtp: { host?: string; port: number; secure: boolean; user: string; pass: string; allowInsecure: boolean; allowInvalidCert: boolean; allowPlaintext: boolean };
  from: string;
  sentFolder?: string;
  draftsFolder?: string;
  saveToSent: boolean;
  mode: Mode;
  sendAllowlist: string[];
  maxSendsPerHour: number;
  maxResults: number;
  toolCallsPerMinute: number;
  publicUrl: URL;
  mcpUrl: URL;
  auth: {
    user: string;
    password?: string;
    passwordHash?: string;
    totpSecret?: string;
    tokenSecret: string;
    accessTtl: number;
    refreshTtl: number;
    redirectAllowlist: string[];
  };
  trustProxy: number;
}

export const DEFAULT_REDIRECT_URIS = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`);
    throw new ConfigError(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;

  let publicUrl: URL;
  try {
    publicUrl = new URL(e.PUBLIC_URL ?? `https://${e.RAILWAY_PUBLIC_DOMAIN}`);
  } catch {
    throw new ConfigError('Invalid configuration:\n  - PUBLIC_URL: not a valid URL');
  }
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname);
  if (publicUrl.protocol !== 'https:' && !isLocal) {
    throw new ConfigError('Invalid configuration:\n  - PUBLIC_URL: must be https (except localhost)');
  }
  publicUrl = new URL(publicUrl.origin + publicUrl.pathname.replace(/\/+$/, ''));
  const mcpUrl = new URL(publicUrl.href.replace(/\/?$/, '/mcp'));

  return {
    port: e.PORT,
    imap: { host: e.IMAP_HOST, port: e.IMAP_PORT, secure: e.IMAP_SECURE, user: e.MAIL_USER, pass: e.MAIL_PASSWORD, allowInsecure: e.ALLOW_INSECURE, allowInvalidCert: e.TLS_ALLOW_INVALID_CERT },
    smtp: {
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_SECURE,
      user: e.SMTP_USER ?? e.MAIL_USER,
      pass: e.SMTP_PASSWORD ?? e.MAIL_PASSWORD,
      allowInsecure: e.ALLOW_INSECURE,
      allowInvalidCert: e.TLS_ALLOW_INVALID_CERT,
      allowPlaintext: e.SMTP_ALLOW_PLAINTEXT,
    },
    from: e.MAIL_FROM ?? e.MAIL_USER,
    sentFolder: e.SENT_FOLDER,
    draftsFolder: e.DRAFTS_FOLDER,
    saveToSent: e.SAVE_TO_SENT,
    mode: e.MODE,
    sendAllowlist: e.SEND_ALLOWLIST.map((s) => s.toLowerCase()),
    maxSendsPerHour: e.MAX_SENDS_PER_HOUR,
    maxResults: e.MAX_RESULTS,
    toolCallsPerMinute: e.TOOL_CALLS_PER_MINUTE,
    publicUrl,
    mcpUrl,
    auth: {
      user: e.AUTH_USER,
      password: e.AUTH_PASSWORD,
      passwordHash: e.AUTH_PASSWORD_HASH,
      totpSecret: e.AUTH_TOTP_SECRET,
      tokenSecret: e.TOKEN_SECRET,
      accessTtl: e.ACCESS_TOKEN_TTL_SECONDS,
      refreshTtl: e.REFRESH_TOKEN_TTL_DAYS * 86400,
      redirectAllowlist: [...DEFAULT_REDIRECT_URIS, ...e.EXTRA_REDIRECT_URIS],
    },
    trustProxy: e.TRUST_PROXY,
  };
}

export class ConfigError extends Error {}
