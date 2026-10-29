const API = 'https://www.googleapis.com/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';
const PDF = 'application/pdf';

function escapeQuery(value) { return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

export class DriveApi {
  constructor(accessToken, fetcher = fetch) { this.token = accessToken; this.fetcher = fetcher; }
  async request(url, options = {}) {
    const response = await this.fetcher(url, { ...options, headers: { Authorization: `Bearer ${this.token}`, ...(options.headers || {}) } });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Google Drive ${response.status}: ${body.slice(0, 300)}`);
    }
    return response;
  }
  async json(url, options) { return (await this.request(url, options)).json(); }
  async list(q, fields = 'nextPageToken,files(id,name,mimeType,parents,modifiedTime,webViewLink)', pageSize = 100) {
    const files = [];
    let pageToken;
    do {
      const url = new URL(API);
      url.searchParams.set('q', q);
      url.searchParams.set('fields', fields);
      url.searchParams.set('pageSize', String(pageSize));
      url.searchParams.set('orderBy', 'modifiedTime asc');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const page = await this.json(url);
      files.push(...(page.files || []));
      pageToken = page.nextPageToken;
      if (files.length > 1000) throw new Error('Folder has more than 1,000 pending files. Process or remove some before refreshing.');
    } while (pageToken);
    return files;
  }
  async listFolders() {
    return this.list(`mimeType = '${FOLDER}' and trashed = false`, 'nextPageToken,files(id,name,mimeType,parents,webViewLink)', 1000);
  }
  async getFolder(id) {
    const url = new URL(`${API}/${encodeURIComponent(id)}`);
    url.searchParams.set('fields', 'id,name,mimeType,trashed,capabilities(canAddChildren),webViewLink');
    const folder = await this.json(url);
    if (folder.mimeType !== FOLDER || folder.trashed || !folder.capabilities?.canAddChildren) {
      throw new Error('Select a Google Drive folder where you can add files.');
    }
    return folder;
  }
  async listPdfs(folderId) {
    return this.list(`'${escapeQuery(folderId)}' in parents and mimeType = '${PDF}' and trashed = false`);
  }
  async download(fileId) {
    const url = new URL(`${API}/${encodeURIComponent(fileId)}`);
    url.searchParams.set('alt', 'media');
    const response = await this.request(url);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > 20 * 1024 * 1024) throw new Error('PDF exceeds the 20 MiB limit.');
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 20 * 1024 * 1024) {
        await response.body.cancel().catch(() => {});
        throw new Error('PDF exceeds the 20 MiB limit.');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  async archiveFolder(parentId) {
    const matches = await this.list(`'${escapeQuery(parentId)}' in parents and name = 'archive' and mimeType = '${FOLDER}' and trashed = false`);
    if (matches.length) return matches[0];
    return this.json(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'archive', mimeType: FOLDER, parents: [parentId] }) });
  }
  async moveToArchive(fileId, parentId, archiveId) {
    const url = new URL(`${API}/${encodeURIComponent(fileId)}`);
    url.searchParams.set('addParents', archiveId);
    url.searchParams.set('removeParents', parentId);
    url.searchParams.set('fields', 'id,parents');
    return this.json(url, { method: 'PATCH' });
  }
}
