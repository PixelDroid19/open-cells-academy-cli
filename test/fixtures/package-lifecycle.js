import { writeFileSync } from 'node:fs';

const mode = process.argv[2];

if (mode === 'mark') {
  writeFileSync('lifecycle-ran.txt', 'ran\n', { encoding: 'utf8', mode: 0o600 });
} else if (mode === 'fail') {
  process.stderr.write('fixture lifecycle failure\n');
  process.exitCode = 17;
} else {
  process.stderr.write('unknown lifecycle mode\n');
  process.exitCode = 64;
}
