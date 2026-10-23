import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');

test('a root package.json declares the function dependencies', () => {
  // Vercel installs dependencies for a function declared at /api from the repo
  // root. apps/api/node_modules is gitignored, so without this the function
  // deployed with no firebase-admin and every /api request returned
  // FUNCTION_INVOCATION_FAILED (500). That is why no button responded.
  const pkgPath = join(REPO, 'package.json');
  assert.ok(existsSync(pkgPath), 'root package.json is missing');

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  assert.ok(pkg.dependencies, 'root package.json has no dependencies');
  assert.ok(
    pkg.dependencies['firebase-admin'],
    'firebase-admin must be a root dependency so the api function can resolve it'
  );
});

test('the api function entrypoint delegates to the shared handler', () => {
  const entry = join(REPO, 'api', 'index.js');
  assert.ok(existsSync(entry), 'api/index.js missing');
  const source = readFileSync(entry, 'utf8');
  assert.match(source, /export\s*\{\s*default\s*\}\s*from/, 'entrypoint must re-export the handler');
  assert.ok(
    source.includes('apps/api/handler/vercel.js'),
    'entrypoint should delegate to apps/api/handler/vercel.js'
  );
});

test('the handler only needs modules the root install provides', () => {
  const handler = readFileSync(join(REPO, 'api', 'index.js'), 'utf8');
  const target = handler.match(/from\s*'([^']+)'/)?.[1];
  assert.ok(target, 'no re-export target found');

  const resolved = join(REPO, 'api', target);
  assert.ok(existsSync(resolved), `re-export target does not exist: ${resolved}`);
});
