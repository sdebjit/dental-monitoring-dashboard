import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
let count = 0;
for (const directory of ['src', 'public', 'scripts', 'test']) {
  for (const name of fs.readdirSync(path.join(root, directory))) {
    if (!/\.(mjs|js)$/.test(name)) continue;
    const result = spawnSync(process.execPath, ['--check', path.join(root, directory, name)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
    count++;
  }
}
console.log(`Syntax checked ${count} JavaScript files.`);
