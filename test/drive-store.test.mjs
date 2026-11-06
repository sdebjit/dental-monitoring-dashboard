import test from 'node:test';
import assert from 'node:assert/strict';
import { DriveStore } from '../src/drive-store.mjs';

// Realistic in-memory Firestore Mock for testing DriveStore
class MockFirestore {
  constructor() {
    this.data = new Map(); // path -> object
  }

  _getKey(collectionPath, docId) {
    return `${collectionPath}/${docId}`;
  }

  collection(collectionName) {
    return new MockCollection(this, collectionName);
  }

  async runTransaction(updateFunction) {
    const tx = {
      get: async (ref) => ref.get(),
      set: (ref, data, opts) => ref.set(data, opts),
      update: (ref, data) => ref.update(data),
      delete: (ref) => ref.delete(),
    };
    return updateFunction(tx);
  }

  batch() {
    const ops = [];
    return {
      set: (ref, data, opts) => ops.push(() => ref.set(data, opts)),
      delete: (ref) => ops.push(() => ref.delete()),
      update: (ref, data) => ops.push(() => ref.update(data)),
      commit: async () => {
        for (const op of ops) await op();
      }
    };
  }
}

class MockCollection {
  constructor(db, path, filters = [], orderByClause = null, limitCount = null) {
    this.db = db;
    this.path = path;
    this.filters = filters;
    this.orderByClause = orderByClause;
    this.limitCount = limitCount;
  }

  doc(id) {
    return new MockDocRef(this.db, this.path, id);
  }

  where(field, op, val) {
    return new MockCollection(
      this.db,
      this.path,
      [...this.filters, { field, op, val }],
      this.orderByClause,
      this.limitCount
    );
  }

  orderBy(field, dir = 'asc') {
    return new MockCollection(
      this.db,
      this.path,
      this.filters,
      { field, dir },
      this.limitCount
    );
  }

  limit(n) {
    return new MockCollection(
      this.db,
      this.path,
      this.filters,
      this.orderByClause,
      n
    );
  }

  async get() {
    const prefix = `${this.path}/`;
    const matchingDocs = [];

    for (const [key, val] of this.db.data.entries()) {
      if (key.startsWith(prefix)) {
        const subPath = key.slice(prefix.length);
        // Only direct children (no additional slash)
        if (!subPath.includes('/')) {
          let matches = true;
          for (const f of this.filters) {
            if (f.op === '==' && val[f.field] !== f.val) matches = false;
            if (f.op === '<=' && !(val[f.field] <= f.val)) matches = false;
            if (f.op === '>=' && !(val[f.field] >= f.val)) matches = false;
          }
          if (matches) {
            matchingDocs.push({
              id: subPath,
              ref: new MockDocRef(this.db, this.path, subPath),
              data: () => ({ ...val })
            });
          }
        }
      }
    }

    if (this.orderByClause) {
      const { field, dir } = this.orderByClause;
      matchingDocs.sort((a, b) => {
        const valA = a.data()[field];
        const valB = b.data()[field];
        if (valA < valB) return dir === 'desc' ? 1 : -1;
        if (valA > valB) return dir === 'desc' ? -1 : 1;
        return 0;
      });
    }

    const limited = this.limitCount !== null ? matchingDocs.slice(0, this.limitCount) : matchingDocs;

    return {
      empty: limited.length === 0,
      size: limited.length,
      docs: limited
    };
  }
}

class MockDocRef {
  constructor(db, collectionPath, id) {
    this.db = db;
    this.collectionPath = collectionPath;
    this.id = id;
    this.path = `${collectionPath}/${id}`;
  }

  collection(subCollectionName) {
    return new MockCollection(this.db, `${this.path}/${subCollectionName}`);
  }

  async get() {
    const exists = this.db.data.has(this.path);
    const data = exists ? { ...this.db.data.get(this.path) } : undefined;
    return {
      exists,
      data: () => data
    };
  }

  async set(data, options = {}) {
    if (options.merge && this.db.data.has(this.path)) {
      const existing = this.db.data.get(this.path);
      this.db.data.set(this.path, { ...existing, ...data });
    } else {
      this.db.data.set(this.path, { ...data });
    }
  }

  async update(fields) {
    const existing = this.db.data.get(this.path) || {};
    const updated = { ...existing };
    for (const [k, v] of Object.entries(fields)) {
      // Check for FieldValue.delete()
      if (v && typeof v === 'object' && v.constructor?.name === 'DeleteTransform') {
        delete updated[k];
      } else {
        updated[k] = v;
      }
    }
    this.db.data.set(this.path, updated);
  }

  async delete() {
    this.db.data.delete(this.path);
  }
}

const VALID_KEY = 'a'.repeat(64);

test('DriveStore constructor validates encryption key', () => {
  assert.throws(
    () => new DriveStore({ encryptionKey: 'short-key' }),
    /DAYBOOK_ENCRYPTION_KEY must be 32 bytes as 64 hex characters\./
  );
  assert.throws(
    () => new DriveStore({ encryptionKey: '' }),
    /DAYBOOK_ENCRYPTION_KEY must be 32 bytes as 64 hex characters\./
  );

  const mockDb = new MockFirestore();
  const store = new DriveStore({ db: mockDb, encryptionKey: VALID_KEY });
  assert.ok(store);
  assert.equal(store.db, mockDb);
});

test('DriveStore encrypt and decrypt roundtrip and tampering detection', () => {
  const mockDb = new MockFirestore();
  const store = new DriveStore({ db: mockDb, encryptionKey: VALID_KEY });

  const secret = 'super-secret-refresh-token-12345';
  const encrypted = store.encrypt(secret);
  assert.notEqual(encrypted, secret);

  const decrypted = store.decrypt(encrypted);
  assert.equal(decrypted, secret);

  // Tampering with auth tag or ciphertext throws
  const bytes = Buffer.from(encrypted, 'base64');
  bytes[bytes.length - 1] ^= 1; // flip last bit
  const tampered = bytes.toString('base64');
  assert.throws(() => store.decrypt(tampered));
});

test('DriveStore oauth state management and expiration', async () => {
  const mockDb = new MockFirestore();
  const store = new DriveStore({ db: mockDb, encryptionKey: VALID_KEY });

  // put and consume valid oauth state
  await store.putOauthState('state-1', 'verifier-1', Date.now() + 600000);
  const verifier = await store.consumeOauthState('state-1');
  assert.equal(verifier, 'verifier-1');

  // consuming again fails (state deleted)
  await assert.rejects(
    async () => await store.consumeOauthState('state-1'),
    /Sign-in state has expired\. Please try again\./
  );

  // consuming expired state fails
  await store.putOauthState('expired-state', 'verifier-exp', Date.now() - 1000);
  await assert.rejects(
    async () => await store.consumeOauthState('expired-state'),
    /Sign-in state has expired\. Please try again\./
  );
});

test('DriveStore user upsert, naming resolution, and profile retrieval', async () => {
  const mockDb = new MockFirestore();
  const store = new DriveStore({ db: mockDb, encryptionKey: VALID_KEY });

  // Missing refresh token for new user throws
  await assert.rejects(
    async () => await store.upsertUser('user-1', { email: 'user1@example.com' }, null),
    /Google did not provide offline access\. Please reconnect and grant consent\./
  );

  // Successful initial upsert
  await store.upsertUser('user-1', { email: 'user1@example.com', name: 'User One', picture: 'pic.jpg' }, 'refresh-tok-1');
  let u = await store.getUser('user-1');
  assert.equal(u.email, 'user1@example.com');
  assert.equal(u.name, 'User One');
  assert.equal(u.refreshToken, 'refresh-tok-1');

  // Upsert user with customName preserved
  await store.updateUserName('user-1', 'Custom Nickname');
  await store.upsertUser('user-1', { email: 'user1@example.com', name: 'Google Given Name' }, null);
  u = await store.getUser('user-1');
  assert.equal(u.name, 'Custom Nickname');

  // Upsert user where existing name is used if profile name is missing
  mockDb.data.set('users/user-2', { name: 'Existing Name', refreshToken: store.encrypt('token-2') });
  await store.upsertUser('user-2', { email: 'user2@example.com', name: '' }, null);
  const u2 = await store.getUser('user-2');
  assert.equal(u2.name, 'Existing Name');

  // getUser on non-existent user returns null
  assert.equal(await store.getUser('non-existent'), null);

  // getUser on user without refreshToken
  mockDb.data.set('users/user-no-token', { email: 'notoken@example.com', name: 'No Token' });
  const uNoTok = await store.getUser('user-no-token');
  assert.equal(uNoTok.refreshToken, undefined);

  // updateUserName with falsy or non-string is no-op
  await store.updateUserName('user-1', '');
  await store.updateUserName('user-1', null);
  assert.equal((await store.getUser('user-1')).name, 'Custom Nickname');
});

test('DriveStore session lifecycle', async () => {
  const mockDb = new MockFirestore();
  const store = new DriveStore({ db: mockDb, encryptionKey: VALID_KEY });

  // session(null) returns null
  assert.equal(await store.session(null), null);
  assert.equal(await store.session(''), null);

  const { token, csrf } = await store.createSession('user-sess');
  assert.ok(token);
  assert.ok(csrf);

  const sess = await store.session(token);
  assert.ok(sess);
  assert.equal(sess.userId, 'user-sess');
  assert.equal(sess.csrf, csrf);

  // Expired session returns null
  const sessKey = Array.from(mockDb.data.keys()).find(k => k.startsWith('sessions/'));
  mockDb.data.get(sessKey).expiresAt = Date.now() - 1000;
  assert.equal(await store.session(token), null);

  // deleteSession
  await store.deleteSession(token);
  assert.equal(await store.session(token), null);
  await store.deleteSession(null); // safe no-op
});

test('DriveStore onboarded, folder, schedule, and stopSync', async () => {
  const mockDb = new MockFirestore();
  const store = new DriveStore({ db: mockDb, encryptionKey: VALID_KEY });
  const userId = 'user-ops';

  await store.upsertUser(userId, { email: 'ops@example.com', name: 'Ops User' }, 'tok');

  // setOnboarded with custom name and flags
  await store.setOnboarded(userId, { termsAccepted: true, completed: true, name: 'Onboarded Ops' });
  let u = await store.getUser(userId);
  assert.equal(u.name, 'Onboarded Ops');
  assert.ok(u.termsAcceptedAt);
  assert.ok(u.onboardedAt);

  // setFolder
  await store.setFolder(userId, { id: 'folder-abc', name: 'Dental Reports' });
  u = await store.getUser(userId);
  assert.equal(u.folderId, 'folder-abc');
  assert.equal(u.folderName, 'Dental Reports');

  // setSchedule with positive minutes
  await store.setSchedule(userId, 1440);
  u = await store.getUser(userId);
  assert.equal(u.scheduleMinutes, 1440);
  assert.ok(u.nextScanAt > Date.now());

  // setSchedule with 0 minutes turns off scan
  await store.setSchedule(userId, 0);
  u = await store.getUser(userId);
  assert.equal(u.scheduleMinutes, 0);
  assert.equal(u.nextScanAt, null);

  // stopSync
  await store.stopSync(userId);
  u = await store.getUser(userId);
  assert.equal(u.refreshToken, undefined);
  assert.equal(u.folderId, undefined);
  assert.equal(u.scanLeaseUntil, 0);
});

test('DriveStore scan lease and execution workflow', async () => {
  const mockDb = new MockFirestore();
  const store = new DriveStore({ db: mockDb, encryptionKey: VALID_KEY });
  const userId = 'user-scan';

  mockDb.data.set(`users/${userId}`, { name: 'Scanner' });

  // claimScan throws if folderId not configured
  await assert.rejects(
    async () => await store.claimScan(userId),
    /Choose a Google Drive folder first\./
  );

  mockDb.data.set(`users/${userId}`, { folderId: 'folder-1', scanLeaseUntil: 0 });
  const claimed = await store.claimScan(userId);
  assert.equal(claimed, true);

  // active lease returns false
  const doubleClaim = await store.claimScan(userId);
  assert.equal(doubleClaim, false);

  // finishScan with schedule
  await store.finishScan(userId, { imported: 2 }, '');
  let u = await store.getUser(userId);
  assert.equal(u.scanLeaseUntil, 0);
  assert.deepEqual(u.lastScanResult, { imported: 2 });
  assert.ok(u.nextScanAt > Date.now());

  // finishScan with scheduleMinutes <= 0
  mockDb.data.get(`users/${userId}`).scheduleMinutes = 0;
  await store.finishScan(userId, { imported: 0 });
  u = await store.getUser(userId);
  assert.equal(u.nextScanAt, null);
});

test('DriveStore dueUsers, cleanupExpired, and deleteAllUserData', async () => {
  const mockDb = new MockFirestore();
  const store = new DriveStore({ db: mockDb, encryptionKey: VALID_KEY });

  // dueUsers
  mockDb.data.set('users/user-due-1', { nextScanAt: Date.now() - 5000 });
  mockDb.data.set('users/user-due-2', { nextScanAt: Date.now() - 1000 });
  mockDb.data.set('users/user-future', { nextScanAt: Date.now() + 100000 });

  const due = await store.dueUsers(10);
  assert.ok(due.includes('user-due-1'));
  assert.ok(due.includes('user-due-2'));
  assert.equal(due.includes('user-future'), false);

  // cleanupExpired
  mockDb.data.set('sessions/sess-exp', { expiresAt: Date.now() - 1000 });
  mockDb.data.set('sessions/sess-act', { expiresAt: Date.now() + 10000 });
  mockDb.data.set('oauthStates/state-exp', { expiresAt: Date.now() - 1000 });
  mockDb.data.set('oauthStates/state-act', { expiresAt: Date.now() + 10000 });

  const deleted = await store.cleanupExpired(50);
  assert.equal(deleted, 2);
  assert.equal(mockDb.data.has('sessions/sess-exp'), false);
  assert.equal(mockDb.data.has('oauthStates/state-exp'), false);

  // deleteAllUserData
  const userId = 'user-purge';
  mockDb.data.set(`users/${userId}`, { name: 'To Purge' });
  mockDb.data.set(`users/${userId}/reports/2026-11-01`, { date: '2026-11-01' });
  mockDb.data.set(`users/${userId}/files/file-1`, { status: 'ingested' });
  mockDb.data.set(`users/${userId}/notes/2026-11-01`, { text: 'test' });
  mockDb.data.set(`sessions/sess-user`, { userId });

  await store.deleteAllUserData(userId);
  assert.equal(mockDb.data.has(`users/${userId}`), false);
  assert.equal(mockDb.data.has(`users/${userId}/reports/2026-11-01`), false);
  assert.equal(mockDb.data.has(`users/${userId}/files/file-1`), false);
  assert.equal(mockDb.data.has(`users/${userId}/notes/2026-11-01`), false);
  assert.equal(mockDb.data.has(`sessions/sess-user`), false);
});

test('DriveStore reports, conflict detection, resolution, and import stats', async () => {
  const mockDb = new MockFirestore();
  const store = new DriveStore({ db: mockDb, encryptionKey: VALID_KEY });
  const userId = 'report-user';

  mockDb.data.set(`users/${userId}`, { folderName: 'Dental Ingest' });

  // initial getFile
  assert.equal(await store.getFile(userId, 'f-none'), undefined);

  // saveReport initial
  const rep1 = {
    date: '2026-11-05',
    casesFinished: 100,
    individualScore: 850,
    details: [],
    metadata: {},
    records: [],
    sha256: 'sha-v1'
  };
  await store.saveReport(userId, { id: 'file-v1', name: 'v1.pdf' }, rep1, '2026-11-05T12:00:00Z');

  let fileDoc = await store.getFile(userId, 'file-v1');
  assert.equal(fileDoc.status, 'ingested');

  // saveReport with conflicting numbers
  const repConflicting = {
    date: '2026-11-05',
    casesFinished: 110,
    individualScore: 935,
    details: [],
    metadata: {},
    records: [],
    sha256: 'sha-v2'
  };
  await store.saveReport(userId, { id: 'file-v2', name: 'v2.pdf' }, repConflicting, '2026-11-05T14:00:00Z');

  let reportsList = await store.reports(userId, 5);
  assert.equal(reportsList.length, 1);
  assert.equal(reportsList[0].hasConflict, true);
  assert.equal(reportsList[0].versions.length, 2);

  // saveReport updating existing version in prevList
  const repConflictingUpdate = {
    ...repConflicting,
    casesFinished: 115,
  };
  await store.saveReport(userId, { id: 'file-v2', name: 'v2.pdf' }, repConflictingUpdate, '2026-11-05T14:30:00Z');

  // saveReport with identical content preserves existing.versions if > 1
  await store.saveReport(userId, { id: 'file-v2', name: 'v2.pdf' }, repConflictingUpdate, '2026-11-05T14:45:00Z');
  const identicalRep = await store.reports(userId, 1);
  assert.equal(identicalRep[0].versions.length, 2);

  // resolveDuplicateReport
  await assert.rejects(
    async () => await store.resolveDuplicateReport(userId, '2026-11-99', 'file-v2'),
    /Report for 2026-11-99 not found\./
  );
  await assert.rejects(
    async () => await store.resolveDuplicateReport(userId, '2026-11-05', 'non-existent-v'),
    /Selected version not found\./
  );

  const resolved = await store.resolveDuplicateReport(userId, '2026-11-05', 'file-v2');
  assert.equal(resolved.hasConflict, false);
  assert.equal(resolved.conflictResolved, true);
  assert.equal(resolved.sourceFileId, 'file-v2');

  // markArchived, markIgnored, recordFileError
  await store.markArchived(userId, 'file-v1', '2026-11-05T15:00:00Z');
  assert.equal((await store.getFile(userId, 'file-v1')).status, 'archived');

  await store.markIgnored(userId, 'file-unrelated', '2026-11-05T15:00:00Z', 'unrelated.pdf');
  assert.equal((await store.getFile(userId, 'file-unrelated')).status, 'ignored');

  await store.recordFileError(userId, 'file-bad', 'Bad PDF', '2026-11-05T15:00:00Z', 'bad.pdf');
  assert.equal((await store.getFile(userId, 'file-bad')).status, 'error');

  // Standalone report doc without corresponding files doc
  mockDb.data.set(`users/${userId}/reports/2026-11-04`, {
    date: '2026-11-04',
    sourceFileName: 'orphan.pdf',
    casesFinished: 50,
    individualScore: 425,
    ingestedAt: '2026-11-04T10:00:00Z'
  });

  // getImportStats
  const stats = await store.getImportStats(userId);
  assert.equal(stats.totalErrors, 1);
  assert.ok(stats.totalSuccessful >= 2);
  assert.ok(stats.recentImports.length > 0);
});

test('DriveStore notes management: validation, save, and delete', async () => {
  const mockDb = new MockFirestore();
  const store = new DriveStore({ db: mockDb, encryptionKey: VALID_KEY });
  const userId = 'user-notes';

  // Invalid date throws
  await assert.rejects(
    async () => await store.saveNote(userId, '05-11-2026', 'Invalid date'),
    /Invalid date format\./
  );

  // Save valid note
  const notes = await store.saveNote(userId, '2026-11-06', 'First shift note');
  assert.equal(notes['2026-11-06'], 'First shift note');

  // Empty note deletes it
  const notesAfterEmpty = await store.saveNote(userId, '2026-11-06', '   ');
  assert.equal(notesAfterEmpty['2026-11-06'], undefined);

  // Delete note
  await store.saveNote(userId, '2026-11-07', 'To delete');
  const notesAfterDelete = await store.deleteNote(userId, '2026-11-07');
  assert.equal(notesAfterDelete['2026-11-07'], undefined);
});
