# Security

Please report vulnerabilities privately through GitHub's **Report a vulnerability** button (Security tab → Advisories). Don't open a public issue.

Helpful details: affected version or commit, how to reproduce it, and the impact (for example, auth bypass, mail access without sign-in, or sending without approval).

## Scope notes

- Single-user by design: one deployment, one mailbox, one owner.
- Auth codes and refresh tokens are single-use only within one running process. A restart forgets which ones were already used, though they still expire (60 s and 30 days). Rotate `TOKEN_SECRET` to revoke everything.
- Prompt injection through email content can't be fully prevented by a server. The mitigations are `MODE`, `SEND_ALLOWLIST`, the send cap, and the client-side approval prompt for `send_draft`.
