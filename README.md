# imap-mcp-connector

**Let Claude read and answer your work email, even if your email provider has no Claude integration.**

Many small businesses get email through a web host such as web.com, GoDaddy, Namecheap or a cPanel provider. Claude can't reach those mailboxes on its own. This project is a small bridge you run in the cloud: Claude talks to the bridge, and the bridge talks to your mailbox, the same way Outlook or your phone's mail app does.

Once it's set up, you can ask Claude things like:

- "What came in from customers today?"
- "Find the quote Acme Supply sent last week and summarize the attachment."
- "Draft a reply to Dana saying Thursday works."
- "Send it." (Claude asks you to approve first.)

Your computer doesn't need to be on.

## How it works

1. **You deploy the bridge** to a cloud host. The guide uses Railway; it takes about 15 minutes.
2. **You add it to Claude** as a custom connector and sign in once with a password you choose.
3. **Claude uses it** whenever you ask about your email, from your phone, your computer, or Claude Duet.

**→ [Step-by-step setup guide](docs/DEPLOY-RAILWAY.md)**

## Will it work with my email?

**Probably yes** if your mail app uses "IMAP" settings with a username and password. You can check in Outlook (File → Account Settings → Server Settings) or in your phone's mail settings. Hosts that usually work: web.com, GoDaddy, Namecheap, cPanel hosts, Fastmail, Zoho, iCloud (with an app-specific password).

**Use something else if:**
- **Gmail or Google Workspace:** Claude already has a built-in Gmail connector. Use that.
- **Microsoft 365 or Outlook.com:** Microsoft is phasing out password logins for this kind of connection, so it may not work.

## You choose how much Claude can do

Set this once with the `MODE` setting:

| Mode | Claude can |
|---|---|
| `read` | Read and search your email and attachments. Nothing else. |
| `draft` | Also write replies into your Drafts folder. You send them yourself. |
| `send` | Also send a draft, but only after you approve it in the Claude app. |

Even in `send` mode, Claude can only send a draft it has already shown you. Each send asks for your approval, always comes from your own address, and can be limited to approved recipients.

## Is it safe?

- **Your mail password stays on your own server.** Claude never sees it. Claude signs in to the bridge with a separate password you choose, with optional two-factor codes.
- **Everything is encrypted** between Claude, the bridge and your mail provider, as long as your provider supports it. If your provider's setup is outdated, there are clearly labeled settings to work around it, and the guide explains the tradeoff.
- **Nothing is stored.** No database, no copies of your mail. Logs record only which action ran and how long it took.
- **Watch for tricky emails.** Anyone can email you, and some emails try to give instructions to AI assistants. Claude is told to treat email content as information, not instructions. Keep sending on "ask every time" so nothing goes out without your OK.
- **One-step lockout:** change one setting (`TOKEN_SECRET`) and every connected session is signed out immediately.

**Using it for company email?** Get your employer's OK first, and check any rules that cover that mailbox (for example, HIPAA in healthcare).

## Cost

- **Railway Pro** (about $20/month) if you want Claude to send mail. Railway's cheaper Hobby plan blocks sending, but `read` and `draft` modes work on it.
- Or any host that runs Docker (Fly.io, Render, your own server).

## Help and details

- [Setup guide and troubleshooting](docs/DEPLOY-RAILWAY.md)
- [Security notes and how to report a problem](SECURITY.md)
- [Technical design](SPEC.md)

## For developers

TypeScript, the official MCP SDK (Streamable HTTP, stateless), `imapflow` and `nodemailer`. It has a built-in single-user OAuth 2.1 server (dynamic client registration, PKCE, signed stateless tokens), so there's no database.

```bash
cp .env.example .env     # fill it in; set PUBLIC_URL=http://localhost:3000
npm install
npm run dev
npm test                 # unit tests
npm run test:integration # full round trip; needs the GreenMail test server (see .github/workflows/ci.yml)
```

To test with the [MCP Inspector](https://github.com/modelcontextprotocol/inspector), add `EXTRA_REDIRECT_URIS=http://localhost:*`.

## License

MIT
