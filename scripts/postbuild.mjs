import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';

const distDir = path.resolve('dist');
const userscriptPath = path.join(distDir, 'sin-inline.user.js');
const userscriptSource = await readFile(userscriptPath, 'utf8');
const userscriptBuffer = await readFile(userscriptPath);

const versionMatch = userscriptSource.match(/^\/\/ @version\s+(.+)$/m);
if (!versionMatch?.[1]) {
  throw new Error('Nao foi possivel identificar a versao do userscript em dist/sin-inline.user.js.');
}

const version = versionMatch[1].trim();
const metaBlockMatch = userscriptSource.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/);
if (!metaBlockMatch?.[0]) {
  throw new Error('Nao foi possivel extrair o bloco de metadata do userscript.');
}

const sha256 = createHash('sha256').update(userscriptBuffer).digest('hex');
const releaseDir = path.join(distDir, 'releases', version);
const releaseScriptPath = path.join(releaseDir, 'sin-inline.user.js');
const releaseChecksumPath = path.join(releaseDir, 'SHA256SUMS.txt');
const latestManifestPath = path.join(distDir, 'latest.json');
const metaPath = path.join(distDir, 'sin-inline.meta.js');

await mkdir(releaseDir, { recursive: true });
await copyFile(userscriptPath, releaseScriptPath);
await writeFile(metaPath, `${metaBlockMatch[0]}\n`, 'utf8');
await writeFile(releaseChecksumPath, `${sha256}  sin-inline.user.js\n`, 'utf8');
await writeFile(latestManifestPath, `${JSON.stringify({
  version,
  installUrl: 'https://ysraestudos.github.io/km-sin-sidebar-userscript/sin-inline.user.js',
  updateUrl: 'https://ysraestudos.github.io/km-sin-sidebar-userscript/sin-inline.meta.js',
  downloadUrl: `https://ysraestudos.github.io/km-sin-sidebar-userscript/releases/${version}/sin-inline.user.js`,
  sha256
}, null, 2)}\n`, 'utf8');
