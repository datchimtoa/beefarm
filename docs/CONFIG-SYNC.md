# Config sync

## The problem this fixes

`Economy.config()` merges the **stored** config over `DEFAULT_CONFIG`:

```js
return { ...DEFAULT_CONFIG, ...(await this.store.getConfig()) };
```

That is the right behaviour — a stale database never breaks the game. But it
hid a real divergence: after the yield range was added, the live database still
held only the old **7 keys**, with no `woolPerShiftMin` / `woolPerShiftMax`.

Consequences if left alone:

- the game behaved correctly (defaults filled the gap), so nothing looked wrong
- anyone reading `system_config` in the Firebase console would not see the keys,
  and would edit a document that does not describe what is actually running
- an admin "fixing" the payout by setting `woolPerShift` would be surprised that
  a range silently overrides it

## The fix

`apps/api/sync-config.js` pushes the fixture into the database:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.secrets/beefarm-service-account.json"
node apps/api/sync-config.js
```

Live before/after:

```
live     : 7 keys before
live     : 9 keys after
  * woolPerShiftMax        198000
  * woolPerShiftMin        165000
```

It reports which keys changed, and **warns if the fixture disagrees with
`DEFAULT_CONFIG`** — a fixture that contradicts the code is a bug, not a
preference, because whichever wins would surprise someone later.

## Supporting changes

- `FirebaseStore.putConfig()` and `MemoryStore.putConfig()` — merge semantics,
  so changing one value never wipes the rest.
- 5 tests, including:
  - `putConfig` merges rather than replaces
  - **the fixture covers every key `DEFAULT_CONFIG` declares** (this is the
    check that would have caught the missing range immediately)
  - the fixture values match the code defaults
  - a stored config overrides defaults while everything else still applies
  - an admin can change the yield range at runtime, no restart

125 tests passing.
