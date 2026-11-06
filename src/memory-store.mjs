import { createHash, randomBytes } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');

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
    if (!data) return null;
    return typeof data === 'object' ? (data.codeVerifier || data.verifier || '') : data;
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

  async resolveDuplicateReport(userId, date, keepVersionId) {
    const userReports = this.reportsMap.get(userId) || [];
    for (const r of userReports) {
      if (r.date === date) {
        r.hasConflict = false;
        r.conflictResolved = true;
        r.activeVersion = keepVersionId;
      }
    }
    this.reportsMap.set(userId, userReports);
    return userReports.find(r => r.date === date && (r.sourceFileId === keepVersionId || r.sha256 === keepVersionId)) || userReports.find(r => r.date === date);
  }
}
