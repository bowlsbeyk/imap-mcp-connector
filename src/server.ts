import express, { type Request, type Response, type NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Config } from './config.js';
import { StatelessOAuthProvider } from './auth/provider.js';
import { loginRouter } from './auth/login.js';
import { buildMcpServer } from './tools.js';
import { SendBudget } from './mail/smtp.js';
import { withImap } from './mail/imap.js';
import { log, errorClass } from './log.js';

export function createApp(config: Config) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  const provider = new StatelessOAuthProvider(config);
  const sendBudget = new SendBudget(config.maxSendsPerHour);

  // Health: cheap by default; ?deep=1 checks the IMAP login (cached for a minute).
  let deep: { at: number; ok: boolean } | undefined;
  app.get('/healthz', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.query.deep === undefined) {
      res.json({ ok: true, mode: config.mode });
      return;
    }
    if (!deep || Date.now() - deep.at > 60_000) {
      try {
        await withImap(config, async () => undefined);
        deep = { at: Date.now(), ok: true };
      } catch {
        deep = { at: Date.now(), ok: false };
      }
    }
    res.status(deep.ok ? 200 : 503).json({ ok: deep.ok, imap: deep.ok ? 'ok' : 'error' });
  });

  app.get('/', (_req: Request, res: Response) => {
    res
      .type('text')
      .send(`imap-mcp-connector is running.\nAdd ${config.mcpUrl.href} as a custom connector in Claude.\nhttps://github.com/bowlsbeyk/imap-mcp-connector\n`);
  });

  // OAuth 2.1 authorization server: metadata, /register (DCR), /authorize, /token.
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: config.publicUrl,
      resourceServerUrl: config.mcpUrl,
      resourceName: 'IMAP MCP Connector',
      serviceDocumentationUrl: new URL('https://github.com/bowlsbeyk/imap-mcp-connector'),
    }),
  );
  app.use(loginRouter(config, provider));

  const bearer = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(config.mcpUrl),
    expectedResource: config.mcpUrl,
  });

  const toolLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.toolCallsPerMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => req.auth?.clientId ?? 'anon',
    message: { jsonrpc: '2.0', error: { code: -32000, message: 'Rate limit exceeded; slow down.' }, id: null },
  });

  // Stateless Streamable HTTP: a fresh server + transport per request, so restarts never break sessions.
  app.post('/mcp', bearer, toolLimiter, express.json({ limit: '1mb' }), async (req: Request, res: Response) => {
    const server = buildMcpServer(config, sendBudget);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.error('mcp_request_failed', { err: errorClass(err) });
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  });

  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed (stateless server).' }, id: null });
  };
  app.get('/mcp', bearer, methodNotAllowed);
  app.delete('/mcp', bearer, methodNotAllowed);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    log.error('http_error', { err: errorClass(err) });
    if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
