// Usage: npm run hash-password   (prompts; nothing is echoed or saved)
import bcrypt from 'bcryptjs';
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
let muted = false;
out._writeToOutput = (s: string) => {
  if (!muted || s.includes('\n')) out.output.write(muted ? '\n' : s);
};
rl.question('Password for the connector sign-in page (16+ characters): ', async (pw) => {
  muted = false;
  rl.close();
  if (pw.length < 16) {
    console.error('Too short: use at least 16 characters.');
    process.exit(1);
  }
  console.log('\nAUTH_PASSWORD_HASH=' + (await bcrypt.hash(pw, 12)));
});
muted = true;
