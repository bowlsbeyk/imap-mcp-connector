@echo off
REM Makes the secret values for imap-mcp-connector. Double-click to run.
REM Uses Windows' secure random generator. Nothing is saved or sent anywhere.

powershell -NoProfile -Command ^
  "$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create();" ^
  "function Rand($n) { $b = New-Object byte[] $n; $rng.GetBytes($b); return $b };" ^
  "function Url64($b) { return [Convert]::ToBase64String($b).TrimEnd('=').Replace('+','-').Replace('/','_') };" ^
  "function B32($b) { $a='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; $bits=''; foreach($x in $b){ $bits += [Convert]::ToString($x,2).PadLeft(8,'0') }; $o=''; for($i=0;$i -lt $bits.Length;$i+=5){ $c=$bits.Substring($i,[Math]::Min(5,$bits.Length-$i)).PadRight(5,'0'); $o += $a[[Convert]::ToInt32($c,2)] }; return $o };" ^
  "$token = Url64 (Rand 48); $pass = Url64 (Rand 18); $totp = B32 (Rand 20);" ^
  "Write-Host ''; Write-Host '=== Paste into Railway Variables ===' -ForegroundColor Cyan;" ^
  "Write-Host ('TOKEN_SECRET=' + $token); Write-Host ('AUTH_PASSWORD=' + $pass);" ^
  "Write-Host ''; Write-Host 'Save AUTH_PASSWORD in your password manager - you type it when connecting Claude.' -ForegroundColor Yellow;" ^
  "Write-Host ''; Write-Host '=== Optional two-factor sign-in ===' -ForegroundColor Cyan;" ^
  "Write-Host ('AUTH_TOTP_SECRET=' + $totp);" ^
  "Write-Host 'Add this link to your authenticator app (or type the secret in manually):';" ^
  "Write-Host ('otpauth://totp/IMAP%%20MCP%%20Connector:connector?secret=' + $totp + '&issuer=IMAP%%20MCP%%20Connector&digits=6&period=30');" ^
  "Write-Host ''"

echo.
pause
