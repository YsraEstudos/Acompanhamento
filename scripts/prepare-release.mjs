import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateReleaseArtifacts } from './release-artifacts.mjs';

const ALIASES = ['sin-inline.user.js', 'sin-inline.meta.js', 'latest.json'];
const RELEASE_FILES = ['sin-inline.user.js', 'SHA256SUMS.txt'];
const LOCK_NAME = '.release-preparation.lock';

async function acquireLock(io, lockPath) {
  try {
    await io.mkdir(lockPath);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`release preparation already in progress: ${lockPath}`, { cause: error });
    }
    throw error;
  }
}

async function releaseLock(io, lockPath) {
  await io.rmdir(lockPath);
}

async function exists(io, target) {
  try {
    await io.lstat(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function assertRegularFileOrMissing(io, target) {
  if (!(await exists(io, target))) return false;
  const info = await io.lstat(target);
  if (!info.isFile()) throw new Error(`release target is not a regular file: ${target}`);
  return true;
}

async function readSourceFiles(io, distDir, version) {
  const files = {};
  for (const name of ALIASES) files[name] = await io.readFile(path.join(distDir, name));
  for (const name of RELEASE_FILES) files[`release/${name}`] = await io.readFile(path.join(distDir, 'releases', version, name));
  return files;
}

async function inspectExistingRelease(io, releaseDir, sourceFiles) {
  if (!(await exists(io, releaseDir))) return false;
  const info = await io.lstat(releaseDir);
  if (!info.isDirectory()) throw new Error(`existing release path is not a directory: ${releaseDir}`);

  const entries = await io.readdir(releaseDir);
  const names = entries.map((entry) => typeof entry === 'string' ? entry : entry.name);
  const unexpected = names.filter((name) => !RELEASE_FILES.includes(name));
  if (unexpected.length > 0) throw new Error(`existing release is divergent: unexpected files ${unexpected.join(', ')}`);

  for (const name of RELEASE_FILES) {
    const target = path.join(releaseDir, name);
    if (!(await exists(io, target))) throw new Error(`existing release is incomplete: missing ${name}`);
    const info = await io.lstat(target);
    if (!info.isFile()) throw new Error(`existing release is incomplete: ${name} is not a file`);
    const actual = await io.readFile(target);
    if (!actual.equals(sourceFiles[`release/${name}`])) {
      throw new Error(`existing release is divergent: ${name} differs from dist`);
    }
  }

  return true;
}

async function rollback(io, { stageDir, aliasesInstalled, backups, releaseDir, releaseInstalled, releasesDir, releasesDirCreated }) {
  const failures = [];
  const attempt = async (operation, description) => {
    try {
      await operation();
    } catch (error) {
      failures.push(`${description}: ${error.message}`);
    }
  };

  for (const target of aliasesInstalled.slice().reverse()) {
    await attempt(() => io.rm(target, { force: true }), `remove installed alias ${target}`);
  }
  if (releaseInstalled) {
    for (const name of RELEASE_FILES) {
      await attempt(() => io.rm(path.join(releaseDir, name), { force: true }), `remove installed release file ${name}`);
    }
    await attempt(() => io.rmdir(releaseDir), `remove installed release directory ${releaseDir}`);
  }
  if (releasesDirCreated) await attempt(() => io.rmdir(releasesDir), `remove created releases directory ${releasesDir}`);
  for (const { target, backup } of backups.slice().reverse()) {
    await attempt(async () => {
      if (await exists(io, backup)) await io.rename(backup, target);
    }, `restore alias backup ${target}`);
  }
  if (failures.length > 0) {
    throw new Error(`rollback failed: ${failures.join('; ')}; recovery stage preserved at ${stageDir}`);
  }
}

async function installAlias(io, stageDir, projectDir, name, aliasesInstalled, backups) {
  const target = path.join(projectDir, name);
  const staged = path.join(stageDir, name);
  if (await exists(io, target)) {
    const backup = path.join(stageDir, 'backups', name);
    await io.rename(target, backup);
    backups.push({ target, backup });
  }
  await io.rename(staged, target);
  aliasesInstalled.push(target);
}

export async function prepareRelease({ projectDir, fileSystem = fs, fs: injectedFileSystem }) {
  const io = injectedFileSystem ?? fileSystem;
  const lockPath = path.join(projectDir, LOCK_NAME);
  await acquireLock(io, lockPath);
  try {
    const { version, sha256 } = await validateReleaseArtifacts({ projectDir, location: 'dist' });
    const distDir = path.join(projectDir, 'dist');
    const releasesDir = path.join(projectDir, 'releases');
    const releaseDir = path.join(releasesDir, version);
    const sourceFiles = await readSourceFiles(io, distDir, version);

    for (const name of ALIASES) await assertRegularFileOrMissing(io, path.join(projectDir, name));
    if (await exists(io, releasesDir)) {
      const info = await io.lstat(releasesDir);
      if (!info.isDirectory()) throw new Error(`release directory is not a directory: ${releasesDir}`);
    }
    const releaseExists = await inspectExistingRelease(io, releaseDir, sourceFiles);
    const aliasesMatch = await Promise.all(ALIASES.map(async (name) => {
      const target = path.join(projectDir, name);
      if (!(await exists(io, target))) return false;
      return (await io.readFile(target)).equals(sourceFiles[name]);
    }));
    if (releaseExists && aliasesMatch.every(Boolean)) return { version, sha256, changed: false };

    const stageDir = path.join(projectDir, `.release-stage-${process.pid}-${randomUUID()}`);
    const stageReleaseDir = path.join(stageDir, 'release');
    const aliasesInstalled = [];
    const backups = [];
    let releaseInstalled = false;
    let releasesDirCreated = false;
    let preserveStage = false;

    try {
      await io.mkdir(path.join(stageDir, 'backups'), { recursive: true });
      await io.mkdir(stageReleaseDir, { recursive: true });
      for (const name of ALIASES) await io.writeFile(path.join(stageDir, name), sourceFiles[name]);
      for (const name of RELEASE_FILES) await io.writeFile(path.join(stageReleaseDir, name), sourceFiles[`release/${name}`]);

      await installAlias(io, stageDir, projectDir, 'sin-inline.user.js', aliasesInstalled, backups);
      await installAlias(io, stageDir, projectDir, 'sin-inline.meta.js', aliasesInstalled, backups);

      if (!releaseExists) {
        if (!(await exists(io, releasesDir))) {
          await io.mkdir(releasesDir);
          releasesDirCreated = true;
        }
        await io.rename(stageReleaseDir, releaseDir);
        releaseInstalled = true;
      }

      // Install latest.json last so a failed preparation never advertises the new release.
      await installAlias(io, stageDir, projectDir, 'latest.json', aliasesInstalled, backups);
    } catch (error) {
      try {
        await rollback(io, { stageDir, aliasesInstalled, backups, releaseDir, releaseInstalled, releasesDir, releasesDirCreated });
      } catch (rollbackError) {
        preserveStage = true;
        throw new Error(`Release preparation failed: ${error.message}; ${rollbackError.message}`, { cause: error });
      }
      throw new Error(`Release preparation failed: ${error.message}`, { cause: error });
    } finally {
      if (!preserveStage) await io.rm(stageDir, { recursive: true, force: true }).catch(() => {});
    }

    return { version, sha256, changed: true };
  } finally {
    await releaseLock(io, lockPath);
  }
}

async function main() {
  const result = await prepareRelease({ projectDir: process.cwd() });
  console.log(`Release prepared: ${result.version} ${result.sha256}${result.changed ? '' : ' (already prepared)'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
