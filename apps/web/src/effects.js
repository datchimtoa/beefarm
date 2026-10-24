// Harvest and shift animations.
//
// The original had two effects our rebuild was missing, and they are the reason
// the game felt static:
//
//   1. `+182,351 🐑` floats up from wherever the harvest happened
//      (class `wool-particle`, keyframe `floatUp`, 1.5s)
//   2. small crescent "wool strands" fly out of the sheep during a shift
//      (class `crescent-strand`, keyframe `flyOutStrand`, 0.9s)
//
// Both keyframes and both classes already exist in the byte-identical
// stylesheet, so this file only reproduces the original's spawn logic.

const MAX_PARTICLES = 40;

/**
 * Floating "+N" text at the harvest point.
 * Mirrors the original: appended to #wool-particles, removed after 1.5s.
 *
 * @param {HTMLElement | null} host
 * @param {string} label already-formatted amount, e.g. "182,351"
 */
export function spawnWoolReward(host, label) {
  if (!host) return;
  const el = document.createElement('div');
  el.className =
    'absolute text-white font-black text-2xl wool-particle flex items-center text-stroke-brown tracking-wide z-50';
  el.innerHTML = `+${label}<img src="/wool.png" class="w-6 h-8 ml-2 object-contain drop-shadow-md">`;
  host.appendChild(el);
  setTimeout(() => {
    if (el.parentNode === host) host.removeChild(el);
  }, 1500);
}

let strandTimer = null;

/** One crescent strand, positioned and flung exactly as the original does. */
function spawnStrand(host) {
  if (host.childElementCount > MAX_PARTICLES) return;

  const el = document.createElement('div');
  el.className = 'crescent-strand';
  el.style.position = 'absolute';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '40';

  // The original's jitter: left 47–65%, top 25–35%.
  el.style.left = `${18 * Math.random() - 9 + 56}%`;
  el.style.top = `${10 * Math.random() - 5 + 30}%`;

  const angle = Math.random() * Math.PI * 2;
  const distance = 40 + 140 * Math.random();
  el.style.setProperty('--tx', `${Math.cos(angle) * distance}px`);
  el.style.setProperty('--ty', `${Math.sin(angle) * distance}px`);
  el.style.setProperty('--rot', `${720 * Math.random() - 360}deg`);

  host.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

/**
 * Start emitting strands while a shift is running.
 * The original spawned 1–3 strands at most every 90ms via requestAnimationFrame;
 * a plain interval is equivalent here and cheaper.
 *
 * @param {HTMLElement | null} host  #wool-particles
 */
export function startShearEffect(host) {
  if (!host || strandTimer) return;
  strandTimer = setInterval(() => {
    const count = 1 + Math.floor(3 * Math.random());
    for (let i = 0; i < count; i += 1) spawnStrand(host);
  }, 90);
}

/** Stop emitting strands and let the existing ones finish. */
export function stopShearEffect() {
  if (strandTimer) {
    clearInterval(strandTimer);
    strandTimer = null;
  }
}
