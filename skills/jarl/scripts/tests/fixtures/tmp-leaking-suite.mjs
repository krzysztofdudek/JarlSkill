// A test file that makes a temporary directory and does not import the cleanup: the leak the suite runner must report.
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('makes a directory and leaves it', () => {
  mkdtempSync(join(tmpdir(), 'fixture-leaked-'));
});
