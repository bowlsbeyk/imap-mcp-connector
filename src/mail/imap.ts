import { ImapFlow, type ListResponse, type MailboxObject } from 'imapflow';
import type { Config } from '../config.js';
import { log } from '../log.js';

export class MailError extends Error {
  constructor(
    message: string,
    readonly code = 'MAIL_ERROR',
  ) {
    super(message);
  }
}

/**
 * Opens a fresh IMAP connection for one operation and always closes it.
 * Per-request connections survive restarts, sleeping and server-side idle
 * timeouts without any reconnect logic.
 */
export async function withImap<T>(config: Config, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const { host, port, secure, user, pass, allowInsecure } = config.imap;
  const client = new ImapFlow({
    host,
    port,
    secure,
    doSTARTTLS: secure ? undefined : allowInsecure ? undefined : true,
    auth: { user, pass },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
    tls: { rejectUnauthorized: !allowInsecure, minVersion: 'TLSv1.2' },
  });
  client.on('error', () => {
    /* surfaced through the awaited call below */
  });
  try {
    await client.connect();
  } catch (err) {
    const e = err as { authenticationFailed?: boolean; code?: string; responseStatus?: string; serverResponseCode?: string };
    // Codes only (e.g. ENOTFOUND, ECONNREFUSED, ETIMEDOUT, CERT_HAS_EXPIRED, ERR_TLS_CERT_ALTNAME_INVALID,
    // AUTHENTICATIONFAILED); never messages, which can echo server text.
    log.warn('imap_connect_failed', {
      auth_failed: Boolean(e?.authenticationFailed),
      code: typeof e?.code === 'string' ? e.code : undefined,
      server_code: typeof e?.serverResponseCode === 'string' ? e.serverResponseCode : undefined,
      host: host,
      port,
      secure,
    });
    if (e?.authenticationFailed) throw new MailError('The mail server rejected the username or password.', 'IMAP_AUTH');
    throw new MailError('Could not connect to the mail server.', 'IMAP_CONNECT');
  }
  try {
    return await fn(client);
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

export interface FolderRoles {
  sent?: string;
  drafts?: string;
  trash?: string;
  junk?: string;
}

const FALLBACK_NAMES: Record<keyof FolderRoles, string[]> = {
  sent: ['Sent', 'Sent Items', 'Sent Messages', 'Sent Mail', 'INBOX.Sent', 'INBOX.Sent Items', 'INBOX/Sent'],
  drafts: ['Drafts', 'Draft', 'INBOX.Drafts', 'INBOX/Drafts'],
  trash: ['Trash', 'Deleted Items', 'Deleted Messages', 'INBOX.Trash'],
  junk: ['Junk', 'Spam', 'Junk Email', 'Junk E-mail', 'INBOX.Junk', 'INBOX.Spam'],
};

const SPECIAL: Record<keyof FolderRoles, string> = { sent: '\\Sent', drafts: '\\Drafts', trash: '\\Trash', junk: '\\Junk' };

export function resolveRoles(folders: ListResponse[], config: Config): FolderRoles {
  const roles: FolderRoles = {};
  for (const key of Object.keys(SPECIAL) as (keyof FolderRoles)[]) {
    const bySpecial = folders.find((f) => f.specialUse === SPECIAL[key]);
    if (bySpecial) {
      roles[key] = bySpecial.path;
      continue;
    }
    const lower = new Map(folders.map((f) => [f.path.toLowerCase(), f.path]));
    for (const name of FALLBACK_NAMES[key]) {
      const hit = lower.get(name.toLowerCase());
      if (hit) {
        roles[key] = hit;
        break;
      }
    }
  }
  if (config.sentFolder) roles.sent = config.sentFolder;
  if (config.draftsFolder) roles.drafts = config.draftsFolder;
  return roles;
}

export async function getRoles(client: ImapFlow, config: Config): Promise<FolderRoles> {
  return resolveRoles(await client.list(), config);
}

export function roleOf(path: string, folder: ListResponse | undefined, roles: FolderRoles): string | undefined {
  if (path.toUpperCase() === 'INBOX') return 'inbox';
  if (folder?.specialUse) return folder.specialUse.replace('\\', '').toLowerCase();
  for (const [k, v] of Object.entries(roles)) if (v === path) return k;
  return undefined;
}

export async function openFolder(client: ImapFlow, path: string, readOnly: boolean): Promise<MailboxObject> {
  try {
    return await client.mailboxOpen(path, { readOnly });
  } catch {
    throw new MailError(`Folder "${path}" was not found. Call list_folders to see available folders.`, 'NO_FOLDER');
  }
}
