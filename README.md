# imap-mcp-connector

A self-hosted [MCP](https://modelcontextprotocol.io) server that connects Claude to **any IMAP/SMTP mailbox**. It's for mail hosts with no Claude connector of their own: web.com, GoDaddy, Namecheap, Fastmail, Zoho, cPanel hosts and other small-business mail. Deploy it once, add it as a custom connector in Claude, and Claude can read, search, draft and (if you allow it) send. Your computer doesn't need to be on.

Built for working with Claude as a mail partner: Claude reads and drafts, you approve, then it sends.

**→ [Deploy on Railway in ~10 minutes](docs/DEPLOY-RAILWAY.md)**

## What Claude can do

| Tool | Mode | What it does |
|---|---|---|
| `list_folders` | read | Folders with role (inbox/sent/drafts/…), totals and unread counts |
| `list_recent` | read | Newest messages in a folder, with snippets |
| `search_messages` | read | Search by text, from, to, subject, dates |
| `get_message` | read | Full text of a message plus its attachment list. **Doesn't mark it read.** |
| `get_attachment` | read | Text of PDFs, Word .docx, text, CSV and HTML; images shown inline |
| `create_draft` | draft | Saves to Drafts. Replies are threaded automatically. |
| `mark_read` | draft | Mark read or unread |
| `send_draft` | send | Sends one saved draft **exactly as saved**, files it in Sent, removes the draft |

Set `MODE=read` (default), `draft` (recommended) or `send`.

## Security model

- **Sign-in:** a built-in, single-user OAuth 2.1 server (Dynamic Client Registration, PKCE S256, redirect-URI allowlist) with your own password and optional TOTP. Claude never sees your mail password.
- **Encryption:** TLS from Claude to the server, and TLS from the server to your mail host (IMAPS/SMTPS or enforced STARTTLS), with certificates verified. By default, plaintext and invalid certificates are refused. For providers with broken mail security, there are two explicit opt-ins, both off by default and both logged at startup: `TLS_ALLOW_INVALID_CERT` (still encrypted, certificate not verified) and `SMTP_ALLOW_PLAINTEXT` (outgoing mail unencrypted).
- **Tokens:** signed with `TOKEN_SECRET` (HKDF-derived key per token type). No database. Rotate the secret to log everything out instantly.
- **Secrets:** environment variables only. Nothing in the repo or the logs.
- **Logs:** tool name, duration and count. Never addresses, subjects, bodies, search terms or tokens.
- **Prompt injection:** email is written by strangers, and a message can contain text aimed at an AI. So message content is labeled as untrusted. `send_draft` can only send what's already in Drafts, is marked destructive so Claude asks for your approval, always sends from your address, and honors an optional `SEND_ALLOWLIST` and an hourly cap.

See [SPEC.md](SPEC.md) for the full design and [SECURITY.md](SECURITY.md) to report issues.

## Provider notes

- **Works with a password or app password:** most cPanel and shared hosts (web.com, GoDaddy, Namecheap), Fastmail, iCloud (app-specific password), Zoho, Proton (through Bridge on your own host).
- **Gmail and Google Workspace** work with an app password, but Claude already has a Gmail connector.
- **Microsoft 365 / Outlook.com:** password IMAP/SMTP is being retired, so this may not work. OAuth (XOAUTH2) is on the roadmap.
- **Railway Hobby blocks outbound SMTP.** `send` mode needs Railway Pro or another host. Any Docker host works (Fly.io, Render, a VPS, a home server behind Cloudflare Tunnel).

## Run locally

```bash
cp .env.example .env    # fill it in; set PUBLIC_URL=http://localhost:3000
npm install
npm run dev
```

Test with the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) by adding `EXTRA_REDIRECT_URIS=http://localhost:*`.

### Tests

```bash
npm test                         # unit tests
docker run -d -p 3025:3025 -p 3143:3143 -p 3465:3465 -p 3993:3993 \
  -e GREENMAIL_OPTS='-Dgreenmail.setup.test.all -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.users=test:testpass@example.com -Dgreenmail.users.login=email' \
  greenmail/standalone:2.1.3
npm run test:integration         # full OAuth + IMAP/SMTP round trip
```

## Using it on a work mailbox

You're giving a hosted service access to company mail. Get your employer's OK first, and check any retention or compliance rules (HIPAA and similar) that cover that mailbox.

## License

MIT
