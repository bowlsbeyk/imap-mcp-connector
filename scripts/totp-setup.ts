// Usage: npm run totp-setup
// Prints a new secret for AUTH_TOTP_SECRET and an otpauth:// link to add to any authenticator app.
import { TOTP, Secret } from 'otpauth';

const secret = new Secret({ size: 20 });
const totp = new TOTP({ issuer: 'IMAP MCP Connector', label: 'connector', secret, digits: 6, period: 30 });
console.log('AUTH_TOTP_SECRET=' + secret.base32);
console.log('\nAdd to your authenticator app with this link (or type the secret in manually):');
console.log(totp.toString());
