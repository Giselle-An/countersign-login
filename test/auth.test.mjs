import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'countersign-test-'));
  const server = await createApp({ dataDir, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const request = (path, data, cookie, origin = base) => fetch(base + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { ...(data === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { request, dataDir, base, server };
}
const account = { name: 'Alex Chen', email: 'Alex@example.com', password: 'secure-passphrase-2026' };

test('registration, persistent password hashing, login, session rotation and logout', async t => {
  const { request, dataDir } = await fixture(t);
  assert.equal((await request('/api/me')).status, 401);
  const registered = await request('/api/register', account);
  assert.equal(registered.status, 201);
  const user = (await registered.json()).user;
  assert.deepEqual(Object.keys(user).sort(), ['email', 'id', 'name']);
  assert.equal(user.email, 'alex@example.com');
  const cookie = registered.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  const disk = await readFile(join(dataDir, 'users.json'), 'utf8');
  assert.ok(!disk.includes(account.password));
  assert.equal(JSON.parse(disk)[0].passwordHash.length, 128);
  assert.equal((await request('/api/me', undefined, cookie)).status, 200);
  assert.equal((await request('/api/login', { ...account, password: 'incorrect-password' })).status, 401);
  assert.equal((await request('/api/login', { ...account, email: 'unknown@example.com' })).status, 401);
  const loggedIn = await request('/api/login', account, cookie);
  assert.equal(loggedIn.status, 200);
  const newCookie = loggedIn.headers.get('set-cookie');
  assert.notEqual(cookie, newCookie);
  assert.equal((await request('/api/me', undefined, cookie)).status, 401);
  assert.equal((await request('/api/logout', {}, newCookie)).status, 200);
  assert.equal((await request('/api/me', undefined, newCookie)).status, 401);
  assert.equal((await request('/api/me', undefined, 'countersign_session=forged')).status, 401);
});

test('rejects invalid input, duplicate accounts, cross-origin writes and private-file access', async t => {
  const { request, base } = await fixture(t);
  assert.equal((await request('/api/register', { ...account, password: 'short' })).status, 400);
  assert.equal((await request('/api/register', { ...account, email: 'invalid' })).status, 400);
  assert.equal((await request('/api/register', { ...account, name: 'a' })).status, 400);
  assert.equal((await request('/api/register', account, undefined, 'https://evil.example')).status, 403);
  assert.equal((await request('/api/register', account)).status, 201);
  assert.equal((await request('/api/register', { ...account, email: 'alex@example.com' })).status, 409);
  assert.equal((await fetch(base + '/data/users.json')).status, 404);
  assert.equal((await fetch(base + '/server.mjs')).status, 404);
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('concurrent registration cannot create duplicate email records', async t => {
  const { request, dataDir } = await fixture(t);
  const responses = await Promise.all([request('/api/register', account), request('/api/register', account)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
  assert.equal(JSON.parse(await readFile(join(dataDir, 'users.json'), 'utf8')).length, 1);
});

test('limits authentication attempts before further password checks', async t => {
  const { request } = await fixture(t);
  for (let i = 0; i < 20; i++) assert.equal((await request('/api/login', { email: 'invalid', password: 'short' })).status, 400);
  const blocked = await request('/api/login', account);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
});

test('HTTPS deployment configuration issues Secure cookies', async t => {
  const { request } = await fixture(t, { origin: 'https://countersign.example', secureCookies: true });
  const registered = await request('/api/register', account, undefined, 'https://countersign.example');
  assert.equal(registered.status, 201);
  assert.match(registered.headers.get('set-cookie'), /; Secure/);
});
