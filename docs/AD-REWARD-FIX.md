# Why the ad reward never landed

Reported: ads play and complete, but no wool is credited — neither on "continue"
nor after watching the full 15 seconds.

## Cause 1 (the blocker): ad tokens were per-instance memory

`AdVerifier` kept tokens in three `Map`/`Set` fields **on its own instance**:

```js
this.pending  = new Map();   // tokenId -> { userId, expiresAt }
this.consumed = new Set();
this.spent    = new Set();
```

Vercel runs serverless functions, so requests land on **different instances**.
The chain was:

```
instance A: SHEAR -> issues token "abc", stores it in A's memory
instance B: Monetag postback -> looks up "abc" -> not found
            -> unknown_or_expired -> no reward
```

The player watched the whole ad and was silently unpaid. Nothing logged as an
error, because from B's point of view the token genuinely did not exist.

This could never have been caught locally: a single `node dev-server.js` process
holds one instance, so the token was always in memory.

## Fix: tokens in the durable store

`AdVerifier` now takes the same store the economy uses (`FirebaseStore` in
production, `MemoryStore` in tests) and keeps one record per token:

```json
{ "userId": "42", "status": "pending | watched | spent", "expiresAt": 1792… }
```

All token methods are now async and read through the store:

| Method | Meaning |
| --- | --- |
| `issue(userId)` | create `status: pending` |
| `isAdWatched(userId, token)` | `status === 'watched'` |
| `redeem(userId, token)` | `pending -> watched` (the postback) |
| `consumeForShift(userId, token)` | `watched -> spent` (starting the shift) |

Statuses are written before returning, so two concurrent requests cannot both
spend the same token.

## Verified against real Firebase

Two `AdVerifier` objects sharing one Firebase store — exactly like two Vercel
instances:

```
issued on A  : 2fb95fcf17
B sees it    : true          <- the instance that never issued it
postback on B: true
A sees watch : true
A consumes   : true
B consumes   : false (must be false)
```

## Cause 2 (also present): the secret in Vercel differs from the URL

`GET /api/ads/postback?secret=<the one I generated>` returns:

```json
{"success":false,"reason":"bad_secret"}
```

So `AD_POSTBACK_SECRET` **is** set in Vercel, but it is not the value embedded in
the Monetag postback URL. Every real postback is rejected before it reaches the
token logic.

The two must match exactly. Changing either one means updating both:

- Monetag SSP: the `secret=` query parameter in the postback URL
- Vercel: the `AD_POSTBACK_SECRET` environment variable (then redeploy)

## Tests

100 passing, including three that pin this bug:

- a postback handled by a *different* app instance still finds the token
- two verifier instances share state through the store
- a token cannot be spent twice across instances
