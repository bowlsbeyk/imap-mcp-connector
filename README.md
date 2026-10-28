# imap-mcp-connector

A self-hosted MCP server that gives Claude access to **any IMAP/SMTP mailbox**, including web.com, GoDaddy, Namecheap, Fastmail, cPanel hosts and other small-business mail that has no Claude connector of its own. You deploy it once, add it as a custom connector in Claude, and Claude can list, search and read your mail, and optionally draft or send, without your computer being on.

> **Status:** spec stage. See [SPEC.md](SPEC.md). Implementation hasn't started.

## Highlights

- Three access modes: `read` (default), `draft` (writes replies to your Drafts folder; recommended), and `send`
- Built-in single-user OAuth 2.1 sign-in that works with Claude's custom connectors (Dynamic Client Registration and PKCE)
- No database. Deploys as one container on Railway, Fly, a VPS or a home server.
- Reading never marks mail as read. Logs never contain addresses, subjects or bodies.

## Important caveats

- **Prompt injection:** anyone can email you text written to steer an AI. Use `draft` mode, or `send` with a recipient allowlist, and keep "ask before sending" on.
- **Railway Hobby plan blocks outbound SMTP.** `read` and `draft` work there; `send` needs Railway Pro or another host.
- **Microsoft 365 / Outlook.com** password IMAP is being retired; OAuth support is on the roadmap.
- Using this on a work mailbox? Get your employer's OK first.

## License

MIT
