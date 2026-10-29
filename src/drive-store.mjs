import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Firestore, FieldValue } from '@google-cloud/firestore';

const digest = value => createHash('sha256').update(value).digest('hex');

export class DriveStore {
  constructor({ db = new Firestore(), encryptionKey }) {
    if (!/^[a-f0-9]{64}$/i.test(encryptionKey || '')) throw new Error('DAYBOOK_ENCRYPTION_KEY must be 32 bytes as 64 hex characters.');
    this.db = db;
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
    await ref.set({ email: profile.email, name: profile.name || profile.email, picture: profile.picture || '', refreshToken: token, scheduleMinutes: Math.max(existing.scheduleMinutes ?? 1440, 1440), folderId: existing.folderId || null, folderName: existing.folderName || '', nextScanAt: existing.nextScanAt ?? null, updatedAt: new Date().toISOString() }, { merge: true });
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
  async setSchedule(userId, minutes) {
    const user = await this.getUser(userId);
    await this.user(userId).set({ scheduleMinutes: minutes, nextScanAt: user?.folderId ? Date.now() + minutes * 60000 : null }, { merge: true });
  }
  async stopSync(userId) {
    await this.user(userId).update({ refreshToken: FieldValue.delete(), folderId: FieldValue.delete(), folderName: FieldValue.delete(), nextScanAt: FieldValue.delete(), scanLeaseUntil: 0 });
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
    await this.user(userId).set({ scanLeaseUntil: 0, lastScanAt: new Date().toISOString(), lastScanResult: result, lastScanError: error, nextScanAt: Date.now() + Math.max(user?.scheduleMinutes ?? 1440, 1440) * 60000 }, { merge: true });
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
    const batch = this.db.batch();
    batch.set(this.user(userId).collection('reports').doc(report.date), {
      date: report.date, casesFinished: report.casesFinished, individualScore: report.individualScore,
      details: report.details, metadata: report.metadata, records: report.records,
      sha256: report.sha256, sourceFileId: file.id, sourceFileName: file.name, ingestedAt,
    });
    batch.set(this.file(userId, file.id), { status: 'ingested', date: report.date, sha256: report.sha256, name: file.name, modifiedTime: file.modifiedTime || null, ingestedAt, error: '' });
    await batch.commit();
  }
  async markArchived(userId, fileId, archivedAt) { await this.file(userId, fileId).set({ status: 'archived', archivedAt, error: '' }, { merge: true }); }
  async recordFileError(userId, fileId, error, at) { await this.file(userId, fileId).set({ error, errorAt: at }, { merge: true }); }
  async reports(userId, limit = 100) {
    const rows = await this.user(userId).collection('reports').orderBy('date', 'desc').limit(limit).get();
    return rows.docs.map(doc => doc.data());
  }
}
