## Ad verification (server-to-server postback)

**The leak this closes.** In the original, the client calls the ad SDK, waits
for its promise, then tells the server "ad watched". A client that never shows
the ad still gets paid. That is the single largest revenue hole in the design.

**The fix, in three steps:**

```
1. client POST /api/harvest  (no token)
     -> 402 { errorCode: "ad_required", token: "<nonce>" }

2. ad network POST /api/ads/postback   { token, user_id, signature }
     signature = HMAC_SHA256(AD_POSTBACK_SECRET, `${token}.${user_id}`)
     -> 200 { success: true }          (token now "watched")

3. client POST /api/harvest { adToken: "<nonce>" }
     -> 200 { phase: "shift_started" } (token now spent)
```

The client never sees `AD_POSTBACK_SECRET`, so it cannot mint step 2 itself.

### Guarantees, all covered by tests

| Attack | Result |
| --- | --- |
| Skip the ad, ask for a shift | `402 ad_required` |
| Forge the postback signature | `400 bad_signature` |
| Reuse a token for a second shift | `400 already_spent` |
| Replay the same postback | `400 already_redeemed` |
| Use someone else's token | `400 unknown_or_expired` |
| Wait out the token | `400 unknown_or_expired` (5 min TTL) |
| Harvest a *finished* shift | allowed — it was already earned |

**One bug I hit while testing this:** my first version left a redeemed token
valid forever, so one watched ad could fund unlimited shifts. The
"replay to fund a second shift" test caught it; tokens are now spent on use.

### Trying it locally

The dev server has the gate **on** by default and ships a provider simulator:

```bash
# 1. refused, returns a token
curl -sX POST -H "x-init-data: $INIT" -d '{}' $B/api/harvest
# {"success":false,"errorCode":"ad_required","token":"36ed…"}

# 2. play the ad network's role
curl -sX POST -H 'content-type: application/json' \
  -d '{"token":"36ed…","user_id":"42"}' $B/dev/ad-postback
# {"success":true}

# 3. now it starts
curl -sX POST -H "x-init-data: $INIT" -d '{"adToken":"36ed…"}' $B/api/harvest
# {"success":true,"phase":"shift_started",...}
```

Set `DISABLE_AD_GATE=1` for frictionless local play (never in production).

### What a real provider must do

Give them the postback URL (`POST https://your-host/api/ads/postback`) and one
shared secret. They must send:

```json
{ "token": "<the nonce we returned>", "user_id": "<telegram id>", "signature": "<hmac>" }
```

The `ymid` the original client sent to the SDK is the Telegram id, so it maps
directly onto `user_id`. If your provider cannot sign, the fallback is a
provider-issued transaction id that we verify against their reporting API —
ask before choosing a network, because not all of them offer postbacks.

### Remaining limitation

`AdVerifier` state is in-process memory. That is correct for one instance;
run two and a postback could land on a different box than the shift request.
Before scaling, move `pending`/`consumed`/`spent` to Redis or a Firebase node.
