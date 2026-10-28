# Security

Please report vulnerabilities privately through GitHub's **Report a vulnerability** button (Security tab → Advisories). Don't open a public issue.

Helpful details: affected version or commit, how to reproduce it, and the impact (for example, auth bypass, mail access without sign-in, or sending without approval).

## Scope notes

- Single-user by design: one deployment, one mailbox, one owner.
- Auth codes and refresh tokens are single-use only within one running process. A restart forgets which ones were already used, though they still expire (60 s and 30 days). Rotate `TOKEN_SECRET` to revoke everything.
- There's no per-token revocation or refresh-token family tracking. A stolen refresh token works until it expires (30 days) or `TOKEN_SECRET` is rotated.
- The "approve before sending" rule is enforced by the client's tool-permission prompt and the server's instructions to the model. The server-side guards are `MODE`, `SEND_ALLOWLIST`, the hourly cap, and the rule that only messages already in Drafts can be sent. `send_draft` will send any draft in that folder, including ones you wrote yourself.
- Attachment text extraction runs in a worker thread with memory and time limits.
- Prompt injection through email content can't be fully prevented by a server. The mitigations are `MODE`, `SEND_ALLOWLIST`, the send cap, and the client-side approval prompt for `send_draft`.
