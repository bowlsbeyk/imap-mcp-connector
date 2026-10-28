# Setup guide (Railway)

About 15 minutes. No coding needed.

**You'll need:**
- A [GitHub](https://github.com) account (free)
- A [Railway](https://railway.com) account. The **Pro plan** is needed if you want Claude to *send* mail. Reading and drafting work on any plan.
- Your email login and your mail server settings (step 1)
- A Claude plan that supports custom connectors

---

## Step 1: Find your mail server settings

Open **Outlook → File → Account Settings → Account Settings → (your account) → Change**, or your phone's mail account settings. Write down:

| Setting | Example | Where you'll use it |
|---|---|---|
| Incoming (IMAP) server | `imap.yourcompany.com` | `IMAP_HOST` |
| Incoming port | `993` or `143` | `IMAP_PORT` |
| Outgoing (SMTP) server | `smtp.yourcompany.com` | `SMTP_HOST` |
| Outgoing port | `465` or `587` | `SMTP_PORT` |
| Username | usually your full email address | `MAIL_USER` |

If your provider offers **app passwords**, make one for this and use it instead of your normal password.

> **Tip: find the real server name.** Many hosts give you a friendly name like `imap.yourcompany.com` that secretly points to the provider's own server. Secure connections often only work with the real name. To find it, open
> `https://dns.google/resolve?name=imap.yourcompany.com&type=A`
> in your browser (with your server name). If the answer shows a different name (for example `webmail1.myregisteredsite.com`), use that name for both `IMAP_HOST` and `SMTP_HOST`.

## Step 2: Make your secret values

You need two random values: a password for signing in to the connector, and a secret key the connector uses internally.

- **Windows:** download [`scripts/make-secrets.bat`](../scripts/make-secrets.bat) and double-click it.
- **Mac or Linux:** download [`scripts/make-secrets.sh`](../scripts/make-secrets.sh) and run `sh make-secrets.sh` in Terminal.

It prints:
- `AUTH_PASSWORD`: **save this in your password manager.** You'll type it when connecting Claude.
- `TOKEN_SECRET`: paste it into Railway and you never need it again.
- `AUTH_TOTP_SECRET` (optional): adds a six-digit code from an authenticator app at sign-in. Add the printed link to your authenticator app (Google Authenticator, 1Password, etc.).

Nothing is saved or sent anywhere. Each run makes new values.

## Step 3: Copy the project to your GitHub

On the [project page](https://github.com/bowlsbeyk/imap-mcp-connector), click **Fork**, then **Create fork**. You now have your own copy.

*To get updates later, open your fork on GitHub and click **Sync fork**. Railway redeploys automatically.*

## Step 4: Create the Railway service

1. In Railway: **New Project → Deploy from GitHub repo**, then choose your fork. Railway builds it automatically.
2. Open the service, go to **Settings → Networking**, and click **Generate Domain**. When it asks for a port, enter **`8080`**. Write down the address it gives you, like `your-app.up.railway.app`.
3. Leave **Serverless** turned **off**, so the connector answers right away.

The first deploy will fail with "Invalid configuration." That's expected, because the settings aren't in yet.

## Step 5: Enter your settings

In the service, open **Variables**. Use **New Variable** for each line below, or **Raw Editor** to paste them all at once. Fill in your own values:

```
PORT=8080
IMAP_HOST=imap.yourcompany.com
IMAP_PORT=993
SMTP_HOST=smtp.yourcompany.com
SMTP_PORT=465
MAIL_USER=you@yourcompany.com
MAIL_PASSWORD=your-email-password
MODE=draft
AUTH_USER=pick-a-username
AUTH_PASSWORD=from-step-2
TOKEN_SECRET=from-step-2
```

**Ports:**
- Incoming **993** is standard. If your settings say **143**, use `IMAP_PORT=143` and add `IMAP_SECURE=false`. The connection is still encrypted.
- Outgoing **465** is standard. If your settings say **587**, use `SMTP_PORT=587` and add `SMTP_SECURE=false`.

**Optional:**
- `AUTH_TOTP_SECRET=...` from step 2, for two-factor sign-in.
- `SEND_ALLOWLIST=@yourcompany.com,@bigcustomer.com` to allow sending only to these domains or addresses.

Click **Deploy** (the purple button at the top) and wait about two minutes.

## Step 6: Check it works

Open `https://your-app.up.railway.app/healthz?deep=1` in your browser.

- `{"ok":true,"imap":"ok"}` means it can log in to your mailbox. Go to step 7.
- `{"ok":false,"imap":"error"}` means something's wrong. In Railway, open **Deployments → View logs**, find the line that says `imap_connect_failed`, and check **Fixing problems** below.

## Step 7: Connect Claude

1. In Claude: **Settings → Connectors → Add custom connector**.
2. Name it "Work email." For the URL, enter `https://your-app.up.railway.app/mcp`. Leave the advanced OAuth fields **empty**.
3. Click **Connect**. A sign-in page opens: enter your `AUTH_USER` and `AUTH_PASSWORD` (and your six-digit code, if you set one up).
4. In the connector's tool permissions, set **send_draft** to **"Ask every time."** Never choose "Always allow."
5. Try it: *"What's in my work inbox today?"*

## Turning on sending

When reading works well, change `MODE` to `send` in Variables and deploy. Then disconnect and reconnect the connector in Claude so the send option appears.

To send, ask Claude to draft a reply. It saves the draft and shows it to you, and when you approve, it sends exactly that draft and files a copy in Sent.

## Emergency stop

- **Sign out every connected app:** change `TOKEN_SECRET` to a new value from step 2 and deploy.
- **Cut off mail access entirely:** also change your email password.

---

## Fixing problems

Railway → your service → **Deployments → View logs**. Find the line with `imap_connect_failed` or `smtp_send_failed`, then match it below.

| What you see | What it means | Fix |
|---|---|---|
| `Invalid configuration` and a list of settings | Settings are missing or wrong | Add or fix the settings it names. |
| `auth_failed: true` | Wrong email username or password | Re-enter `MAIL_USER` and `MAIL_PASSWORD`, and watch for stray spaces. You may need an app password. |
| `ECONNREFUSED` on port 993 | Your provider doesn't offer the standard secure port | Use `IMAP_PORT=143`, `IMAP_SECURE=false`, `SMTP_PORT=587`, `SMTP_SECURE=false`. |
| `ERR_TLS_CERT_ALTNAME_INVALID` | You're using a friendly server name | Use the provider's real server name (see the tip in step 1). |
| `CERT_HAS_EXPIRED` | Your provider's security certificate has expired | Ask your provider to renew it. Meanwhile you can set `TLS_ALLOW_INVALID_CERT=true`: the connection stays encrypted, but it can't confirm the server's identity. |
| `STARTTLS` with `502 unimplemented` | Your provider's outgoing server has no encryption | Ask your provider to enable it. If you must send anyway, set `SMTP_ALLOW_PLAINTEXT=true`. Your email password and outgoing mail then travel unencrypted, which is what your mail app is already doing. |
| Sending times out | Railway's Hobby plan blocks sending, or the port is wrong | Upgrade to Railway Pro, or check `SMTP_PORT` and `SMTP_SECURE` (465 needs `true`, 587 needs `false`). |
| Claude says the connector failed to connect | Wrong URL, or extra OAuth fields filled in | The URL must end in `/mcp`. Leave the OAuth fields empty. |
| "redirect_uri not allowed" | You're connecting from an app other than Claude | Add that app's callback to `EXTRA_REDIRECT_URIS` (for example `http://localhost:*` for developer tools). |
| Signed out after every update | `TOKEN_SECRET` changed | Leave it the same unless you want to sign everyone out. |

Still stuck? [Open an issue](https://github.com/bowlsbeyk/imap-mcp-connector/issues). Include the log line, but **never** your passwords or secrets.
