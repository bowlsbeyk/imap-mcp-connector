import { MailError } from './imap.js';

/**
 * A message id is base64url(JSON([folder, uidValidity, uid])).
 * UIDVALIDITY is included so an id can never silently point at a different
 * message after the server renumbers a folder.
 */
export interface MessageRef {
  folder: string;
  uidValidity: string;
  uid: number;
}

export function encodeId(ref: MessageRef): string {
  return Buffer.from(JSON.stringify([ref.folder, ref.uidValidity, ref.uid]), 'utf8').toString('base64url');
}

export function decodeId(id: string): MessageRef {
  try {
    const arr = JSON.parse(Buffer.from(id, 'base64url').toString('utf8'));
    if (
      Array.isArray(arr) &&
      arr.length === 3 &&
      typeof arr[0] === 'string' &&
      typeof arr[1] === 'string' &&
      Number.isInteger(arr[2]) &&
      arr[2] > 0
    ) {
      return { folder: arr[0], uidValidity: arr[1], uid: arr[2] };
    }
  } catch {
    /* fall through */
  }
  throw new MailError('That message id is not valid. Use an id returned by list_recent or search_messages.', 'BAD_ID');
}

export function checkValidity(ref: MessageRef, current: bigint | number | string | undefined) {
  if (current === undefined || String(current) !== ref.uidValidity) {
    throw new MailError(
      'That message id has expired because the folder was renumbered on the server. List or search again to get fresh ids.',
      'STALE_ID',
    );
  }
}
