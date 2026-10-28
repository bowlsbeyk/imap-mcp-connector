import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import type Mail from 'nodemailer/lib/mailer/index.js';
import type { Config } from '../config.js';
import { MailError } from './imap.js';

export function createTransport(config: Config) {
  const { host, port, secure, user, pass, allowInsecure } = config.smtp;
  if (!host) throw new MailError('Sending is not configured (SMTP_HOST is not set).', 'NO_SMTP');
  return nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure && !allowInsecure,
    auth: { user, pass },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
    tls: { rejectUnauthorized: !allowInsecure, minVersion: 'TLSv1.2' },
    logger: false,
    debug: false,
  });
}

/** Build a raw RFC 5322 message. keepBcc keeps the Bcc header (for Drafts/Sent copies only). */
export async function buildRaw(mail: Mail.Options, keepBcc: boolean): Promise<Buffer> {
  const composer = new MailComposer(mail);
  const node = composer.compile();
  (node as unknown as { keepBcc: boolean }).keepBcc = keepBcc;
  return node.build();
}

/** Lowercased bare address from "Name <addr>" or "addr". */
export function bareAddress(s: string): string {
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}

export function recipientAllowed(address: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  const addr = bareAddress(address);
  const domain = addr.slice(addr.lastIndexOf('@'));
  return allowlist.some((rule) => (rule.startsWith('@') ? domain === rule : addr === rule));
}

/** Sliding one-hour window counter for sends. In memory; resets on restart. */
export class SendBudget {
  private stamps: number[] = [];
  constructor(private perHour: number) {}
  remaining(): number {
    const cutoff = Date.now() - 3600_000;
    this.stamps = this.stamps.filter((t) => t > cutoff);
    return Math.max(0, this.perHour - this.stamps.length);
  }
  take(): boolean {
    if (this.remaining() <= 0) return false;
    this.stamps.push(Date.now());
    return true;
  }
}
