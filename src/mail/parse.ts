import iconv from 'iconv-lite';
import { convert as htmlToText } from 'html-to-text';
import type { MessageStructureObject, MessageAddressObject, MessageEnvelopeObject } from 'imapflow';

export interface PartInfo {
  part: string;
  type: string;
  encoding?: string;
  charset?: string;
  size?: number;
  filename?: string;
}

function partId(node: MessageStructureObject): string {
  return node.part ?? '1';
}

function filenameOf(node: MessageStructureObject): string | undefined {
  return node.dispositionParameters?.filename ?? node.parameters?.name ?? undefined;
}

function walk(node: MessageStructureObject, cb: (n: MessageStructureObject) => void) {
  cb(node);
  for (const child of node.childNodes ?? []) walk(child, cb);
}

function toInfo(node: MessageStructureObject): PartInfo {
  return {
    part: partId(node),
    type: (node.type ?? 'application/octet-stream').toLowerCase(),
    encoding: node.encoding?.toLowerCase(),
    charset: node.parameters?.charset,
    size: node.size,
    filename: filenameOf(node),
  };
}

/** The best body part to show as text: text/plain, else text/html. Attachments are skipped. */
export function findBodyPart(struct: MessageStructureObject | undefined): PartInfo | undefined {
  if (!struct) return undefined;
  let plain: MessageStructureObject | undefined;
  let html: MessageStructureObject | undefined;
  walk(struct, (n) => {
    const type = (n.type ?? '').toLowerCase();
    if (n.disposition?.toLowerCase() === 'attachment') return;
    if (type === 'text/plain' && !plain && !filenameOf(n)) plain = n;
    if (type === 'text/html' && !html && !filenameOf(n)) html = n;
  });
  const chosen = plain ?? html;
  return chosen ? toInfo(chosen) : undefined;
}

/** Attachments: any leaf part that has a filename or attachment disposition and isn't the body. */
export function listAttachments(struct: MessageStructureObject | undefined): PartInfo[] {
  if (!struct) return [];
  const body = findBodyPart(struct);
  const out: PartInfo[] = [];
  walk(struct, (n) => {
    const type = (n.type ?? '').toLowerCase();
    if (type.startsWith('multipart/')) return;
    const id = partId(n);
    if (body && id === body.part) return;
    const isAttachment = n.disposition?.toLowerCase() === 'attachment' || Boolean(filenameOf(n));
    if (isAttachment || type === 'message/rfc822') out.push(toInfo(n));
  });
  return out;
}

export function findPart(struct: MessageStructureObject | undefined, part: string): PartInfo | undefined {
  if (!struct) return undefined;
  let hit: PartInfo | undefined;
  walk(struct, (n) => {
    if (!hit && partId(n) === part && !(n.type ?? '').toLowerCase().startsWith('multipart/')) hit = toInfo(n);
  });
  return hit;
}

export function decodeTransferEncoding(raw: Buffer, encoding?: string): Buffer {
  switch ((encoding ?? '').toLowerCase()) {
    case 'base64': {
      const clean = raw.toString('latin1').replace(/[^A-Za-z0-9+/=]/g, '');
      return Buffer.from(clean.slice(0, clean.length - (clean.length % 4)), 'base64');
    }
    case 'quoted-printable': {
      const s = raw
        .toString('latin1')
        .replace(/=\r?\n/g, '')
        .replace(/=([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
      return Buffer.from(s, 'latin1');
    }
    default:
      return raw;
  }
}

export function decodeCharset(buf: Buffer, charset?: string): string {
  const cs = (charset ?? 'utf-8').toLowerCase();
  try {
    if (iconv.encodingExists(cs)) return iconv.decode(buf, cs);
  } catch {
    /* fall through */
  }
  return buf.toString('utf8');
}

export function htmlToPlain(html: string): string {
  return htmlToText(html, {
    wordwrap: false,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { hideLinkHrefIfSameAsText: true } },
    ],
  });
}

export function bodyToText(raw: Buffer, info: PartInfo): string {
  const text = decodeCharset(decodeTransferEncoding(raw, info.encoding), info.charset);
  const plain = info.type === 'text/html' ? htmlToPlain(text) : text;
  return plain.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Parse a raw header block into lowercase name -> values. */
export function parseHeaderBlock(raw: Buffer | undefined): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!raw) return map;
  const unfolded = raw.toString('utf8').replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    const v = line.slice(i + 1).trim();
    map.set(k, [...(map.get(k) ?? []), v]);
  }
  return map;
}

export function fmtAddr(a: MessageAddressObject): string {
  if (a.name && a.address) return `${a.name} <${a.address}>`;
  return a.address ?? a.name ?? '';
}

export function fmtAddrs(list: MessageAddressObject[] | undefined): string[] {
  return (list ?? []).map(fmtAddr).filter(Boolean);
}

export function iso(d: Date | string | undefined): string | undefined {
  if (!d) return undefined;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function envelopeSummary(env: MessageEnvelopeObject | undefined) {
  return {
    from: fmtAddrs(env?.from),
    to: fmtAddrs(env?.to),
    cc: fmtAddrs(env?.cc),
    subject: env?.subject ?? '',
    date: iso(env?.date),
    messageId: env?.messageId,
  };
}

export function truncate(s: string, max: number): { text: string; truncated: boolean } {
  if (s.length <= max) return { text: s, truncated: false };
  return { text: s.slice(0, max), truncated: true };
}

export function snippetOf(s: string, max = 200): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}
