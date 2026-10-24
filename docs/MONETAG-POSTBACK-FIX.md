# Monetag: why the ad never opened and the button reset

Reported: clicking SHEAR showed no ad, and the button reverted to
`WAITING FOR SHEARING` after about two seconds.

Two independent defects, both found by tracing the live flow rather than
guessing.

## Bug 1 — the ad could never open (user gesture lost)

The click handler did this:

```js
let res = await api.harvest();   // network round-trip
if (res.token) await show_12109522({ ... });
```

Monetag only opens an ad **during a user gesture**, and awaiting a fetch spends
that gesture. Their documented rejection is literally
`"Ad can only be opened directly in response to a user's click"`.

**Fix:** fetch the token *ahead of* the click. `primeAdToken()` runs when the
button becomes actionable (on boot and after each harvest) and stores the nonce
in `state.adToken`. The click handler then calls the SDK with no `await` in
front of it.

Requesting a nonce is free — the server only mints one; it does not start a
shift.

## Bug 2 — the button reset because the client raced the postback

The reward is granted by **Monetag's server-to-server postback**, which arrives
seconds after the SDK Promise resolves. The old code immediately re-requested:

```js
res = await api.harvest(res.token);   // postback had not landed yet
```

Reproduced exactly:

```
immediate retry (no postback yet): 402 {"errorCode":"ad_required"}
```

That 402 is what snapped the UI back to `WAITING FOR SHEARING`.

**Fix:** a new endpoint and a poll.

```
GET /api/ads/status?token=<nonce>  ->  { success: true, watched: boolean }
```

The client polls once a second for up to 20 attempts, showing
`Waiting for server confirmation...` (the original's own string,
`toast_ad_waiting`) while it waits. Only after `watched: true` does it call
`/api/harvest` with the token, which starts the shift.

## Verified flow

```
1 token        : 402 3ab3693d            (server issues a nonce)
2 postback sent                          (Monetag, server-to-server)
3 status       : { success: true, watched: true }
4 shift        : 200 shift_started
5 token reuse  : 409 not_ready           (one token, one shift)
```

## Notes on configuration

The live deployment was already correct:

- SDK tag present: `data-zone="12109522" data-sdk="show_12109522"`
- secret configured (a wrong secret returns `bad_secret`, not
  `ad_verification_not_configured`)

So neither problem was a config error — both were client flow bugs.

## If the ad still does not appear

Check, in this order:

1. **Telegram, not a desktop browser.** Monetag's TMA SDK is built for the
   Telegram WebView; a plain browser often has no fill.
2. **Zone moderation.** A newly created Monetag zone can run with no fill until
   approved. The SDK rejects with `Empty feed` — visible in the console.
3. **`toast_no_ads` on screen** means the SDK threw. The exact message is logged.

The client logs every SDK rejection reason, so the console will name it.

## Tests

4 new (`ad-polling.test.js`), 87 total:

- the old race returns `ad_required` (documents the bug)
- status flips to `watched` after the postback, then the shift starts
- status requires auth and a token
- one watched token cannot start two shifts
