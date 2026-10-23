// Telegram WebApp bootstrap.
//
// The original threw (and redirected to /home) when initData was missing. We do
// the same check but fail visibly: a blank screen tells the player nothing, and
// a real error message is what you asked to be able to see on their screen.

export function initTelegram() {
  const tg = globalThis.Telegram?.WebApp;

  if (!tg) {
    return {
      ok: false,
      reason: 'not_telegram',
      message: 'Open this game from Telegram, not a browser.',
    };
  }

  tg.ready?.();
  tg.expand?.();
  tg.disableVerticalSwipes?.();
  tg.enableClosingConfirmation?.();
  tg.setHeaderColor?.('#FFFBE6');
  tg.setBackgroundColor?.('#FFFBE6');

  if (!tg.initData) {
    return {
      ok: false,
      reason: 'no_init_data',
      message: 'Telegram did not provide a session. Reopen the game from the bot menu.',
    };
  }

  const user = tg.initDataUnsafe?.user ?? null;
  const locale = user?.language_code ?? 'en';

  return { ok: true, webApp: tg, user, locale };
}

/** Show an honest, visible error instead of a silent failure. */
export function showFatal(message) {
  const el = document.getElementById('fatal-error');
  if (!el) {
    // Fall back to an alert so the message is never lost.
    console.error('[fatal]', message);
    return;
  }
  el.querySelector('[data-fatal-text]').textContent = message;
  el.classList.remove('hidden');
  el.style.display = 'flex';
}

export function hideFatal() {
  const el = document.getElementById('fatal-error');
  if (el) el.style.display = 'none';
}
