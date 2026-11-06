import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryDriveStore } from '../src/memory-store.mjs';

test('MemoryDriveStore constructor seeds sample data correctly', async () => {
  const store = new MemoryDriveStore();
  const user = await store.getUser('sdebjit-local');
  assert.ok(user);
  assert.equal(user.email, 'mr.debjit.sadhukhan@gmail.com');

  const notes = await store.getNotes('sdebjit-local');
  assert.ok(notes['2026-10-29']);

  const reps = await store.reports('sdebjit-local', 10);
  assert.equal(reps.length, 5);

  const file = await store.getFile('sdebjit-local', 'file-2026-10-27');
  assert.ok(file);
  assert.equal(file.status, 'archived');
});

test('MemoryDriveStore oauth state lifecycle and expiration', async () => {
  const store = new MemoryDriveStore();

  // put and consume valid oauth state
  await store.putOauthState('state-123', 'verifier-abc', '/dashboard');
  const verifier = await store.consumeOauthState('state-123');
  assert.equal(verifier, 'verifier-abc');

  // consume non-existent state returns null
  const missing = await store.consumeOauthState('state-missing');
  assert.equal(missing, null);

  // consume state with string or verifier property
  store.oauthStatesMap.set('raw-string-state', 'direct-verifier-string');
  assert.equal(await store.consumeOauthState('raw-string-state'), 'direct-verifier-string');

  store.oauthStatesMap.set('obj-verifier-state', { verifier: 'alt-verifier' });
  assert.equal(await store.consumeOauthState('obj-verifier-state'), 'alt-verifier');

  store.oauthStatesMap.set('empty-verifier-state', {});
  assert.equal(await store.consumeOauthState('empty-verifier-state'), '');

  // cleanExpiredOauthStates
  await store.putOauthState('old-state', 'v1');
  const oldEntry = store.oauthStatesMap.get('old-state');
  oldEntry.createdAt = Date.now() - 20 * 60 * 1000; // 20 mins old
  await store.putOauthState('new-state', 'v2');

  await store.cleanExpiredOauthStates(10 * 60 * 1000);
  assert.equal(store.oauthStatesMap.has('old-state'), false);
  assert.equal(store.oauthStatesMap.has('new-state'), true);
});

test('MemoryDriveStore session lifecycle and expiration', async () => {
  const store = new MemoryDriveStore();

  // session(null) returns null
  assert.equal(await store.session(null), null);
  assert.equal(await store.session(''), null);
  assert.equal(await store.getSession(null), null);

  // createSession
  const { token, csrf } = await store.createSession('user-xyz');
  assert.ok(token);
  assert.ok(csrf);

  const sess = await store.getSession(token);
  assert.ok(sess);
  assert.equal(sess.userId, 'user-xyz');
  assert.equal(sess.csrf, csrf);

  // custom putSession with short expiration
  await store.putSession('token-custom', 'user-abc', -10); // already expired
  assert.equal(await store.session('token-custom'), null);

  // deleteSession
  await store.deleteSession(token);
  assert.equal(await store.session(token), null);
  // deleteSession with null/empty is a no-op
  await store.deleteSession(null);
});

test('MemoryDriveStore user management and profile updates', async () => {
  const store = new MemoryDriveStore();

  // upsertUser
  await store.upsertUser('user-new', { email: 'test@example.com', name: 'Tester', picture: 'pic.jpg' }, 'refresh-tok');
  let u = await store.getUser('user-new');
  assert.equal(u.email, 'test@example.com');
  assert.equal(u.refreshToken, 'refresh-tok');

  // upsertUser without refresh token preserves existing
  await store.upsertUser('user-new', { email: 'test@example.com', name: 'Tester Updated', picture: 'pic2.jpg' });
  u = await store.getUser('user-new');
  assert.equal(u.name, 'Tester Updated');
  assert.equal(u.refreshToken, 'refresh-tok');

  // getUser for non-existent user returns null
  assert.equal(await store.getUser('non-existent'), null);

  // putUser merges fields
  await store.putUser('user-new', { role: 'admin', customSetting: true });
  u = await store.getUser('user-new');
  assert.equal(u.role, 'admin');
  assert.equal(u.name, 'Tester Updated');

  // putUser for brand new user
  await store.putUser('user-fresh', { email: 'fresh@example.com' });
  assert.equal((await store.getUser('user-fresh')).email, 'fresh@example.com');

  // updateUserName
  await store.updateUserName('user-new', 'Final Name');
  assert.equal((await store.getUser('user-new')).name, 'Final Name');

  // updateUserName for user not in map yet
  await store.updateUserName('user-ghost', 'Ghost Name');
  assert.equal((await store.getUser('user-ghost')).name, 'Ghost Name');

  // setOnboarded with various flags
  await store.setOnboarded('user-new', { termsAccepted: true, completed: true, name: 'Onboarded Name' });
  u = await store.getUser('user-new');
  assert.ok(u.termsAcceptedAt);
  assert.ok(u.onboardedAt);
  assert.equal(u.name, 'Onboarded Name');

  // setFolder with object
  await store.setFolder('user-new', { id: 'folder-obj-id', name: 'Folder Object' });
  u = await store.getUser('user-new');
  assert.equal(u.folderId, 'folder-obj-id');
  assert.equal(u.folderName, 'Folder Object');

  // setFolder with string and name
  await store.setFolder('user-new', 'folder-str-id', 'Folder String');
  u = await store.getUser('user-new');
  assert.equal(u.folderId, 'folder-str-id');
  assert.equal(u.folderName, 'Folder String');

  // setFolder with string only (fallback to id)
  await store.setFolder('user-new', 'folder-only-id');
  u = await store.getUser('user-new');
  assert.equal(u.folderId, 'folder-only-id');
  assert.equal(u.folderName, 'folder-only-id');

  // setSchedule
  await store.setSchedule('user-new', 720);
  u = await store.getUser('user-new');
  assert.equal(u.scheduleMinutes, 720);

  // stopSync clears sync fields
  await store.stopSync('user-new');
  u = await store.getUser('user-new');
  assert.equal(u.refreshToken, undefined);
  assert.equal(u.folderId, undefined);
  assert.equal(u.folderName, undefined);
  assert.equal(u.nextScanAt, undefined);
  assert.equal(u.scanLeaseUntil, 0);

  // dueUsers returns array
  const due = await store.dueUsers(10);
  assert.deepEqual(due, []);
});

test('MemoryDriveStore cleanupExpired removes expired oauthStates and sessions', async () => {
  const store = new MemoryDriveStore();

  store.oauthStatesMap.set('expired-state', { expiresAt: Date.now() - 1000 });
  store.oauthStatesMap.set('active-state', { expiresAt: Date.now() + 10000 });

  store.sessionsMap.set('expired-session', { expiresAt: Date.now() - 1000 });
  store.sessionsMap.set('active-session', { expiresAt: Date.now() + 10000 });

  await store.cleanupExpired();
  assert.equal(store.oauthStatesMap.has('expired-state'), false);
  assert.equal(store.oauthStatesMap.has('active-state'), true);
  assert.equal(store.sessionsMap.has('expired-session'), false);
  assert.equal(store.sessionsMap.has('active-session'), true);
});

test('MemoryDriveStore deleteAllUserData purges all user records', async () => {
  const store = new MemoryDriveStore();
  const userId = 'user-to-purge';

  await store.putUser(userId, { email: 'purge@example.com', name: 'Purge' });
  await store.saveReport(userId, {}, { date: '2026-11-01', sourceFileId: 'purge-file-1' });
  await store.saveNote(userId, '2026-11-01', 'Purge note');
  await store.markArchived(userId, 'purge-file-1', new Date().toISOString(), 'purge.pdf');
  const { token } = await store.createSession(userId);

  // verify existence
  assert.ok(await store.getUser(userId));
  assert.equal((await store.reports(userId)).length, 1);
  assert.ok((await store.getNotes(userId))['2026-11-01']);
  assert.ok(await store.getFile(userId, 'purge-file-1'));
  assert.ok(await store.session(token));

  // Purge
  await store.deleteAllUserData(userId);

  assert.equal(await store.getUser(userId), null);
  assert.equal((await store.reports(userId)).length, 0);
  assert.deepEqual(await store.getNotes(userId), {});
  assert.equal(await store.getFile(userId, 'purge-file-1'), null);
  assert.equal(await store.session(token), null);
});

test('MemoryDriveStore scan lease and execution workflow', async () => {
  const store = new MemoryDriveStore();
  const userId = 'scan-user';

  // claimScan throws if user has no folder
  await store.putUser(userId, { name: 'Scan User' });
  await assert.rejects(
    async () => await store.claimScan(userId),
    /Choose a Google Drive folder first\./
  );

  // Set folder and claim lease
  await store.setFolder(userId, 'folder-123', 'My Ingest Folder');
  const claimed = await store.claimScan(userId);
  assert.equal(claimed, true);

  // Attempting to claim again while lease is active returns false
  const doubleClaim = await store.claimScan(userId);
  assert.equal(doubleClaim, false);

  // finishScan releases lease and schedules next scan
  const scanResult = { checked: 2, imported: 1, archived: 1, skipped: 0, errors: [] };
  await store.finishScan(userId, scanResult, '');
  const u = await store.getUser(userId);
  assert.equal(u.scanLeaseUntil, 0);
  assert.deepEqual(u.lastScanResult, scanResult);
  assert.ok(u.nextScanAt > Date.now());

  // finishScan on empty user handles missing scheduleMinutes with default 1440
  await store.finishScan('empty-user', { checked: 0 });
  const emptyU = await store.getUser('empty-user');
  assert.ok(emptyU.nextScanAt > Date.now());
});

test('MemoryDriveStore reports, files, import stats, and conflict resolution', async () => {
  const store = new MemoryDriveStore();
  const userId = 'report-user';

  // initial getFile is null
  assert.equal(await store.getFile(userId, 'f1'), null);

  // markArchived
  const nowStr = new Date().toISOString();
  await store.markArchived(userId, 'f1', nowStr, 'test-report.pdf');
  const f1 = await store.getFile(userId, 'f1');
  assert.equal(f1.status, 'archived');
  assert.equal(f1.name, 'test-report.pdf');

  // markIgnored
  await store.markIgnored(userId, 'f2', nowStr, 'unrelated.pdf');
  const f2 = await store.getFile(userId, 'f2');
  assert.equal(f2.status, 'ignored');

  // recordFileError
  await store.recordFileError(userId, 'f3', 'Corrupted PDF header', nowStr, 'bad.pdf');
  const f3 = await store.getFile(userId, 'f3');
  assert.equal(f3.status, 'error');
  assert.equal(f3.error, 'Corrupted PDF header');

  // saveReport
  const rep1 = {
    date: '2026-11-02',
    casesFinished: 300,
    individualScore: 2550,
    sourceFileId: 'f1',
    sourceFileName: 'test-report.pdf',
    ingestedAt: nowStr,
    sha256: 'hash-rep1'
  };
  await store.saveReport(userId, { id: 'f1' }, rep1);

  const reps = await store.reports(userId, 5);
  assert.equal(reps.length, 1);
  assert.equal(reps[0].date, '2026-11-02');

  // getImportStats without folderName
  let stats = await store.getImportStats(userId);
  assert.equal(stats.totalSuccessful, 1);
  assert.equal(stats.recentImports[0].location, 'archive');

  // getImportStats with folderName
  await store.setFolder(userId, 'folder-root', 'Dental Ingest');
  stats = await store.getImportStats(userId);
  assert.equal(stats.recentImports[0].location, 'Dental Ingest / archive');

  // resolveDuplicateReport
  const rep2 = {
    date: '2026-11-02',
    casesFinished: 310,
    individualScore: 2635,
    sourceFileId: 'f1-v2',
    sourceFileName: 'test-report-v2.pdf',
    ingestedAt: nowStr,
    sha256: 'hash-rep2',
    hasConflict: true
  };
  await store.saveReport(userId, { id: 'f1-v2' }, rep2);

  // resolveDuplicateReport with sha256 match
  const resolvedSha = await store.resolveDuplicateReport(userId, '2026-11-02', 'hash-rep2');
  assert.ok(resolvedSha);
  assert.equal(resolvedSha.sha256, 'hash-rep2');

  // resolveDuplicateReport with unknown keepVersionId falls back to finding any report on that date
  const resolvedFallback = await store.resolveDuplicateReport(userId, '2026-11-02', 'non-existent-id');
  assert.ok(resolvedFallback);
  assert.equal(resolvedFallback.date, '2026-11-02');
});

test('MemoryDriveStore notes management: validation, save, update, and delete', async () => {
  const store = new MemoryDriveStore();
  const userId = 'notes-user';

  // invalid date format throws
  await assert.rejects(
    async () => await store.saveNote(userId, '26-10-2026', 'Invalid date'),
    /Invalid date format\./
  );
  await assert.rejects(
    async () => await store.saveNote(userId, 'not-a-date', 'Invalid date'),
    /Invalid date format\./
  );

  // save valid note
  const notesAfterSave = await store.saveNote(userId, '2026-11-03', '  High volume day, seamless operation.  ');
  assert.equal(notesAfterSave['2026-11-03'], 'High volume day, seamless operation.');

  const fetchedNotes = await store.getNotes(userId);
  assert.equal(fetchedNotes['2026-11-03'], 'High volume day, seamless operation.');

  // empty or whitespace note deletes the date entry
  const notesAfterEmpty = await store.saveNote(userId, '2026-11-03', '   ');
  assert.equal(notesAfterEmpty['2026-11-03'], undefined);

  // deleteNote
  await store.saveNote(userId, '2026-11-04', 'Another note');
  assert.ok((await store.getNotes(userId))['2026-11-04']);
  const notesAfterDelete = await store.deleteNote(userId, '2026-11-04');
  assert.equal(notesAfterDelete['2026-11-04'], undefined);
});
