#!/usr/bin/env node
// One-command check that Firebase is wired correctly.
//
//   export GOOGLE_APPLICATION_CREDENTIALS=~/.secrets/alod-service-account.json
//   node server/check-firebase.js
//
// Exits non-zero with an actionable message on any failure, so you never have
// to guess whether it is the URL, the key, or the rules.
import { FirebaseStore } from './lib/store-firebase.js';

const databaseUrl = process.env.FIREBASE_DATABASE_URL
  ?? 'https://beefarm-9ad69-default-rtdb.asia-southeast1.firebasedatabase.app';

function fail(msg, hint) {
  console.error(`\n  FAIL  ${msg}`);
  if (hint) console.error(`        ${hint}`);
  process.exit(1);
}

const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
console.log(`database : ${databaseUrl}`);
console.log(`credentials: ${credsPath ?? '(application default)'}`);

if (!credsPath) {
  fail(
    'GOOGLE_APPLICATION_CREDENTIALS is not set',
    'Download a service account key (FIREBASE-SETUP.md part 5) and export the path.'
  );
}

const { readFileSync } = await import('node:fs');
let key;
try {
  key = JSON.parse(readFileSync(credsPath, 'utf8'));
} catch (err) {
  fail(`cannot read/parse the service account file: ${err.message}`, credsPath);
}
for (const field of ['project_id', 'client_email', 'private_key']) {
  if (!key[field]) fail(`service account is missing "${field}"`, 'Re-download it from the console.');
}
console.log(`project  : ${key.project_id}`);

const expectedHost = `${key.project_id}-default-rtdb`;
if (!databaseUrl.includes(expectedHost) && !databaseUrl.includes(key.project_id)) {
  console.warn(
    `\n  WARN  database URL does not mention project "${key.project_id}".` +
      '\n        Make sure they belong to the same Firebase project.'
  );
}

const store = new FirebaseStore({ databaseUrl, serviceAccount: key });

let timer;
try {
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('timed out after 20s (network blocked, or wrong region host)')),
      20_000
    );
  });
  const config = await Promise.race([store.getConfig(), timeout]);
  console.log(`\n  OK    read system_config -> ${JSON.stringify(config)}`);
  if (!config || Object.keys(config).length === 0) {
    console.warn('        (empty: import server/fixtures/system_config.json — see FIREBASE-SETUP.md part 3)');
  }

  const probe = { telegramId: '__probe__', ts: Date.now() };
  await store.putUser(probe);
  const back = await store.getUser('__probe__');
  if (!back || back.ts !== probe.ts) fail('write did not round-trip');
  console.log('  OK    write + read a probe user');
} catch (err) {
  const msg = String(err.message).split('\n')[0];
  if (/invalid_grant|invalid_client|Getting metadata|credentials/i.test(msg)) {
    fail(msg, 'The service account key is invalid or was deleted. Generate a new one.');
  }
  if (/ENOTFOUND|EAI_AGAIN|timeout/i.test(msg)) {
    fail(msg, 'Network problem: check the database URL host and your connectivity.');
  }
  fail(msg, 'Check the database URL, then the rules (FIREBASE-SETUP.md parts 2 and 4).');
} finally {
  clearTimeout(timer);
}

console.log('\nFirebase is wired correctly.\n');
process.exit(0);
