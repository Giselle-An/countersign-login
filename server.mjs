import http from 'node:http';
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const derive = promisify(scrypt);
const root = dirname(fileURLToPath(import.meta.url));
const SESSION_TTL = 8 * 60 * 60 * 1000;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hashToken = token => createHash('sha256').update(token).digest('hex');

export async function createApp({ dataDir = process.env.DATA_DIR || join(root, 'data'), origin = process.env.APP_ORIGIN, secureCookies = process.env.SECURE_COOKIES === 'true' } = {}) {
  const storage = resolve(dataDir);
  await mkdir(storage, { recursive: true });
  const userFile = join(storage, 'users.json');
  let users;
  try { users = JSON.parse(await readFile(userFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; users = []; }
  if (!Array.isArray(users)) throw new Error('Invalid user storage');
  const sessions = new Map();
  const attempts = new Map();
  let mutation = Promise.resolve();
  const dummySalt = randomBytes(16).toString('hex');
  const dummyHash = await derive('unusable-dummy-password', dummySalt, 64);
  const serialize = operation => {
    const task = mutation.then(operation);
    mutation = task.catch(() => {});
    return task;
  };
  async function persist(next) {
    await writeFile(userFile + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 });
    await rename(userFile + '.tmp', userFile);
    users = next;
  }
  const publicUser = user => ({ id: user.id, name: user.name, email: user.email });
  const cookie = (token, maxAge) => `countersign_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`;
  function session(req) {
    const token = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('countersign_session='))?.slice('countersign_session='.length);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const key = hashToken(token);
    const found = sessions.get(key);
    if (!found) return null;
    if (found.expires <= Date.now()) { sessions.delete(key); return null; }
    return { ...found, key };
  }
  function establish(req, res, user) {
    const old = session(req);
    if (old) sessions.delete(old.key);
    const token = randomBytes(32).toString('hex');
    sessions.set(hashToken(token), { userId: user.id, expires: Date.now() + SESSION_TTL });
    res.setHeader('Set-Cookie', cookie(token, SESSION_TTL / 1000));
  }
  function json(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(payload));
  }
  async function body(req) {
    if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      const error = new Error('Send JSON data.'); error.status = 415; throw error;
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 8192) { const error = new Error('Request is too large.'); error.status = 413; throw error; }
      chunks.push(chunk);
    }
    try {
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
      return result;
    } catch { const error = new Error('Invalid request.'); error.status = 400; throw error; }
  }
  const staticFiles = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
    ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
  ]);
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    let path;
    try { path = new URL(req.url, 'http://localhost').pathname; }
    catch { return json(res, 400, { error: 'Invalid URL.' }); }
    try {
      if (path.startsWith('/api/')) {
        if (req.method === 'POST') {
          const expected = origin || `http://${req.headers.host}`;
          if (req.headers.origin !== expected || req.headers['sec-fetch-site'] === 'cross-site') {
            return json(res, 403, { error: 'Refresh this page and try again.' });
          }
        }
        if (path === '/api/me' && req.method === 'GET') {
          const active = session(req);
          const user = active && users.find(u => u.id === active.userId);
          return json(res, user ? 200 : 401, user ? { user: publicUser(user) } : { error: 'Please sign in.' });
        }
        if (path === '/api/logout' && req.method === 'POST') {
          const active = session(req);
          if (active) sessions.delete(active.key);
          res.setHeader('Set-Cookie', cookie('', 0));
          return json(res, 200, { ok: true });
        }
        if (['/api/login', '/api/register'].includes(path) && req.method === 'POST') {
          // Limit before password hashing. Use the socket IP rather than trusting forwarded headers.
          const ip = req.socket.remoteAddress;
          const now = Date.now();
          const recent = (attempts.get(ip) || []).filter(t => t > now - 15 * 60 * 1000);
          if (recent.length >= 20) {
            res.setHeader('Retry-After', String(Math.ceil((recent[0] + 15 * 60 * 1000 - now) / 1000)));
            return json(res, 429, { error: 'Too many attempts. Please try again in 15 minutes.' });
          }
          recent.push(now); attempts.set(ip, recent);
          const input = await body(req);
          const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
          const password = typeof input.password === 'string' ? input.password : '';
          if (email.length > 254 || !emailPattern.test(email) || password.length < 10 || password.length > 128) {
            return json(res, 400, { error: 'Enter a valid email and a password with 10–128 characters.' });
          }
          if (path === '/api/register') {
            const name = typeof input.name === 'string' ? input.name.trim() : '';
            if (name.length < 2 || name.length > 60) return json(res, 400, { error: 'Enter a name with 2–60 characters.' });
            const salt = randomBytes(16).toString('hex');
            const passwordHash = (await derive(password, salt, 64)).toString('hex');
            const user = await serialize(async () => {
              if (users.some(u => u.email === email)) return null;
              const record = { id: randomBytes(16).toString('hex'), name, email, salt, passwordHash, createdAt: new Date().toISOString() };
              await persist([...users, record]);
              return record;
            });
            if (!user) return json(res, 409, { error: 'Unable to create this account. Try signing in instead.' });
            establish(req, res, user);
            return json(res, 201, { user: publicUser(user) });
          }
          const user = users.find(u => u.email === email);
          const actual = await derive(password, user?.salt || dummySalt, 64);
          const expected = user ? Buffer.from(user.passwordHash, 'hex') : dummyHash;
          if (!timingSafeEqual(actual, expected) || !user) return json(res, 401, { error: 'Email or password is incorrect.' });
          establish(req, res, user);
          return json(res, 200, { user: publicUser(user) });
        }
        return json(res, 404, { error: 'Endpoint not found.' });
      }
      const file = staticFiles.get(path);
      if (!file || !['GET', 'HEAD'].includes(req.method)) return json(res, 404, { error: 'Not found.' });
      const content = await readFile(join(root, 'public', file[0]));
      res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (error.status) return json(res, error.status, { error: error.message });
      console.error('Request failed:', error.code || error.name);
      json(res, 500, { error: 'Something went wrong. Please try again.' });
    }
  });
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of sessions) if (value.expires <= now) sessions.delete(key);
    for (const [key, values] of attempts) if (values.every(t => t <= now - 15 * 60 * 1000)) attempts.delete(key);
  }, 60_000);
  cleanup.unref();
  server.on('close', () => clearInterval(cleanup));
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  const server = await createApp();
  server.listen(port, host, () => console.log(`Countersign is ready at http://${host}:${port}`));
}
