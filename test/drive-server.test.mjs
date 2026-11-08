import test from 'node:test';
import assert from 'node:assert/strict';
import { createDriveServer } from '../src/drive-server.mjs';
import { MemoryDriveStore } from '../src/drive-store.mjs';

test('shared server protects user and scheduled routes, and starts OAuth with state and PKCE', async () => {
  const saved = [];
  const store = {
    async putOauthState(state, verifier, expiresAt) { saved.push({ state, verifier, expiresAt }); },
    async session() { return null; },
  };
  const { server } = createDriveServer({
    env: { DAYBOOK_BASE_URL: 'http://localhost', GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'secret', DAYBOOK_SCHEDULER_SECRET: 'scheduler-secret' },
    store,
  });
  async function request(method, url) {
    const response = { headers: {}, status: 0, body: '', setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, writeHead(status, headers) { this.status = status; for (const [key, value] of Object.entries(headers)) this.headers[key.toLowerCase()] = value; }, end(value = '') { this.body = value; } };
    await server.listeners('request')[0]({ method, url, headers: {} }, response);
    return response;
  }
  const me = await request('GET', '/api/me');
  assert.equal(me.status, 401);
  const scheduler = await request('POST', '/api/scheduled');
  assert.equal(scheduler.status, 401);
  const login = await request('GET', '/auth/login');
  assert.equal(login.status, 303);
  const target = new URL(login.headers.location);
    assert.equal(target.hostname, 'accounts.google.com');
    assert.equal(target.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(target.searchParams.get('scope').includes('profile'));
  assert.ok(target.searchParams.get('scope').includes('https://www.googleapis.com/auth/drive'));
    assert.equal(target.searchParams.get('prompt'), 'select_account consent');
  assert.equal(saved[0].state, target.searchParams.get('state'));
    assert.ok(saved[0].verifier);
  assert.ok(login.headers['set-cookie'].includes('HttpOnly'));
});

test('report reads are scoped to the signed-in user, regardless of query parameters', async () => {
  const calls = [];
  const store = {
    async session(token) { return token === 'alice-token' ? { userId: 'alice-id', csrf: 'alice-csrf' } : null; },
    async reports(userId) { calls.push(userId); return [{ date: '2026-10-27', casesFinished: 243 }]; },
  };
  const { server } = createDriveServer({
    env: { DAYBOOK_BASE_URL: 'http://localhost', GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'secret', DAYBOOK_SCHEDULER_SECRET: 'scheduler-secret' },
    store,
  });
  const response = { status: 0, payload: '', setHeader() {}, writeHead(status) { this.status = status; }, end(value = '') { this.payload = value; } };
  await server.listeners('request')[0]({ method: 'GET', url: '/api/reports?userId=bob-id', headers: { cookie: 'daybook_session=alice-token' } }, response);
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ['alice-id']);
  assert.equal(JSON.parse(response.payload).reports[0].casesFinished, 243);
});

test('schedule endpoint enforces a minimum refresh schedule of once per day (1440 minutes)', async () => {
  let savedSchedule = null;
  const store = {
    async session(token) { return token === 'alice-token' ? { userId: 'alice-id', csrf: 'alice-csrf' } : null; },
    async setSchedule(userId, minutes) { savedSchedule = { userId, minutes }; },
  };
  const { server } = createDriveServer({
    env: { DAYBOOK_BASE_URL: 'http://localhost', GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'secret', DAYBOOK_SCHEDULER_SECRET: 'scheduler-secret' },
    store,
  });

  async function postSchedule(minutes) {
    const response = { status: 0, payload: '', setHeader() {}, writeHead(status) { this.status = status; }, end(value = '') { this.payload = value; } };
    const chunks = [Buffer.from(JSON.stringify({ minutes }))];
    const req = {
      method: 'POST',
      url: '/api/schedule',
      headers: {
        cookie: 'daybook_session=alice-token',
        origin: 'http://localhost',
        'x-daybook-csrf': 'alice-csrf',
        'content-type': 'application/json',
      },
      [Symbol.asyncIterator]: async function* () {
        for (const chunk of chunks) yield chunk;
      },
    };
    await server.listeners('request')[0](req, response);
    return { status: response.status, body: JSON.parse(response.payload || '{}') };
  }

  // Reject schedules lesser than once per day (e.g. 15, 60, 360)
  const rejected15 = await postSchedule(15);
  assert.equal(rejected15.status, 400);
  assert.match(rejected15.body.error, /minimum once per day/i);

  const rejected60 = await postSchedule(60);
  assert.equal(rejected60.status, 400);
  assert.match(rejected60.body.error, /minimum once per day/i);

  // Accept daily (1440 minutes) or longer
  const acceptedDaily = await postSchedule(1440);
  assert.equal(acceptedDaily.status, 200);
  assert.equal(acceptedDaily.body.minutes, 1440);
  assert.deepEqual(savedSchedule, { userId: 'alice-id', minutes: 1440 });

  const acceptedWeek = await postSchedule(10080);
  assert.equal(acceptedWeek.status, 200);
  assert.equal(acceptedWeek.body.minutes, 10080);
  assert.deepEqual(savedSchedule, { userId: 'alice-id', minutes: 10080 });

  const acceptedManual = await postSchedule(0);
  assert.equal(acceptedManual.status, 200);
  assert.equal(acceptedManual.body.minutes, 0);
  assert.deepEqual(savedSchedule, { userId: 'alice-id', minutes: 0 });
});

test('server maintains backward compatibility with legacy DAYBOOK_ environment variables and cookies', async () => {
  const store = {
    async session(token) { return token === 'legacy-token' ? { userId: 'legacy-user', csrf: 'legacy-csrf' } : null; },
    async reports() { return []; },
  };
  const { server } = createDriveServer({
    env: { DAYBOOK_BASE_URL: 'http://localhost', GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'secret', DAYBOOK_SCHEDULER_SECRET: 'scheduler-secret' },
    store,
  });
  const response = { status: 0, payload: '', setHeader() {}, writeHead(status) { this.status = status; }, end(value = '') { this.payload = value; } };
  await server.listeners('request')[0]({ method: 'GET', url: '/api/reports', headers: { cookie: 'daybook_session=legacy-token' } }, response);
  assert.equal(response.status, 200);
});

test('server supports __session cookie for Firebase Hosting rewrite compatibility', async () => {
  const store = {
    async session(token) { return token === 'firebase-token' ? { userId: 'firebase-user', csrf: 'firebase-csrf' } : null; },
    async reports() { return [{ date: '2026-10-28', casesFinished: 100 }]; },
    async consumeOauthState(state) {
      if (state === 'valid-state') return 'test-verifier';
      throw new Error('Not found');
    },
  };
  const { server } = createDriveServer({
    env: { DAYBOOK_BASE_URL: 'http://localhost', GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'secret', DAYBOOK_SCHEDULER_SECRET: 'scheduler-secret' },
    store,
  });

  // Verify __session token authenticated request
  const response = { status: 0, payload: '', setHeader() {}, writeHead(status) { this.status = status; }, end(value = '') { this.payload = value; } };
  await server.listeners('request')[0]({ method: 'GET', url: '/api/reports', headers: { cookie: '__session=firebase-token' } }, response);
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.payload).reports[0].casesFinished, 100);

  // Verify OAuth callback rejects state mismatch
  const mismatchResponse = { status: 0, payload: '', setHeader() {}, writeHead(status) { this.status = status; }, end(value = '') { this.payload = value; } };
  await server.listeners('request')[0]({ method: 'GET', url: '/auth/callback?state=state-a&code=code-123', headers: { cookie: '__session=oauth:state-b' } }, mismatchResponse);
  assert.equal(mismatchResponse.status, 400);
  assert.match(JSON.parse(mismatchResponse.payload).error, /Sign-in state did not match/);
});

test('delete-all-data permanently flushes user data and clears session cookies', async () => {
  let deletedUser = null;
  const store = {
    async session(token) { return token === 'user-token' ? { userId: 'victim-id', csrf: 'csrf-1' } : null; },
    async deleteAllUserData(userId) { deletedUser = userId; },
  };
  const { server } = createDriveServer({
    env: { DAYBOOK_BASE_URL: 'http://localhost', GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'secret', DAYBOOK_SCHEDULER_SECRET: 'scheduler-secret' },
    store,
  });

  const response = { headers: {}, status: 0, payload: '', setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, writeHead(status, headers = {}) { this.status = status; for (const [k, v] of Object.entries(headers)) this.headers[k.toLowerCase()] = v; }, end(value = '') { this.payload = value; } };
  await server.listeners('request')[0]({
    method: 'POST',
    url: '/api/delete-all-data',
    headers: {
      cookie: '__session=user-token',
      origin: 'http://localhost',
      'x-daybook-csrf': 'csrf-1',
    },
  }, response);

  assert.equal(response.status, 200);
  assert.equal(deletedUser, 'victim-id');
  assert.equal(JSON.parse(response.payload).ok, true);
  assert.ok(response.headers['set-cookie']);
});

test('api/import-stats returns total counts and recent 5 imports', async () => {
  const store = {
    async session(token) { return token === 'user-token' ? { userId: 'alice-id', csrf: 'csrf-1' } : null; },
    async getImportStats(userId) {
      assert.equal(userId, 'alice-id');
      return {
        totalSuccessful: 8,
        totalErrors: 1,
        recentImports: [
          { fileName: 'report-1.pdf', when: '2026-10-29', location: 'Reports / archive', status: 'success' },
          { fileName: 'corrupt.pdf', when: '2026-10-28', location: 'Reports', status: 'error', error: 'Invalid PDF' }
        ],
      };
    },
  };
  const { server } = createDriveServer({
    env: { DAYBOOK_BASE_URL: 'http://localhost', GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'secret', DAYBOOK_SCHEDULER_SECRET: 'scheduler-secret' },
    store,
  });

  const response = { headers: {}, status: 0, payload: '', setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, writeHead(status, headers = {}) { this.status = status; for (const [k, v] of Object.entries(headers)) this.headers[k.toLowerCase()] = v; }, end(value = '') { this.payload = value; } };
  await server.listeners('request')[0]({
    method: 'GET',
    url: '/api/import-stats',
    headers: { cookie: '__session=user-token' },
  }, response);

  assert.equal(response.status, 200);
  const data = JSON.parse(response.payload);
  assert.equal(data.totalSuccessful, 8);
  assert.equal(data.totalErrors, 1);
  assert.equal(data.recentImports.length, 2);
  assert.equal(data.recentImports[1].status, 'error');
});

test('api/source-status reports folder availability accurately', async () => {
  const store = {
    async session(token) {
      if (token === 'user-token') return { userId: 'alice-id', csrf: 'csrf' };
      if (token === 'no-folder-token') return { userId: 'no-folder-id', csrf: 'csrf' };
      if (token === 'not-found-token') return { userId: 'not-found-id', csrf: 'csrf' };
      if (token === 'error-token') return { userId: 'error-id', csrf: 'csrf' };
      return null;
    },
    async getUser(userId) {
      if (userId === 'alice-id') return { folderId: 'valid-folder', folderName: 'Clinical Reports' };
      if (userId === 'not-found-id') return { folderId: 'missing-folder' };
      if (userId === 'error-id') return { folderId: 'error-folder' };
      return {};
    },
  };
  const { server } = createDriveServer({
    env: { DAYBOOK_BASE_URL: 'http://localhost', GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'secret', DAYBOOK_SCHEDULER_SECRET: 'scheduler-secret' },
    store,
    access: async () => ({
      async getFolder(id) {
        if (id === 'valid-folder') return { id: 'valid-folder', name: 'Clinical Reports' };
        if (id === 'missing-folder') throw new Error('File not found: ' + id);
        throw new Error('Google Drive API connection reset');
      }
    }),
  });

  const reqHelper = async (cookie) => {
    const res = { headers: {}, status: 0, payload: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(s, h = {}) { this.status = s; }, end(v = '') { this.payload = v; } };
    await server.listeners('request')[0]({
      method: 'GET',
      url: '/api/source-status',
      headers: { cookie },
    }, res);
    return { status: res.status, body: JSON.parse(res.payload) };
  };

  const okResult = await reqHelper('daybook_session=user-token');
  assert.equal(okResult.status, 200);
  assert.equal(okResult.body.available, true);
  assert.equal(okResult.body.folder.name, 'Clinical Reports');

  // Test when user has no folderId configured
  const noFolderResult = await reqHelper('daybook_session=no-folder-token');
  assert.equal(noFolderResult.status, 200);
  assert.equal(noFolderResult.body.available, false);
  assert.equal(noFolderResult.body.reason, 'no_folder');

  // Test when folder throws 404
  const notFoundResult = await reqHelper('daybook_session=not-found-token');
  assert.equal(notFoundResult.status, 200);
  assert.equal(notFoundResult.body.available, false);
  assert.equal(notFoundResult.body.reason, 'not_found');

  // Test when folder throws generic error
  const genericErrResult = await reqHelper('daybook_session=error-token');
  assert.equal(genericErrResult.status, 200);
  assert.equal(genericErrResult.body.available, false);
  assert.equal(genericErrResult.body.reason, 'error');
});

test('api/reports/resolve-conflict resolves duplicate reports and updates the active version', async () => {
  let resolvedArgs = null;
  const store = {
    async session(token) { return token === 'user-token' ? { userId: 'alice-id', csrf: 'csrf-1' } : null; },
    async resolveDuplicateReport(userId, date, keepVersionId) {
      resolvedArgs = { userId, date, keepVersionId };
      return { date, casesFinished: 250, sourceFileId: keepVersionId, hasConflict: false };
    },
  };
  const { server } = createDriveServer({
    env: { DAYBOOK_BASE_URL: 'http://localhost', GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'secret', DAYBOOK_SCHEDULER_SECRET: 'scheduler-secret' },
    store,
  });

  const res = { headers: {}, status: 0, payload: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(s, h = {}) { this.status = s; }, end(v = '') { this.payload = v; } };
  const req = {
    method: 'POST',
    url: '/api/reports/resolve-conflict',
    headers: {
      cookie: 'daybook_session=user-token',
      origin: 'http://localhost',
      'x-daybook-csrf': 'csrf-1',
      'content-type': 'application/json',
    },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({ date: '2026-10-27', keepVersionId: 'pdf-2' }));
    }
  };

  await server.listeners('request')[0](req, res);
  assert.equal(res.status, 200);
  const data = JSON.parse(res.payload);
  assert.equal(data.ok, true);
  assert.equal(data.report.casesFinished, 250);
  assert.deepEqual(resolvedArgs, { userId: 'alice-id', date: '2026-10-27', keepVersionId: 'pdf-2' });

  // Missing date or keepVersionId
  const resBad = { headers: {}, status: 0, payload: '', setHeader() {}, writeHead(s) { this.status = s; }, end(v = '') { this.payload = v; } };
  const reqBad = {
    method: 'POST',
    url: '/api/reports/resolve-conflict',
    headers: { cookie: 'daybook_session=user-token', origin: 'http://localhost', 'x-daybook-csrf': 'csrf-1' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ date: '2026-10-27' })); }
  };
  await server.listeners('request')[0](reqBad, resBad);
  assert.equal(resBad.status, 400);

  // Store without resolveDuplicateReport function
  const storeNoFn = {
    async session() { return { userId: 'alice-id', csrf: 'csrf-1' }; }
  };
  const { server: serverNoFn } = createDriveServer({
    env: { DAYBOOK_BASE_URL: 'http://localhost', GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'secret', DAYBOOK_SCHEDULER_SECRET: 'scheduler-secret' },
    store: storeNoFn,
  });
  const resNoFn = { headers: {}, status: 0, payload: '', setHeader() {}, writeHead(s) { this.status = s; }, end(v = '') { this.payload = v; } };
  await serverNoFn.listeners('request')[0](req, resNoFn);
  assert.equal(resNoFn.status, 200);
  assert.equal(JSON.parse(resNoFn.payload).ok, true);
});

test('api/profile updates user name and api/onboarded persists custom name', async () => {
  let updatedName = '';
  let onboardedState = null;
  const store = {
    async session(token) { return token === 'user-token' ? { userId: 'alice-id', csrf: 'csrf-1' } : null; },
    async updateUserName(userId, name) { updatedName = name; },
    async setOnboarded(userId, options) { onboardedState = { userId, ...options }; },
  };
  const { server } = createDriveServer({
    env: { DAYBOOK_BASE_URL: 'http://localhost', GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'secret', DAYBOOK_SCHEDULER_SECRET: 'scheduler-secret' },
    store,
  });

  // 1. Test /api/profile
  const res1 = { headers: {}, status: 0, payload: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(s) { this.status = s; }, end(v = '') { this.payload = v; } };
  const req1 = {
    method: 'POST',
    url: '/api/profile',
    headers: { cookie: 'daybook_session=user-token', origin: 'http://localhost', 'x-daybook-csrf': 'csrf-1', 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ name: 'Dr. Jane Smith' })); }
  };
  await server.listeners('request')[0](req1, res1);
  assert.equal(res1.status, 200);
  const data1 = JSON.parse(res1.payload);
  assert.equal(data1.ok, true);
  assert.equal(data1.name, 'Dr. Jane Smith');
  assert.equal(updatedName, 'Dr. Jane Smith');

  // 2. Test /api/onboarded with name
  const res2 = { headers: {}, status: 0, payload: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(s) { this.status = s; }, end(v = '') { this.payload = v; } };
  const req2 = {
    method: 'POST',
    url: '/api/onboarded',
    headers: { cookie: 'daybook_session=user-token', origin: 'http://localhost', 'x-daybook-csrf': 'csrf-1', 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ termsAccepted: true, completed: true, name: 'Dr. Jane Smith, DDS' })); }
  };
  await server.listeners('request')[0](req2, res2);
  assert.equal(res2.status, 200);
  assert.equal(updatedName, 'Dr. Jane Smith, DDS');
  assert.equal(onboardedState.name, 'Dr. Jane Smith, DDS');
  assert.equal(onboardedState.completed, true);

  // 3. Test local dev origin check (e.g. 127.0.0.1 matching localhost base)
  const res3 = { headers: {}, status: 0, payload: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(s) { this.status = s; }, end(v = '') { this.payload = v; } };
  const req3 = {
    method: 'POST',
    url: '/api/profile',
    headers: { cookie: 'daybook_session=user-token', origin: 'http://127.0.0.1', 'x-daybook-csrf': 'csrf-1', 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ name: 'Dr. Jane' })); }
  };
  await server.listeners('request')[0](req3, res3);
  assert.equal(res3.status, 200);
  assert.equal(updatedName, 'Dr. Jane');

  // 4. Test /terms and /privacy serve privacy policy and Google Limited Use disclosure
  const resTerms = { headers: {}, status: 0, payload: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(s) { this.status = s; }, end(v = '') { this.payload = v; } };
  await server.listeners('request')[0]({ method: 'GET', url: '/terms', headers: {} }, resTerms);
  assert.equal(resTerms.status, 200);
  assert.ok(resTerms.payload.includes('Google API Services User Data Policy'));
  assert.ok(resTerms.payload.includes('Limited Use'));

  const resPrivacy = { headers: {}, status: 0, payload: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(s) { this.status = s; }, end(v = '') { this.payload = v; } };
  await server.listeners('request')[0]({ method: 'GET', url: '/privacy', headers: {} }, resPrivacy);
  assert.equal(resPrivacy.status, 200);
  assert.ok(resPrivacy.payload.includes('Google API Services User Data Policy'));
  assert.ok(resPrivacy.payload.includes('Limited Use'));
});

test('api/notes routes handle GET, POST and DELETE with date validation', async () => {
  const notesDb = { '2026-10-29': 'Existing note' };
  const store = {
    async session(token) {
      return token === 'user-token' ? { userId: 'user-1', csrf: 'csrf-1' } : null;
    },
    async getNotes(userId) {
      assert.equal(userId, 'user-1');
      return { ...notesDb };
    },
    async saveNote(userId, date, text) {
      assert.equal(userId, 'user-1');
      if (!text) delete notesDb[date];
      else notesDb[date] = text;
      return { ...notesDb };
    },
    async deleteNote(userId, date) {
      assert.equal(userId, 'user-1');
      delete notesDb[date];
      return { ...notesDb };
    }
  };

  const { server } = createDriveServer({
    env: { DAYBOOK_BASE_URL: 'http://localhost', GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'secret', DAYBOOK_SCHEDULER_SECRET: 'scheduler-secret' },
    store
  });

  // 1. GET /api/notes
  const resGet = { headers: {}, status: 0, payload: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(s) { this.status = s; }, end(v = '') { this.payload = v; } };
  await server.listeners('request')[0]({
    method: 'GET',
    url: '/api/notes',
    headers: { cookie: 'daybook_session=user-token' }
  }, resGet);
  assert.equal(resGet.status, 200);
  const getJson = JSON.parse(resGet.payload);
  assert.equal(getJson.notes['2026-10-29'], 'Existing note');

  // 2. POST /api/notes with valid date
  const resPost = { headers: {}, status: 0, payload: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(s) { this.status = s; }, end(v = '') { this.payload = v; } };
  const reqPost = {
    method: 'POST',
    url: '/api/notes',
    headers: { cookie: 'daybook_session=user-token', origin: 'http://localhost', 'x-daybook-csrf': 'csrf-1', 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ date: '2026-10-30', text: 'Dr. Jane shift completed early' })); }
  };
  await server.listeners('request')[0](reqPost, resPost);
  assert.equal(resPost.status, 200);
  const postJson = JSON.parse(resPost.payload);
  assert.equal(postJson.notes['2026-10-30'], 'Dr. Jane shift completed early');

  // 3. POST /api/notes with invalid date
  const resInvalid = { headers: {}, status: 0, payload: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(s) { this.status = s; }, end(v = '') { this.payload = v; } };
  const reqInvalid = {
    method: 'POST',
    url: '/api/notes',
    headers: { cookie: 'daybook_session=user-token', origin: 'http://localhost', 'x-daybook-csrf': 'csrf-1', 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ date: 'invalid-date', text: 'Some note' })); }
  };
  await server.listeners('request')[0](reqInvalid, resInvalid);
  assert.equal(resInvalid.status, 400);

  // 4. DELETE /api/notes
  const resDel = { headers: {}, status: 0, payload: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(s) { this.status = s; }, end(v = '') { this.payload = v; } };
  const reqDel = {
    method: 'DELETE',
    url: '/api/notes',
    headers: { cookie: 'daybook_session=user-token', origin: 'http://localhost', 'x-daybook-csrf': 'csrf-1', 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ date: '2026-10-30' })); }
  };
  await server.listeners('request')[0](reqDel, resDel);
  assert.equal(resDel.status, 200);
  const delJson = JSON.parse(resDel.payload);
  assert.equal(delJson.notes['2026-10-30'], undefined);
});

test('MemoryDriveStore supports local dev session lifecycle and /me /api/me endpoints', async () => {
  const store = new MemoryDriveStore();
  const { server } = createDriveServer({
    env: {
      DAYBOOK_BASE_URL: 'http://localhost:8080',
      LOCAL_DEV: 'true',
      GOOGLE_CLIENT_ID: 'mock-client-id',
      GOOGLE_CLIENT_SECRET: 'secret',
      DAYBOOK_SCHEDULER_SECRET: 'scheduler-secret'
    },
    store
  });

  // 1. Visit /auth/login in mock dev mode -> should create session and set cookies
  const resLogin = { headers: {}, status: 0, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(s, h = {}) { this.status = s; for (const [k, v] of Object.entries(h)) this.headers[k.toLowerCase()] = v; }, end() {} };
  await server.listeners('request')[0]({ method: 'GET', url: '/auth/login', headers: {} }, resLogin);
  assert.equal(resLogin.status, 303);
  assert.ok(resLogin.headers['set-cookie']);

  // Extract session token from cookie
  const setCookieHeaders = Array.isArray(resLogin.headers['set-cookie']) ? resLogin.headers['set-cookie'] : [resLogin.headers['set-cookie']];
  const sessionCookie = setCookieHeaders.find(c => c.includes('daybook_session='));
  const match = sessionCookie.match(/daybook_session=([^;]+)/);
  assert.ok(match, 'Session token cookie should be present');
  const token = match[1];

  // 2. GET /api/me with cookie
  const resApiMe = { headers: {}, status: 0, payload: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(s) { this.status = s; }, end(v = '') { this.payload = v; } };
  await server.listeners('request')[0]({ method: 'GET', url: '/api/me', headers: { cookie: `daybook_session=${token}` } }, resApiMe);
  assert.equal(resApiMe.status, 200);
  const meData = JSON.parse(resApiMe.payload);
  assert.ok(meData.csrf, 'CSRF token should be returned');
  assert.equal(meData.user.email, 'mr.debjit.sadhukhan@gmail.com');

  // 3. GET /me alias with cookie
  const resMe = { headers: {}, status: 0, payload: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(s) { this.status = s; }, end(v = '') { this.payload = v; } };
  await server.listeners('request')[0]({ method: 'GET', url: '/me', headers: { cookie: `daybook_session=${token}` } }, resMe);
  assert.equal(resMe.status, 200);
  const meDataAlias = JSON.parse(resMe.payload);
  assert.equal(meDataAlias.user.email, 'mr.debjit.sadhukhan@gmail.com');

  // 4. Browser GET /auth/login with Accept: text/html -> should show dev account chooser
  const resChooser = { headers: {}, status: 0, payload: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(s) { this.status = s; }, end(v = '') { this.payload = v; } };
  await server.listeners('request')[0]({ method: 'GET', url: '/auth/login', headers: { accept: 'text/html,application/xhtml+xml' } }, resChooser);
  assert.equal(resChooser.status, 200);
  assert.ok(resChooser.payload.includes('Choose an account'));
  assert.ok(resChooser.payload.includes('mr.debjit.sadhukhan@gmail.com'));

  // 5. GET /auth/login?email=doctor@clinic.com -> should create session for chosen email
  const resCustom = { headers: {}, status: 0, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(s, h = {}) { this.status = s; for (const [k, v] of Object.entries(h)) this.headers[k.toLowerCase()] = v; }, end() {} };
  await server.listeners('request')[0]({ method: 'GET', url: '/auth/login?email=doctor@clinic.com', headers: { accept: 'text/html' } }, resCustom);
  assert.equal(resCustom.status, 303);
  const customCookies = Array.isArray(resCustom.headers['set-cookie']) ? resCustom.headers['set-cookie'] : [resCustom.headers['set-cookie']];
  const customSessionCookie = customCookies.find(c => c.includes('daybook_session='));
  const customToken = customSessionCookie.match(/daybook_session=([^;]+)/)[1];

  const resCustomMe = { headers: {}, status: 0, payload: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(s) { this.status = s; }, end(v = '') { this.payload = v; } };
  await server.listeners('request')[0]({ method: 'GET', url: '/api/me', headers: { cookie: `daybook_session=${customToken}` } }, resCustomMe);
  assert.equal(resCustomMe.status, 200);
  const customData = JSON.parse(resCustomMe.payload);
  assert.equal(customData.user.email, 'doctor@clinic.com');
});

test('canonical domain enforcement permanently redirects legacy domains to canonical base URL', async () => {
  const store = new MemoryDriveStore();
  const { server } = createDriveServer({
    env: {
      DAYBOOK_BASE_URL: 'https://dmd.qd.je',
      GOOGLE_CLIENT_ID: 'mock-client-id',
      GOOGLE_CLIENT_SECRET: 'secret',
      DAYBOOK_SCHEDULER_SECRET: 'scheduler-secret'
    },
    store
  });

  // Request arriving from legacy web.app host
  const resRedirect = { headers: {}, status: 0, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(s, h = {}) { this.status = s; for (const [k, v] of Object.entries(h)) this.headers[k.toLowerCase()] = v; }, end() {} };
  await server.listeners('request')[0]({
    method: 'GET',
    url: '/privacy',
    headers: { host: 'dental-monitoring-dashboard.web.app' }
  }, resRedirect);

  assert.equal(resRedirect.status, 301);
  assert.equal(resRedirect.headers['location'], 'https://dmd.qd.je/privacy');
});

test('server settings validation enforces HTTPS, clean origin, and required secrets', () => {
  // Missing DAYBOOK_BASE_URL
  assert.throws(
    () => createDriveServer({ env: {} }),
    /Set DAYBOOK_BASE_URL and Google Cloud credentials before starting/
  );

  // Non-HTTPS and non-localhost protocol
  assert.throws(
    () => createDriveServer({ env: { DAYBOOK_BASE_URL: 'http://example.com' } }),
    /DAYBOOK_BASE_URL must be HTTPS\./
  );

  // Origin with a pathname
  assert.throws(
    () => createDriveServer({ env: { DAYBOOK_BASE_URL: 'https://example.com/subpath' } }),
    /DAYBOOK_BASE_URL must be an origin without a path\./
  );

  // Missing Google client or scheduler secrets
  assert.throws(
    () => createDriveServer({ env: { DAYBOOK_BASE_URL: 'https://example.com' } }),
    /Google OAuth and scheduler environment variables are required\./
  );
  assert.throws(
    () => createDriveServer({ env: { DAYBOOK_BASE_URL: 'https://example.com', GOOGLE_CLIENT_ID: 'id' } }),
    /Google OAuth and scheduler environment variables are required\./
  );
  assert.throws(
    () => createDriveServer({ env: { DAYBOOK_BASE_URL: 'https://example.com', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'sec' } }),
    /Google OAuth and scheduler environment variables are required\./
  );
});

test('server static assets handling, HEAD requests, and 404 for unknown routes', async () => {
  const store = new MemoryDriveStore();
  const { server } = createDriveServer({
    env: {
      DAYBOOK_BASE_URL: 'http://localhost',
      GOOGLE_CLIENT_ID: 'mock-client-id',
      GOOGLE_CLIENT_SECRET: 'secret',
      DAYBOOK_SCHEDULER_SECRET: 'scheduler-secret'
    },
    store
  });

  const sendReq = async (method, url, headers = {}) => {
    const res = { headers: {}, status: 0, payload: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(s, h = {}) { this.status = s; for (const [k, v] of Object.entries(h)) this.headers[k.toLowerCase()] = v; }, end(v = '') { this.payload = v; } };
    await server.listeners('request')[0]({ method, url, headers }, res);
    return res;
  };

  // HEAD request for root
  const headRoot = await sendReq('HEAD', '/');
  assert.equal(headRoot.status, 200);
  assert.equal(headRoot.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(headRoot.payload, '');

  // GET static CSS, JS, SVG, and themes
  const getCss = await sendReq('GET', '/drive.css');
  assert.equal(getCss.status, 200);
  assert.equal(getCss.headers['content-type'], 'text/css; charset=utf-8');

  const getFavicon = await sendReq('GET', '/favicon.svg');
  assert.equal(getFavicon.status, 200);
  assert.equal(getFavicon.headers['content-type'], 'image/svg+xml; charset=utf-8');

  const getTheme = await sendReq('GET', '/theme.js');
  assert.equal(getTheme.status, 200);
  assert.equal(getTheme.headers['content-type'], 'text/javascript; charset=utf-8');

  // Unknown route returns 404
  const notFound = await sendReq('GET', '/unregistered-page');
  assert.equal(notFound.status, 404);
  assert.equal(JSON.parse(notFound.payload).error, 'Not found');

  // Authenticated unknown /api/ route falls through to line 640 returning 404
  const { token } = await store.createSession('user-xyz');
  const apiNotFound = await sendReq('GET', '/api/nonexistent-endpoint', { cookie: `daybook_session=${token}` });
  assert.equal(apiNotFound.status, 404);
  assert.equal(JSON.parse(apiNotFound.payload).error, 'Not found');
});

test('request body parser enforces 20KB size limit and valid JSON', async () => {
  const store = {
    async session(token) { return token === 'test-tok' ? { userId: 'u1', csrf: 'csrf1' } : null; }
  };
  const { server } = createDriveServer({
    env: {
      DAYBOOK_BASE_URL: 'http://localhost',
      GOOGLE_CLIENT_ID: 'mock-client-id',
      GOOGLE_CLIENT_SECRET: 'secret',
      DAYBOOK_SCHEDULER_SECRET: 'scheduler-secret'
    },
    store
  });

  // Body exceeding 20,000 bytes
  const largeChunk = Buffer.alloc(25000, 'x');
  const res = { headers: {}, status: 0, payload: '', setHeader() {}, writeHead(s) { this.status = s; }, end(v = '') { this.payload = v; } };
  const req = {
    method: 'POST',
    url: '/api/profile',
    headers: { cookie: 'daybook_session=test-tok', origin: 'http://localhost', 'x-daybook-csrf': 'csrf1' },
    async *[Symbol.asyncIterator]() { yield largeChunk; }
  };
  await server.listeners('request')[0](req, res);
  assert.equal(res.status, 400);
  assert.match(JSON.parse(res.payload).error, /Request body is too large\./);
});

test('CSRF and Origin security checks reject mismatched or missing credentials', async () => {
  const store = {
    async session(token) { return token === 'valid-tok' ? { userId: 'u1', csrf: 'real-csrf' } : null; }
  };
  const { server } = createDriveServer({
    env: {
      DAYBOOK_BASE_URL: 'http://localhost:8080',
      GOOGLE_CLIENT_ID: 'mock-client-id',
      GOOGLE_CLIENT_SECRET: 'secret',
      DAYBOOK_SCHEDULER_SECRET: 'scheduler-secret'
    },
    store
  });

  const sendPost = async (headers) => {
    const res = { headers: {}, status: 0, payload: '', setHeader() {}, writeHead(s) { this.status = s; }, end(v = '') { this.payload = v; } };
    const req = {
      method: 'POST',
      url: '/api/profile',
      headers,
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ name: 'Valid' })); }
    };
    await server.listeners('request')[0](req, res);
    return res;
  };

  // Missing CSRF
  const noCsrf = await sendPost({ cookie: 'daybook_session=valid-tok', origin: 'http://localhost:8080' });
  assert.equal(noCsrf.status, 403);
  assert.match(JSON.parse(noCsrf.payload).error, /Security check failed/);

  // Mismatched CSRF
  const badCsrf = await sendPost({ cookie: 'daybook_session=valid-tok', origin: 'http://localhost:8080', 'x-daybook-csrf': 'wrong' });
  assert.equal(badCsrf.status, 403);

  // Mismatched Origin
  const badOrigin = await sendPost({ cookie: 'daybook_session=valid-tok', origin: 'http://malicious.com', 'x-daybook-csrf': 'real-csrf' });
  assert.equal(badOrigin.status, 403);
});

test('api/folders and api/folder URL parsing and validation', async () => {
  let storedFolder = null;
  const store = {
    async session(token) { return token === 'valid-tok' ? { userId: 'u1', csrf: 'real-csrf' } : null; },
    async getUser() { return { id: 'u1' }; },
    async setFolder(userId, folder) { storedFolder = { userId, folder }; }
  };
  const mockDrive = {
    async listFolders(parentId) {
      return [
        { id: 'f-1', name: 'Folder 1', isShared: false, parentId },
        { id: 'f-2', name: 'Shared Folder', isShared: true, parentId }
      ];
    },
    async getFolder(id) {
      if (id === 'valid-folder-id-123') return { id, name: 'Parsed Folder' };
      throw new Error('Not found');
    }
  };

  const { server } = createDriveServer({
    env: {
      DAYBOOK_BASE_URL: 'http://localhost:8080',
      GOOGLE_CLIENT_ID: 'mock-client-id',
      GOOGLE_CLIENT_SECRET: 'secret',
      DAYBOOK_SCHEDULER_SECRET: 'scheduler-secret'
    },
    store,
    access: async () => mockDrive
  });

  // GET /api/folders with parentId
  const resFolders = { headers: {}, status: 0, payload: '', setHeader() {}, writeHead(s) { this.status = s; }, end(v = '') { this.payload = v; } };
  await server.listeners('request')[0]({
    method: 'GET',
    url: '/api/folders?parentId=parent-abc',
    headers: { cookie: 'daybook_session=valid-tok' }
  }, resFolders);
  assert.equal(resFolders.status, 200);
  const foldersData = JSON.parse(resFolders.payload);
  assert.equal(foldersData.folders.length, 2);
  assert.equal(foldersData.ownFolders.length, 1);
  assert.equal(foldersData.sharedFolders.length, 1);

  // POST /api/folder with Google Drive URL regex extraction
  const resUrlFolder = { headers: {}, status: 0, payload: '', setHeader() {}, writeHead(s) { this.status = s; }, end(v = '') { this.payload = v; } };
  const reqUrlFolder = {
    method: 'POST',
    url: '/api/folder',
    headers: { cookie: 'daybook_session=valid-tok', origin: 'http://localhost:8080', 'x-daybook-csrf': 'real-csrf' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({ folderId: 'https://drive.google.com/drive/folders/valid-folder-id-123' }));
    }
  };
  await server.listeners('request')[0](reqUrlFolder, resUrlFolder);
  assert.equal(resUrlFolder.status, 200);
  assert.equal(storedFolder.folder.id, 'valid-folder-id-123');

  // POST /api/folder with invalid short id
  const resBadFolder = { headers: {}, status: 0, payload: '', setHeader() {}, writeHead(s) { this.status = s; }, end(v = '') { this.payload = v; } };
  const reqBadFolder = {
    method: 'POST',
    url: '/api/folder',
    headers: { cookie: 'daybook_session=valid-tok', origin: 'http://localhost:8080', 'x-daybook-csrf': 'real-csrf' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({ folderId: 'short' }));
    }
  };
  await server.listeners('request')[0](reqBadFolder, resBadFolder);
  assert.equal(resBadFolder.status, 400);
  assert.match(JSON.parse(resBadFolder.payload).error, /Choose a valid Drive folder\./);
});

test('api/refresh, scan concurrency, and missing folder error handling', async () => {
  let leaseHeld = false;
  let hasFolder = true;
  const store = {
    async session(token) { return token === 'valid-tok' ? { userId: 'u1', csrf: 'real-csrf' } : null; },
    async claimScan() {
      if (leaseHeld) return false;
      leaseHeld = true;
      return true;
    },
    async finishScan() { leaseHeld = false; },
    async getUser() { return hasFolder ? { folderId: 'f-123' } : {}; }
  };

  const { server } = createDriveServer({
    env: {
      DAYBOOK_BASE_URL: 'http://localhost:8080',
      LOCAL_DEV: 'true',
      GOOGLE_CLIENT_ID: 'mock-client-id',
      GOOGLE_CLIENT_SECRET: 'secret',
      DAYBOOK_SCHEDULER_SECRET: 'scheduler-secret'
    },
    store
  });

  const sendRefresh = async () => {
    const res = { headers: {}, status: 0, payload: '', setHeader() {}, writeHead(s) { this.status = s; }, end(v = '') { this.payload = v; } };
    const req = {
      method: 'POST',
      url: '/api/refresh',
      headers: { cookie: 'daybook_session=valid-tok', origin: 'http://localhost:8080', 'x-daybook-csrf': 'real-csrf' },
      async *[Symbol.asyncIterator]() { yield Buffer.from('{}'); }
    };
    await server.listeners('request')[0](req, res);
    return res;
  };

  // Successful refresh in mock dev mode
  const res1 = await sendRefresh();
  assert.equal(res1.status, 200);
  assert.equal(JSON.parse(res1.payload).result.checked, 5);

  // Missing folder error
  hasFolder = false;
  const resNoFolder = await sendRefresh();
  assert.equal(resNoFolder.status, 400);
  assert.match(JSON.parse(resNoFolder.payload).error, /No Google Drive folder connected yet/);

  // Already running lease error
  hasFolder = true;
  leaseHeld = true;
  const resConflict = await sendRefresh();
  assert.equal(resConflict.status, 400);
  assert.match(JSON.parse(resConflict.payload).error, /A refresh is already running for this folder\./);
});

test('api/logout, api/stop-sync, and default store initialization', async () => {
  let stoppedSync = false;
  let deletedSessionToken = null;
  const store = {
    async session(token) { return token === 'sess-tok' ? { userId: 'u-logout', csrf: 'csrf-logout' } : null; },
    async stopSync(userId) { stoppedSync = userId; },
    async deleteSession(token) { deletedSessionToken = token; }
  };

  const { server } = createDriveServer({
    env: {
      DAYBOOK_BASE_URL: 'http://localhost:8080',
      GOOGLE_CLIENT_ID: 'mock-client-id',
      GOOGLE_CLIENT_SECRET: 'secret',
      DAYBOOK_SCHEDULER_SECRET: 'scheduler-secret'
    },
    store
  });

  // POST /api/logout
  const resLogout = { headers: {}, status: 0, payload: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(s, h = {}) { this.status = s; for (const [k, v] of Object.entries(h)) this.headers[k.toLowerCase()] = v; }, end(v = '') { this.payload = v; } };
  await server.listeners('request')[0]({
    method: 'POST',
    url: '/api/logout',
    headers: { cookie: 'daybook_session=sess-tok', origin: 'http://localhost:8080', 'x-daybook-csrf': 'csrf-logout' },
    async *[Symbol.asyncIterator]() { yield Buffer.from('{}'); }
  }, resLogout);
  assert.equal(resLogout.status, 200);
  assert.equal(deletedSessionToken, 'sess-tok');
  assert.ok(resLogout.headers['set-cookie']);

  // POST /api/stop-sync
  const resStop = { headers: {}, status: 0, payload: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(s, h = {}) { this.status = s; for (const [k, v] of Object.entries(h)) this.headers[k.toLowerCase()] = v; }, end(v = '') { this.payload = v; } };
  await server.listeners('request')[0]({
    method: 'POST',
    url: '/api/stop-sync',
    headers: { cookie: 'daybook_session=sess-tok', origin: 'http://localhost:8080', 'x-daybook-csrf': 'csrf-logout' },
    async *[Symbol.asyncIterator]() { yield Buffer.from('{}'); }
  }, resStop);
  assert.equal(resStop.status, 200);
  assert.equal(stoppedSync, 'u-logout');

  // Default store initialization without passing store
  const devServer = createDriveServer({
    env: {
      DAYBOOK_BASE_URL: 'http://localhost:8080',
      GOOGLE_CLIENT_ID: 'mock-client-id',
      GOOGLE_CLIENT_SECRET: 'secret',
      DAYBOOK_SCHEDULER_SECRET: 'scheduler-secret'
    }
  });
  assert.ok(devServer);
});

test('OAuth callback handling: error response, state fallback, ticket validation, and userinfo fetch', async () => {
  const { OAuth2Client } = await import('google-auth-library');
  const originalVerifyIdToken = OAuth2Client.prototype.verifyIdToken;

  try {
    let upsertedUser = null;
    const store = {
      oauthStates: new Map(),
      async consumeOauthState(state) {
        if (state === 'valid-oauth-state') return 'code-verifier-123';
        if (state === 'expired-state') return null;
        return null;
      },
      async upsertUser(id, profile, refresh) {
        upsertedUser = { id, profile, refresh };
      },
      async createSession(id) {
        return { token: `sess-${id}`, csrf: 'new-csrf' };
      }
    };

    const mockFetcher = async (url, opts) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        const bodyStr = opts.body.toString();
        if (bodyStr.includes('code=bad-code')) {
          return { ok: false, status: 400, json: async () => ({ error_description: 'Bad code' }) };
        }
        return {
          ok: true,
          json: async () => ({
            access_token: 'google-access-tok',
            id_token: bodyStr.includes('code=unverified-code') ? 'unverified-tok' : 'valid-id-tok',
            refresh_token: 'google-refresh-tok'
          })
        };
      }
      if (url === 'https://www.googleapis.com/oauth2/v3/userinfo') {
        return {
          ok: true,
          json: async () => ({ name: 'Fetched Name', picture: 'https://fetched.pic' })
        };
      }
      throw new Error(`Unhandled mock fetch URL: ${url}`);
    };

    OAuth2Client.prototype.verifyIdToken = async function({ idToken }) {
      if (idToken === 'unverified-tok') {
        return { getPayload: () => ({ sub: 'u-unverified', email: 'unverified@example.com', email_verified: false }) };
      }
      return {
        getPayload: () => ({ sub: 'u-verified', email: 'verified@example.com', email_verified: true })
      };
    };

    const { server } = createDriveServer({
      env: {
        DAYBOOK_BASE_URL: 'http://localhost:8080',
        GOOGLE_CLIENT_ID: 'real-google-id',
        GOOGLE_CLIENT_SECRET: 'real-google-secret',
        DAYBOOK_SCHEDULER_SECRET: 'scheduler-secret'
      },
      store,
      fetcher: mockFetcher
    });

    const sendCallback = async (query, cookie) => {
      const res = { headers: {}, status: 0, payload: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(s, h = {}) { this.status = s; for (const [k, v] of Object.entries(h)) this.headers[k.toLowerCase()] = v; }, end(v = '') { this.payload = v; } };
      await server.listeners('request')[0]({
        method: 'GET',
        url: `/auth/callback?${query}`,
        headers: { cookie }
      }, res);
      return res;
    };

    // 1. Google OAuth error parameter
    const resErr = await sendCallback('error=access_denied', '');
    assert.equal(resErr.status, 400);
    assert.match(JSON.parse(resErr.payload).error, /Google sign-in: access_denied/);

    // 2. Expired code verifier in store
    const resExpired = await sendCallback('state=expired-state&code=code1', 'daybook_oauth=expired-state');
    assert.equal(resExpired.status, 400);
    assert.match(JSON.parse(resExpired.payload).error, /Sign-in state has expired/);

    // 3. Token exchange error from Google
    const resTokenErr = await sendCallback('state=valid-oauth-state&code=bad-code', 'daybook_oauth=valid-oauth-state');
    assert.equal(resTokenErr.status, 400);
    assert.match(JSON.parse(resTokenErr.payload).error, /Google OAuth: Bad code/);

    // 4. Unverified Google account
    const resUnverified = await sendCallback('state=valid-oauth-state&code=unverified-code', 'daybook_oauth=valid-oauth-state');
    assert.equal(resUnverified.status, 400);
    assert.match(JSON.parse(resUnverified.payload).error, /A verified Google account is required/);

    // 5. Successful login, profile payload missing name/picture triggers userinfo fetch
    const resSuccess = await sendCallback('state=valid-oauth-state&code=good-code', 'daybook_oauth=valid-oauth-state');
    assert.equal(resSuccess.status, 303);
    assert.ok(resSuccess.headers['location']);
    assert.equal(upsertedUser.profile.name, 'Fetched Name');
    assert.equal(upsertedUser.profile.picture, 'https://fetched.pic');
    assert.equal(upsertedUser.refresh, 'google-refresh-tok');
  } finally {
    OAuth2Client.prototype.verifyIdToken = originalVerifyIdToken;
  }
});

test('server default access function in mock dev mode and non-mock scan', async () => {
  const store = new MemoryDriveStore();
  const userId = 'sdebjit-local';

  // 1. In mock dev mode, test default access() methods
  const { server } = createDriveServer({
    env: {
      DAYBOOK_BASE_URL: 'http://localhost:8080',
      LOCAL_DEV: 'true',
      GOOGLE_CLIENT_ID: 'mock-client-id',
      GOOGLE_CLIENT_SECRET: 'secret',
      DAYBOOK_SCHEDULER_SECRET: 'scheduler-secret'
    },
    store
  });

  const { token, csrf } = await store.createSession(userId);

  // Trigger /api/folders using default mock dev access
  const resFolders = { headers: {}, status: 0, payload: '', setHeader() {}, writeHead(s) { this.status = s; }, end(v = '') { this.payload = v; } };
  await server.listeners('request')[0]({
    method: 'GET',
    url: '/api/folders',
    headers: { cookie: `daybook_session=${token}` }
  }, resFolders);
  assert.equal(resFolders.status, 200);

  // Trigger /api/folder using default mock dev access getFolder
  const resFolder = { headers: {}, status: 0, payload: '', setHeader() {}, writeHead(s) { this.status = s; }, end(v = '') { this.payload = v; } };
  await server.listeners('request')[0]({
    method: 'POST',
    url: '/api/folder',
    headers: { cookie: `daybook_session=${token}`, origin: 'http://localhost:8080', 'x-daybook-csrf': csrf },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ folderId: 'mock-folder-2' })); }
  }, resFolder);
  assert.equal(resFolder.status, 200);

  // 2. Non-mock mode scan calling default access with token exchange and ingestFolder
  const realStore = {
    async claimScan() { return true; },
    async finishScan() {},
    async getUser() { return { id: 'u-live', folderId: 'live-folder-1', refreshToken: 'valid-refresh-tok' }; },
    async getFile() { return null; },
    async saveReport() {},
    async markArchived() {}
  };

  const mockFetcher = async (url) => {
    const urlStr = url.toString();
    if (urlStr === 'https://oauth2.googleapis.com/token') {
      return {
        ok: true,
        json: async () => ({ access_token: 'live-access-token' })
      };
    }
    if (urlStr.includes('/files?')) {
      return {
        ok: true,
        json: async () => ({ files: [] })
      };
    }
    throw new Error(`Unhandled URL: ${urlStr}`);
  };

  const { scan } = createDriveServer({
    env: {
      DAYBOOK_BASE_URL: 'http://localhost:8080',
      GOOGLE_CLIENT_ID: 'live-client-id',
      GOOGLE_CLIENT_SECRET: 'live-secret',
      DAYBOOK_SCHEDULER_SECRET: 'scheduler-secret'
    },
    store: realStore,
    fetcher: mockFetcher
  });

  const scanResult = await scan('u-live');
  assert.deepEqual(scanResult, { checked: 0, imported: 0, archived: 0, skipped: 0, errors: [] });
});

test('api/scheduled handles due users execution, error catching, and DriveStore default creation', async () => {
  // 1. Test DriveStore default creation when GOOGLE_APPLICATION_CREDENTIALS is set
  const cloudServer = createDriveServer({
    env: {
      DAYBOOK_BASE_URL: 'http://localhost:8080',
      GOOGLE_CLIENT_ID: 'cloud-client-id',
      GOOGLE_CLIENT_SECRET: 'cloud-secret',
      DAYBOOK_SCHEDULER_SECRET: 'secret-scheduler',
      GOOGLE_APPLICATION_CREDENTIALS: '/tmp/nonexistent-creds.json',
      DAYBOOK_ENCRYPTION_KEY: 'b'.repeat(64),
    }
  });
  assert.ok(cloudServer);

  // 2. Test /api/scheduled with successful and failing user scans
  let finishedCalls = [];
  const scheduledStore = {
    async cleanupExpired() {},
    async dueUsers() { return ['user-ok', 'user-fail']; },
    async claimScan(id) {
      if (id === 'user-fail') throw new Error('Drive quota exceeded');
      return true;
    },
    async finishScan(id, result, error) { finishedCalls.push({ id, error }); },
    async getUser() { return { folderId: 'f-scheduled' }; }
  };

  const { server } = createDriveServer({
    env: {
      DAYBOOK_BASE_URL: 'http://localhost:8080',
      LOCAL_DEV: 'true',
      GOOGLE_CLIENT_ID: 'mock-client-id',
      GOOGLE_CLIENT_SECRET: 'secret',
      DAYBOOK_SCHEDULER_SECRET: 'sched-123'
    },
    store: scheduledStore
  });

  const res = { headers: {}, status: 0, payload: '', setHeader() {}, writeHead(s) { this.status = s; }, end(v = '') { this.payload = v; } };
  await server.listeners('request')[0]({
    method: 'POST',
    url: '/api/scheduled',
    headers: { authorization: 'Bearer sched-123' }
  }, res);

  assert.equal(res.status, 200);
  const data = JSON.parse(res.payload);
  assert.equal(data.checkedUsers, 2);
  assert.equal(data.results.length, 2);
  assert.equal(data.results[0].id, 'user-ok');
  assert.ok(data.results[0].result);
  assert.equal(data.results[1].id, 'user-fail');
  assert.equal(data.results[1].error, 'Drive quota exceeded');
});

test('startServer starts listening on configured port and closes cleanly', async () => {
  const { startServer } = await import('../src/drive-server.mjs');
  const server = startServer({
    env: {
      DAYBOOK_BASE_URL: 'http://localhost',
      PORT: '0',
      GOOGLE_CLIENT_ID: 'mock-client-id',
      GOOGLE_CLIENT_SECRET: 'secret',
      DAYBOOK_SCHEDULER_SECRET: 'scheduler-secret'
    }
  });
  await new Promise((resolve) => server.on('listening', resolve));
  await new Promise((resolve) => server.close(resolve));
});




