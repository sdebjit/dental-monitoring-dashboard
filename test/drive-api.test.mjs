import test from 'node:test';
import assert from 'node:assert/strict';
import { DriveApi } from '../src/drive-api.mjs';

test('DriveApi handles request authentication, custom headers, and error responses', async () => {
  let requestedUrl = '';
  let requestedHeaders = {};

  const mockFetcher = async (url, options = {}) => {
    requestedUrl = url.toString();
    requestedHeaders = options.headers || {};
    if (requestedUrl.includes('error-trigger')) {
      return {
        ok: false,
        status: 403,
        text: async () => 'Rate limit exceeded or permission denied.'
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok' }),
      text: async () => JSON.stringify({ status: 'ok' })
    };
  };

  const api = new DriveApi('test-token-123', mockFetcher);
  const res = await api.request('https://www.googleapis.com/drive/v3/files/sample', {
    headers: { 'X-Custom-Header': 'custom-val' }
  });
  assert.equal(res.status, 200);
  assert.equal(requestedHeaders.Authorization, 'Bearer test-token-123');
  assert.equal(requestedHeaders['X-Custom-Header'], 'custom-val');

  const jsonRes = await api.json('https://www.googleapis.com/drive/v3/files/sample');
  assert.deepEqual(jsonRes, { status: 'ok' });

  // Error branch
  await assert.rejects(
    async () => api.request('https://www.googleapis.com/drive/v3/files/error-trigger'),
    /Google Drive 403: Rate limit exceeded/
  );
});

test('DriveApi.list handles single-page, multi-page pagination, and maxResults limits', async () => {
  let callCount = 0;
  const mockFetcher = async (url) => {
    callCount++;
    const u = new URL(url);
    const pageToken = u.searchParams.get('pageToken');

    if (!pageToken) {
      return {
        ok: true,
        json: async () => ({
          files: [{ id: 'f1', name: 'File 1' }, { id: 'f2', name: 'File 2' }],
          nextPageToken: 'page-token-2'
        })
      };
    }
    if (pageToken === 'page-token-2') {
      return {
        ok: true,
        json: async () => ({
          files: [{ id: 'f3', name: 'File 3' }, { id: 'f4', name: 'File 4' }],
          nextPageToken: 'page-token-3'
        })
      };
    }
    return {
      ok: true,
      json: async () => ({
        files: [{ id: 'f5', name: 'File 5' }]
      })
    };
  };

  const api = new DriveApi('token-abc', mockFetcher);

  // Test full pagination without limit
  callCount = 0;
  const allFiles = await api.list('trashed = false', 'files(id,name)', 2, Infinity, 'name asc');
  assert.equal(allFiles.length, 5);
  assert.equal(callCount, 3);

  // Test maxResults limit early return
  callCount = 0;
  const limitedFiles = await api.list('trashed = false', 'files(id,name)', 2, 3);
  assert.equal(limitedFiles.length, 3);
  assert.deepEqual(limitedFiles.map(f => f.id), ['f1', 'f2', 'f3']);
});

test('DriveApi.listFolders handles root folders, shared folders, errors, and custom parent IDs', async () => {
  let failSharedQuery = false;

  const mockFetcher = async (url) => {
    const u = new URL(url);
    const q = u.searchParams.get('q') || '';

    if (q.includes('sharedWithMe = true')) {
      if (failSharedQuery) {
        return {
          ok: false,
          status: 400,
          text: async () => 'sharedWithMe invalid query'
        };
      }
      return {
        ok: true,
        json: async () => ({
          files: [
            { id: 'f-shared-1', name: 'Shared Team Folder', mimeType: 'application/vnd.google-apps.folder' },
            { id: 'f-root-1', name: 'Duplicate Root Folder', mimeType: 'application/vnd.google-apps.folder' } // Should not overwrite root
          ]
        })
      };
    }

    if (q.includes("'root' in parents")) {
      return {
        ok: true,
        json: async () => ({
          files: [
            { id: 'f-root-1', name: 'Alpha Root Folder', mimeType: 'application/vnd.google-apps.folder' },
            { id: 'f-root-2', name: 'Beta Root Folder', mimeType: 'application/vnd.google-apps.folder' }
          ]
        })
      };
    }

    if (q.includes("'custom-parent-123' in parents")) {
      return {
        ok: true,
        json: async () => ({
          files: [
            { id: 'f-sub-1', name: 'Sub Folder 1', mimeType: 'application/vnd.google-apps.folder' }
          ]
        })
      };
    }

    if (q.includes("'custom-parent-123\\'s folder' in parents")) {
      return {
        ok: true,
        json: async () => ({
          files: [
            { id: 'f-sub-escaped', name: "Escaped Sub Folder", mimeType: 'application/vnd.google-apps.folder' }
          ]
        })
      };
    }

    return { ok: true, json: async () => ({ files: [] }) };
  };

  const api = new DriveApi('token-abc', mockFetcher);

  // Case 1: parentId = 'root' (default)
  const rootFolders = await api.listFolders();
  assert.equal(rootFolders.length, 3);
  assert.equal(rootFolders[0].name, 'Alpha Root Folder');
  assert.equal(rootFolders[1].name, 'Beta Root Folder');
  assert.equal(rootFolders[2].name, 'Shared Team Folder');
  assert.equal(rootFolders[2].isShared, true);

  // Case 2: parentId passed as a number (e.g. maxFolders overload)
  const numericFolders = await api.listFolders(100);
  assert.equal(numericFolders.length, 3);

  // Case 3: sharedWithMe query failure gracefully ignored
  failSharedQuery = true;
  const resilientFolders = await api.listFolders('root');
  assert.equal(resilientFolders.length, 2);
  failSharedQuery = false;

  // Case 4: Specific parentId with query escaping
  const subFolders = await api.listFolders("custom-parent-123's folder");
  assert.equal(subFolders.length, 1);
  assert.equal(subFolders[0].id, 'f-sub-escaped');

  const exactSubFolders = await api.listFolders('custom-parent-123');
  assert.equal(exactSubFolders.length, 1);
  assert.equal(exactSubFolders[0].id, 'f-sub-1');
});

test('DriveApi.getFolder validates mimeType, trashed status, and canAddChildren capability', async () => {
  const mockFetcher = async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/valid-folder')) {
      return {
        ok: true,
        json: async () => ({
          id: 'valid-folder',
          name: 'Valid Clinical Reports',
          mimeType: 'application/vnd.google-apps.folder',
          trashed: false,
          capabilities: { canAddChildren: true }
        })
      };
    }
    if (u.pathname.endsWith('/trashed-folder')) {
      return {
        ok: true,
        json: async () => ({
          id: 'trashed-folder',
          name: 'Trashed Folder',
          mimeType: 'application/vnd.google-apps.folder',
          trashed: true,
          capabilities: { canAddChildren: true }
        })
      };
    }
    if (u.pathname.endsWith('/not-a-folder')) {
      return {
        ok: true,
        json: async () => ({
          id: 'not-a-folder',
          name: 'Document.pdf',
          mimeType: 'application/pdf',
          trashed: false,
          capabilities: { canAddChildren: true }
        })
      };
    }
    if (u.pathname.endsWith('/readonly-folder')) {
      return {
        ok: true,
        json: async () => ({
          id: 'readonly-folder',
          name: 'Readonly Folder',
          mimeType: 'application/vnd.google-apps.folder',
          trashed: false,
          capabilities: { canAddChildren: false }
        })
      };
    }
    return { ok: false, status: 404, text: async () => 'Not found' };
  };

  const api = new DriveApi('token-abc', mockFetcher);

  const folder = await api.getFolder('valid-folder');
  assert.equal(folder.id, 'valid-folder');
  assert.equal(folder.name, 'Valid Clinical Reports');

  await assert.rejects(async () => api.getFolder('trashed-folder'), /Select a Google Drive folder where you can add files/);
  await assert.rejects(async () => api.getFolder('not-a-folder'), /Select a Google Drive folder where you can add files/);
  await assert.rejects(async () => api.getFolder('readonly-folder'), /Select a Google Drive folder where you can add files/);
});

test('DriveApi.listPdfs lists PDFs and enforces the 1,000 files limit', async () => {
  let fileCount = 5;
  const mockFetcher = async () => ({
    ok: true,
    json: async () => ({
      files: Array.from({ length: fileCount }, (_, i) => ({ id: `pdf-${i}`, name: `report-${i}.pdf`, mimeType: 'application/pdf' }))
    })
  });

  const api = new DriveApi('token-abc', mockFetcher);

  const files = await api.listPdfs('folder-1');
  assert.equal(files.length, 5);

  fileCount = 1005;
  await assert.rejects(
    async () => api.listPdfs('folder-overflow'),
    /Folder has more than 1,000 pending files/
  );
});

test('DriveApi.download streams chunks, handles content-length checks, and 20 MiB streaming limits', async () => {
  const mockFetcher = async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/oversized-header')) {
      return {
        ok: true,
        headers: new Headers({ 'content-length': String(25 * 1024 * 1024) }),
        body: (async function* () { yield Buffer.from('chunk'); })()
      };
    }
    if (u.pathname.endsWith('/oversized-stream')) {
      let cancelled = false;
      const stream = {
        async *[Symbol.asyncIterator]() {
          yield Buffer.alloc(15 * 1024 * 1024);
          yield Buffer.alloc(10 * 1024 * 1024); // Exceeds 20 MiB
        },
        async cancel() {
          cancelled = true;
        }
      };
      return {
        ok: true,
        headers: new Headers({}),
        body: stream
      };
    }
    if (u.pathname.endsWith('/oversized-stream-reject-cancel')) {
      const stream = {
        async *[Symbol.asyncIterator]() {
          yield Buffer.alloc(15 * 1024 * 1024);
          yield Buffer.alloc(10 * 1024 * 1024);
        },
        async cancel() {
          throw new Error('Cancel stream failure');
        }
      };
      return { ok: true, headers: new Headers({}), body: stream };
    }
    // Normal valid PDF download
    const chunk1 = Buffer.from('%PDF-1.4\n1 0 obj\n');
    const chunk2 = Buffer.from('<< /Type /Catalog >>\nendobj\n%%EOF\n');
    return {
      ok: true,
      headers: new Headers({ 'content-length': String(chunk1.length + chunk2.length) }),
      body: (async function* () {
        yield chunk1;
        yield chunk2;
      })()
    };
  };

  const api = new DriveApi('token-abc', mockFetcher);

  // Normal download
  const buffer = await api.download('valid-file-id');
  assert.ok(buffer.toString().startsWith('%PDF-1.4'));

  // Content-length > 20 MiB header check
  await assert.rejects(
    async () => api.download('oversized-header'),
    /PDF exceeds the 20 MiB limit/
  );

  // Stream size accumulation > 20 MiB
  await assert.rejects(
    async () => api.download('oversized-stream'),
    /PDF exceeds the 20 MiB limit/
  );

  // Stream size accumulation > 20 MiB when cancel() rejects
  await assert.rejects(
    async () => api.download('oversized-stream-reject-cancel'),
    /PDF exceeds the 20 MiB limit/
  );

  // Default fetcher parameter
  const defaultApi = new DriveApi('default-tok');
  assert.equal(defaultApi.fetcher, fetch);
});

test('DriveApi.archiveFolder finds existing archive or creates new archive folder', async () => {
  let createdPayload = null;
  const mockFetcher = async (url, options = {}) => {
    const u = new URL(url);
    if (options.method === 'POST') {
      createdPayload = JSON.parse(options.body || '{}');
      return {
        ok: true,
        json: async () => ({ id: 'new-archive-id', name: createdPayload.name, parents: createdPayload.parents })
      };
    }
    const q = u.searchParams.get('q') || '';
    if (q.includes('existing-parent')) {
      return {
        ok: true,
        json: async () => ({ files: [{ id: 'existing-archive-id', name: 'archive' }] })
      };
    }
    return { ok: true, json: async () => ({ files: [] }) };
  };

  const api = new DriveApi('token-abc', mockFetcher);

  // Existing archive folder
  const existing = await api.archiveFolder('existing-parent');
  assert.equal(existing.id, 'existing-archive-id');

  // Create new archive folder
  const created = await api.archiveFolder('new-parent');
  assert.equal(created.id, 'new-archive-id');
  assert.equal(createdPayload.name, 'archive');
  assert.deepEqual(createdPayload.parents, ['new-parent']);
});

test('DriveApi.moveToArchive patches file parents to move to archive', async () => {
  let patchMethod = '';
  let patchedUrl = '';

  const mockFetcher = async (url, options = {}) => {
    patchMethod = options.method || 'GET';
    patchedUrl = url.toString();
    return {
      ok: true,
      json: async () => ({ id: 'file-100', parents: ['archive-123'] })
    };
  };

  const api = new DriveApi('token-abc', mockFetcher);
  const result = await api.moveToArchive('file-100', 'parent-source', 'archive-123');

  assert.equal(patchMethod, 'PATCH');
  assert.ok(patchedUrl.includes('addParents=archive-123'));
  assert.ok(patchedUrl.includes('removeParents=parent-source'));
  assert.equal(result.id, 'file-100');
});
