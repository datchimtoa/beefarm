#!/usr/bin/env node
// Push apps/api/fixtures/system_config.json into the live Firebase database.
//
//   GOOGLE_APPLICATION_CREDENTIALS=~/.secrets/beefarm-service-account.json \
//   node apps/api/sync-config.js
//
// Why this exists: `Economy.config()` merges the stored config over
// DEFAULT_CONFIG, so a stale database still behaves correctly — but it hides
// which values are actually live, and an admin editing the console would not
// see the newer keys at all. Syncing keeps the database the single readable
// source of truth.
//
// Only the keys present in the fixture are written; anything else in
// system_config is left alone.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FirebaseStore } from './lib/store-firebase.js';
import { DEFAULT_CONFIG } from './lib/economy.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'system_config.json');
const DB_URL = process.env.FIREBASE_DATABASE_URL
  ?? 'https://beefarm-9ad69-default-rtdb.asia-southeast1.firebasedatabase.app';

const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credsPath) {
  console.error('  ERROR  GOOGLE_APPLICATION_CREDENTIALS is not set');
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(credsPath, 'utf8'));
} catch (err) {
  console.error(`  ERROR  cannot read the service account: ${err.message}`);
  process.exit(1);
}

const { system_config: seed } = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const argv = process.argv.slice(2);
const store = new FirebaseStore({ databaseUrl: DB_URL, serviceAccount });

console.log(`database : ${DB_URL}`);
console.log(`fixture  : ${Object.keys(seed).length} keys`);

// A seed that disagrees with the code defaults is a bug, not a preference:
// whichever wins would surprise someone later.
const mismatched = Object.entries(seed).filter(([k, v]) => DEFAULT_CONFIG[k] !== v);
if (mismatched.length) {
  console.warn('\n  WARN  fixture differs from DEFAULT_CONFIG:');
  for (const [k, v] of mismatched) {
    console.warn(`        ${k}: fixture ${v} vs default ${DEFAULT_CONFIG[k]}`);
  }
}

const before = await store.getConfig();
console.log(`live     : ${Object.keys(before).length} keys before`);

// Remove keys the fixture no longer declares. Without this the database keeps
// stale entries from earlier schemas (woolPerShift*, shiftDurationMs) and the
// console misrepresents what the server actually reads.
const prune = argv.includes('--prune');
const stale = Object.keys(before).filter((k) => !(k in seed));

await store.putConfig(seed);

if (prune && stale.length) {
  await store.putConfig(Object.fromEntries(stale.map((k) => [k, null])));
  console.log(`\n  pruned ${stale.length} stale key(s): ${stale.join(', ')}`);
} else if (stale.length) {
  console.log(`\n  note: ${stale.length} stale key(s) still present: ${stale.join(', ')}`);
  console.log('        re-run with --prune to remove them');
}

const after = await store.getConfig();
console.log(`live     : ${Object.keys(after).length} keys after\n`);
for (const key of Object.keys(seed).sort()) {
  const changed = before[key] !== after[key];
  console.log(`  ${changed ? '*' : ' '} ${key.padEnd(22)} ${after[key]}`);
}
console.log('\nsystem_config is in sync.\n');
process.exit(0);
