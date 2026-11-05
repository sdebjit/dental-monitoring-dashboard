import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Firestore, FieldValue } from '@google-cloud/firestore';

const digest = value => createHash('sha256').update(value).digest('hex');

export class DriveStore {
  constructor({ db, databaseId = process.env.FIRESTORE_DATABASE_ID || process.env.DAYBOOK_DATABASE_ID || 'daybook-db', encryptionKey } = {}) {
    if (!/^[a-f0-9]{64}$/i.test(encryptionKey || '')) throw new Error('DAYBOOK_ENCRYPTION_KEY must be 32 bytes as 64 hex characters.');
    this.db = db || new Firestore(databaseId && databaseId !== '(default)' ? { databaseId } : {});
    this.key = Buffer.from(encryptionKey, 'hex');
  }
  users() { return this.db.collection('users'); }
  user(id) { return this.users().doc(id); }
  encrypt(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  }
  decrypt(value) {
    const bytes = Buffer.from(value, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  }
  async putOauthState(state, verifier, expiresAt) { await this.db.collection('oauthStates').doc(digest(state)).set({ verifier, expiresAt }); }
  async consumeOauthState(state) {
    const ref = this.db.collection('oauthStates').doc(digest(state));
    return this.db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('Sign-in state has expired. Please try again.');
      tx.delete(ref);
      if (snap.data().expiresAt < Date.now()) throw new Error('Sign-in state has expired. Please try again.');
      return snap.data().verifier;
    });
  }
  async upsertUser(id, profile, refreshToken) {
    const ref = this.user(id);
    const existing = (await ref.get()).data() || {};
    const token = refreshToken ? this.encrypt(refreshToken) : existing.refreshToken;
    if (!token) throw new Error('Google did not provide offline access. Please reconnect and grant consent.');
    let resolvedName = profile.name || profile.email;
    if (existing.customName && existing.name) {
      resolvedName = existing.name;
    } else if (existing.name && existing.name !== profile.email && !profile.name) {
      resolvedName = existing.name;
    }
    const resolvedPicture = profile.picture || existing.picture || '';
    await ref.set({ email: profile.email, name: resolvedName, picture: resolvedPicture, refreshToken: token, scheduleMinutes: Math.max(existing.scheduleMinutes ?? 1440, 1440), folderId: existing.folderId || null, folderName: existing.folderName || '', nextScanAt: existing.nextScanAt ?? null, updatedAt: new Date().toISOString() }, { merge: true });
  }
  async getUser(id) {
    const data = (await this.user(id).get()).data();
    return data ? { ...data, id, refreshToken: data.refreshToken && this.decrypt(data.refreshToken) } : null;
  }
  async createSession(userId) {
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(24).toString('base64url');
    await this.db.collection('sessions').doc(digest(token)).set({ userId, csrf, expiresAt: Date.now() + 30 * 86400000 });
    return { token, csrf };
  }
  async session(token) {
    if (!token) return null;
    const data = (await this.db.collection('sessions').doc(digest(token)).get()).data();
    return data && data.expiresAt > Date.now() ? data : null;
  }
  async deleteSession(token) { if (token) await this.db.collection('sessions').doc(digest(token)).delete(); }
  async setFolder(userId, folder) {
    await this.user(userId).set({ folderId: folder.id, folderName: folder.name, nextScanAt: Date.now(), scanLeaseUntil: 0 }, { merge: true });
  }
  async updateUserName(userId, name) {
    if (!name || typeof name !== 'string') return;
    await this.user(userId).set({ name: name.trim(), customName: true, updatedAt: new Date().toISOString() }, { merge: true });
  }
  async setOnboarded(userId, { termsAccepted = true, completed = true, name } = {}) {
    const update = {
      termsAcceptedAt: termsAccepted ? new Date().toISOString() : null,
      onboardedAt: completed ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString(),
    };
    if (name && typeof name === 'string' && name.trim()) {
      update.name = name.trim();
      update.customName = true;
    }
    await this.user(userId).set(update, { merge: true });
  }
  async setSchedule(userId, minutes) {
    const user = await this.getUser(userId);
    const nextScanAt = minutes > 0 && user?.folderId ? Date.now() + minutes * 60000 : null;
    await this.user(userId).set({ scheduleMinutes: minutes, nextScanAt }, { merge: true });
  }
  async stopSync(userId) {
    await this.user(userId).update({ refreshToken: FieldValue.delete(), folderId: FieldValue.delete(), folderName: FieldValue.delete(), nextScanAt: FieldValue.delete(), scanLeaseUntil: 0 });
  }
  async deleteAllUserData(userId) {
    const userRef = this.user(userId);
    for (const sub of ['reports', 'files', 'notes']) {
      const snap = await userRef.collection(sub).get();
      if (!snap.empty) {
        const batch = this.db.batch();
        for (const doc of snap.docs) batch.delete(doc.ref);
        await batch.commit();
      }
    }
    await userRef.delete();
    const sessionsSnap = await this.db.collection('sessions').where('userId', '==', userId).get();
    if (!sessionsSnap.empty) {
      const batch = this.db.batch();
      for (const doc of sessionsSnap.docs) batch.delete(doc.ref);
      await batch.commit();
    }
  }
  async claimScan(userId) {
    const ref = this.user(userId);
    return this.db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const data = snap.data();
      if (!data?.folderId) throw new Error('Choose a Google Drive folder first.');
      if (data.scanLeaseUntil > Date.now()) return false;
      tx.update(ref, { scanLeaseUntil: Date.now() + 10 * 60000 });
      return true;
    });
  }
  async finishScan(userId, result, error = '') {
    const user = await this.getUser(userId);
    const schedule = user?.scheduleMinutes ?? 1440;
    const nextScanAt = schedule > 0 ? Date.now() + Math.max(schedule, 1440) * 60000 : null;
    await this.user(userId).set({ scanLeaseUntil: 0, lastScanAt: new Date().toISOString(), lastScanResult: result, lastScanError: error, nextScanAt }, { merge: true });
  }
  async dueUsers(limit = 20) {
    const result = await this.users().where('nextScanAt', '<=', Date.now()).orderBy('nextScanAt').limit(limit).get();
    return result.docs.map(doc => doc.id);
  }
  async cleanupExpired(limit = 100) {
    let deleted = 0;
    for (const collection of ['sessions', 'oauthStates']) {
      const rows = await this.db.collection(collection).where('expiresAt', '<=', Date.now()).limit(limit).get();
      if (!rows.empty) {
        const batch = this.db.batch();
        for (const row of rows.docs) batch.delete(row.ref);
        await batch.commit();
        deleted += rows.size;
      }
    }
    return deleted;
  }
  file(userId, fileId) { return this.user(userId).collection('files').doc(fileId); }
  async getFile(userId, fileId) { return (await this.file(userId, fileId).get()).data(); }
  async saveReport(userId, file, report, ingestedAt) {
    const reportRef = this.user(userId).collection('reports').doc(report.date);
    let existing = null;
    try {
      const snap = await reportRef.get();
      if (snap?.exists) existing = snap.data();
    } catch (_) {}

    let versions = [];
    let hasConflict = false;

    if (existing) {
      const isSameFile = existing.sourceFileId === file.id && existing.sha256 === report.sha256;
      const isIdentical = existing.sha256 === report.sha256 &&
                          existing.casesFinished === report.casesFinished &&
                          existing.individualScore === report.individualScore;

      if (!isSameFile && !isIdentical) {
        hasConflict = true;
        const prevList = Array.isArray(existing.versions) && existing.versions.length ? [...existing.versions] : [
          {
            versionId: existing.sourceFileId || 'v1',
            date: existing.date,
            casesFinished: existing.casesFinished,
            individualScore: existing.individualScore,
            sourceFileName: existing.sourceFileName || 'Previous Report',
            sourceFileId: existing.sourceFileId || '',
            ingestedAt: existing.ingestedAt || existing.date,
            sha256: existing.sha256 || ''
          }
        ];

        const newEntry = {
          versionId: file.id,
          date: report.date,
          casesFinished: report.casesFinished,
          individualScore: report.individualScore,
          sourceFileName: file.name,
          sourceFileId: file.id,
          ingestedAt,
          sha256: report.sha256
        };

        const idx = prevList.findIndex(v => v.versionId === file.id || v.sourceFileId === file.id);
        if (idx >= 0) prevList[idx] = newEntry;
        else prevList.push(newEntry);
        versions = prevList;
      } else {
        versions = existing.versions || [];
        hasConflict = Boolean(existing.hasConflict && !existing.conflictResolved);
      }
    }

    const reportDoc = {
      date: report.date,
      casesFinished: report.casesFinished,
      individualScore: report.individualScore,
      details: report.details,
      metadata: report.metadata,
      records: report.records,
      sha256: report.sha256,
      sourceFileId: file.id,
      sourceFileName: file.name,
      ingestedAt,
      hasConflict,
      conflictResolved: hasConflict ? false : Boolean(existing?.conflictResolved),
    };

    if (versions.length > 1) {
      reportDoc.versions = versions;
    } else if (existing?.versions?.length > 1 && !hasConflict) {
      reportDoc.versions = existing.versions;
    }

    const batch = this.db.batch();
    batch.set(reportRef, reportDoc);
    batch.set(this.file(userId, file.id), { status: 'ingested', date: report.date, sha256: report.sha256, name: file.name, modifiedTime: file.modifiedTime || null, ingestedAt, error: '' });
    await batch.commit();
  }

  async resolveDuplicateReport(userId, date, keepVersionId) {
    const reportRef = this.user(userId).collection('reports').doc(date);
    const snap = await reportRef.get();
    if (!snap.exists) throw new Error(`Report for ${date} not found.`);
    const data = snap.data();
    const versions = data.versions || [];
    const chosen = versions.find(v => v.versionId === keepVersionId || v.sourceFileId === keepVersionId) ||
                   (data.sourceFileId === keepVersionId ? data : null);
    if (!chosen) throw new Error('Selected version not found.');

    const updated = {
      ...data,
      casesFinished: chosen.casesFinished,
      individualScore: chosen.individualScore,
      sourceFileName: chosen.sourceFileName,
      sourceFileId: chosen.sourceFileId || chosen.versionId,
      ingestedAt: chosen.ingestedAt,
      sha256: chosen.sha256 || data.sha256,
      hasConflict: false,
      conflictResolved: true,
      resolvedAt: new Date().toISOString(),
      resolvedVersionId: keepVersionId,
      versions: [chosen]
    };

    await reportRef.set(updated);
    return updated;
  }
  async markArchived(userId, fileId, archivedAt) { await this.file(userId, fileId).set({ status: 'archived', archivedAt, error: '' }, { merge: true }); }
  async markIgnored(userId, fileId, ignoredAt, fileName = '') {
    const data = { status: 'ignored', ignoredAt, at: ignoredAt, error: '' };
    if (fileName) data.name = fileName;
    await this.file(userId, fileId).set(data, { merge: true });
  }
  async recordFileError(userId, fileId, error, at, fileName = '') {
    const data = { error, errorAt: at, at, status: 'error' };
    if (fileName) data.name = fileName;
    await this.file(userId, fileId).set(data, { merge: true });
  }
  async reports(userId, limit = 100) {
    const rows = await this.user(userId).collection('reports').orderBy('date', 'desc').limit(limit).get();
    return rows.docs.map(doc => doc.data());
  }
  async getNotes(userId) {
    const snap = await this.user(userId).collection('notes').get();
    const notes = {};
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      notes[doc.id] = data.text || '';
    }
    return notes;
  }
  async saveNote(userId, date, text) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid date format.');
    const trimmed = (text || '').trim();
    if (!trimmed) {
      await this.user(userId).collection('notes').doc(date).delete();
    } else {
      await this.user(userId).collection('notes').doc(date).set({
        date,
        text: trimmed,
        updatedAt: new Date().toISOString()
      });
    }
    return this.getNotes(userId);
  }
  async deleteNote(userId, date) {
    await this.user(userId).collection('notes').doc(date).delete();
    return this.getNotes(userId);
  }
  async getImportStats(userId) {
    const userRef = this.user(userId);
    const userSnap = await userRef.get();
    const userData = userSnap.data() || {};
    const defaultLocation = userData.folderName ? `${userData.folderName} / archive` : 'archive';
    const errorLocation = userData.folderName || 'Google Drive';

    const filesSnap = await userRef.collection('files').get();
    const reportsSnap = await userRef.collection('reports').get();

    const reportsByFileId = new Map();
    const reportsByDate = new Map();
    for (const doc of reportsSnap.docs) {
      const rep = doc.data();
      if (rep.sourceFileId) reportsByFileId.set(rep.sourceFileId, rep);
      if (rep.date) reportsByDate.set(rep.date, rep);
    }

    let totalSuccessful = 0;
    let totalErrors = 0;
    const allImports = [];
    const processedFileIds = new Set();
    const processedReportDates = new Set();

    for (const doc of filesSnap.docs) {
      const d = doc.data();
      processedFileIds.add(doc.id);
      if (d.status === 'ignored') {
        continue;
      }
      const isError = Boolean(d.error || d.status === 'error');
      const rep = reportsByFileId.get(doc.id) || (d.date ? reportsByDate.get(d.date) : null);

      if (isError) {
        totalErrors++;
        allImports.push({
          id: doc.id,
          fileName: d.name || 'report.pdf',
          when: d.errorAt || d.at || d.ingestedAt || new Date().toISOString(),
          location: errorLocation,
          casesFinished: null,
          individualScore: null,
          status: 'error',
          error: d.error || 'Failed to import',
        });
      } else if (d.status === 'ingested' || d.status === 'archived' || rep) {
        totalSuccessful++;
        if (rep?.date) processedReportDates.add(rep.date);
        allImports.push({
          id: doc.id,
          date: d.date || rep?.date,
          fileName: d.name || rep?.sourceFileName || `${d.date || 'report'}.pdf`,
          when: d.archivedAt || d.ingestedAt || rep?.ingestedAt || d.at || d.date,
          location: defaultLocation,
          casesFinished: rep?.casesFinished ?? d.casesFinished ?? 0,
          individualScore: rep?.individualScore ?? d.individualScore ?? 0,
          status: 'success',
          error: '',
        });
      }
    }

    for (const doc of reportsSnap.docs) {
      const rep = doc.data();
      if (!processedReportDates.has(rep.date) && (!rep.sourceFileId || !processedFileIds.has(rep.sourceFileId))) {
        totalSuccessful++;
        allImports.push({
          id: doc.id,
          date: rep.date,
          fileName: rep.sourceFileName || `${rep.date}.pdf`,
          when: rep.ingestedAt || rep.date,
          location: defaultLocation,
          casesFinished: rep.casesFinished ?? 0,
          individualScore: rep.individualScore ?? 0,
          status: 'success',
          error: '',
        });
      }
    }

    // Sort descending by when (most recent first)
    allImports.sort((a, b) => {
      const timeA = new Date(a.when).getTime() || 0;
      const timeB = new Date(b.when).getTime() || 0;
      return timeB - timeA;
    });

    const recentImports = allImports.slice(0, 5);

    return {
      totalSuccessful,
      totalErrors,
      recentImports,
    };
  }
}

export class MemoryDriveStore {
  constructor() {
    this.usersMap = new Map();
    this.sessionsMap = new Map();
    this.oauthStatesMap = new Map();
    this.reportsMap = new Map();
    this.filesMap = new Map();
    this.notesMap = new Map();
    this.seed();
  }

  seed() {
    const userId = 'sdebjit-local';
    this.notesMap.set(userId, {
      '2026-10-29': 'Day ran smoothly with no system outages. Handled peak 2D validation caseload during mid-day hours.'
    });
    const defaultDevToken = 'mock-session-token';
    this.sessionsMap.set(digest(defaultDevToken), {
      userId,
      csrf: 'mock-csrf-token',
      expiresAt: Date.now() + 30 * 86400000
    });
    const profile = {
      id: userId,
      email: 'mr.debjit.sadhukhan@gmail.com',
      name: 'Debjit Sadhukhan',
      picture: '',
      folderId: 'mock-folder-1',
      folderName: 'Clinical PDF Reports',
      scheduleMinutes: 1440,
      termsAcceptedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
      onboardedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
      lastScanAt: new Date(Date.now() - 3600000).toISOString(),
      lastScanResult: { checked: 5, imported: 1, archived: 1, skipped: 4, errors: [] },
      nextScanAt: Date.now() + 86400000,
      scanLeaseUntil: 0,
    };
    this.usersMap.set(userId, profile);

    const sampleDates = [
      { date: '2026-10-27', total: 243, score: 2065.5, hourly: [28, 32, 35, 30, 31, 27, 32, 28] },
      { date: '2026-10-28', total: 268, score: 2278.0, hourly: [30, 34, 38, 33, 35, 31, 35, 32] },
      { date: '2026-10-29', total: 295, score: 2507.5, hourly: [34, 38, 42, 37, 39, 34, 37, 34] },
      { date: '2026-10-30', total: 312, score: 2652.0, hourly: [36, 40, 44, 39, 41, 36, 40, 36] },
      { date: '2026-10-31', total: 352, score: 2992.0, hourly: [42, 45, 48, 44, 46, 41, 44, 42] },
    ];

    const userReports = [];
    for (const item of sampleDates) {
      const details = [];
      const baseHour = 7;
      for (let i = 0; i < item.hourly.length; i++) {
        const hour = baseHour + i;
        const count = item.hourly[i];
        const hScore = Number((count * 8.5).toFixed(1));
        const startStr = `${item.date} ${String(hour).padStart(2, '0')}:00:00`;
        const endStr = `${item.date} ${String(hour + 1).padStart(2, '0')}:00:00`;
        details.push({
          tz: 'MA',
          hour,
          start: startStr,
          end: endStr,
          taskType: 'Clinical | 2D Validation',
          finished: count,
          score: hScore,
        });
      }

      const rep = {
        date: item.date,
        casesFinished: item.total,
        individualScore: item.score,
        cases2D: item.total,
        cases3D: 0,
        taskBreakdown: { 'Clinical | 2D Validation': item.total },
        details,
        metadata: {
          operator: 'Debjit Sadhukhan',
          shift: 'MA - clinical - 1',
          taskType: 'Clinical | 2D Validation',
          cases2D: item.total,
          cases3D: 0,
          taskBreakdown: { 'Clinical | 2D Validation': item.total },
          goalScoreIndividual: 3000,
          shiftScore: Math.round(item.score * 0.95),
          siteScore: Math.round(item.score * 0.98),
          globalScore: 2180,
          scoreBreakdown: item.score,
          sourceExportedAt: `${item.date} 15:30 GMT`,
          lastRefreshText: `Last refresh was ${item.date} 15:30:00`,
        },
        records: [],
        sha256: `hash-${item.date}`,
        sourceFileId: `file-${item.date}`,
        sourceFileName: `daily-report-${item.date}.pdf`,
        ingestedAt: `${item.date}T15:35:00.000Z`,
        hasConflict: false,
        conflictResolved: false,
      };
      userReports.push(rep);

      const fileKey = `${userId}:file-${item.date}`;
      this.filesMap.set(fileKey, {
        id: `file-${item.date}`,
        name: `daily-report-${item.date}.pdf`,
        status: 'archived',
        at: `${item.date}T15:35:00.000Z`,
        error: '',
      });
    }
    this.reportsMap.set(userId, userReports);
  }

  async putOauthState(state, codeVerifier, returnTo = '/') {
    this.oauthStatesMap.set(state, { state, codeVerifier, returnTo, createdAt: Date.now() });
  }

  async consumeOauthState(state) {
    const data = this.oauthStatesMap.get(state);
    this.oauthStatesMap.delete(state);
    return data || null;
  }

  async cleanExpiredOauthStates(maxAgeMs = 10 * 60 * 1000) {
    const now = Date.now();
    for (const [key, val] of this.oauthStatesMap) {
      if (now - val.createdAt > maxAgeMs) this.oauthStatesMap.delete(key);
    }
  }

  async createSession(userId) {
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(24).toString('base64url');
    this.sessionsMap.set(digest(token), { userId, csrf, expiresAt: Date.now() + 30 * 86400000 });
    return { token, csrf };
  }

  async session(token) {
    if (!token) return null;
    const s = this.sessionsMap.get(digest(token));
    if (!s || s.expiresAt < Date.now()) return null;
    return s;
  }

  async getSession(token) {
    return this.session(token);
  }

  async putSession(token, userId, maxAgeSeconds = 30 * 86400) {
    const csrf = randomBytes(24).toString('base64url');
    this.sessionsMap.set(digest(token), { userId, csrf, expiresAt: Date.now() + maxAgeSeconds * 1000 });
  }

  async deleteSession(token) { if (token) this.sessionsMap.delete(digest(token)); }

  async upsertUser(id, profile, refreshToken) {
    const existing = this.usersMap.get(id) || {};
    this.usersMap.set(id, {
      ...existing,
      id,
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
      refreshToken: refreshToken || existing.refreshToken || '',
      updatedAt: new Date().toISOString()
    });
  }

  async dueUsers(limit = 20) {
    return [];
  }

  async cleanupExpired(limit = 100) {
    const now = Date.now();
    for (const [key, val] of this.oauthStatesMap) {
      if (val.expiresAt && val.expiresAt < now) this.oauthStatesMap.delete(key);
    }
    for (const [key, val] of this.sessionsMap) {
      if (val.expiresAt && val.expiresAt < now) this.sessionsMap.delete(key);
    }
  }

  async getUser(userId) {
    return this.usersMap.get(userId) || null;
  }

  async putUser(userId, profile) {
    const existing = this.usersMap.get(userId) || {};
    this.usersMap.set(userId, { ...existing, ...profile });
  }

  async updateUserName(userId, name) {
    const u = this.usersMap.get(userId) || {};
    u.name = name;
    this.usersMap.set(userId, u);
  }

  async setOnboarded(userId, flags = {}) {
    const u = this.usersMap.get(userId) || {};
    if (flags.termsAccepted) u.termsAcceptedAt = new Date().toISOString();
    if (flags.completed) u.onboardedAt = new Date().toISOString();
    if (flags.name) u.name = flags.name;
    this.usersMap.set(userId, u);
  }

  async setFolder(userId, folderOrId, folderName) {
    const u = this.usersMap.get(userId) || {};
    if (typeof folderOrId === 'object' && folderOrId !== null) {
      u.folderId = folderOrId.id;
      u.folderName = folderOrId.name;
    } else {
      u.folderId = folderOrId;
      u.folderName = folderName || folderOrId;
    }
    this.usersMap.set(userId, u);
  }

  async setSchedule(userId, minutes) {
    const u = this.usersMap.get(userId) || {};
    u.scheduleMinutes = minutes;
    this.usersMap.set(userId, u);
  }

  async stopSync(userId) {
    const u = this.usersMap.get(userId) || {};
    delete u.refreshToken;
    delete u.folderId;
    delete u.folderName;
    delete u.nextScanAt;
    u.scanLeaseUntil = 0;
    this.usersMap.set(userId, u);
  }

  async deleteAllUserData(userId) {
    this.usersMap.delete(userId);
    this.reportsMap.delete(userId);
    this.notesMap.delete(userId);
    for (const [key] of this.filesMap) {
      if (key.startsWith(`${userId}:`)) this.filesMap.delete(key);
    }
    for (const [hash, sess] of this.sessionsMap) {
      if (sess.userId === userId) this.sessionsMap.delete(hash);
    }
  }

  async claimScan(userId) {
    const u = this.usersMap.get(userId);
    if (!u?.folderId) throw new Error('Choose a Google Drive folder first.');
    if (u.scanLeaseUntil > Date.now()) return false;
    u.scanLeaseUntil = Date.now() + 10 * 60000;
    return true;
  }

  async finishScan(userId, result, error = '') {
    const u = this.usersMap.get(userId) || {};
    u.lastScanAt = new Date().toISOString();
    u.lastScanResult = result;
    u.lastScanError = error;
    u.scanLeaseUntil = 0;
    const mins = u.scheduleMinutes || 1440;
    u.nextScanAt = Date.now() + mins * 60000;
    this.usersMap.set(userId, u);
  }

  async getFile(userId, fileId) {
    return this.filesMap.get(`${userId}:${fileId}`) || null;
  }

  async saveReport(userId, file, parsed) {
    const reports = this.reportsMap.get(userId) || [];
    reports.unshift(parsed);
    this.reportsMap.set(userId, reports);
  }

  async markArchived(userId, fileId, archivedAt, fileName = '') {
    this.filesMap.set(`${userId}:${fileId}`, { status: 'archived', archivedAt, at: archivedAt, name: fileName, error: '' });
  }

  async markIgnored(userId, fileId, ignoredAt, fileName = '') {
    this.filesMap.set(`${userId}:${fileId}`, { status: 'ignored', ignoredAt, at: ignoredAt, name: fileName, error: '' });
  }

  async recordFileError(userId, fileId, error, at, fileName = '') {
    this.filesMap.set(`${userId}:${fileId}`, { status: 'error', error, errorAt: at, at, name: fileName });
  }

  async reports(userId, limit = 100) {
    const list = this.reportsMap.get(userId) || [];
    return list.slice(0, limit);
  }

  async getImportStats(userId) {
    const user = this.usersMap.get(userId) || {};
    const defaultLocation = user.folderName ? `${user.folderName} / archive` : 'archive';
    const reps = this.reportsMap.get(userId) || [];
    const recentImports = reps.slice(0, 5).map(r => ({
      id: r.sourceFileId,
      date: r.date,
      fileName: r.sourceFileName,
      when: r.ingestedAt,
      location: defaultLocation,
      casesFinished: r.casesFinished,
      individualScore: r.individualScore,
      status: 'success',
      error: '',
    }));
    return {
      totalSuccessful: reps.length,
      totalErrors: 0,
      recentImports,
    };
  }

  async getNotes(userId) {
    const userNotes = this.notesMap.get(userId) || {};
    return { ...userNotes };
  }

  async saveNote(userId, date, text) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid date format.');
    const userNotes = this.notesMap.get(userId) || {};
    const trimmed = (text || '').trim();
    if (!trimmed) {
      delete userNotes[date];
    } else {
      userNotes[date] = trimmed;
    }
    this.notesMap.set(userId, userNotes);
    return { ...userNotes };
  }

  async deleteNote(userId, date) {
    const userNotes = this.notesMap.get(userId) || {};
    delete userNotes[date];
    this.notesMap.set(userId, userNotes);
    return { ...userNotes };
  }
}
