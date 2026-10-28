#!/bin/sh
# Makes the secret values for imap-mcp-connector. Run: sh make-secrets.sh
# Uses your system's secure random source. Nothing is saved or sent anywhere.
set -e

rand_url64() { head -c "$1" /dev/urandom | base64 | tr -d '\n=' | tr '+/' '-_'; }
rand_b32() {
  if command -v base32 >/dev/null 2>&1; then head -c 20 /dev/urandom | base32 | tr -d '\n='
  else python3 -c 'import os,base64;print(base64.b32encode(os.urandom(20)).decode().rstrip("="))'
  fi
}

TOKEN=$(rand_url64 48)
PASS=$(rand_url64 18)
TOTP=$(rand_b32)

echo
echo "=== Paste into Railway Variables ==="
echo "TOKEN_SECRET=$TOKEN"
echo "AUTH_PASSWORD=$PASS"
echo
echo "Save AUTH_PASSWORD in your password manager - you type it when connecting Claude."
echo
echo "=== Optional two-factor sign-in ==="
echo "AUTH_TOTP_SECRET=$TOTP"
echo "Add this link to your authenticator app (or type the secret in manually):"
echo "otpauth://totp/IMAP%20MCP%20Connector:connector?secret=$TOTP&issuer=IMAP%20MCP%20Connector&digits=6&period=30"
echo
