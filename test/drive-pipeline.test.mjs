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
