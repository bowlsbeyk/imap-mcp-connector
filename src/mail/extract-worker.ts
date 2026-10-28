import { parentPort, workerData } from 'node:worker_threads';
import { extractAttachment } from './extract.js';

const { buf, mimeType, filename } = workerData as { buf: Uint8Array; mimeType: string; filename?: string };

extractAttachment(Buffer.from(buf), mimeType, filename, 'utf-8')
  .then((r) => parentPort?.postMessage(r))
  .catch(() => parentPort?.postMessage({ kind: 'unsupported', reason: 'The attachment could not be read.' }));
