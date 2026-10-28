import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const WEB_SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const ALIAS_EXTS = ['.ts', '.tsx', '.mjs', '.js', '.mts'];
const loaderSrc = [
  "import { existsSync } from 'node:fs';",
  "import path from 'node:path';",
  "import { pathToFileURL } from 'node:url';",
  `const WEB_SRC = ${JSON.stringify(WEB_SRC)};`,
  `const EXTS = ${JSON.stringify(ALIAS_EXTS)};`,
  'function resolveWithExt(base) {',
  '  for (const ext of EXTS) { if (existsSync(base + ext)) return base + ext; }',
  '  if (existsSync(base)) return base;',
  '  return null;',
  '}',
  'export async function resolve(specifier, context, nextResolve) {',
  "  if (specifier === '@/lib/career-ops' || specifier.startsWith('@/')) {",
  "    const rel = specifier.slice(2);",
  '    const target = path.join(WEB_SRC, rel);',
  '    const found = resolveWithExt(target);',
  '    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };',
  '  }',
  '  return nextResolve(specifier, context);',
  '}',
].join('\n');

try {
  register(`data:text/javascript,${encodeURIComponent(loaderSrc)}`);
} catch {
  // register may throw if already registered in the same process
}

const { loadCandidateProfile, normalizeToApplicationUrl } = await import('@/lib/apply/direct-fill');

test('loadCandidateProfile loads candidate facts with valid URLs', () => {
  const profile = loadCandidateProfile();
  assert.ok(profile.name, 'name must be defined');
  assert.ok(profile.firstName, 'firstName must be defined');
  assert.ok(profile.email.includes('@'), 'email must be valid');
  assert.ok(profile.linkedin.startsWith('http'), 'linkedin must start with http');
  assert.ok(profile.github.startsWith('http'), 'github must start with http');
  assert.ok(profile.workAuth, 'workAuth must be defined');
});

test('normalizeToApplicationUrl rewrites Ashby JD URLs to Application form URLs', () => {
  const jd = 'https://jobs.ashbyhq.com/qlub/975d7158-906a-4c7c-b74d-8ff2dbd55252?workplaceType=Remote';
  const expected = 'https://jobs.ashbyhq.com/qlub/975d7158-906a-4c7c-b74d-8ff2dbd55252/application?workplaceType=Remote';
  assert.equal(normalizeToApplicationUrl(jd), expected);

  // If already application URL, keep it
  assert.equal(normalizeToApplicationUrl(expected), expected);
});

test('normalizeToApplicationUrl rewrites Lever and Workable JD URLs', () => {
  assert.equal(
    normalizeToApplicationUrl('https://jobs.lever.co/company/abc-123'),
    'https://jobs.lever.co/company/abc-123/apply'
  );
  assert.equal(
    normalizeToApplicationUrl('https://apply.workable.com/company/j/abc-123'),
    'https://apply.workable.com/company/j/abc-123/apply'
  );
});
