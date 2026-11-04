// A test file that leaves a directory the runner cannot remove: the leftover must still be named.
import test from 'node:test';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('leaves a read-only directory with a file in it', () => {
  const dir = join(tmpdir(), 'fixture-locked');
  mkdirSync(dir);
  writeFileSync(join(dir, 'file'), 'x');
  chmodSync(dir, 0o500);
});
