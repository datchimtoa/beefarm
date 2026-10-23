# Monetag integration

Replaces the original's `show_11373165` call. Note: `libtl.com` — the host in the
original's script tag — **is Monetag's own interstitial SDK host**, so this is a
same-provider upgrade to their documented Telegram Mini App SDK rather than a
switch of vendor.

## What changed

### The SDK tag

```html
<script src="https://libtl.com/sdk.js" data-zone="__AD_ZONE__" data-sdk="__AD_SDK__"></script>
```

Filled at build time by a small Vite plugin from `VITE_AD_ZONE`. With no zone
set the tag is **removed entirely**, so an unconfigured build makes no
third-party request instead of a broken one. Verified both paths:

```
VITE_AD_ZONE unset  -> "<!-- Monetag SDK omitted: VITE_AD_ZONE not set -->"
VITE_AD_ZONE=9876543 -> data-zone="9876543" data-sdk="show_9876543"
```

### The call

Per Monetag's SDK Reference, `show_<zone>({ type, ymid, requestVar })` returns a
Promise. We use `type: 'end'` (rewarded interstitial) and
`requestVar: 'start-shift'`.

`ymid` is **`<telegramId>.<token>`** — the server's 402 response supplies the
token, so the postback can be tied back to the exact shift that requested it.

### The postback

Monetag sends a **GET** with macros substituted, and retries for ~38h:

```
GET /api/ads/postback?secret=…&ymid=42.<token>&event_type=impression
    &reward_event_type=valued&estimated_price=0.0037&request_var=start-shift
    &telegram_id=…&zone_id=…&sub_zone_id=…
```

Handled by `AdVerifier.handleMonetagPostback()`, which differs from our generic
handler in three ways that matter:

| | Generic | Monetag |
| --- | --- | --- |
| Auth | HMAC header | `secret` query param (Monetag stores the URL; the app never sees it) |
| Reward token | separate field | embedded in `ymid` |
| Payout condition | signature valid | signature valid **and** `reward_event_type === 'valued'` |

### The rule that matters most

Monetag's own docs make the argument we already implemented:

> A resolved Promise does not mean the event was monetized. Check
> `reward_event_type` in the result. […] Use the Frontend Callback for the UI
> and the postback for rewards and accounting.

So the client **never** rewards on `then()`. It calls the SDK for the UI, then
re-requests the shift with the token; only the postback marks a token watched.

## Idempotency

Monetag retries for ~38h, so duplicates are normal rather than exceptional.
`non_valued` and already-consumed postbacks answer **200** (so retries stop)
while granting nothing. Only a bad secret or malformed request gets a 400.

## Configuration

| Where | Variable | Value |
| --- | --- | --- |
| Vercel env | `AD_POSTBACK_SECRET` | a random string; also goes in the Monetag postback URL |
| Vercel env | `VITE_AD_ZONE` | your Monetag zone id |
| Monetag SSP | postback URL | `https://<app>/api/ads/postback?secret=<same string>&ymid={ymid}&event_type={event_type}&reward_event_type={reward_event_type}&estimated_price={estimated_price}&request_var={request_var}&telegram_id={telegram_id}&zone_id={zone_id}` |

Both sides must use the same secret. If `AD_POSTBACK_SECRET` is unset the ad
gate is **off** and shifts are free — useful for testing, wrong for production.

## Tests

9 new (`test/monetag.test.js`), 80 total. The important ones:

- a `valued` impression redeems the shift
- **a `non_valued` impression must not grant a shift**
- a wrong secret is rejected
- a retried postback is idempotent, not a double reward
- a `ymid` for a different user cannot pay this user
- a `ymid` without our token is refused
- expired tokens are refused
