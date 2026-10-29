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
