// Structured, content-free logging. Never pass message bodies, addresses,
// subjects, search terms, credentials, auth codes or tokens to these functions.

type Fields = Record<string, string | number | boolean | undefined>;

function emit(level: 'info' | 'warn' | 'error', event: string, fields: Fields = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Fields) => emit('info', event, fields),
  warn: (event: string, fields?: Fields) => emit('warn', event, fields),
  error: (event: string, fields?: Fields) => emit('error', event, fields),
};

/** Reduce an error to a class name that is safe to log (no message text, which can echo server responses). */
export function errorClass(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; name?: unknown; constructor?: { name?: string } };
    if (typeof e.code === 'string') return e.code;
    if (typeof e.name === 'string' && e.name !== 'Error') return e.name;
    if (e.constructor?.name) return e.constructor.name;
  }
  return 'Error';
}
