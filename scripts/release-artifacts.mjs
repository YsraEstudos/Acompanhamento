import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const INSTALL_URL = 'https://ysraestudos.github.io/Acompanhamento/sin-inline.user.js';
const UPDATE_URL = 'https://ysraestudos.github.io/Acompanhamento/sin-inline.meta.js';
const MATCHES = [
  'https://*.klassmatt.com.br/*SIN_Item_Edita.aspx*',
  'https://*.klassmatt.com.br/*ITEM_Edita.aspx*',
  'https://klassmatt.com.br/*SIN_Item_Edita.aspx*',
  'https://klassmatt.com.br/*ITEM_Edita.aspx*'
];
const CONNECTS = ['*.klassmatt.com.br', 'klassmatt.com.br'];
const GRANTS = ['GM_registerMenuCommand', 'GM_unregisterMenuCommand', 'GM_xmlhttpRequest', 'unsafeWindow'];

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} mismatch: expected ${expected}, received ${actual}`);
}

function assertBytes(actual, expected, label) {
  if (!actual.equals(expected)) throw new Error(`${label} is not bytewise consistent`);
}

function parseMetadata(contents) {
  const blockMatch = contents.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/);
  if (!blockMatch?.[0]) throw new Error('userscript metadata block is missing');

  const fields = new Map();
  for (const line of blockMatch[0].split(/\r?\n/)) {
    const match = line.match(/^\/\/ @(\S+)(?:\s+(.*?))?\s*$/);
    if (!match) continue;
    const values = fields.get(match[1]) ?? [];
    values.push(match[2]?.trim() ?? '');
    fields.set(match[1], values);
  }

  const value = (name) => fields.get(name)?.[0];
  const values = (name) => fields.get(name) ?? [];
  const version = value('version');
  if (!version) throw new Error('userscript metadata is missing @version');
  assertEqual(values('version').length, 1, '@version occurrences');
  assertEqual(values('updateURL').length, 1, '@updateURL occurrences');
  assertEqual(values('downloadURL').length, 1, '@downloadURL occurrences');
  if (!VERSION_PATTERN.test(version) || path.basename(version) !== version) {
    throw new Error(`userscript metadata has an unsafe @version: ${version}`);
  }

  assertEqual(value('updateURL'), UPDATE_URL, '@updateURL');
  assertEqual(value('downloadURL'), `https://ysraestudos.github.io/Acompanhamento/releases/${version}/sin-inline.user.js`, '@downloadURL');
  assertEqual(JSON.stringify(values('grant')), JSON.stringify(GRANTS), '@grant');
  assertEqual(JSON.stringify(values('connect')), JSON.stringify(CONNECTS), '@connect');
  assertEqual(JSON.stringify(values('match')), JSON.stringify(MATCHES), '@match');

  return { block: blockMatch[0], version };
}

function parseJson(buffer, relative) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    throw new Error(`${relative} is not valid JSON: ${error.message}`);
  }
}

async function readDistribution(baseDir, label) {
  const script = await fs.readFile(path.join(baseDir, 'sin-inline.user.js'));
  const metadata = parseMetadata(script.toString('utf8'));
  const version = metadata.version;
  const meta = await fs.readFile(path.join(baseDir, 'sin-inline.meta.js'));
  assertBytes(meta, Buffer.from(`${metadata.block}\n`), `${label}/sin-inline.meta.js`);

  const digest = createHash('sha256').update(script).digest('hex');
  const latest = await fs.readFile(path.join(baseDir, 'latest.json'));
  const manifest = parseJson(latest, `${label}/latest.json`);
  assertEqual(manifest.version, version, `${label}/latest.json version`);
  assertEqual(manifest.installUrl, INSTALL_URL, `${label}/latest.json installUrl`);
  assertEqual(manifest.updateUrl, UPDATE_URL, `${label}/latest.json updateUrl`);
  assertEqual(manifest.downloadUrl, `https://ysraestudos.github.io/Acompanhamento/releases/${version}/sin-inline.user.js`, `${label}/latest.json downloadUrl`);
  assertEqual(manifest.sha256, digest, `${label}/latest.json sha256`);

  const releaseDir = path.join(baseDir, 'releases', version);
  const releaseScript = await fs.readFile(path.join(releaseDir, 'sin-inline.user.js'));
  const checksum = await fs.readFile(path.join(releaseDir, 'SHA256SUMS.txt'));
  assertBytes(releaseScript, script, `${label}/releases/${version}/sin-inline.user.js`);
  assertBytes(checksum, Buffer.from(`${digest}  sin-inline.user.js\n`), `${label}/releases/${version}/SHA256SUMS.txt`);

  return { version, sha256: digest, script, meta, latest, releaseScript, checksum };
}

function normalizeLocation(input) {
  const requested = input.location ?? input.distribution ?? input.target;
  if (requested === 'dist' || requested === 'published' || requested === 'both') return requested;
  if (input.published === true) return 'published';
  if (input.published === false) return 'dist';
  return 'both';
}

export async function validateReleaseArtifacts(input) {
  const { projectDir } = input;
  const location = normalizeLocation(input);
  const distributions = [];
  if (location === 'dist' || location === 'both') {
    distributions.push(await readDistribution(path.join(projectDir, 'dist'), 'dist'));
  }
  if (location === 'published' || location === 'both') {
    distributions.push(await readDistribution(projectDir, 'published'));
  }

  if (distributions.length === 2) {
    const [dist, published] = distributions;
    for (const key of ['script', 'meta', 'latest', 'releaseScript', 'checksum']) {
      assertBytes(published[key], dist[key], `published/${key}`);
    }
  }

  const { version, sha256 } = distributions[0];
  return { version, sha256 };
}

async function main() {
  const location = process.argv.includes('--published') ? 'published' : process.argv.includes('--both') ? 'both' : 'dist';
  const result = await validateReleaseArtifacts({ projectDir: process.cwd(), location });
  console.log(`Release artifacts valid (${location}): ${result.version} ${result.sha256}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
