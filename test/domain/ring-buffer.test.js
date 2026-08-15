import assert from 'node:assert/strict';
import test from 'node:test';

import { RingBuffer } from '../../src/domain/tui/ring-buffer.js';

test('domain: ring buffer stores lines up to capacity and evicts oldest items in FIFO order', () => {
  const buffer = new RingBuffer({ capacity: 5 });
  assert.equal(buffer.capacity, 5);
  assert.equal(buffer.length, 0);

  for (let i = 1; i <= 5; i++) {
    buffer.append({ taskId: 'serve', message: `Line ${i}`, timestamp: 1000 + i });
  }
  assert.equal(buffer.length, 5);
  assert.deepEqual(
    buffer.toArray().map(l => l.message),
    ['Line 1', 'Line 2', 'Line 3', 'Line 4', 'Line 5']
  );

  buffer.append({ taskId: 'serve', message: 'Line 6', timestamp: 1006 });
  assert.equal(buffer.length, 5);
  assert.deepEqual(
    buffer.toArray().map(l => l.message),
    ['Line 2', 'Line 3', 'Line 4', 'Line 5', 'Line 6']
  );
});

test('domain: ring buffer redacts sensitive tokens, passwords, and HTTP basic auth URLs', () => {
  const buffer = new RingBuffer({ capacity: 10 });
  buffer.append({ taskId: 'serve', message: 'Set NPM_TOKEN=npm_secret_xyz123 in env' });
  buffer.append({ taskId: 'serve', message: '_authToken = secret-auth-token-456' });
  buffer.append({ taskId: 'serve', message: 'Fetching https://admin:SuperSecretPass@private.registry.org/package' });
  buffer.append({ taskId: 'serve', message: 'Using GitHub token ghp_ABCdefGHIjkl1234567890mnopqrstuv' });

  const lines = buffer.toArray().map(l => l.message);
  assert.doesNotMatch(lines[0], /npm_secret_xyz123/);
  assert.match(lines[0], /\[REDACTED_TOKEN\]/);

  assert.doesNotMatch(lines[1], /secret-auth-token-456/);
  assert.match(lines[1], /\[REDACTED_TOKEN\]/);

  assert.doesNotMatch(lines[2], /SuperSecretPass/);
  assert.match(lines[2], /https:\/\/\[REDACTED_AUTH\]@private\.registry\.org/);

  assert.doesNotMatch(lines[3], /ghp_ABCdefGHIjkl1234567890mnopqrstuv/);
  assert.match(lines[3], /\[REDACTED_TOKEN\]/);
});

test('domain: ring buffer filterByType and filterByQuery return matching subsets', () => {
  const buffer = new RingBuffer({ capacity: 10 });
  buffer.append({ taskId: 'serve', type: 'serve', message: 'Server listening at http://127.0.0.1:8001/' });
  buffer.append({ taskId: 'unit', type: 'unit', message: 'test/unit/button.test.js passed' });
  buffer.append({ taskId: 'cov', type: 'coverage', message: 'Coverage: 95% lines' });
  buffer.append({ taskId: 'serve', type: 'serve', message: 'hmr update /src/button.js' });

  const serveOnly = buffer.filter({ type: 'serve' });
  assert.equal(serveOnly.length, 2);
  assert.equal(serveOnly[0].message, 'Server listening at http://127.0.0.1:8001/');
  assert.equal(serveOnly[1].message, 'hmr update /src/button.js');

  const searchResults = buffer.filter({ query: 'Coverage' });
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].taskId, 'cov');
});

test('domain: ring buffer strips terminal controls and redacts bearer, JWT, PEM, password, and authorization secrets', () => {
  const buffer = new RingBuffer({ capacity: 20, byteCapacity: 4096 });
  const bearer = 'Bearer abcdefghijklmnopqrstuvwxyz0123456789';
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhY2FkZW15In0.signaturevalue';
  const pem = '-----BEGIN PRIVATE KEY-----\nsecret-private-key\n-----END PRIVATE KEY-----';

  buffer.append({ taskId: 'serve', message: `\x1b]0;hidden-title\x07\x1b[31m${bearer}\x1b[0m` });
  buffer.append({ taskId: 'serve', message: `token=${jwt}` });
  buffer.append({ taskId: 'serve', message: pem });
  buffer.append({ taskId: 'serve', message: 'password: too-secret Authorization: Basic YWRtaW46c2VjcmV0' });
  buffer.append({ taskId: 'serve', message: 'auth=opaque-auth-secret' });

  const output = buffer.toArray().map(entry => entry.message).join('\n');
  assert.doesNotMatch(output, /\x1b|hidden-title|abcdefghijklmnopqrstuvwxyz0123456789|signaturevalue|secret-private-key|too-secret|YWRtaW46c2VjcmV0|opaque-auth-secret/);
  assert.match(output, /Bearer \[REDACTED_TOKEN\]/);
  assert.match(output, /\[REDACTED_TOKEN\]/);
  assert.match(output, /\[REDACTED_PEM\]/);
  assert.match(output, /password: \[REDACTED_PASSWORD\]/i);
  assert.match(output, /Authorization: \[REDACTED_AUTH\]/i);
  assert.match(output, /auth= \[REDACTED_AUTH\]/i);
});

test('domain: ring buffer redacts generic sensitive environment assignments while preserving ordinary text', () => {
  const buffer = new RingBuffer({ capacity: 20 });
  const assignments = [
    ['DEEPSEEK_API_KEY', 'deepseek-private-value'],
    ['OPENAI_API_KEY', 'openai-private-value'],
    ['AWS_SECRET_ACCESS_KEY', 'aws-private-value'],
    ['SERVICE_TOKEN', 'service-private-value'],
    ['DEPLOY_SECRET', 'deploy-private-value'],
    ['SIGNING_PRIVATE_KEY', 'signing-private-value']
  ];
  for (const [name, value] of assignments) {
    buffer.append({ taskId: 'serve', message: `${name}=${value}` });
  }
  buffer.append({ taskId: 'serve', message: 'API_KEY policy documentation remains visible.' });
  buffer.append({ taskId: 'serve', message: 'The token count is 4 and no assignment was printed.' });

  const lines = buffer.toArray().map(entry => entry.message);
  for (const [name, value] of assignments) {
    const line = lines.find(item => item.startsWith(`${name}=`));
    assert.ok(line);
    assert.match(line, new RegExp(`^${name}= \\[REDACTED_TOKEN\\]$`));
    assert.doesNotMatch(line, new RegExp(value));
  }
  assert.equal(lines.at(-2), 'API_KEY policy documentation remains visible.');
  assert.equal(lines.at(-1), 'The token count is 4 and no assignment was printed.');
});

test('domain: ring buffer splits lines and evicts by both line and byte capacity', () => {
  const buffer = new RingBuffer({ capacity: 3, byteCapacity: 12 });
  buffer.append({ taskId: 'serve', message: 'first\nsecond' });
  assert.deepEqual(buffer.toArray().map(entry => entry.message), ['first', 'second']);

  buffer.append({ taskId: 'serve', message: '1234567890' });
  assert.ok(buffer.length <= 3);
  assert.ok(buffer.byteLength <= 12);
  assert.deepEqual(buffer.toArray().map(entry => entry.message), ['1234567890']);
});
