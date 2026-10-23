import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..', '..', 'web');
const RENDER = readFileSync(join(WEB, 'src', 'render.js'), 'utf8');
const MAIN = readFileSync(join(WEB, 'src', 'main.js'), 'utf8');

test('the loader animates instead of sitting at 0%', () => {
  // The original ramped towards 90% every 120ms, then jumped to 100% when the
  // player record arrived. Without startLoader() the bar stayed at 0.
  assert.match(RENDER, /export function startLoader/, 'startLoader missing');
  assert.match(RENDER, /export function finishLoader/, 'finishLoader missing');
  assert.ok(RENDER.includes('setInterval'), 'no progress interval');
  assert.ok(MAIN.includes('startLoader();'), 'startLoader never called');
  assert.ok(MAIN.includes('finishLoader();'), 'finishLoader never called');
});

test('the progress placeholder is substituted, never printed raw', () => {
  // "Preparing farm... {progress}%" appeared on screen because
  // applyTranslations() wrote the template without params.
  assert.match(
    RENDER,
    /t\('preparing',\s*\{\s*progress:/,
    'progress value is not passed to the translation'
  );
  assert.ok(
    RENDER.includes("value.includes('{')"),
    'applyTranslations must skip keys that need parameters'
  );
});

test('Telegram is told the app is ready only after data loads', () => {
  // Calling ready() during init leaves Telegram's own loading overlay showing
  // while our loader is still at 0%, which looks like a stuck "loading %{...}".
  const telegram = readFileSync(join(WEB, 'src', 'telegram.js'), 'utf8');
  const initBody = telegram.slice(0, telegram.indexOf('/** Show an honest'));
  assert.ok(!/tg\.ready\?\.\(\)/.test(initBody), 'ready() must not be called during init');
  assert.match(telegram, /export function markReady/, 'markReady missing');
  assert.ok(MAIN.includes('markReady(webApp)'), 'markReady never called');
});
