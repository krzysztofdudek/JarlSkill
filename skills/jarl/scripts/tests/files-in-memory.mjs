// A test that reads one small loop tens of thousands of times, changing only a file or two between reads: a read on a
// Windows runner's disk costs milliseconds, and the code under test makes dozens per call. While on, the files the test
// puts are read from memory, and every other read of the file system is made once and answered from then on. The code
// under test runs unchanged. A test using this checks a fixed sample of its cases on the real disk as well.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const real = { readFileSync: fs.readFileSync, existsSync: fs.existsSync, readdirSync: fs.readdirSync, statSync: fs.statSync, native: fs.realpathSync.native };

export function filesInMemory() {
  const texts = new Map();
  const seen = new Map();
  const once = (name, read) => (...args) => {
    const key = `${name}\0${JSON.stringify(args)}`;
    if (!seen.has(key)) { try { seen.set(key, { value: read(...args) }); } catch (error) { seen.set(key, { error }); } }
    const { value, error } = seen.get(key);
    if (error) throw error;
    return Array.isArray(value) ? [...value] : value;
  };
  const answers = {
    readFileSync: (path, ...rest) => (texts.has(String(path)) ? texts.get(String(path)) : once('readFileSync', real.readFileSync)(path, ...rest)),
    existsSync: (path) => texts.has(String(path)) || once('existsSync', real.existsSync)(path),
    readdirSync: once('readdirSync', real.readdirSync),
    statSync: once('statSync', real.statSync),
    native: once('native', real.native),
  };
  const install = (from) => {
    fs.readFileSync = from.readFileSync;
    fs.existsSync = from.existsSync;
    fs.readdirSync = from.readdirSync;
    fs.statSync = from.statSync;
    fs.realpathSync.native = from.native;
    syncBuiltinESMExports();
  };
  return { put: (path, text) => texts.set(String(path), text), on: () => install(answers), off: () => install(real) };
}
