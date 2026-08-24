import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const read = (root, relative) => fs.readFile(path.join(root, relative), 'utf8');

function metadataVersion(contents) {
  const match = contents.match(/^\/\/ @version\s+(.+)$/m);
  if (!match) throw new Error('userscript metadata is missing @version');
  return match[1].trim();
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} mismatch: expected ${expected}, received ${actual}`);
}

export async function validateReleaseArtifacts({ projectDir }) {
  const distScript = await read(projectDir, 'dist/sin-inline.user.js');
  const rootScript = await read(projectDir, 'sin-inline.user.js');
  const version = metadataVersion(distScript);
  assertEqual(metadataVersion(rootScript), version, 'root userscript version');

  const latest = JSON.parse(await read(projectDir, 'latest.json'));
  assertEqual(latest.version, version, 'latest.json version');
  const expectedDownload = `https://ysraestudos.github.io/km-sin-sidebar-userscript/releases/${version}/sin-inline.user.js`;
  assertEqual(latest.downloadUrl, expectedDownload, 'latest.json downloadUrl');

  const digest = createHash('sha256').update(distScript).digest('hex');
  assertEqual(latest.sha256, digest, 'latest.json sha256');

  const releaseFiles = [
    `dist/releases/${version}/sin-inline.user.js`,
    `releases/${version}/sin-inline.user.js`
  ];
  for (const relative of releaseFiles) {
    assertEqual(await read(projectDir, relative), distScript, relative);
  }
  for (const relative of [`dist/releases/${version}/SHA256SUMS.txt`, `releases/${version}/SHA256SUMS.txt`]) {
    assertEqual((await read(projectDir, relative)).trim(), `${digest}  sin-inline.user.js`, relative);
  }

  return { version, sha256: digest };
}
