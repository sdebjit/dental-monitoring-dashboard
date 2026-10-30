import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { DriveApi } from './drive-api.mjs';
import { DriveStore } from './drive-store.mjs';
import { ingestFolder } from './drive-pipeline.mjs';

try {
  if (typeof process.loadEnvFile === 'function') process.loadEnvFile();
} catch (_) {}

const ROOT = new URL('../public/', import.meta.url);
const SESSION = '__session';
const SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive'];

function settings(env) {
  const baseUrl = env.DAYBOOK_BASE_URL || env.DENTAL_MONITORING_DASHBOARD_BASE_URL;
  if (!baseUrl) throw new Error('Set DAYBOOK_BASE_URL and Google Cloud credentials before starting; see README.md.');
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && base.hostname === 'localhost')) throw new Error('DAYBOOK_BASE_URL must be HTTPS.');
  if (base.pathname !== '/' || base.search || base.hash) throw new Error('DAYBOOK_BASE_URL must be an origin without a path.');
  const schedulerSecret = env.DAYBOOK_SCHEDULER_SECRET || env.DENTAL_MONITORING_DASHBOARD_SCHEDULER_SECRET;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !schedulerSecret) throw new Error('Google OAuth and scheduler environment variables are required.');
  return { base: base.origin, clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, schedulerSecret, secure: base.protocol === 'https:', port: Number(env.PORT || 8080) };
}
function cookie(req, name) {
  return (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}
function setCookie(name, value, secure, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; ${secure ? 'Secure; ' : ''}Max-Age=${maxAge}`;
}
function getSessionToken(req) {
  const token = cookie(req, SESSION);
  if (token && !token.startsWith('oauth:')) return token;
  return cookie(req, 'daybook_session');
}
function getOauthState(req) {
  const sessionVal = cookie(req, SESSION);
  if (sessionVal) return sessionVal.startsWith('oauth:') ? sessionVal.slice(6) : sessionVal;
  return cookie(req, 'daybook_oauth');
}
function json(res, status, data, headers = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(data)); }
function redirect(res, location, headers = {}) { res.writeHead(303, { Location: location, 'Cache-Control': 'no-store', ...headers }); res.end(); }
async function body(req) {
  let value = '';
  for await (const chunk of req) { value += chunk; if (value.length > 20_000) throw new Error('Request body is too large.'); }
  return JSON.parse(value || '{}');
}
async function oauthToken(config, fields, fetcher) {
  const response = await fetcher('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...fields }) });
  const result = await response.json();
  if (!response.ok) throw new Error(`Google OAuth: ${result.error_description || result.error || response.status}`);
  return result;
}

export function createDriveServer({ env = process.env, store, access, fetcher = fetch } = {}) {
  const config = settings(env);
  store ||= new DriveStore({
    databaseId: env.FIRESTORE_DATABASE_ID || env.DAYBOOK_DATABASE_ID || 'daybook-db',
    encryptionKey: env.DAYBOOK_ENCRYPTION_KEY || env.DENTAL_MONITORING_DASHBOARD_ENCRYPTION_KEY,
  });
  const verifier = new OAuth2Client(config.clientId);
  access ||= async user => {
    const token = await oauthToken(config, { refresh_token: user.refreshToken, grant_type: 'refresh_token' }, fetcher);
    return new DriveApi(token.access_token, fetcher);
  };
  const scan = async userId => {
    if (!(await store.claimScan(userId))) throw new Error('A refresh is already running for this folder.');
    let result;
    let error = '';
    try {
      const user = await store.getUser(userId);
      if (!user?.folderId) throw new Error('No Google Drive folder connected yet. Please select a folder in Settings.');
      result = await ingestFolder({ userId, folderId: user.folderId, drive: await access(user), store });
    } catch (cause) { error = cause.message; }
    await store.finishScan(userId, result || null, error);
    if (error) throw new Error(error);
    return result;
  };
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://*.googleusercontent.com https://lh3.googleusercontent.com data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const url = new URL(req.url, config.base);
      if (req.method === 'GET' && url.pathname === '/auth/login') {
        const state = randomBytes(24).toString('base64url');
        const codeVerifier = randomBytes(32).toString('base64url');
        const challenge = createHash('sha256').update(codeVerifier).digest('base64url');
        await store.putOauthState(state, codeVerifier, Date.now() + 10 * 60000);
        const target = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        for (const [key, value] of Object.entries({ client_id: config.clientId, redirect_uri: `${config.base}/auth/callback`, response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256' })) target.searchParams.set(key, value);
        return redirect(res, target.href, { 'Set-Cookie': setCookie(SESSION, `oauth:${state}`, config.secure, 600) });
      }
      if (req.method === 'GET' && url.pathname === '/auth/callback') {
        if (url.searchParams.get('error')) throw new Error(`Google sign-in: ${url.searchParams.get('error')}`);
        const state = url.searchParams.get('state') || '';
        const cookieState = getOauthState(req);
        if (!state || state !== cookieState) throw new Error('Sign-in state did not match. Please try again.');
        const codeVerifier = await store.consumeOauthState(state);
        const token = await oauthToken(config, { code: url.searchParams.get('code') || '', code_verifier: codeVerifier, redirect_uri: `${config.base}/auth/callback`, grant_type: 'authorization_code' }, fetcher);
        const ticket = await verifier.verifyIdToken({ idToken: token.id_token, audience: config.clientId });
        let profile = ticket.getPayload();
        if (!profile?.sub || !profile.email_verified) throw new Error('A verified Google account is required.');
        if (token.access_token && (!profile.name || !profile.picture)) {
          try {
            const userinfoRes = await fetcher('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${token.access_token}` }
            });
            if (userinfoRes.ok) {
              const info = await userinfoRes.json();
              profile = { ...profile, ...info };
            }
          } catch (_) {}
        }
        await store.upsertUser(profile.sub, profile, token.refresh_token);
        const session = await store.createSession(profile.sub);
        return redirect(res, '/', {
          'Set-Cookie': [
            setCookie(SESSION, session.token, config.secure, 30 * 86400),
            setCookie('daybook_session', session.token, config.secure, 30 * 86400)
          ]
        });
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && (url.pathname === '/' || url.pathname === '/drive.js' || url.pathname === '/drive.css' || url.pathname === '/favicon.svg' || url.pathname === '/terms' || url.pathname === '/terms.html' || url.pathname === '/terms.js' || url.pathname === '/settings' || url.pathname === '/settings.html' || url.pathname === '/settings.js' || url.pathname === '/theme.js')) {
        const filename = (url.pathname === '/' || url.pathname === '') ? 'drive.html' : (url.pathname === '/terms' || url.pathname === '/terms.html') ? 'terms.html' : (url.pathname === '/settings' || url.pathname === '/settings.html') ? 'settings.html' : url.pathname.slice(1);
        const type = filename.endsWith('.html') ? 'text/html' : filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.svg') ? 'image/svg+xml' : 'text/css';
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
          return res.end();
        }
        const content = await readFile(new URL(filename, ROOT));
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' }); return res.end(content);
      }
      if (url.pathname === '/api/scheduled' && req.method === 'POST') {
        const provided = (req.headers.authorization || '').replace(/^Bearer /, '');
        const left = Buffer.from(provided), right = Buffer.from(config.schedulerSecret);
        if (left.length !== right.length || !timingSafeEqual(left, right)) return json(res, 401, { error: 'Unauthorized' });
        await store.cleanupExpired();
        const users = await store.dueUsers();
        const results = [];
        for (const id of users) { try { results.push({ id, result: await scan(id) }); } catch (error) { results.push({ id, error: error.message }); } }
        return json(res, 200, { checkedUsers: users.length, results });
      }
      if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
      const sessionToken = getSessionToken(req);
      const session = await store.session(sessionToken);
      if (!session) return json(res, 401, { error: 'Sign in with Google to continue.' });
      if (req.method !== 'GET') {
        const csrfHeader = req.headers['x-daybook-csrf'] || req.headers['x-dental-monitoring-dashboard-csrf'];
        const origin = req.headers.origin;
        let originMatches = origin === config.base;
        if (!originMatches && origin) {
          try {
            const reqUrl = new URL(origin);
            const baseObj = new URL(config.base);
            if (baseObj.protocol === 'http:' &&
                (reqUrl.hostname === 'localhost' || reqUrl.hostname === '127.0.0.1') &&
                (baseObj.hostname === 'localhost' || baseObj.hostname === '127.0.0.1') &&
                reqUrl.port === baseObj.port) {
              originMatches = true;
            }
          } catch (_) {}
        }
        if (!originMatches || csrfHeader !== session.csrf) return json(res, 403, { error: 'Security check failed. Reload the page.' });
      }
      const userId = session.userId;
      if (url.pathname === '/api/me' && req.method === 'GET') {
        const user = await store.getUser(userId);
        return json(res, 200, {
          csrf: session.csrf,
          user: {
            email: user.email,
            name: user.name,
            picture: user.picture,
            folderId: user.folderId,
            folderName: user.folderName,
            scheduleMinutes: user.scheduleMinutes,
            lastScanAt: user.lastScanAt || '',
            lastScanResult: user.lastScanResult || null,
            lastScanError: user.lastScanError || '',
            nextScanAt: user.nextScanAt || null,
            termsAcceptedAt: user.termsAcceptedAt || null,
            onboardedAt: user.onboardedAt || null,
          }
        });
      }
      if (url.pathname === '/api/profile' && req.method === 'POST') {
        const bodyData = await body(req);
        const name = (bodyData.name || '').trim();
        if (!name) return json(res, 400, { error: 'Name cannot be empty.' });
        if (typeof store.updateUserName === 'function') {
          await store.updateUserName(userId, name);
        }
        return json(res, 200, { ok: true, name });
      }
      if (url.pathname === '/api/onboarded' && req.method === 'POST') {
        const bodyData = await body(req);
        const name = (bodyData.name || '').trim();
        if (name && typeof store.updateUserName === 'function') {
          await store.updateUserName(userId, name);
        }
        if (typeof store.setOnboarded === 'function') {
          await store.setOnboarded(userId, { termsAccepted: bodyData.termsAccepted !== false, completed: bodyData.completed !== false, name: name || undefined });
        }
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/source-status' && req.method === 'GET') {
        const user = await store.getUser(userId);
        if (!user.folderId) {
          return json(res, 200, { available: false, reason: 'no_folder', message: 'No Google Drive folder configured.' });
        }
        try {
          const drive = await access(user);
          const folder = await drive.getFolder(user.folderId);
          return json(res, 200, { available: true, folder: { id: folder.id, name: folder.name } });
        } catch (err) {
          const isNotFound = /not found|404|select a google drive folder/i.test(err.message);
          return json(res, 200, {
            available: false,
            reason: isNotFound ? 'not_found' : 'error',
            message: isNotFound ? 'Google Drive source folder was removed or is inaccessible.' : err.message
          });
        }
      }
      if (url.pathname === '/api/folders' && req.method === 'GET') {
        const parentId = url.searchParams.get('parentId') || 'root';
        const drive = await access(await store.getUser(userId));
        const folders = await drive.listFolders(parentId);
        const ownFolders = folders.filter(f => !f.isShared);
        const sharedFolders = folders.filter(f => Boolean(f.isShared));
        return json(res, 200, { folders, ownFolders, sharedFolders });
      }
      if (url.pathname === '/api/folder' && req.method === 'POST') {
        let { folderId } = await body(req);
        if (typeof folderId === 'string') {
          const match = folderId.match(/folders\/([\w-]+)/);
          if (match) folderId = match[1];
        }
        if (typeof folderId !== 'string' || !/^[\w-]{10,}$/.test(folderId)) throw new Error('Choose a valid Drive folder.');
        const folder = await (await access(await store.getUser(userId))).getFolder(folderId);
        await store.setFolder(userId, folder);
        return json(res, 200, { folder: { id: folder.id, name: folder.name } });
      }
      if (url.pathname === '/api/schedule' && req.method === 'POST') {
        const { minutes } = await body(req);
        if (![0, 1440, 2880, 4320, 10080].includes(minutes)) throw new Error('Choose a supported refresh interval (Manual, or minimum once per day).');
        await store.setSchedule(userId, minutes);
        return json(res, 200, { minutes });
      }
      if (url.pathname === '/api/import-stats' && req.method === 'GET') {
        const stats = typeof store.getImportStats === 'function' ? await store.getImportStats(userId) : { totalSuccessful: 0, totalErrors: 0, recentImports: [] };
        return json(res, 200, stats);
      }
      if (url.pathname === '/api/refresh' && req.method === 'POST') {
        const result = await scan(userId);
        return json(res, 200, { result, lastScanAt: new Date().toISOString() });
      }
      if (url.pathname === '/api/reports' && req.method === 'GET') return json(res, 200, { reports: await store.reports(userId) });
      if (url.pathname === '/api/reports/resolve-conflict' && req.method === 'POST') {
        const { date, keepVersionId } = await body(req);
        if (!date || !keepVersionId) throw new Error('Specify the report date and version to keep.');
        if (typeof store.resolveDuplicateReport === 'function') {
          const report = await store.resolveDuplicateReport(userId, date, keepVersionId);
          return json(res, 200, { ok: true, report });
        }
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/logout' && req.method === 'POST') {
        await store.deleteSession(sessionToken);
        return json(res, 200, { ok: true }, {
          'Set-Cookie': [
            setCookie(SESSION, '', config.secure, 0),
            setCookie('daybook_session', '', config.secure, 0)
          ]
        });
      }
      if (url.pathname === '/api/stop-sync' && req.method === 'POST') {
        await store.stopSync(userId);
        await store.deleteSession(sessionToken);
        return json(res, 200, { ok: true }, {
          'Set-Cookie': [
            setCookie(SESSION, '', config.secure, 0),
            setCookie('daybook_session', '', config.secure, 0)
          ]
        });
      }
      if (url.pathname === '/api/delete-all-data' && req.method === 'POST') {
        await store.deleteAllUserData(userId);
        return json(res, 200, { ok: true }, {
          'Set-Cookie': [
            setCookie(SESSION, '', config.secure, 0),
            setCookie('daybook_session', '', config.secure, 0)
          ]
        });
      }
      return json(res, 404, { error: 'Not found' });
    } catch (error) { json(res, 400, { error: error.message }); }
  });
  return { server, config, scan };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { server, config } = createDriveServer();
    server.listen(config.port, '0.0.0.0', () => console.log(`Daybook listening on port ${config.port}`));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
