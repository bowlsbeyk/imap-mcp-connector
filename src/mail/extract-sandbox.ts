import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { extractAttachment, type Extracted } from './extract.js';

const TIMEOUT_MS = 20_000;
const HEAP_MB = 256;

/**
 * Runs attachment extraction in a worker thread with a memory cap and a timeout,
 * so a zip bomb or pathological PDF kills only the worker, never the server.
 * Falls back to in-process extraction when running from TypeScript sources (dev/tests).
 */
export async function extractInSandbox(buf: Buffer, mimeType: string, filename?: string): Promise<Extracted> {
  const workerPath = fileURLToPath(new URL('./extract-worker.js', import.meta.url));
  if (!existsSync(workerPath)) return extractAttachment(buf, mimeType, filename, 'utf-8');

  return new Promise<Extracted>((resolve) => {
    let settled = false;
    const done = (r: Extracted) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(r);
    };
    const worker = new Worker(workerPath, {
      workerData: { buf, mimeType, filename },
      resourceLimits: { maxOldGenerationSizeMb: HEAP_MB, maxYoungGenerationSizeMb: 32 },
    });
    const timer = setTimeout(
      () => done({ kind: 'unsupported', reason: 'The attachment took too long to read and was skipped.' }),
      TIMEOUT_MS,
    );
    worker.once('message', (r: Extracted) => done(r));
    worker.once('error', () => done({ kind: 'unsupported', reason: 'The attachment could not be read safely (too large or malformed).' }));
    worker.once('exit', () => done({ kind: 'unsupported', reason: 'The attachment could not be read safely (too large or malformed).' }));
  });
}
