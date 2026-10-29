import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestFolder } from '../src/drive-pipeline.mjs';

const report = { date: '2026-10-27', casesFinished: 243, individualScore: 2065.5, details: [], metadata: {}, records: [], sha256: 'abc' };
function fixtures({ failSave = false, failMove = false } = {}) {
  const state = { events: [], file: null, report: null };
  const drive = {
    async listPdfs(folder) { assert.equal(folder, 'chosen-folder'); return [{ id: 'pdf-1', name: 'report.pdf' }]; },
    async download(id) { state.events.push('download'); assert.equal(id, 'pdf-1'); return Buffer.from('pdf'); },
    async archiveFolder(folder) { state.events.push('archive-folder'); assert.equal(folder, 'chosen-folder'); return { id: 'archive-1' }; },
    async moveToArchive(id, parent, archive) { state.events.push('move'); assert.deepEqual([id, parent, archive], ['pdf-1', 'chosen-folder', 'archive-1']); if (failMove) throw new Error('move failed'); },
  };
  const store = {
    async getFile() { return state.file; },
    async saveReport(user, file, parsed) { state.events.push('save'); assert.equal(user, 'alice'); assert.equal(file.id, 'pdf-1'); assert.equal(parsed, report); if (failSave) throw new Error('save failed'); state.report = parsed; state.file = { status: 'ingested' }; },
    async markArchived() { state.events.push('mark'); state.file.status = 'archived'; },
    async markIgnored(user, fileId) { state.events.push('ignored'); state.file = { status: 'ignored' }; },
    async recordFileError() { state.events.push('error'); },
  };
  const parse = async () => { state.events.push('parse'); return report; };
  return { state, drive, store, parse };
}

test('stores a parsed report before moving its PDF, and skips archived files', async () => {
  const fixture = fixtures();
  const args = { userId: 'alice', folderId: 'chosen-folder', ...fixture };
  const first = await ingestFolder(args);
  assert.equal(first.imported, 1);
  assert.equal(first.archived, 1);
  assert.deepEqual(fixture.state.events, ['download', 'parse', 'save', 'archive-folder', 'move', 'mark']);
  fixture.state.events.length = 0;
  const second = await ingestFolder(args);
  assert.equal(second.skipped, 1);
  assert.deepEqual(fixture.state.events, []);
});

test('leaves a PDF in the chosen folder when persistence fails', async () => {
  const fixture = fixtures({ failSave: true });
  const result = await ingestFolder({ userId: 'alice', folderId: 'chosen-folder', ...fixture });
  assert.equal(result.archived, 0);
  assert.deepEqual(fixture.state.events, ['download', 'parse', 'save', 'error']);
});

test('retries an archive move without reimporting the same report', async () => {
  const fixture = fixtures({ failMove: true });
  const args = { userId: 'alice', folderId: 'chosen-folder', ...fixture };
  const first = await ingestFolder(args);
  assert.equal(first.imported, 1);
  assert.equal(first.archived, 0);
  assert.equal(fixture.state.file.status, 'ingested');
  fixture.state.events.length = 0;
  fixture.drive.moveToArchive = async () => { fixture.state.events.push('move'); };
  const second = await ingestFolder(args);
  assert.equal(second.imported, 0);
  assert.equal(second.archived, 1);
  assert.deepEqual(fixture.state.events, ['archive-folder', 'move', 'mark']);
});

test('ignores other types of PDFs in the Drive folder without taking them into account or logging errors', async () => {
  const fixture = fixtures();
  // Simulate parsing an unrelated PDF (e.g. invoice, resume, arbitrary document)
  fixture.parse = async () => {
    throw new Error('Daily Report Date is missing or uses an unsupported format.');
  };
  const args = { userId: 'alice', folderId: 'chosen-folder', ...fixture };

  const res = await ingestFolder(args);
  // Other types of PDFs must not be imported, archived, or counted as errors
  assert.equal(res.imported, 0);
  assert.equal(res.archived, 0);
  assert.equal(res.skipped, 1);
  assert.equal(res.errors.length, 0);
  assert.deepEqual(fixture.state.events, ['download', 'ignored']);

  // On second scan, the ignored file is skipped immediately without re-downloading
  fixture.state.events.length = 0;
  const second = await ingestFolder(args);
  assert.equal(second.skipped, 1);
  assert.deepEqual(fixture.state.events, []);
});

test('accepts valid daily report format while ignoring an unrelated PDF alongside it in the same folder', async () => {
  const state = { events: [] };
  const filesMap = new Map();
  const drive = {
    async listPdfs(folder) {
      return [
        { id: 'valid-report-1', name: 'Report_2026-10-27.pdf', modifiedTime: '2026-10-27T10:00:00Z' },
        { id: 'unrelated-doc-2', name: 'Vendor_Invoice.pdf', modifiedTime: '2026-10-27T10:00:00Z' }
      ];
    },
    async download(id) {
      state.events.push(`download:${id}`);
      return Buffer.from(id);
    },
    async archiveFolder(folder) {
      return { id: 'archive-folder-id' };
    },
    async moveToArchive(id, parent, archive) {
      state.events.push(`archive:${id}`);
    }
  };
  const store = {
    async getFile(user, fileId) {
      return filesMap.get(fileId) || null;
    },
    async saveReport(user, file, rep) {
      state.events.push(`save:${file.id}`);
      filesMap.set(file.id, { status: 'ingested', modifiedTime: file.modifiedTime });
    },
    async markArchived(user, fileId) {
      state.events.push(`markArchived:${fileId}`);
      filesMap.set(fileId, { status: 'archived', modifiedTime: '2026-10-27T10:00:00Z' });
    },
    async markIgnored(user, fileId) {
      state.events.push(`markIgnored:${fileId}`);
      filesMap.set(fileId, { status: 'ignored', modifiedTime: '2026-10-27T10:00:00Z' });
    },
    async recordFileError(user, fileId, msg) {
      state.events.push(`error:${fileId}`);
    }
  };
  const parse = async (buffer) => {
    const id = buffer.toString();
    if (id === 'valid-report-1') {
      return report;
    }
    throw new Error('Daily Report Date is missing or uses an unsupported format.');
  };

  const res = await ingestFolder({ userId: 'alice', folderId: 'chosen-folder', drive, store, parse });
  assert.equal(res.checked, 2);
  assert.equal(res.imported, 1);
  assert.equal(res.archived, 1);
  assert.equal(res.skipped, 1);
  assert.equal(res.errors.length, 0);

  // The valid report is downloaded, saved, and archived
  // The unrelated doc is downloaded and ignored without being archived or causing errors
  assert.ok(state.events.includes('download:valid-report-1'));
  assert.ok(state.events.includes('save:valid-report-1'));
  assert.ok(state.events.includes('archive:valid-report-1'));
  assert.ok(state.events.includes('markIgnored:unrelated-doc-2'));
  assert.ok(!state.events.includes('archive:unrelated-doc-2'));
  assert.ok(!state.events.includes('error:unrelated-doc-2'));
});
