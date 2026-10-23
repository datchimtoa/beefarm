## Referral payouts

`refPercent` was previously dead config — referral links were recorded but
never paid. It is now applied on every harvest.

**Rule:** when a referee harvests, the referrer receives `floor(credited × refPercent / 100)`
of the wool the referee just banked. The referee keeps 100% — the bonus is
minted for the referrer, not deducted from the player.

At the default config that is **18,235 wool per harvest** (`182,351 × 10%`).

### Guards

| Case | Behaviour |
| --- | --- |
| No referrer | no payout, harvest succeeds normally |
| Self-referral | refused at registration **and** at payout time |
| Referrer banned | payout skipped; referee unaffected |
| Referrer deleted | payout skipped; referee unaffected |
| `refPercent: 0` | disabled, no payout |
| Link recorded twice | second attempt ignored (`already_referred`) |
| Unknown referrer id | ignored, player unaffected |
| Rounding | floored, so it can never mint fractional wool |

The payout is deliberately non-fatal: a broken referral record must never stop
a player from collecting what they earned.

### A real bug found here: lost updates

The first implementation read the referrer, added the bonus and wrote the whole
record back. Because `getUser()` returns a copy, **two referees harvesting at
the same instant overwrote each other**:

```
6 concurrent harvests -> referrer credited 18,235 instead of 109,410
```

Silent underpayment, and the kind of bug that only shows up under load. Fixed
by adding `store.increment(id, field, delta)`:

- `MemoryStore.increment` — clone-modify-set under one call
- `FirebaseStore.increment` — a real RTDB **transaction**

Verified on live Firebase: two concurrent referees credited the referrer
`36,470` = exactly `2 × 18,235`.

There is now a regression test (`REGRESSION: concurrent harvests do not lose
referral payouts`) that fails if anyone reintroduces read-modify-write.

### Concurrency note for other fields

`increment` covers the shared-record case. A player's *own* balance still uses
read-modify-write, which is safe only because one player acts on their own
record serially. If you ever add shared balances (pools, team rewards), route
them through `increment` too.
