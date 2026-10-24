// Entry point. Wires Telegram -> API -> store -> DOM.
//
// Design rules that differ from the original on purpose:
//  1. no direct database access; everything goes through /api
//  2. no silent failures: every error path shows a visible message
//  3. no frozen promises: a 401 shows an error instead of hanging forever
import { initTelegram, showFatal, hideFatal, markReady } from './telegram.js';
import { api, ApiError } from './api.js';
import { createStore, formatNumber, toGram } from './state.js';
import {
  toast,
  hideLoader,
  startLoader,
  finishLoader,
  renderState,
  renderTasks,
  renderHistory,
  applyTranslations,
} from './render.js';
import { loadLocale, t, locale } from './i18n.js';
import { showRewardedAd } from './ads.js';

const TASKS = [
  { id: 't1', channel: 'Lucky Sheep Farm Channel', reward: 5_000, type: 'channel' },
  { id: 't2', channel: 'Lucky Sheep Farm Chat', reward: 5_000, type: 'chat' },
  { id: 't3', channel: 'Bee Farm Channel', reward: 5_000, type: 'channel' },
  { id: 't4', channel: 'Bee Farm Chat', reward: 5_000, type: 'chat' },
];

// Server error codes map onto the original's own api_* strings, so the copy a
// player sees matches the reference exactly. An unknown code still surfaces the
// code itself rather than hiding the failure.
const message = (code) =>
  t(`api_${code}`) === `api_${code}` ? `Something went wrong (${code}).` : t(`api_${code}`);

const store = createStore();
const el = (id) => document.getElementById(id);

// Load the player's language first: every rendered string comes from it.
const boot = initTelegram();
if (!boot.ok) {
  hideLoader();
  showFatal(boot.message);
} else {
  // No top-level await: the bundle targets es2020 for older Telegram webviews.
  startLoader();
  loadLocale(boot.locale ?? 'en')
    .catch(() => 'en')
    .then(() => start(boot));
}

function start({ webApp, user }) {
  bindTabs();
  bindMainAction();
  bindTasks();
  bindWithdraw();
  bindReferral();
  bindSettings();

  applyTranslations();
  store.subscribe((state) => renderState(state));
  renderTasks(TASKS, []);

  // 1s tick keeps countdowns honest without re-fetching.
  setInterval(() => renderState(store.get()), 1_000);
  refresh();

  async function refresh() {
    try {
      const { me } = await api.me();
      store.set(me);
      renderTasks(TASKS, me.completedTasks);
      renderHistory(me.withdrawHistory, me.rateTon);
      finishLoader();
      hideFatal();
      markReady(webApp);
      primeAdToken();
    } catch (err) {
      hideLoader();
      handleError(err);
    }
  }

  function handleError(err) {
    if (err instanceof ApiError) {
      if (err.code === 'unauthorized') showFatal(message('unauthorized'));
      else toast(message(err.code), 'error');
    } else {
      // Network / CORS / offline: exactly the class of error worth surfacing
      // on the player's screen instead of a blank page.
      showFatal(`Cannot reach the server. ${err.message ?? ''}`.trim());
    }
  }

  function bindTabs() {
    const tabs = document.querySelectorAll('.nav-btn');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.target;
        tabs.forEach((t) => {
          t.classList.remove('text-[#5F270A]', 'active-nav');
          t.classList.add('text-[#D4A373]');
        });
        tab.classList.add('text-[#5F270A]', 'active-nav');
        tab.classList.remove('text-[#D4A373]');
        document.querySelectorAll('.tab-content').forEach((c) => {
          c.classList.toggle('hidden-tab', c.id !== target);
        });
      });
    });
  }

  function withBusy(button, fn) {
    return async () => {
      if (button?.disabled) return;
      const original = button?.innerHTML;
      if (button) {
        button.disabled = true;
        button.style.opacity = '0.5';
      }
      try {
        await fn();
      } catch (err) {
        handleError(err);
      } finally {
        if (button) {
          button.disabled = false;
          button.style.opacity = '1';
          if (original) button.innerHTML = original;
        }
      }
    };
  }

  function bindMainAction() {
    const btn = el('btn-main-action');
    if (!btn) return;
    btn.addEventListener(
      'click',
      withBusy(btn, async () => {
        const phase = btn.dataset.phase;

        if (phase === 'harvest') {
          const res = await api.harvest();
          store.set({ wool: res.wool, pendingWool: 0, workEndTime: 0 });
          toast(t('toast_collect_success', { amount: formatNumber(res.credited) }));
          primeAdToken();
          if (res.referral)
            toast(t('toast_ref_earned', { amount: formatNumber(res.referral.bonus) }));
          return;
        }

        // phase === 'start'.
        //
        // The ad token must already be in hand when the player clicks: Monetag
        // refuses to open an ad unless it is called during the click's user
        // gesture, and awaiting a fetch first consumes that gesture. The token
        // is fetched ahead of time by primeAdToken().
        const token = store.get().adToken;
        if (!token) {
          toast(t('toast_no_ads'), 'error');
          primeAdToken();
          return;
        }

        const shown = await playAd(token);
        if (!shown) {
          primeAdToken();
          throw new ApiError('ad_required', 402);
        }

        // The reward comes from Monetag's server-to-server postback, which lands
        // after the SDK Promise resolves. Waiting for it is what stops the button
        // snapping back to WAITING FOR SHEARING a couple of seconds after click.
        toast(t('toast_ad_waiting'));
        const confirmed = await waitForAdConfirmation(token);
        if (!confirmed) {
          toast(t('toast_no_ads'), 'error');
          primeAdToken();
          return;
        }

        const res = await api.harvest(token);
        store.set({ pendingWool: res.pendingWool, workEndTime: res.workEndTime, adToken: '' });
        primeAdToken();
      })
    );
  }

  /**
   * Ask the ad SDK to display an ad. This only *requests* it; the server credits
   * the shift when the provider's postback arrives, so skipping it locally
   * gains nothing.
   */


  /**
   * Fetch an ad token ahead of the click.
   *
   * Monetag will not open an ad outside a user gesture, so the token cannot be
   * requested in the click handler (the await would spend the gesture). Instead
   * one is requested as soon as the button is clickable and kept in the store.
   * Requesting costs nothing: the server only issues a nonce.
   */
  async function primeAdToken() {
    const state = store.get();
    if (state.adToken) return state.adToken;
    if (state.pendingWool > 0) return ''; // a shift is running; no ad needed yet
    try {
      const res = await api.harvest();
      if (res.token) {
        store.set({ adToken: res.token });
        return res.token;
      }
      // Ads are not gated on this deployment: start the shift straight away.
      store.set({ pendingWool: res.pendingWool, workEndTime: res.workEndTime });
    } catch {
      // Retried when the player clicks.
    }
    return '';
  }

  /**
   * Poll until the ad postback marks the token watched.
   *
   * Monetag retries for ~38h on their side, but the normal case is a couple of
   * seconds. Polling keeps the player informed instead of silently reverting.
   *
   * @returns {Promise<boolean>} true once confirmed, false on timeout
   */
  async function waitForAdConfirmation(token, { attempts = 20, intervalMs = 1000 } = {}) {
    for (let i = 0; i < attempts; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      try {
        const { watched } = await api.adStatus(token);
        if (watched) return true;
      } catch {
        // Transient network error: keep polling rather than failing the player.
      }
    }
    return false;
  }

  /**
   * Show the rewarded interstitial.
   *
   * A resolved Promise is NOT permission to reward: Monetag confirms whether the
   * impression was monetised via the server postback, which is what actually
   * grants the shift. This only drives the UI.
   */
  async function playAd(token) {
    const result = await showRewardedAd({
      telegramId: user.id,
      token,
      requestVar: 'start-shift',
    });
    if (!result.shown) {
      // 'no_zone' means ads are not configured for this build; say so plainly
      // rather than blaming the network.
      toast(result.reason === 'no_zone' ? t('toast_no_ads') : t('toast_no_ads'), 'error');
      return false;
    }
    return true;
  }

  function bindTasks() {
    el('task-list')?.addEventListener('click', async (event) => {
      const claim = event.target.closest('.task-claim-btn');
      if (!claim) return;
      const taskId = claim.dataset.id;
      try {
        const res = await api.claimTask(taskId);
        const state = store.get();
        store.set({ wool: res.wool, completedTasks: [...state.completedTasks, taskId] });
        renderTasks(TASKS, store.get().completedTasks);
        toast(t('toast_reward_claimed'));
      } catch (err) {
        handleError(err);
      }
    });
  }

  function bindWithdraw() {
    const amountInput = el('input-withdraw');
    const walletInput = el('input-bank-acc');
    const receive = el('val-withdraw-vnd');

    amountInput?.addEventListener('input', () => {
      const amount = parseInt(amountInput.value, 10) || 0;
      if (receive) receive.textContent = `${toGram(amount, store.get().rateTon)} GRAM`;
    });

    el('btn-max-withdraw')?.addEventListener('click', () => {
      const wool = Math.floor(store.get().wool);
      if (amountInput) amountInput.value = String(wool);
      if (receive) receive.textContent = `${toGram(wool, store.get().rateTon)} GRAM`;
    });

    const btn = el('btn-do-withdraw');
    btn?.addEventListener(
      'click',
      withBusy(btn, async () => {
        const wallet = (walletInput?.value ?? '').trim();
        const amount = parseInt(amountInput?.value, 10) || 0;
        const res = await api.withdraw(wallet, amount);
        const state = store.get();
        store.set({
          wool: res.wool,
          lastWithdrawTime: res.withdrawal.timestamp,
          tonWallet: wallet,
          withdrawHistory: [...state.withdrawHistory, res.withdrawal],
        });
        renderHistory(store.get().withdrawHistory, state.rateTon);
        toast(t('toast_withdraw_success'));
      })
    );
  }

  function bindReferral() {
    const bot = import.meta.env?.VITE_BOT_USERNAME ?? 'LuckySheepFarm_bot';
    const link = `https://t.me/${bot}?start=ref_${user.id}`;
    const display = el('ref-link-display');
    if (display) display.textContent = link;

    el('btn-copy-ref-icon')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(link);
        toast(t('toast_copy_link'));
      } catch {
        toast(t('toast_copy_error', { error: t('toast_copy_link') }), 'error');
      }
    });

    el('btn-copy-ref')?.addEventListener('click', async () => {
      try {
        const res = await api.invite();
        if (webApp.shareMessage) webApp.shareMessage(res.id);
        else webApp.switchInlineQuery?.(res.id, ['users', 'groups']);
      } catch (err) {
        handleError(err);
      }
    });
  }

  function bindSettings() {
    const modal = el('settings-modal');
    el('btn-settings')?.addEventListener('click', () => modal?.classList.remove('hidden'));
    el('btn-close-settings')?.addEventListener('click', () => modal?.classList.add('hidden'));
    el('settings-backdrop')?.addEventListener('click', () => modal?.classList.add('hidden'));

    const toggle = el('toggle-audio-btn');
    toggle?.addEventListener('click', () => {
      const next = !store.get().audioEnabled;
      store.set({ audioEnabled: next });
      toggle.setAttribute('aria-pressed', String(next));
    });
  }
}
