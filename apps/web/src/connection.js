// Connection state modal.
//
// Mirrors the original's `de()` / `ce()` pair:
//   window 'offline' -> show #no-internet-modal, block input on #action-area
//   window 'online'  -> hide it and restore input
//
// The original also drove this from Firebase's `.info/connected`, which we no
// longer use (the rebuild talks to our own API), so the browser's own online
// and offline events are the whole source of truth now.
import { t } from './i18n.js';

let shown = false;

export function showOffline() {
  const modal = document.getElementById('no-internet-modal');
  if (!modal || shown) return;
  shown = true;

  const title = document.getElementById('internet-title');
  const desc = document.getElementById('internet-desc');
  const icon = document.getElementById('internet-icon-container');
  const retry = document.getElementById('btn-retry-internet');

  if (title) title.textContent = t('error_offline_title');
  if (desc) desc.textContent = t('error_offline_desc');
  if (icon) {
    icon.className =
      'w-20 h-20 bg-[#FFE8A1] border-2 border-[#E63946] rounded-full flex items-center justify-center mb-4 shadow-sm relative animate-pulse';
  }
  if (retry) {
    retry.innerHTML =
      '<i data-lucide="refresh-cw" class="w-4 h-4"></i> <span class="text-stroke-brown-sm">Retry</span>';
  }
  globalThis.lucide?.createIcons?.();

  modal.classList.remove('hidden');
  // The original froze input while disconnected rather than letting taps fail.
  const area = document.getElementById('action-area');
  if (area) area.style.pointerEvents = 'none';
}

export function hideOffline() {
  const modal = document.getElementById('no-internet-modal');
  if (!modal || !shown) return;
  shown = false;
  modal.classList.add('hidden');
  const area = document.getElementById('action-area');
  if (area) area.style.pointerEvents = 'auto';
}

export function bindConnectionWatcher() {
  window.addEventListener('offline', showOffline);
  window.addEventListener('online', hideOffline);

  document.getElementById('btn-retry-internet')?.addEventListener('click', () => {
    if (navigator.onLine) hideOffline();
    else window.location.reload();
  });

  // Reflect a connection lost before the listeners attached.
  if (!navigator.onLine) showOffline();
}
