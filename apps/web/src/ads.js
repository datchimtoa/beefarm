// Monetag TMA SDK adapter.
//
// Replaces the original's `show_11373165` call (libtl.com, which is Monetag's
// own interstitial host) with the documented Monetag TMA SDK.
//
// API, from https://docs.monetag.com/docs/sdk-reference:
//   <script src=".../sdk.js" data-zone="<zone>" data-sdk="show_<zone>"></script>
//   show_<zone>({ type: 'end' | 'preload' | 'pop', ymid, requestVar })
//     -> Promise resolving with { reward_event_type, estimated_price, ... }
//
// Two rules from Monetag's own documentation drive the design here:
//
//  1. ymid must be UNIQUE PER CALL, and must embed our token so the server-side
//     postback can be tied back to the shift that requested it. Monetag sends
//     ymid back to our server as {ymid} / variable2.
//  2. A resolved Promise does NOT mean the event was monetised — check
//     reward_event_type. The Promise only drives the UI; the postback grants
//     the reward. Never reward from `then()`.

/**
 * Monetag zone id.
 *
 * Defaults to the rewarded-interstitial zone from adsandanything.md so a build
 * works without extra configuration; VITE_AD_ZONE overrides it for other
 * environments (e.g. a test zone).
 */
export const AD_ZONE = import.meta.env?.VITE_AD_ZONE || '12109522';

/** Global function the SDK creates: show_<zone>. */
export function adFunctionName(zone = AD_ZONE) {
  return `show_${zone}`;
}

export function isAdSdkReady(zone = AD_ZONE) {
  return typeof globalThis[adFunctionName(zone)] === 'function';
}

/**
 * Build the ymid for one ad show.
 *
 * Format: `<telegramId>.<token>` — the server put `token` in the 402 response,
 * so the postback can look it up and confirm this is the same shift.
 */
export function buildYmid(telegramId, token) {
  return token ? `${telegramId}.${token}` : String(telegramId);
}

/**
 * Ask the SDK to show a rewarded interstitial.
 * @returns {Promise<{shown: boolean, monetised: boolean, reason?: string}>}
 */
export async function showRewardedAd({ telegramId, token, requestVar = 'start-shift' }) {
  const zone = AD_ZONE;
  if (!zone) return { shown: false, monetised: false, reason: 'no_zone' };
  if (!isAdSdkReady(zone)) return { shown: false, monetised: false, reason: 'sdk_unavailable' };

  const show = globalThis[adFunctionName(zone)];
  try {
    const result = await show({
      type: 'end',
      ymid: buildYmid(telegramId, token),
      requestVar,
    });
    // The reward itself is granted by the postback, not here. `monetised` is
    // reported only so the UI can say something accurate if it wants to.
    return { shown: true, monetised: result?.reward_event_type === 'valued' };
  } catch (err) {
    // Documented rejections include "Empty feed", "Timeout", "Ad is not ready",
    // "Failed to verify the ad show".
    return { shown: false, monetised: false, reason: err?.message ?? 'failed' };
  }
}
