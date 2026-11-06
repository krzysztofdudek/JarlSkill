// Import reports each finding whose text differs from the text its issue was filed with, with both texts, and never
// writes to that issue: white space and line endings are not a change, a hand-added paragraph is not a change, and an
// issue that is done or dropped is reported like an open one. An issue is compared only when its own file reads as one
// import filed: an issue written by hand under the same Source holds its own words and is never reported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jarl, loop as makeLoop, refuses } from './helpers.mjs';
import { oldJarl } from './old-jarl.mjs';

const loop = () => makeLoop({ prefix: 'jarl-import-changes-', via: 'cli', dotGit: false });
const json = (root, ...args) => JSON.parse(jarl(root, ...args, '--json'));
const SOURCE = 'ext/2026-11-05-tickets';
const fileOf = (root, id) => readFileSync(json(root, 'show', id).file, 'utf8');
const logFile = (root) => join(root, '.jarl', 'log.md');

// A findings file in a folder of its own; `text` is written as given, so a test chooses its line endings.
function findingsFile(text) {
  const file = join(mkdtempSync(join(tmpdir(), 'jarl-findings-')), 'findings.json');
  writeFileSync(file, text);
  return file;
}
const finding = (over = {}) => ({ id: 'T-1', title: 'Export as csv', claim: 'Users can export a report as csv.', truth: 'The export button writes json only.', impact: 'Reports cannot be opened in a sheet.', ...over });
const written = (list, eol = '\n') => JSON.stringify(list, null, 2).replace(/\n/g, eol);
const importing = (root, file, ...more) => json(root, 'import', file, '--source', SOURCE, ...more);

test('a finding imported again with the same text is not reported as changed', () => {
  const root = loop();
  const file = findingsFile(written([finding()]));
  assert.deepEqual(importing(root, file).changed, []);
  const again = importing(root, file);
  assert.deepEqual(again.changed, []);
  assert.equal(again.already.length, 1);
  assert.doesNotMatch(jarl(root, 'import', file, '--source', SOURCE), /changed/);
});

test('a finding whose text changed is reported with the issue text and the finding text, and the issue is left as it was', () => {
  const root = loop();
  importing(root, findingsFile(written([finding()])));
  const before = fileOf(root, '1');
  const next = findingsFile(written([finding({ claim: 'Users can export a report as csv or xlsx.', impact: 'Reports open in a sheet.' })]));
  const out = importing(root, next);
  assert.equal(out.changed.length, 1);
  const [c] = out.changed;
  assert.deepEqual([c.finding, c.issue, c.status], ['T-1', '1', 'open']);
  assert.deepEqual(c.parts.map((p) => p.part), ['What', 'Why']);
  assert.match(c.parts[0].issueText, /Claim: Users can export a report as csv\.\n/);
  assert.match(c.parts[0].findingText, /Claim: Users can export a report as csv or xlsx\./);
  assert.equal(c.parts[1].issueText, 'Reports cannot be opened in a sheet.');
  assert.equal(c.parts[1].findingText, 'Reports open in a sheet.');
  assert.equal(fileOf(root, '1'), before, 'import never overwrites the issue');
  assert.equal(out.filed.length, 0);
  const text = jarl(root, 'import', next, '--source', SOURCE);
  assert.match(text, /^ext\/2026-11-05-tickets: 1 finding\(s\) · filed 0 · already filed 1 · changed since filed 1$/m);
  assert.match(text, /^changed since filed · T-1 · issue 1 \(open\) · What$/m);
  assert.match(text, /^ {4}issue: {3}Claim: Users can export a report as csv\.$/m);
  assert.match(text, /^ {4}finding: Claim: Users can export a report as csv or xlsx\.$/m);
  assert.match(text, /import leaves the text of an issue as it is/);
  assert.equal(fileOf(root, '1'), before, 'a second run leaves it as well');
});

test('a change of white space or of line endings alone is not a change', () => {
  const root = loop();
  const first = [finding({ claim: 'Users can export a report as csv.\n\nThe file keeps the column order.' })];
  importing(root, findingsFile(written(first)));
  const spaced = [finding({ claim: '  Users can export   a report\nas csv.\r\n\r\n\r\nThe file keeps the\tcolumn order.  ', truth: 'The export button\nwrites json only.  ' })];
  assert.deepEqual(importing(root, findingsFile(written(spaced))).changed, []);
  assert.deepEqual(importing(root, findingsFile(written(first, '\r\n'))).changed, [], 'a findings file with CRLF line endings reads the same');
  assert.deepEqual(importing(root, findingsFile(written(spaced, '\r\n'))).changed, []);
});

test('a findings file with CRLF line endings, imported first, matches the same file with LF', () => {
  const root = loop();
  const list = [finding({ claim: 'Line one.\r\n\r\nLine two.' })];
  importing(root, findingsFile(written(list, '\r\n')));
  assert.deepEqual(importing(root, findingsFile(written([finding({ claim: 'Line one.\n\nLine two.' })]))).changed, []);
  assert.equal(importing(root, findingsFile(written([finding({ claim: 'Line one.\n\nLine two, changed.' })]))).changed.length, 1);
});

test('a paragraph added to an issue by hand is not a change, and a paragraph of the finding that the issue lost is', () => {
  const root = loop();
  const file = findingsFile(written([finding()]));
  importing(root, file);
  jarl(root, 'field', '1', 'What', `${json(root, 'show', '1').sections.what.trim()}\n\nThe coordinator's note: the sheet export waits for the writer.`);
  assert.deepEqual(importing(root, file).changed, []);
  jarl(root, 'field', '1', 'What', 'Claim: something else entirely.');
  const out = importing(root, file);
  assert.deepEqual(out.changed.map((c) => c.parts.map((p) => p.part)), [['What']]);
});

test('a finding of a done or a dropped issue is reported with the status of that issue', () => {
  const root = loop();
  importing(root, findingsFile(written([finding(), finding({ id: 'T-2', title: 'Print', claim: 'Users can print a report.' })])));
  jarl(root, 'set', '1', 'dropped', 'the ticket was withdrawn');
  jarl(root, 'set', '2', 'in-progress', 'go', '--worker', 'w2');
  jarl(root, 'evidence', '2', '--ran', 'npm test', '--saw', 'all pass');
  jarl(root, 'review', '2', 'approve', '--by', 'rev', 'read the diff, nothing found');
  jarl(root, 'set', '2', 'done', 'finished');
  const out = importing(root, findingsFile(written([finding({ claim: 'Nobody exports.' }), finding({ id: 'T-2', title: 'Print', claim: 'Users can print a report in colour.' })])));
  assert.deepEqual(out.changed.map((c) => [c.finding, c.issue, c.status]), [['T-1', '1', 'dropped'], ['T-2', '2', 'done']]);
  assert.match(jarl(root, 'import', findingsFile(written([finding({ claim: 'Nobody exports.' })])), '--source', SOURCE), /issue 1 \(dropped\)/);
});

test('a dry run and an import of part of the file report changes too, and write nothing', () => {
  const root = loop();
  importing(root, findingsFile(written([finding(), finding({ id: 'T-2', title: 'Print', claim: 'Users can print.' })])));
  const before = [fileOf(root, '1'), fileOf(root, '2')];
  const changed = findingsFile(written([finding({ claim: 'A new claim.' }), finding({ id: 'T-2', title: 'Print', claim: 'A new print claim.' })]));
  assert.deepEqual(importing(root, changed, '--dry-run').changed.map((c) => c.finding), ['T-1', 'T-2']);
  assert.deepEqual(importing(root, changed, '--only', 'T-2').changed.map((c) => c.finding), ['T-2']);
  assert.deepEqual([fileOf(root, '1'), fileOf(root, '2')], before);
  assert.match(readFileSync(join(root, '.jarl', 'log.md'), 'utf8'), /· imported ext\/2026-11-05-tickets · 0 filed, 1 already filed$/m, 'the log line of an import that found a change is the line of any other');
});

test('an external requirement is a branch of the issue tree: the sub-issue of a requirement is reported on its own Source', () => {
  const root = loop();
  jarl(root, 'new', 'the requirements of the tracker');
  importing(root, findingsFile(written([finding()])));
  jarl(root, 'field', '2', 'Parent', '1');
  const out = importing(root, findingsFile(written([finding({ claim: 'Users can export a report as xlsx.' })])));
  assert.deepEqual(out.changed.map((c) => [c.finding, c.issue]), [['T-1', '2']]);
});

test('an issue filed by hand under a Source, and one adopted into it, is never reported, whatever its What says', () => {
  const root = loop();
  jarl(root, 'new', 'Export by hand', '--source', `${SOURCE}#T-1`, '--found-by', `research ${SOURCE}`, '--what', 'Our own account of the export, nothing like the finding.');
  jarl(root, 'new', 'Print named by an issue', '--found-by', `research ${SOURCE}`, '--what', 'Covers T-2 of ext/2026-11-05-tickets in our words.');
  const file = findingsFile(written([finding(), finding({ id: 'T-2', title: 'Print', claim: 'Users can print a report.' })]));
  assert.deepEqual(importing(root, file, '--adopt').changed, []);
  assert.deepEqual(importing(root, file).changed, []);
  assert.deepEqual(importing(root, file, '--dry-run').changed, []);
  assert.match(jarl(root, 'import', file, '--source', SOURCE), /already filed 2$/m);
});

test('only an issue that reads as import filed it is compared: a hand-filed issue beside imported ones stays silent, an imported one is reported', () => {
  const root = loop();
  jarl(root, 'new', 'Export by hand', '--source', `${SOURCE}#T-1`, '--found-by', `research ${SOURCE}`, '--what', 'Our own account of the export.');
  importing(root, findingsFile(written([finding({ id: 'T-2', title: 'Print', claim: 'Users can print a report.' })])));
  const changed = findingsFile(written([finding(), finding({ id: 'T-2', title: 'Print', claim: 'Users can print a report in colour.' })]));
  assert.deepEqual(importing(root, changed).changed.map((c) => [c.finding, c.issue]), [['T-2', '2']]);
});

// A report whose findings are partly imported and partly filed by hand, each hand-filed issue with the finding's Source
// and the same Found by as the imported ones, in its writer's own words: a coordinator files an issue before its finding
// is written into the findings file, or writes one from a ruling and links it to the finding later.
test('issues filed by hand with the Source and the Found by of an import stay silent on every run, and the imported ones beside them are compared', () => {
  const root = loop();
  jarl(root, 'new', 'One format raise', '--source', `${SOURCE}#T-2`, '--found-by', 'research', '--what', 'Ruling one-raise: every change an older reader would misread rides one raise.', '--why', 'Several raises would make readers refuse loops they read today.');
  jarl(root, 'new', 'Every issue carries a key', '--source', `${SOURCE}#T-3`, '--found-by', 'research', '--what', 'Report section 8: a log line names its issue by number alone.');
  jarl(root, 'new', 'A proof with no verdict', '--source', `${SOURCE}#T-4`, '--found-by', 'review', '--what', 'Fresh review of the design: a proof with no verdict shows nowhere.');
  const findings = (over = {}) => [
    finding({ claim: over.one ?? 'Users can export a report as csv.' }),
    finding({ id: 'T-2', title: 'Format raise', claim: over.two ?? 'Every model change rides one raise to format 3.', impact: 'Readers refuse loops.' }),
    finding({ id: 'T-3', title: 'Issue key', claim: 'A log line names its issue by number.', truth: 'Two clones give one number.' }),
    finding({ id: 'T-4', title: 'Lone agent', claim: 'A proof with no verdict shows nowhere.' }),
    finding({ id: 'T-5', title: 'Routing', claim: 'A session names its loop once.' }),
  ];
  const first = importing(root, findingsFile(written(findings())), '--found-by', 'research');
  assert.deepEqual(first.filed.map((f) => [f.finding, f.id]), [['T-1', '4'], ['T-5', '5']]);
  assert.deepEqual(first.changed, []);
  for (const more of [[], ['--dry-run'], ['--found-by', 'research'], ['--found-by', 'review']]) {
    assert.deepEqual(importing(root, findingsFile(written(findings())), ...more).changed, [], `unchanged findings, run with ${more.join(' ') || 'no flag'}`);
  }
  const changed = findingsFile(written(findings({ one: 'Users can export a report as xlsx.', two: 'Every model change rides two raises.' })));
  assert.deepEqual(importing(root, changed, '--found-by', 'research').changed.map((c) => [c.finding, c.issue]), [['T-1', '4']], 'the hand-filed 1 stays silent though its finding changed');
});

test('an issue filed by hand whose Source and What read as import writes them but whose Found by is another stays silent', () => {
  const root = loop();
  jarl(root, 'new', 'Export', '--source', `${SOURCE}#T-1`, '--found-by', 'owner', '--what', 'Claim: Users export the report the way we put it.');
  const file = findingsFile(written([finding()]));
  assert.deepEqual(importing(root, file).changed, []);
  assert.deepEqual(importing(root, file, '--found-by', 'research').changed, []);
  assert.deepEqual(importing(root, file, '--dry-run').changed, []);
});

test('the issues an import filed with --found-by are compared by a run with the same --found-by, and by no other', () => {
  const root = loop();
  importing(root, findingsFile(written([finding()])), '--found-by', 'tracker');
  const changed = findingsFile(written([finding({ claim: 'Users can export a report as xlsx.' })]));
  assert.deepEqual(importing(root, changed).changed, [], 'this run would write "research <dir>", which the issue does not carry');
  assert.deepEqual(importing(root, changed, '--found-by', 'tracker').changed.map((c) => [c.finding, c.issue]), [['T-1', '1']]);
});

test('an issue whose What a writer rewrote to open otherwise than import writes it is the writer\'s own, and is not compared', () => {
  const root = loop();
  importing(root, findingsFile(written([finding()])));
  jarl(root, 'field', '1', 'What', 'Rewritten by the coordinator in our own words.');
  assert.deepEqual(importing(root, findingsFile(written([finding({ claim: 'Users can export a report as xlsx.' })]))).changed, []);
});

test('an issue filed from a finding with a truth and no claim is compared, and a claim the finding gains is reported', () => {
  const root = loop();
  importing(root, findingsFile(written([{ id: 'T-1', title: 'Export', truth: 'The export button writes json only.' }])));
  assert.deepEqual(importing(root, findingsFile(written([{ id: 'T-1', title: 'Export', truth: 'The export button writes json only.' }]))).changed, []);
  const out = importing(root, findingsFile(written([{ id: 'T-1', title: 'Export', claim: 'Users can export as csv.', truth: 'The export button writes json only.' }])));
  assert.deepEqual(out.changed.map((c) => c.parts.map((p) => p.part)), [['What']]);
});

test('a change in one word is a change, not only a change in the end of the text', () => {
  const root = loop();
  importing(root, findingsFile(written([finding({ claim: 'Users can export a report as csv or xlsx.' })])));
  assert.equal(importing(root, findingsFile(written([finding({ claim: 'Users can export a report as csv or xls' })]))).changed.length, 1);
  assert.equal(importing(root, findingsFile(written([finding({ claim: 'Users can export a report as csv or xlsx.' })]))).changed.length, 0);
});

test('an import refused as a whole files nothing: a later run files every finding, compares them like any other and reports their changes', () => {
  const root = loop();
  const refused = findingsFile(written([finding(), finding({ id: 'T-2', title: 'Print', claim: 'Users can <why>print</why> a report.' })]));
  assert.match(refuses(root, 'import', refused, '--source', SOURCE), /closing why tag/);
  assert.deepEqual(json(root, 'list', '--all'), []);
  const fixed = findingsFile(written([finding(), finding({ id: 'T-2', title: 'Print', claim: 'Users can print a report.' })]));
  assert.deepEqual(importing(root, fixed).filed.map((f) => f.finding), ['T-1', 'T-2']);
  assert.deepEqual(importing(root, fixed).changed, []);
  const both = findingsFile(written([finding({ claim: 'Users can export a report as xlsx.' }), finding({ id: 'T-2', title: 'Print', claim: 'Users can print a report in colour.' })]));
  assert.deepEqual(importing(root, both).changed.map((c) => [c.finding, c.issue]), [['T-1', '1'], ['T-2', '2']]);
});

// A signal or a crash stops an import between two filings, or after the last one and before the line that closes the run:
// the log then holds filings with no closing line, and one filing whose file was never written. The issues are read from
// their own files, so each one the run filed is compared.
test('an import stopped before its closing line leaves every issue it filed compared: a later change of each is reported', () => {
  const root = loop();
  const list = Array.from({ length: 6 }, (_, n) => finding({ id: `T-${n + 1}`, title: `Ticket ${n + 1}`, claim: `Ticket ${n + 1} as filed.` }));
  importing(root, findingsFile(written(list.slice(0, 4))));
  const log = readFileSync(logFile(root), 'utf8');
  const stopped = log.replace(/^.*· imported .*\n/m, '').replace(/\n$/, `\n${log.match(/^- \S+ \S+/m)[0]} · filed 5 · Ticket 5\n`);
  assert.notEqual(stopped, log);
  writeFileSync(logFile(root), stopped);
  assert.doesNotMatch(readFileSync(logFile(root), 'utf8'), /· imported /);
  assert.deepEqual(importing(root, findingsFile(written(list))).filed.map((f) => f.finding), ['T-5', 'T-6']);
  const rewritten = list.map((f) => ({ ...f, claim: `${f.claim} Changed upstream.` }));
  assert.deepEqual(importing(root, findingsFile(written(rewritten))).changed.map((c) => c.finding), ['T-1', 'T-2', 'T-3', 'T-4', 'T-5', 'T-6']);
});

// Two copies of a loop written by a Jarl whose lines carry no key: one imports T-1, the other files an issue by hand under
// T-2 with the Found by an import writes, and both take number 001; the union merge of the two copies keeps both files and
// both filed lines. The number decides nothing: before one file is given a free number and after either is.
const older = () => {
  const root = mkdtempSync(join(tmpdir(), 'jarl-import-older-'));
  mkdirSync(join(root, '.git'));
  assert.equal(oldJarl(root, 'init', {}, ['an older loop', {}]).ok, true);
  return root;
};
function mergedCopies() {
  const a = older();
  const imported = oldJarl(a, 'import', {}, [findingsFile(written([finding()])), { source: SOURCE }]);
  assert.equal(imported.ok, true, imported.error);
  const b = older();
  assert.equal(oldJarl(b, 'new', {}, ['Print by hand', { source: `${SOURCE}#T-2`, 'found-by': `research ${SOURCE}`, what: 'Our own words about printing.' }]).ok, true);
  const [byHand] = readdirSync(join(b, '.jarl', 'issues'));
  writeFileSync(join(a, '.jarl', 'issues', byHand), readFileSync(join(b, '.jarl', 'issues', byHand), 'utf8'));
  writeFileSync(logFile(a), `${readFileSync(logFile(a), 'utf8')}${readFileSync(logFile(b), 'utf8').match(/^.*· filed 001 · .*\n/m)[0]}`);
  const files = readdirSync(join(a, '.jarl', 'issues')).sort();
  assert.deepEqual(files.map((f) => f.slice(0, 4)), ['001-', '001-'], 'two files carry one number');
  return { root: a, imported: files.find((f) => f !== byHand), byHand };
}
function renumber(root, file, to) {
  const dir = join(root, '.jarl', 'issues');
  writeFileSync(join(dir, file), readFileSync(join(dir, file), 'utf8').replace(/^# 001 ·/, `# ${to} ·`));
  renameSync(join(dir, file), join(dir, `${to}${file.slice(3)}`));
}

test('two merged copies with one number on two issues: the hand-filed one stays silent and the imported one is reported, before and after either file gets a free number', () => {
  const unchanged = [finding(), finding({ id: 'T-2', title: 'Print', claim: 'Users can print a report.' })];
  const changed = [finding({ claim: 'Users can export a report as xlsx.' }), finding({ id: 'T-2', title: 'Print', claim: 'Users can print a report.' })];
  for (const [given, imported] of [[null, '001'], ['hand', '001'], ['imported', '002']]) {
    const { root, imported: importedFile, byHand } = mergedCopies();
    if (given === 'hand') renumber(root, byHand, '002');
    if (given === 'imported') renumber(root, importedFile, '002');
    for (const more of [['--dry-run'], []]) {
      const quiet = importing(root, findingsFile(written(unchanged)), ...more);
      assert.deepEqual(quiet.already.map((a) => a.finding), ['T-1', 'T-2']);
      assert.deepEqual(quiet.changed, [], `the unchanged file reports nothing (${given ?? 'one number'} ${more.join(' ')})`);
      assert.deepEqual(importing(root, findingsFile(written(changed)), ...more).changed.map((c) => [c.finding, c.issue]), [['T-1', imported]], `${given ?? 'one number'} ${more.join(' ')}`);
    }
  }
});

// The shape of most research findings files: an id, a title, the evidence, a proposal and an effort, with no claim and no
// truth. Import files each with a What that opens with its evidence, as a What written by hand may, so its issue cannot be
// told from one written by hand.
const evidenceOnly = (n, evidence) => ({ id: `E-${n}`, title: `Gap ${n}`, evidence, proposal: `Close gap ${n}.`, effort: 'small' });

test('a finding with neither a claim nor a truth is not compared, and the run says how many it could not compare', () => {
  const root = loop();
  const first = [1, 2, 3].map((n) => evidenceOnly(n, `Gap ${n} as seen.`));
  assert.equal(importing(root, findingsFile(written(first))).filed.length, 3);
  const rewritten = findingsFile(written([1, 2, 3].map((n) => evidenceOnly(n, `Gap ${n} rewritten upstream.`))));
  for (const more of [['--dry-run'], []]) {
    const out = importing(root, rewritten, ...more);
    assert.deepEqual(out.changed, []);
    assert.deepEqual(out.compared, []);
    assert.deepEqual(out.notCompared, [1, 2, 3].map((n) => ({ finding: `E-${n}`, reason: 'no-claim-or-truth' })));
    const text = jarl(root, 'import', rewritten, '--source', SOURCE, ...more);
    assert.doesNotMatch(text, /changed/);
    assert.match(text, /^compared 0 of 3 already filed · not compared: 3 with neither a claim nor a truth$/m);
  }
});

test('every run with findings already filed says how many it compared, and names each reason it left one: no claim or truth, or no issue of this run\'s Found by', () => {
  const root = loop();
  jarl(root, 'new', 'Print by hand', '--source', `${SOURCE}#T-2`, '--found-by', `research ${SOURCE}`, '--what', 'Our own words about printing.');
  const list = [finding(), finding({ id: 'T-2', title: 'Print', claim: 'Users can print a report.' }), evidenceOnly(3, 'Gap 3 as seen.')];
  importing(root, findingsFile(written(list)));
  const file = findingsFile(written(list));
  const same = importing(root, file);
  assert.deepEqual([same.compared, same.notCompared], [['T-1'], [{ finding: 'T-2', reason: 'no-issue-of-this-run' }, { finding: 'E-3', reason: 'no-claim-or-truth' }]]);
  assert.match(jarl(root, 'import', file, '--source', SOURCE), new RegExp(`^compared 1 of 3 already filed · not compared: 1 with neither a claim nor a truth, 1 with no issue that reads as filed by import with Found by "research ${SOURCE}"$`, 'm'));
  const other = jarl(root, 'import', file, '--source', SOURCE, '--found-by', 'Research');
  assert.match(other, /^compared 0 of 3 already filed · not compared: 1 with neither a claim nor a truth, 2 with no issue that reads as filed by import with Found by "Research"$/m, 'a re-run with another Found by, in another case too, says it compared none');
  const all = importing(root, findingsFile(written([finding()])));
  assert.deepEqual([all.compared, all.notCompared], [['T-1'], []]);
  assert.match(jarl(root, 'import', findingsFile(written([finding()])), '--source', SOURCE), /^compared 1 of 1 already filed$/m);
  assert.doesNotMatch(jarl(root, 'import', findingsFile(written([finding({ id: 'T-9' })])), '--source', SOURCE, '--dry-run'), /compared/, 'a run with nothing already filed compares nothing and says nothing of it');
});

test('an empty text of the issue leaves its label alone on the line, with no trailing space', () => {
  const root = loop();
  importing(root, findingsFile(written([finding({ impact: undefined })])));
  const text = jarl(root, 'import', findingsFile(written([finding()])), '--source', SOURCE);
  assert.match(text, /^changed since filed · T-1 · issue 1 \(open\) · Why$/m);
  assert.match(text, /^ {4}issue:\n {4}finding: Reports cannot be opened in a sheet\.$/m);
  assert.deepEqual(text.split('\n').filter((l) => / $/.test(l)), []);
});

test('a finding that loses words is a change as one that gains words is, and a paragraph added to the issue by hand is not', () => {
  const root = loop();
  importing(root, findingsFile(written([finding({ claim: 'Users export csv. And xlsx.' })])));
  assert.equal(importing(root, findingsFile(written([finding({ claim: 'Users export csv.' })]))).changed.length, 1, 'words lost at the end');
  assert.equal(importing(root, findingsFile(written([finding({ claim: 'Users export csv. And xlsx. And pdf.' })]))).changed.length, 1, 'words gained at the end');
  jarl(root, 'field', '1', 'What', `${json(root, 'show', '1').sections.what.trim()}\n\nA paragraph the coordinator added.`);
  assert.equal(importing(root, findingsFile(written([finding({ claim: 'Users export csv. And xlsx.' })]))).changed.length, 0);
});

test('the same letters in another Unicode form are not a change', () => {
  const root = loop();
  importing(root, findingsFile(written([finding({ claim: 'Użytkownik eksportuje raport. Zażółć gęślą jaźń.'.normalize('NFC') })])));
  assert.deepEqual(importing(root, findingsFile(written([finding({ claim: 'Użytkownik eksportuje raport. Zażółć gęślą jaźń.'.normalize('NFD') })]))).changed, []);
});
