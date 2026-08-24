import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { validateReleaseArtifacts } from '../scripts/release-artifacts.mjs';

const tempDirs: string[] = [];

const VERSION = '1.2.3';
const USERSCRIPT = `// ==UserScript==
// @name         KM Acompanhamento
// @namespace    http://tampermonkey.net/
// @version      ${VERSION}
// @downloadURL  https://ysraestudos.github.io/km-sin-sidebar-userscript/releases/${VERSION}/sin-inline.user.js
// @updateURL    https://ysraestudos.github.io/km-sin-sidebar-userscript/sin-inline.meta.js
// ==/UserScript==

console.log('ok');
`;

async function createFixture() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'km-release-'));
  tempDirs.push(rootDir);

  const distDir = path.join(rootDir, 'dist');
  const releaseDir = path.join(distDir, 'releases', VERSION);
  const publishReleaseDir = path.join(rootDir, 'releases', VERSION);
  const meta = `${USERSCRIPT.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/)?.[0]}\n`;
  const sha256 = createHash('sha256').update(USERSCRIPT).digest('hex');
  const latest = `${JSON.stringify({
    version: VERSION,
    installUrl: 'https://ysraestudos.github.io/km-sin-sidebar-userscript/sin-inline.user.js',
    updateUrl: 'https://ysraestudos.github.io/km-sin-sidebar-userscript/sin-inline.meta.js',
    downloadUrl: `https://ysraestudos.github.io/km-sin-sidebar-userscript/releases/${VERSION}/sin-inline.user.js`,
    sha256
  }, null, 2)}\n`;
  const checksum = `${sha256}  sin-inline.user.js\n`;

  await fs.mkdir(releaseDir, { recursive: true });
  await fs.mkdir(publishReleaseDir, { recursive: true });
  await fs.writeFile(path.join(distDir, 'sin-inline.user.js'), USERSCRIPT, 'utf8');
  await fs.writeFile(path.join(distDir, 'sin-inline.meta.js'), meta, 'utf8');
  await fs.writeFile(path.join(distDir, 'latest.json'), latest, 'utf8');
  await fs.writeFile(path.join(releaseDir, 'sin-inline.user.js'), USERSCRIPT, 'utf8');
  await fs.writeFile(path.join(releaseDir, 'SHA256SUMS.txt'), checksum, 'utf8');
  await fs.writeFile(path.join(rootDir, 'sin-inline.user.js'), USERSCRIPT, 'utf8');
  await fs.writeFile(path.join(rootDir, 'sin-inline.meta.js'), meta, 'utf8');
  await fs.writeFile(path.join(rootDir, 'latest.json'), latest, 'utf8');
  await fs.writeFile(path.join(publishReleaseDir, 'sin-inline.user.js'), USERSCRIPT, 'utf8');
  await fs.writeFile(path.join(publishReleaseDir, 'SHA256SUMS.txt'), checksum, 'utf8');

  return rootDir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('release artifact validation', () => {
  it('accepts a fully consistent userscript release set', async () => {
    const rootDir = await createFixture();

    await expect(validateReleaseArtifacts({ projectDir: rootDir })).resolves.toEqual({
      version: VERSION,
      sha256: createHash('sha256').update(USERSCRIPT).digest('hex')
    });
  });

  it('rejects latest.json when the versioned download URL drifts', async () => {
    const rootDir = await createFixture();
    const latestPath = path.join(rootDir, 'latest.json');
    const latest = JSON.parse(await fs.readFile(latestPath, 'utf8'));
    latest.downloadUrl = 'https://ysraestudos.github.io/km-sin-sidebar-userscript/releases/9.9.9/sin-inline.user.js';
    await fs.writeFile(latestPath, `${JSON.stringify(latest, null, 2)}\n`, 'utf8');

    await expect(validateReleaseArtifacts({ projectDir: rootDir })).rejects.toThrow(/downloadUrl/i);
  });
});
