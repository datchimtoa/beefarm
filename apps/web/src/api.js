// API client. The ONLY way this app reads or writes game state.
//
// There is deliberately no Firebase SDK here: the browser never touches the
// database. Everything goes through /api with a verified Telegram initData
// header, so the server stays authoritative and the database stays locked.

const BASE = (import.meta.env?.VITE_API_BASE ?? '').replace(/\/$/, '');

function initData() {
  return globalThis.Telegram?.WebApp?.initData ?? '';
}

export class ApiError extends Error {
  constructor(code, status, extra = {}) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'x-init-data': initData() };
  if (body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let payload = {};
  try {
    payload = await res.json();
  } catch {
    /* empty or non-JSON body */
  }

  // 401 means the server did not accept initData: the session is unusable, and
  // retrying cannot help. Surface it so the UI can show an honest message
  // instead of hanging (the original froze forever here).
  if (res.status === 401) {
    throw new ApiError('unauthorized', 401, payload);
  }
  if (!res.ok || payload.success === false) {
    throw new ApiError(payload.errorCode ?? 'failed', res.status, payload);
  }
  return payload;
}

export const api = {
  me: () => request('/api/me'),

  /** Persist the player's language (the original saved it to their record). */
  setLanguage: (language) => request('/api/settings', { method: 'POST', body: { language } }),

  /** Persist the audio preference. */
  setAudio: (audioEnabled) => request('/api/settings', { method: 'POST', body: { audioEnabled } }),

  /** Has the ad provider's postback confirmed this token yet? */
  adStatus: (token) => request(`/api/ads/status?token=${encodeURIComponent(token)}`),

  /** Start a shift or collect a finished one. */
  harvest: (adToken) => request('/api/harvest', { method: 'POST', body: adToken ? { adToken } : {} }),

  claimTask: (taskId) => request('/api/claim_task', { method: 'POST', body: { taskId } }),

  invite: () => request('/api/invite', { method: 'POST' }),

  withdraw: (wallet, amount) => request('/api/withdraw', { method: 'POST', body: { wallet, amount } }),
};
