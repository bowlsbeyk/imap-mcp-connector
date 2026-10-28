import { loadConfig, ConfigError } from './config.js';
import { createApp } from './server.js';
import { log } from './log.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    console.error('\nSee .env.example and docs/DEPLOY-RAILWAY.md for every setting.');
    process.exit(1);
  }
  throw err;
}

if (config.imap.allowInvalidCert) {
  log.warn('tls_cert_verification_disabled', {
    note: 'TLS_ALLOW_INVALID_CERT=true: mail traffic is still encrypted, but the server certificate is not verified',
  });
}

const app = createApp(config);
const server = app.listen(config.port, () => {
  log.info('started', { port: config.port, mode: config.mode, mcp_url: config.mcpUrl.href });
});

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    log.info('stopping', { signal: sig });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
