import JSZip from 'jszip';
import { inflateRawSync } from 'node:zlib';
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import { decodeCharset, htmlToPlain } from './parse.js';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_EXTRACTED_CHARS = 50_000;
const MAX_DOCX_UNZIPPED_BYTES = 50 * 1024 * 1024;

export type Extracted =
  | { kind: 'text'; text: string; truncated: boolean }
  | { kind: 'image'; data: string; mimeType: string }
  | { kind: 'unsupported'; reason: string };

const TEXT_TYPES = new Set(['text/plain', 'text/csv', 'text/markdown', 'text/x-markdown', 'application/json', 'text/calendar']);
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function extOf(name?: string) {
  return (name ?? '').toLowerCase().split('.').pop() ?? '';
}

function limit(text: string): { text: string; truncated: boolean } {
  const clean = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return clean.length > MAX_EXTRACTED_CHARS
    ? { text: clean.slice(0, MAX_EXTRACTED_CHARS), truncated: true }
    : { text: clean, truncated: false };
}

/**
 * Zip-bomb guard: actually inflates every entry with a hard output cap (zlib maxOutputLength),
 * instead of trusting the sizes the archive declares about itself.
 */
async function docxSafe(buf: Buffer): Promise<boolean> {
  const zip = await JSZip.loadAsync(buf);
  let remaining = MAX_DOCX_UNZIPPED_BYTES;
  for (const f of Object.values(zip.files)) {
    if (f.dir) continue;
    const data = (f as unknown as { _data?: { compressedContent?: Uint8Array; compression?: { magic?: string } } })._data;
    const raw = data?.compressedContent;
    if (!raw) return false;
    const magic = data?.compression?.magic;
    let size: number;
    try {
      if (magic === '\x08\x00') size = inflateRawSync(raw, { maxOutputLength: remaining + 1 }).length; // DEFLATE
      else if (magic === '\x00\x00') size = raw.length; // STORED
      else return false;
    } catch {
      return false; // exceeded the cap or corrupt
    }
    remaining -= size;
    if (remaining < 0) return false;
  }
  return true;
}

export async function extractAttachment(buf: Buffer, mimeType: string, filename?: string, charset?: string): Promise<Extracted> {
  const type = mimeType.toLowerCase();
  const ext = extOf(filename);

  if (type === 'application/pdf' || ext === 'pdf') {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await extractText(pdf, { mergePages: true });
      return { kind: 'text', ...limit(Array.isArray(text) ? text.join('\n\n') : text) };
    } catch {
      return { kind: 'unsupported', reason: 'The PDF could not be read (it may be encrypted, damaged, or scanned images only).' };
    }
  }

  if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx') {
    try {
      if (!(await docxSafe(buf))) return { kind: 'unsupported', reason: 'The .docx expands to an unreasonable size and was not opened.' };
      const { value } = await mammoth.extractRawText({ buffer: buf });
      return { kind: 'text', ...limit(value) };
    } catch {
      return { kind: 'unsupported', reason: 'The .docx could not be read.' };
    }
  }

  if (type === 'text/html' || ext === 'html' || ext === 'htm') {
    return { kind: 'text', ...limit(htmlToPlain(decodeCharset(buf, charset))) };
  }

  if (TEXT_TYPES.has(type) || ['txt', 'csv', 'md', 'json', 'ics', 'log'].includes(ext)) {
    return { kind: 'text', ...limit(decodeCharset(buf, charset)) };
  }

  if (IMAGE_TYPES.has(type)) {
    if (buf.length > MAX_IMAGE_BYTES) return { kind: 'unsupported', reason: 'The image is larger than 5 MB.' };
    return { kind: 'image', data: buf.toString('base64'), mimeType: type };
  }

  return { kind: 'unsupported', reason: `Text extraction is not supported for ${type}.` };
}
