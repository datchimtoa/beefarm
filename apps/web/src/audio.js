// Audio: background music plus the original's four interface sounds.
//
// This was missing entirely. The settings toggle flipped `audioEnabled` and
// saved it to the server, but nothing was ever played, so the game was silent
// even with the switch on. The original had a full sound manager (`S`) with a
// looping BGM and click/claim/modal/reward effects.
//
// Browser autoplay policy: audio cannot start until the player interacts with
// the page. `unlock()` is therefore called from the first pointer event, which
// is also what the original did (`document.addEventListener("click", … {once:true})`).

const FILES = {
  bgm: '/music.mp3',
  click: '/click.mp3',
  claim: '/claim.mp3',
  modal: '/modal.mp3',
  reward: '/reward.mp3',
};

const VOLUME = {
  bgm: 0.45,   // deliberately below the effects, as the original did
  sfx: 0.9,
};

let bgm = null;
let effects = {};
let enabled = true;
let unlocked = false;

/** Create the Audio objects once, lazily. */
function ensure() {
  if (bgm) return;
  bgm = new Audio(FILES.bgm);
  bgm.loop = true;
  bgm.volume = VOLUME.bgm;
  bgm.preload = 'auto';

  for (const name of ['click', 'claim', 'modal', 'reward']) {
    const a = new Audio(FILES[name]);
    a.volume = VOLUME.sfx;
    a.preload = 'auto';
    effects[name] = a;
  }
}

function playBgm() {
  if (!enabled) return;
  ensure();
  const p = bgm.play();
  if (p && typeof p.catch === 'function') {
    p.catch((err) => {
      // Autoplay was blocked. Not an error worth surfacing: the next real tap
      // calls unlock() again, which retries. Logged so it is diagnosable.
      console.info('[audio] playback blocked:', err?.name ?? err);
    });
  }
}

/** Start music on the first user gesture. Safe to call repeatedly. */
export function unlock() {
  unlocked = true;
  if (enabled) playBgm();
}

/**
 * True when music is actually audible. Used by tests and by the settings UI to
 * explain why a switch may look on but be silent.
 */
export function isPlaying() {
  return Boolean(bgm) && !bgm.paused && !bgm.ended;
}

/** Apply the saved preference and begin playing if allowed. */
export function setEnabled(next) {
  enabled = Boolean(next);
  ensure();
  if (!enabled) {
    bgm.pause();
    return;
  }
  if (unlocked) playBgm();
}

export function isEnabled() {
  return enabled;
}

/**
 * Play a one-shot effect.
 * @param {'click'|'claim'|'modal'|'reward'} name
 */
export function play(name) {
  if (!enabled || !effects[name]) return;
  const sound = effects[name];
  try {
    sound.currentTime = 0;
    sound.play().catch(() => {});
  } catch {
    /* a missing or blocked file must never break the UI */
  }
}

/** Pause music while a full-screen ad is showing. */
export function duck() {
  bgm?.pause();
}

/** Resume after the ad if the player still has audio on. */
export function unduck() {
  if (enabled && unlocked) playBgm();
}
