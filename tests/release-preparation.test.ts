import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { prepareRelease } from '../scripts/prepare-release.mjs';
import { validateReleaseArtifacts } from '../scripts/release-artifacts.mjs';
import { buildDistArtifacts } from '../scripts/postbuild.mjs';

const tempDirs: string[] = [];
const VERSION = '1.2.3';
const USERSCRIPT = `// ==UserScript==
// @name         KM Acompanhamento
// @namespace    http://tampermonkey.net/
// @version      ${VERSION}
// @downloadURL  https://ysraestudos.github.io/Acompanhamento/releases/${VERSION}/sin-inline.user.js
// @updateURL    https://ysraestudos.github.io/Acompanhamento/sin-inline.meta.js
// @match        https://*.klassmatt.com.br/*SIN_Item_Edita.aspx*
// @match        https://*.klassmatt.com.br/*ITEM_Edita.aspx*
// @match        https://klassmatt.com.br/*SIN_Item_Edita.aspx*
// @match        https://klassmatt.com.br/*ITEM_Edita.aspx*
// @connect      *.klassmatt.com.br
// @connect      klassmatt.com.br
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// ==/UserScript==

console.log('ok');
`;

async function createFixture() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'km-prepare-'));
  tempDirs.push(rootDir);
  const distDir = path.join(rootDir, 'dist');
  const releaseDir = path.join(distDir, 'releases', VERSION);
  const meta = `${USERSCRIPT.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/)?.[0]}\n`;
  const sha256 = createHash('sha256').update(USERSCRIPT).digest('hex');
  const latest = `${JSON.stringify({
    version: VERSION,
    installUrl: 'https://ysraestudos.github.io/Acompanhamento/sin-inline.user.js',
    updateUrl: 'https://ysraestudos.github.io/Acompanhamento/sin-inline.meta.js',
    downloadUrl: `https://ysraestudos.github.io/Acompanhamento/releases/${VERSION}/sin-inline.user.js`,
    sha256
  }, null, 2)}\n`;
  const checksum = `${sha256}  sin-inline.user.js\n`;

  await fs.mkdir(releaseDir, { recursive: true });
  await fs.writeFile(path.join(distDir, 'sin-inline.user.js'), USERSCRIPT);
  await fs.writeFile(path.join(distDir, 'sin-inline.meta.js'), meta);
  await fs.writeFile(path.join(distDir, 'latest.json'), latest);
  await fs.writeFile(path.join(releaseDir, 'sin-inline.user.js'), USERSCRIPT);
  await fs.writeFile(path.join(releaseDir, 'SHA256SUMS.txt'), checksum);
  return { rootDir, sha256, latest, meta, checksum };
}

async function listFiles(rootDir: string) {
  const files = [
    'sin-inline.user.js',
    'sin-inline.meta.js',
    'latest.json',
    `releases/${VERSION}/sin-inline.user.js`,
    `releases/${VERSION}/SHA256SUMS.txt`
  ];
  const result = new Map<string, string | null>();
  for (const relative of files) {
    try {
      result.set(relative, await fs.readFile(path.join(rootDir, relative), 'utf8'));
    } catch {
      result.set(relative, null);
    }
  }
  return result;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('release preparation', () => {
  it('stages root aliases and is idempotent for an identical release', async () => {
    const { rootDir, latest, meta, sha256, checksum } = await createFixture();

    await expect(prepareRelease({ projectDir: rootDir })).resolves.toEqual({
      version: VERSION,
      sha256,
      changed: true
    });
    await expect(validateReleaseArtifacts({ projectDir: rootDir, location: 'published' })).resolves.toEqual({
      version: VERSION,
      sha256
    });
    const before = await listFiles(rootDir);

    await expect(prepareRelease({ projectDir: rootDir })).resolves.toEqual({
      version: VERSION,
      sha256,
      changed: false
    });
    expect(await listFiles(rootDir)).toEqual(before);
    expect(await fs.readFile(path.join(rootDir, 'latest.json'), 'utf8')).toBe(latest);
    expect(await fs.readFile(path.join(rootDir, 'sin-inline.meta.js'), 'utf8')).toBe(meta);
    expect(await fs.readFile(path.join(rootDir, 'releases', VERSION, 'SHA256SUMS.txt'), 'utf8')).toBe(checksum);
  });

  it('rejects a divergent existing release without changing the distribution', async () => {
    const { rootDir } = await createFixture();
    const releaseDir = path.join(rootDir, 'releases', VERSION);
    await fs.mkdir(releaseDir, { recursive: true });
    await fs.writeFile(path.join(releaseDir, 'sin-inline.user.js'), 'different');
    await fs.writeFile(path.join(releaseDir, 'SHA256SUMS.txt'), 'different');
    const before = await listFiles(rootDir);

    await expect(prepareRelease({ projectDir: rootDir })).rejects.toThrow(/existing release|divergent/i);
    expect(await listFiles(rootDir)).toEqual(before);
  });

  it('rejects an incomplete existing release without changing the distribution', async () => {
    const { rootDir } = await createFixture();
    const releaseDir = path.join(rootDir, 'releases', VERSION);
    await fs.mkdir(releaseDir, { recursive: true });
    await fs.writeFile(path.join(releaseDir, 'sin-inline.user.js'), USERSCRIPT);
    const before = await listFiles(rootDir);

    await expect(prepareRelease({ projectDir: rootDir })).rejects.toThrow(/incomplete|missing/i);
    expect(await listFiles(rootDir)).toEqual(before);
  });

  it('rolls back aliases when a commit rename fails', async () => {
    const { rootDir } = await createFixture();
    const old = 'old alias';
    await fs.writeFile(path.join(rootDir, 'sin-inline.user.js'), old);
    await fs.writeFile(path.join(rootDir, 'sin-inline.meta.js'), old);
    await fs.writeFile(path.join(rootDir, 'latest.json'), old);
    const before = await listFiles(rootDir);
    const originalRename = fs.rename.bind(fs);
    let failed = false;
    const io = {
      ...fs,
      rename: async (from: string, to: string) => {
        if (!failed && to === path.join(rootDir, 'latest.json') && from.includes('.release-stage-')) {
          failed = true;
          throw new Error('injected rename failure');
        }
        return originalRename(from, to);
      }
    };

    await expect(prepareRelease({ projectDir: rootDir, fileSystem: io })).rejects.toThrow(/rename failure/i);
    expect(await listFiles(rootDir)).toEqual(before);
    await expect(fs.access(path.join(rootDir, 'releases', VERSION))).rejects.toThrow();
  });

  it('leaves the distribution unchanged when staging a file fails', async () => {
    const { rootDir } = await createFixture();
    const before = await listFiles(rootDir);
    const originalWriteFile = fs.writeFile.bind(fs);
    let failed = false;
    const io = {
      ...fs,
      writeFile: async (target: string, ...args: Parameters<typeof fs.writeFile> extends [unknown, ...infer Rest] ? Rest : never[]) => {
        if (!failed && target.includes('.release-stage-') && target.endsWith('latest.json')) {
          failed = true;
          throw new Error('injected staging write failure');
        }
        return originalWriteFile(target, ...args);
      }
    };

    await expect(prepareRelease({ projectDir: rootDir, fileSystem: io })).rejects.toThrow(/staging write failure/i);
    expect(await listFiles(rootDir)).toEqual(before);
    await expect(fs.access(path.join(rootDir, 'releases', VERSION))).rejects.toThrow();
  });

  it('rejects a concurrent preparation while the first one owns the lock', async () => {
    const { rootDir } = await createFixture();
    const lockPath = path.join(rootDir, '.release-preparation.lock');
    let signalLock: () => void = () => {};
    let releaseLock: () => void = () => {};
    const lockAcquired = new Promise<void>((resolve) => { signalLock = resolve; });
    const lockRelease = new Promise<void>((resolve) => { releaseLock = resolve; });
    const originalMkdir = fs.mkdir.bind(fs);
    const io = {
      ...fs,
      mkdir: async (target: string, options?: Parameters<typeof fs.mkdir>[1]) => {
        const result = await originalMkdir(target, options);
        if (target === lockPath) {
          signalLock();
          await lockRelease;
        }
        return result;
      }
    };

    const first = prepareRelease({ projectDir: rootDir, fileSystem: io });
    await lockAcquired;
    await expect(prepareRelease({ projectDir: rootDir })).rejects.toThrow(/already in progress|lock/i);
    releaseLock();
    await expect(first).resolves.toMatchObject({ version: VERSION, changed: true });
    await expect(fs.access(lockPath)).rejects.toThrow();
  });

  it('validates an unsafe version before postbuild creates any release paths', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'km-postbuild-'));
    tempDirs.push(rootDir);
    const distDir = path.join(rootDir, 'dist');
    await fs.mkdir(distDir, { recursive: true });
    await fs.writeFile(path.join(distDir, 'sin-inline.user.js'), USERSCRIPT.replace(`@version      ${VERSION}`, '@version      ../escape'));

    await expect(buildDistArtifacts({ distDir })).rejects.toThrow(/unsafe.*version|version.*unsafe/i);
    await expect(fs.access(path.join(distDir, 'releases'))).rejects.toThrow();
    await expect(fs.access(path.join(distDir, 'latest.json'))).rejects.toThrow();
    await expect(fs.access(path.join(distDir, 'sin-inline.meta.js'))).rejects.toThrow();
  });

  it('preserves the stage and reports recovery when rollback restoration fails', async () => {
    const { rootDir } = await createFixture();
    for (const name of ['sin-inline.user.js', 'sin-inline.meta.js', 'latest.json']) {
      await fs.writeFile(path.join(rootDir, name), 'old alias');
    }
    const originalRename = fs.rename.bind(fs);
    let commitFailed = false;
    let restoreFailed = false;
    const io = {
      ...fs,
      rename: async (from: string, to: string) => {
        if (!commitFailed && to === path.join(rootDir, 'latest.json') && from.includes('.release-stage-')) {
          commitFailed = true;
          throw new Error('injected commit failure');
        }
        if (commitFailed && !restoreFailed && to === path.join(rootDir, 'sin-inline.user.js') && from.includes('backups')) {
          restoreFailed = true;
          throw new Error('injected rollback failure');
        }
        return originalRename(from, to);
      }
    };

    const result = await prepareRelease({ projectDir: rootDir, fileSystem: io }).catch((error: Error) => error);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/rollback failure|stage/i);
    const stageMatch = (result as Error).message.match(/preserved at (.+)$/m);
    expect(stageMatch?.[1]).toBeTruthy();
    await expect(fs.access(stageMatch![1])).resolves.toBeUndefined();
    await expect(fs.access(path.join(stageMatch![1], 'backups', 'sin-inline.user.js'))).resolves.toBeUndefined();
  });
});
