#!/usr/bin/env node
/**
 * Checks a release build before it goes public. npm run aws:deploy runs it and stops on failure.
 *
 *   node frontend/scripts/release-check.mjs             check frontend/out
 *   node frontend/scripts/release-check.mjs --preview   skip "deployOnly" rules (local preview builds talk to 127.0.0.1)
 *
 * The rules are in frontend/release-check.json: text that must not appear (dev tools, debug
 * hints, personal details), files that must not ship, and size limits. On top of those it checks
 * that no secret file's contents (the admin token) appear anywhere, and that every internal link
 * in the HTML points at a page that exists in the build.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const preview = process.argv.includes('--preview');
const dir = path.join(frontend, 'out');
const rules = JSON.parse(fs.readFileSync(path.join(frontend, 'release-check.json'), 'utf8'));

if (!fs.existsSync(dir)) {
  console.error(`No build at ${dir}. Build first (npm run build:release).`);
  process.exit(1);
}

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(p);
  }
})(dir);
const rel = (p) => path.relative(dir, p).split(path.sep).join('/');
const isText = (p) => /\.(html|txt|js|css|json|svg|xml|webmanifest)$/i.test(p);

/** Problems keyed by what was found, so one string in 30 files is one line. */
const problems = new Map();
const fail = (what, where, why) => {
  const p = problems.get(what) ?? { why, where: [] };
  p.where.push(where);
  problems.set(what, p);
};

// Minified JS may write non-ASCII characters (’) as ’, so look for both spellings.
const jsEscaped = (s) => s.replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const texts = rules.forbiddenText.filter((r) => !(preview && r.deployOnly)).map((r) => ({ ...r, spellings: [...new Set([r.text, jsEscaped(r.text)])] }));
const secrets = (rules.secretFiles ?? [])
  .map((f) => path.resolve(frontend, f))
  .filter((f) => fs.existsSync(f))
  .map((f) => fs.readFileSync(f, 'utf8').trim())
  .filter(Boolean);

let total = 0;
for (const f of files) {
  const name = rel(f);
  const size = fs.statSync(f).size;
  total += size;
  if (size > rules.limits.fileMB * 1e6) fail(`a ${(size / 1e6).toFixed(1)} MB file`, name, `over the ${rules.limits.fileMB} MB per-file limit: visitors download it, and bandwidth is what costs money`);
  for (const r of rules.forbiddenFiles) if (new RegExp(r.pattern).test(name)) fail(`a file matching ${r.pattern}`, name, r.why);
  if (!isText(f)) continue;
  const body = fs.readFileSync(f, 'utf8');
  for (const t of texts) if (t.spellings.some((s) => body.includes(s))) fail(`"${t.text}"`, name, t.why);
  for (const s of secrets) if (body.includes(s)) fail('the admin token', name, 'secrets must never ship');
}
if (total > rules.limits.totalMB * 1e6) fail(`${(total / 1e6).toFixed(1)} MB in total`, '(the whole site)', `over the ${rules.limits.totalMB} MB limit`);

// Internal links must land on something this build contains (e.g. no links to the dev-only Lab).
const exists = (href) => {
  const p = path.join(dir, decodeURIComponent(href.split(/[?#]/)[0]));
  return (fs.existsSync(p) && (fs.statSync(p).isFile() || fs.existsSync(path.join(p, 'index.html')))) || fs.existsSync(`${p}.html`);
};
for (const f of files.filter((f) => f.endsWith('.html'))) {
  for (const [, href] of fs.readFileSync(f, 'utf8').matchAll(/\shref="(\/(?!\/)[^"]*)"/g)) if (!exists(href)) fail(`a link to ${href}`, rel(f), 'points at a page that is not in this build');
}

const mb = (total / 1e6).toFixed(1);
if (!problems.size) {
  console.log(`Release check passed: ${files.length} files, ${mb} MB${preview ? ' (preview: deployOnly rules skipped)' : ''}.`);
  process.exit(0);
}
console.error(`Release check FAILED (${files.length} files, ${mb} MB):`);
for (const [what, { why, where }] of problems) {
  const list = where.slice(0, 3).join(', ') + (where.length > 3 ? ` and ${where.length - 3} more` : '');
  console.error(`  ✗ ${what} in ${list}\n      ${why}`);
}
console.error('Fix these, or change frontend/release-check.json if a rule is wrong.');
process.exit(1);
