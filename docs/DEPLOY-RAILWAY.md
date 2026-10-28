# Deploy on Railway

About 10 minutes. You need a Railway account, a GitHub account, and your mailbox's IMAP/SMTP settings.

> **Sending needs Railway Pro.** Railway blocks outbound SMTP (ports 25, 465, 587, 2525) on Free, Trial and Hobby plans. `MODE=read` and `MODE=draft` work on any plan, because drafts are saved over IMAP. `MODE=send` needs Pro or higher.

## 1. Get your mail server settings

Find your provider's **IMAP** and **SMTP** host names and ports. Search "<your provider> IMAP settings", or check your mail app's account settings: Outlook lists them under Account Settings → Server Settings. Use the TLS/SSL ports:

| | Host | Port |
|---|---|---|
| IMAP | e.g. `imap.yourhost.com` | 993 (SSL/TLS) |
| SMTP | e.g. `smtp.yourhost.com` | 465 (SSL/TLS), or 587 with `SMTP_SECURE=false` (STARTTLS, enforced) |

If your provider offers **app passwords**, create one for this connector and use it as `MAIL_PASSWORD`.

## 2. Create the service

1. Fork this repo, or use it directly.
2. In Railway: **New Project → Deploy from GitHub repo →** pick the repo. Railway finds the `Dockerfile` and `railway.json` on its own.
3. Open the service → **Settings → Networking → Generate Domain**. You'll get something like `your-app.up.railway.app`. The server picks this up automatically through `RAILWAY_PUBLIC_DOMAIN`.
4. **Settings → Serverless:** leave it **off**, so the connector answers instantly.

## 3. Set variables

Service → **Variables → Raw Editor**, paste, and fill in every value (the server refuses to start if any required one is blank):

```
IMAP_HOST=imap.yourhost.com
IMAP_PORT=993
SMTP_HOST=smtp.yourhost.com
SMTP_PORT=465
MAIL_USER=you@yourcompany.com
MAIL_PASSWORD=your-mail-or-app-password

MODE=draft
# SEND_ALLOWLIST=@yourcompany.com,@bigclient.com

AUTH_USER=
AUTH_PASSWORD=
TOKEN_SECRET=
```

- `TOKEN_SECRET` signs every login token. Make it 32+ random characters: use a password manager's generator, `openssl rand -base64 32`, or `npm run gen-secret`. Keep it secret; anyone with it could mint logins.
- `AUTH_USER` and `AUTH_PASSWORD` are what **you** type on the connector's sign-in page. They're not your mail login. For a hashed password instead, run `npm run hash-password` locally and set `AUTH_PASSWORD_HASH`.
- Optional two-factor: run `npm run totp-setup` locally, add the link to your authenticator app, and set `AUTH_TOTP_SECRET`.

Deploy. When the logs show `"event":"started"`, open:

- `https://your-app.up.railway.app/healthz` → `{"ok":true,...}`
- `https://your-app.up.railway.app/healthz?deep=1` → `{"ok":true,"imap":"ok"}`. If you get `"imap":"error"`, check the host, port, username and password.

## 4. Connect Claude

1. Claude → **Settings → Connectors → Add custom connector**.
2. Name it (e.g. "Work mail"), and set the URL to `https://your-app.up.railway.app/mcp`. Leave the OAuth client ID and secret empty, because Claude registers itself.
3. Click **Connect**. The connector's sign-in page opens. Enter `AUTH_USER` and `AUTH_PASSWORD` (and the code, if you set up 2FA).
4. Ask Claude: *"List my recent work email."*

For `send_draft`, leave the tool permission on **ask before running**. Never pick "always allow".

## Modes

| MODE | Claude can |
|---|---|
| `read` | list, search, read messages and attachments |
| `draft` | ...plus save drafts and mark read/unread. You press send in your own mail app. |
| `send` | ...plus `send_draft`: send a saved draft exactly as it is, after you approve |

Change `MODE` in Variables and Railway redeploys. Then reconnect or refresh the connector so Claude sees the new tool list.

## Emergency stop

Change `TOKEN_SECRET` to a new random value. Every existing login stops working immediately. To cut off mail access completely, also change your mailbox (or app) password.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Deploy crashes with `Invalid configuration` | The log lists each bad or missing variable. |
| `imap: error` | Wrong host, port or password, or the provider needs an app password or has IMAP turned off. |
| Logs show `imap_connect_failed` with `ECONNREFUSED` on 993 | The provider has no SSL port. Use `IMAP_PORT=143`, `IMAP_SECURE=false` (STARTTLS is still required) and `SMTP_PORT=587`, `SMTP_SECURE=false`. |
| Logs show `CERT_HAS_EXPIRED` or `ERR_TLS_CERT_ALTNAME_INVALID` | Your provider's certificate is broken. First try the provider's real host name (look up where your `mail.`/`imap.` alias points). If the certificate itself is expired, ask the provider to fix it, or set `TLS_ALLOW_INVALID_CERT=true` (still encrypted, but not verified). |
| Sending times out | You're on Railway Hobby (SMTP blocked), or the SMTP port or `SMTP_SECURE` is wrong (465 means `true`, 587 means `false`). |
| Claude says the connector failed to connect | Check that the URL ends in `/mcp` and that `/healthz` works. Remove any OAuth client ID or secret you typed. |
| "redirect_uri not allowed" | You're using a client other than Claude. Add its callback to `EXTRA_REDIRECT_URIS` (e.g. `http://localhost:*` for MCP Inspector or Claude Code). |
| Asked to sign in again after a redeploy | Expected only if `TOKEN_SECRET` changed. Otherwise logins survive restarts. |
