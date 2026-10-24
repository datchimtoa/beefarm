// DOM rendering. Pure functions of state -> DOM, so every screen is a
// consequence of the store rather than scattered mutations.
import { formatNumber, toGram } from './state.js';
import { t } from './i18n.js';
import { spawnWoolReward, startShearEffect, stopShearEffect } from './effects.js';
import { formatCountdown, isWithdrawLocked, nextSettlement } from './clock.js';

const $ = (id) => document.getElementById(id);

export function toast(message, kind = 'success') {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.className =
    kind === 'error'
      ? 'game-card px-4 py-2 text-sm font-bold text-[#5F270A] bg-[#FFB4B4]'
      : 'game-card px-4 py-2 text-sm font-bold text-[#5F270A] bg-[#9DFB6E]';
  el.classList.remove('show');
  void el.offsetWidth; // restart the CSS transition
  el.classList.add('show');
}

/**
 * Translate every element carrying a data-key attribute.
 *
 * The original did this in X() at runtime, which is why index.html ships English
 * text that is immediately replaced. Placeholders here are only the static ones
 * (drop-in text); dynamic values are set by renderState().
 */
export function applyTranslations() {
  for (const el of document.querySelectorAll('[data-key]')) {
    const key = el.getAttribute('data-key');
    const value = t(key);
    // Keys with {placeholders} (e.g. preparing) are owned by the code that
    // supplies the value. Writing the raw template here is what produced the
    // literal "Preparing farm... {progress}%" on screen.
    if (value === key || value.includes('{')) continue;
    el.textContent = value;
  }
  for (const el of document.querySelectorAll('input[data-key]')) {
    const key = el.getAttribute('data-key');
    const value = t(key);
    if (value !== key) el.placeholder = value;
  }
}

/** Swap the loader for the app shell. */
function completeLoaderHide() {
  const loader = document.getElementById('initial-loader');
  const content = document.getElementById('app-content');
  if (!loader || !content) return;
  loader.style.opacity = '0';
  setTimeout(() => {
    loader.style.display = 'none';
    content.style.display = 'flex';
    requestAnimationFrame(() => {
      content.style.opacity = '1';
    });
  }, 300);
}

/** Hide the loader immediately (used on fatal errors). */
export function hideLoader() {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
  completeLoaderHide();
}

/**
 * Animated loading progress, mirroring the original's loop.
 *
 * The original crept towards 90% with `p += rnd(10)+2` every 120ms and only
 * jumped to 100% once the player record had loaded (`else if (M)`). Without
 * this the bar sat at 0% and the text rendered the raw template
 * "Preparing farm... {progress}%", because applyTranslations() does not pass
 * placeholder values.
 */
let progressTimer = null;
let progressValue = 0;

function paintProgress(value) {
  const bar = document.getElementById('loading-bar');
  const text = document.getElementById('loading-text');
  if (bar) bar.style.width = `${value}%`;
  if (text) text.textContent = t('preparing', { progress: Math.floor(value) });
}

/** Begin the fake progress ramp; safe to call once. */
export function startLoader() {
  if (progressTimer) return;
  progressValue = 0;
  paintProgress(0);

  progressTimer = setInterval(() => {
    if (progressValue < 90) {
      progressValue = Math.min(90, progressValue + Math.floor(Math.random() * 10) + 2);
      paintProgress(progressValue);
    }
  }, 120);
}

/** Jump to 100%, then reveal the app. Matches the original's finish sequence. */
export function finishLoader() {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
  progressValue = 100;
  paintProgress(100);
  setTimeout(completeLoaderHide, 400);
}


/** Paint everything that depends on player state. */
export function renderState(state, now = Date.now()) {
  const setText = (id, value) => {
    const el = $(id);
    if (el) el.textContent = value;
  };

  for (const el of document.querySelectorAll('.val-wool')) {
    el.textContent = formatNumber(state.wool);
  }
  setText('val-pendingWool', formatNumber(state.pendingWool));
  setText('val-referrals', formatNumber(state.referrals));
  setText('val-refEarnedWool', formatNumber(state.refEarnedWool));

  renderMainAction(state, now);
  renderWithdraw(state, now);
}

function renderMainAction(state, now) {
  const btn = $('btn-main-action');
  const icon = $('icon-main-action');
  const txt = $('txt-main-action');
  const desc = $('desc-main-action');
  const bigTimer = $('val-big-timer');
  if (!btn) return;

  const hasShift = state.pendingWool > 0;
  const ready = hasShift && now >= state.workEndTime;

  if (!hasShift) {
    if (bigTimer) bigTimer.textContent = t('status_waiting');
    if (txt) txt.textContent = t('btn_shear');
    if (desc) desc.textContent = t('shift_duration');
    if (icon) icon.setAttribute('data-lucide', 'scissors');
    btn.disabled = false;
    btn.dataset.phase = 'start';
    stopShearEffect();
    $('scissors-img')?.classList.add('hidden');
    // The original hides the timer/action cards until a shift exists.
    $('normal-action-cards')?.classList.add('hidden');
  } else if (ready) {
    if (bigTimer) bigTimer.textContent = t('status_ready');
    if (txt) txt.textContent = t('harvest_btn');
    if (desc) desc.textContent = t('task_reward_wool', { amount: formatNumber(state.pendingWool) });
    if (icon) icon.setAttribute('data-lucide', 'package-open');
    btn.disabled = false;
    btn.dataset.phase = 'harvest';
    stopShearEffect();
    $('scissors-img')?.classList.add('hidden');
    $('normal-action-cards')?.classList.remove('hidden');
  } else {
    if (bigTimer) bigTimer.textContent = formatCountdown(state.workEndTime - now);
    if (txt) txt.textContent = t('status_working');
    if (desc) desc.textContent = t('status_working_desc');
    if (icon) icon.setAttribute('data-lucide', 'timer');
    btn.disabled = true;
    btn.dataset.phase = 'working';
    startShearEffect($('wool-particles'));
    $('scissors-img')?.classList.remove('hidden');
    $('normal-action-cards')?.classList.remove('hidden');
  }
  globalThis.lucide?.createIcons?.();
}

function renderWithdraw(state, now) {
  const locked = isWithdrawLocked(state.lastWithdrawTime, now);
  const form = $('withdraw-form-container');
  const countdown = $('withdraw-countdown-container');

  if (form) form.classList.toggle('hidden', locked);
  if (countdown) countdown.classList.toggle('hidden', !locked);

  const minEl = document.querySelector('[data-key="withdraw_min"]');
  if (minEl) {
    minEl.textContent = `* Minimum: ${formatNumber(state.minWithdraw)} Wool = ${toGram(
      state.minWithdraw,
      state.rateTon
    )} GRAM`;
  }

  // The payout countdown box is only meaningful while a withdrawal is pending.
  const truckBox = $('truck-timer-box');
  if (truckBox) truckBox.classList.toggle('hidden', !locked);

  // The original re-labelled the countdown card per state, so reuse its strings.
  if (countdown) {
    const heading = countdown.querySelector('h3');
    const note = countdown.querySelector('p');
    if (heading) heading.textContent = t(locked ? 'withdraw_waiting_truck' : 'truck_arrived');
    if (note && locked) {
      note.textContent = t('withdraw_waiting_desc', {
        time: nextSettlement(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    }
  }

  if (locked) {
    const timerEl = $('val-truck-timer');
    if (timerEl) {
      const remaining = nextSettlement(now) - now;
      const hh = String(Math.floor(remaining / 3_600_000)).padStart(2, '0');
      const mm = String(Math.floor((remaining % 3_600_000) / 60_000)).padStart(2, '0');
      const ss = String(Math.floor((remaining % 60_000) / 1000)).padStart(2, '0');
      timerEl.textContent = `${hh}:${mm}:${ss}`;
    }
  }
}

/** Task list. Statuses come from the server's completedTasks. */
export function renderTasks(tasks, completedTasks = []) {
  const list = $('task-list');
  if (!list) return;
  const done = new Set(completedTasks);

  list.innerHTML = tasks
    .map((task) => {
      const claimed = done.has(task.id);
      return `
      <div class="game-card p-3 flex justify-between items-center mb-3 opacity-${claimed ? '60' : '100'}">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 bg-[#FFE8A1] border-2 border-[#D4A373] rounded-xl flex items-center justify-center shadow-sm">
            <i data-lucide="${task.type === 'chat' ? 'messages-square' : 'send'}" class="text-[#4A90E2] w-5 h-5"></i>
          </div>
          <div>
            <p class="text-sm font-black text-[#5F270A]">Join ${task.channel}</p>
            <p class="text-xs text-[#97BA42] font-black mt-1">+ ${formatNumber(task.reward)} Wool</p>
          </div>
        </div>
        ${
          claimed
            ? '<button class="bg-[#D4A373] text-[#FFE8A1] border-2 border-[#D4A373] px-3 py-1.5 rounded-xl text-xs font-black cursor-not-allowed">Claimed</button>'
            : `<button class="task-claim-btn game-btn-yellow px-3 py-1.5 rounded-xl text-xs font-black uppercase shadow-md" data-id="${task.id}">Claim</button>`
        }
      </div>`;
    })
    .join('');
  globalThis.lucide?.createIcons?.();
}

export function renderHistory(history = [], rateTon = 450_000_000) {
  const el = $('withdraw-history');
  if (!el) return;
  if (!history.length) {
    el.innerHTML =
      '<div class="text-center text-sm font-bold text-[#8B5A2B] opacity-70">No transactions yet.</div>';
    return;
  }
  el.innerHTML = history
    .slice()
    .reverse()
    .map(
      (w) => `
      <div class="game-card p-3 flex justify-between items-center mb-2">
        <div>
          <p class="text-sm font-black text-[#97BA42]">${(w.amount / rateTon).toFixed(8)} GRAM</p>
          <p class="text-[9px] text-[#8B5A2B] font-bold truncate max-w-[180px]">${w.wallet}</p>
          <p class="text-[9px] text-[#8B5A2B] font-bold opacity-80">${new Date(w.timestamp).toLocaleString()}</p>
        </div>
        <span class="text-[10px] font-black px-2 py-1 rounded-lg border-2 ${
          w.status === 'paid'
            ? 'bg-[#9DFB6E] text-[#5F270A] border-[#5F270A]'
            : 'bg-[#FFD659] text-[#5F270A] border-[#8B5A2B]'
        }">${w.status}</span>
      </div>`
    )
    .join('');
}
