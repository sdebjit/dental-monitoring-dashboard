import { parseDashboardPdf } from './pdf-report.mjs';

export async function ingestFolder({ userId, folderId, drive, store, parse = parseDashboardPdf, now = () => new Date() }) {
  const files = await drive.listPdfs(folderId);
  const result = { checked: files.length, imported: 0, archived: 0, skipped: 0, errors: [] };
  let archive;
  for (const file of files) {
    try {
      const previous = await store.getFile(userId, file.id);
      const sameVersion = previous?.modifiedTime === file.modifiedTime;
      if (sameVersion && previous?.status === 'archived') { result.skipped++; continue; }
      if (!sameVersion || previous?.status !== 'ingested') {
        const report = await parse(await drive.download(file.id));
        await store.saveReport(userId, file, report, now().toISOString());
        result.imported++;
      }
      archive ||= await drive.archiveFolder(folderId);
      await drive.moveToArchive(file.id, folderId, archive.id);
      await store.markArchived(userId, file.id, now().toISOString());
      result.archived++;
    } catch (error) {
      result.errors.push({ file: file.name, message: error.message });
      await store.recordFileError(userId, file.id, error.message, now().toISOString()).catch(() => {});
    }
  }
  return result;
}
