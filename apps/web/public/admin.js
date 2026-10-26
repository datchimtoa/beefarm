// Admin panel logic.
//
// Plain browser JS with no build step, so this page keeps working even if the
// game bundle breaks. It talks only to /api/admin/*, which is guarded by the
// shared admin token — never by Telegram initData.

(() => {
  'use strict';

  // sessionStorage, not localStorage: the token dies with the tab instead of
  // lingering on a shared machine.
  const TOKEN_KEY = 'hbf:admin-token';
  let token = sessionStorage.getItem(TOKEN_KEY) ?? '';

  const $ = (id) => document.getElementById(id);
  const el = {
    loginCard: $('login-card'),
    token: $('token'),
    panel: $('panel'),
    status: $('status'),
    taskRows: $('task-rows'),
    taskCount: $('task-count'),
    withdrawalRows: $('withdrawal-rows'),
  };

  /** Numeric settings the form edits, in display order. */
  const SETTING_KEYS = [
    'yieldPerRunMin',
    'yieldPerRunMax',
    'refPercent',
    'minWithdraw',
    'rateTon',
    'maxWithdrawsPerDay',
    'settlementHourUtc',
  ];

  let statusTimer = null;
  function setStatus(message, kind = '') {
    el.status.textContent = message;
    el.status.className = kind;
    clearTimeout(statusTimer);
    if (message) statusTimer = setTimeout(() => setStatus(''), 6000);
  }

  /** Human-readable text for an API failure. */
  function describeFailure(body, res) {
    if (body?.reason) {
      const extra = body.key ? ` (${body.key})` : body.id ? ` (${body.id})` : '';
      return `${body.reason}${extra}`;
    }
    return `Request failed (HTTP ${res.status})`;
  }

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json', 'x-admin-token': token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(describeFailure(json, res));
    return json;
  }

  // -- rendering -------------------------------------------------------------

  function renderConfig(cfg) {
    for (const key of SETTING_KEYS) {
      const input = $(key);
      if (input) input.value = cfg.settings[key] ?? '';
    }
    renderTasks(cfg.tasks ?? []);
  }

  function taskRow(task = { id: '', channel: '', reward: 5000 }) {
    const tr = document.createElement('tr');
    tr.className = 'task-row';

    const cell = (value, attrs = {}) => {
      const td = document.createElement('td');
      const input = document.createElement('input');
      Object.assign(input, attrs);
      input.value = value;
      td.append(input);
      tr.append(td);
    };

    cell(task.id, { type: 'text', placeholder: 'join_channel' });
    cell(task.channel, { type: 'text', placeholder: '@HoneyBeeFarmChannel' });
    cell(task.reward, { type: 'number', min: '0', step: '500' });

    const actions = document.createElement('td');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      tr.remove();
      updateTaskCount();
    });
    actions.append(remove);
    tr.append(actions);
    return tr;
  }

  function renderTasks(tasks) {
    el.taskRows.replaceChildren(...tasks.map((t) => taskRow(t)));
    updateTaskCount();
  }

  function updateTaskCount() {
    const n = el.taskRows.children.length;
    el.taskCount.textContent = `${n} ${n === 1 ? 'task' : 'tasks'}`;
  }

  /** Read the task table back into the API's shape. */
  function readTasks() {
    return [...el.taskRows.children].map((tr) => {
      const [id, channel, reward] = [...tr.querySelectorAll('input')];
      return {
        id: id.value.trim(),
        channel: channel.value.trim(),
        reward: Number(reward.value),
      };
    });
  }

  function renderWithdrawals(list, unsupported) {
    if (unsupported) {
      el.withdrawalRows.innerHTML =
        '<tr><td colspan="5" class="hint">The active store cannot list withdrawals.</td></tr>';
      return;
    }
    if (!list.length) {
      el.withdrawalRows.innerHTML = '<tr><td colspan="5" class="hint">Nothing pending.</td></tr>';
      return;
    }

    el.withdrawalRows.replaceChildren(
      ...list.map((w) => {
        const tr = document.createElement('tr');
        // Field names follow the stored withdrawal entry: `timestamp` and
        // `gram`. `telegramId` is attached by the store's list projection.
        const cells = [
          w.timestamp ? new Date(w.timestamp).toLocaleString() : '—',
          w.telegramId ?? '—',
          Number(w.amount ?? 0).toLocaleString(),
          Number(w.gram ?? 0).toFixed(6),
          // Wallets are long; show the ends so the operator can eyeball them.
          w.wallet ? `${w.wallet.slice(0, 6)}…${w.wallet.slice(-6)}` : '—',
        ];
        for (const value of cells) {
          const td = document.createElement('td');
          td.textContent = String(value);
          tr.append(td);
        }
        return tr;
      }),
    );
  }

  // -- actions ---------------------------------------------------------------

  async function load() {
    setStatus('Loading…');
    const cfg = await api('/api/admin/config');
    renderConfig(cfg);
    setStatus('Loaded.', 'ok');
  }

  async function login() {
    token = el.token.value.trim();
    if (!token) {
      setStatus('Enter the admin token.', 'err');
      return;
    }
    try {
      await load();
      sessionStorage.setItem(TOKEN_KEY, token);
      el.loginCard.classList.add('hidden');
      el.panel.classList.remove('hidden');
    } catch (err) {
      token = '';
      sessionStorage.removeItem(TOKEN_KEY);
      setStatus(`Sign-in failed: ${err.message}`, 'err');
    }
  }

  el.login.addEventListener('click', login);
  el.token.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') login();
  });

  $('save-settings').addEventListener('click', async () => {
    const settings = {};
    for (const key of SETTING_KEYS) settings[key] = Number($(key).value);
    try {
      const cfg = await api('/api/admin/config', { method: 'POST', body: { settings } });
      renderConfig(cfg);
      setStatus('Settings saved.', 'ok');
    } catch (err) {
      setStatus(`Not saved: ${err.message}`, 'err');
    }
  });

  $('add-task').addEventListener('click', () => {
    el.taskRows.append(taskRow());
    updateTaskCount();
  });

  $('save-tasks').addEventListener('click', async () => {
    try {
      const cfg = await api('/api/admin/tasks', { method: 'POST', body: { tasks: readTasks() } });
      renderTasks(cfg.tasks);
      setStatus('Tasks saved.', 'ok');
    } catch (err) {
      setStatus(`Not saved: ${err.message}`, 'err');
    }
  });

  const playerId = () => $('player-id').value.trim();

  $('do-grant').addEventListener('click', async () => {
    const amount = Number($('grant').value);
    try {
      const res = await api('/api/admin/grant', {
        method: 'POST',
        body: { telegramId: playerId(), amount },
      });
      const suffix = res.clamped ? ' (clamped at 0)' : '';
      setStatus(`Balance for ${res.telegramId}: ${res.balance.toLocaleString()}${suffix}`, 'ok');
    } catch (err) {
      setStatus(`Failed: ${err.message}`, 'err');
    }
  });

  const setBanned = (banned) => async () => {
    try {
      await api('/api/admin/ban', { method: 'POST', body: { telegramId: playerId(), banned } });
      setStatus(`Player ${playerId()} ${banned ? 'banned' : 'unbanned'}.`, 'ok');
    } catch (err) {
      setStatus(`Failed: ${err.message}`, 'err');
    }
  };
  $('do-ban').addEventListener('click', setBanned(true));
  $('do-unban').addEventListener('click', setBanned(false));

  $('load-withdrawals').addEventListener('click', async () => {
    try {
      const res = await api('/api/admin/withdrawals');
      renderWithdrawals(res.withdrawals ?? [], res.unsupported);
    } catch (err) {
      setStatus(`Failed: ${err.message}`, 'err');
    }
  });

  // Resume a session only after proving the stored token still works.
  if (token) {
    el.token.value = token;
    login();
  }
})();

