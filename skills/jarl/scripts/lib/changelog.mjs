// Changelog fragments.

import { basename } from 'node:path';
import { need } from './base.mjs';
import { CHANGELOG_SECTIONS, changelogEntries } from './issues.mjs';
import { repoFromInput, repoNames, topOf } from './repositories.mjs';
import { issueTops } from './tips.mjs';
import { issuesFor } from './shared.mjs';

// ---- changelog fragments -----------------------------------------------------------------------------

// changelog <ids> [--repo <path>] — the ## Changelog entries of those issues, grouped by Keep a Changelog section in
// its order, ready to paste under [Unreleased] at merge time; one block per repository when the issues span several
// (an issue naming two is printed under each), or only the one --repo names. Workers record their line on the issue
// (new --changelog, or field <id> Changelog) instead of editing CHANGELOG.md, so parallel branches stop conflicting there; whoever merges
// writes the file once. Reads only.
export function cmdChangelog(root, rawIds, flags = {}) {
  need(rawIds !== undefined, 'changelog requires <ids> — the issues whose fragments to print, e.g. 284,288 or 203-206', () => ({ arg: 0, value: '<ids>' }));
  const issues = issuesFor(root, rawIds, true);
  // --repo is matched by the repository itself (its resolved root), never by its directory name alone.
  const only = flags.repo !== undefined ? topOf(repoFromInput(root, flags.repo).main) : null;
  const byRepo = {};
  const missing = [];
  for (const i of issues) {
    const entries = changelogEntries(i);
    if (!entries.length) { missing.push(i.id); continue; }
    if (only && !issueTops(root, i).includes(only)) continue;
    const names = only ? [basename(only)] : repoNames(root, i);
    for (const r of names) {
      const sec = (byRepo[r] = byRepo[r] || {});
      for (const e of entries) (sec[e.section] = sec[e.section] || []).push(e.text);
    }
  }
  const order = (sec) => Object.fromEntries(CHANGELOG_SECTIONS.filter((k) => sec[k]).map((k) => [k, sec[k]]));
  const repos = Object.keys(byRepo).sort();
  const block = (sec) => CHANGELOG_SECTIONS.filter((k) => sec[k]).map((k) => `### ${k}\n${sec[k].map((t) => `- ${t}`).join('\n')}`).join('\n\n');
  const text = repos.length > 1 ? repos.map((r) => `## ${r}\n\n${block(byRepo[r])}`).join('\n\n') : repos.length ? block(byRepo[repos[0]]) : '';
  return { ids: issues.map((i) => i.id), missing, repos: Object.fromEntries(repos.map((r) => [r, order(byRepo[r])])), ...(repos.length <= 1 ? { sections: repos.length ? order(byRepo[repos[0]]) : {} } : {}), text };
}
