import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';

const distDir = path.resolve('dist');
const publishDir = path.resolve('.');
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
const publishReleaseDir = path.join(publishDir, 'releases', version);
const publishScriptPath = path.join(publishDir, 'sin-inline.user.js');
const publishMetaPath = path.join(publishDir, 'sin-inline.meta.js');
const publishLatestManifestPath = path.join(publishDir, 'latest.json');
const publishReleaseScriptPath = path.join(publishReleaseDir, 'sin-inline.user.js');
const publishReleaseChecksumPath = path.join(publishReleaseDir, 'SHA256SUMS.txt');
const latestManifest = `${JSON.stringify({
  version,
  installUrl: 'https://ysraestudos.github.io/km-sin-sidebar-userscript/sin-inline.user.js',
  updateUrl: 'https://ysraestudos.github.io/km-sin-sidebar-userscript/sin-inline.meta.js',
  downloadUrl: `https://ysraestudos.github.io/km-sin-sidebar-userscript/releases/${version}/sin-inline.user.js`,
  sha256
}, null, 2)}\n`;
const checksumContents = `${sha256}  sin-inline.user.js\n`;
const metaContents = `${metaBlockMatch[0]}\n`;

await mkdir(releaseDir, { recursive: true });
await mkdir(publishReleaseDir, { recursive: true });
await copyFile(userscriptPath, releaseScriptPath);
await copyFile(userscriptPath, publishScriptPath);
await copyFile(userscriptPath, publishReleaseScriptPath);
await writeFile(metaPath, metaContents, 'utf8');
await writeFile(publishMetaPath, metaContents, 'utf8');
await writeFile(releaseChecksumPath, checksumContents, 'utf8');
await writeFile(publishReleaseChecksumPath, checksumContents, 'utf8');
await writeFile(latestManifestPath, latestManifest, 'utf8');
await writeFile(publishLatestManifestPath, latestManifest, 'utf8');
