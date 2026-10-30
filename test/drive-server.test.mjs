import test from 'node:test';
import assert from 'node:assert/strict';
import { createDriveServer } from '../src/drive-server.mjs';

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
    async session(token) { return token === 'user-token' ? { userId: 'alice-id', csrf: 'csrf' } : null; },
    async getUser(userId) {
      if (userId === 'alice-id') return { folderId: 'valid-folder', folderName: 'Clinical Reports' };
      return {};
    },
  };
  const { server } = createDriveServer({
    env: { DAYBOOK_BASE_URL: 'http://localhost', GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'secret', DAYBOOK_SCHEDULER_SECRET: 'scheduler-secret' },
    store,
    access: async () => ({
      async getFolder(id) {
        if (id === 'valid-folder') return { id: 'valid-folder', name: 'Clinical Reports' };
        throw new Error('File not found: ' + id);
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

