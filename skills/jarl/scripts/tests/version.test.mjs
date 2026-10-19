// Every manifest that carries Jarl's version says the same one, and it is the newest release the
// CHANGELOG heads. A release that moves one place and not the others installs as two different versions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

const carriers = {
  'plugin.json': (m) => m.version,
  '.claude-plugin/plugin.json': (m) => m.version,
  '.codex-plugin/plugin.json': (m) => m.version,
  '.cursor-plugin/plugin.json': (m) => m.version,
  '.github/plugin/marketplace.json': (m) => m.plugins.find((p) => p.name === 'jarl').version,
  'skills/jarl/scripts/package.json': (m) => m.version,
};

const newestChangelogVersion = () => {
  const text = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  const heading = text.match(/^## \[(\d+\.\d+\.\d+)\]/m);
  assert.ok(heading, 'the CHANGELOG has no released section');
  return heading[1];
};

test('every manifest that carries the version says the same one as the newest CHANGELOG section', () => {
  const newest = newestChangelogVersion();
  for (const [rel, pick] of Object.entries(carriers)) {
    assert.equal(pick(readJson(rel)), newest, `${rel} disagrees with the CHANGELOG`);
  }
});

test('the manifests agree with each other', () => {
  const versions = Object.entries(carriers).map(([rel, pick]) => [rel, pick(readJson(rel))]);
  const distinct = new Set(versions.map(([, v]) => v));
  assert.equal(distinct.size, 1, `the manifests say different versions: ${JSON.stringify(versions)}`);
});
