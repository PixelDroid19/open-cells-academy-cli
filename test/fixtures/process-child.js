import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [mode, ...args] = process.argv.slice(2);

if (mode === 'echo') {
  process.stdout.write(args[0] ?? '');
  process.stderr.write(args[1] ?? '');
  process.exitCode = Number.parseInt(args[2] ?? '0', 10);
} else if (mode === 'linger') {
  writeFileSync(args[0], String(process.pid), { encoding: 'utf8', mode: 0o600 });
  process.stdout.write('ready\n');
  setInterval(() => {}, 1_000);
} else if (mode === 'spam') {
  const chunk = 'x'.repeat(8_192);
  const write = () => {
    while (process.stdout.write(chunk)) {
      continue;
    }
    process.stdout.once('drain', write);
  };
  write();
} else if (mode === 'stdin') {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    input += chunk;
  });
  process.stdin.on('end', () => {
    process.stdout.write(input);
  });
} else if (mode === 'group-descendant') {
  const [pidPath, outputMode] = args;
  const descendant = spawn(process.execPath, [import.meta.filename, 'ignore-term', pidPath], {
    detached: false,
    stdio: ['ignore', 'pipe', 'ignore']
  });
  const closeWhenReady = () => {
    process.stdout.write('group-ready\n');
    if (outputMode === 'spam') {
      const chunk = 'x'.repeat(8_192);
      const write = () => {
        while (process.stdout.write(chunk)) {
          continue;
        }
        process.stdout.once('drain', write);
      };
      write();
    }
  };
  descendant.stdout.once('data', closeWhenReady);
  process.once('SIGTERM', () => {
    process.exit(0);
  });
  setInterval(() => {}, 1_000);
} else if (mode === 'ignore-term') {
  writeFileSync(args[0], String(process.pid), { encoding: 'utf8', mode: 0o600 });
  process.stdout.write('descendant-ready\n');
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1_000);
} else {
  process.stderr.write('unknown fixture mode');
  process.exitCode = 64;
}
