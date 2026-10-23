// Phase 2 stub: stands in for gstatic.com/firebasejs/10.7.1/firebase-database.js
//
// Implements the four functions the bundle imports — getDatabase, ref, onValue,
// update — backed by an in-memory tree seeded from fixtures/seed.json.
//
// An in-memory RTDB is used instead of the real emulator because the client
// hardcodes the production databaseURL. Nothing here touches the network.
import { getApp } from './firebase-app.js';

const databases = new Map();

export function getDatabase(app = getApp()) {
  if (!databases.has(app.name)) {
    databases.set(app.name, {
      app,
      root: { '.info': { connected: true } },
      listeners: new Set(),
    });
  }
  return databases.get(app.name);
}

export function ref(db, path = '/') {
  const clean = String(path).replace(/^\/+|\/+$/g, '');
  return { _db: db, _path: clean, toString: () => clean };
}

function segments(path) {
  return path === '' ? [] : path.split('/');
}

function readAt(root, path) {
  let node = root;
  for (const key of segments(path)) {
    if (node === null || typeof node !== 'object') return null;
    node = node[key];
    if (node === undefined) return null;
  }
  return node === undefined ? null : node;
}

function writeAt(root, path, value) {
  const keys = segments(path);
  if (keys.length === 0) return value ?? null;
  let node = root;
  for (const key of keys.slice(0, -1)) {
    if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
    node = node[key];
  }
  const last = keys[keys.length - 1];
  if (value === null || value === undefined) delete node[last];
  else node[last] = value;
  return root;
}

// The bundle treats the snapshot as `{ exists(), val(), key }`.
function snapshot(rawPath, value) {
  return {
    key: rawPath === '' ? null : rawPath,
    exists: () => value !== null && value !== undefined,
    val: () => value,
    toJSON: () => value,
  };
}

const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

export function onValue(query, callback, errorCallback, options) {
  const { _db: db, _path: path } = query;
  // Merge in the seed the harness provided before the app booted.
  if (db.root.__seeded !== true && globalThis.__FIREBASE_SEED) {
    db.root = clone(globalThis.__FIREBASE_SEED);
    db.root['.info'] = { connected: true };
    db.root.__seeded = true;
  }
  const listener = {
    path,
    callback,
    errorCallback,
    options,
    emit() {
      const value = clone(readAt(db.root, path));
      try {
        callback(snapshot(path, value));
      } catch (err) {
        console.error('[firebase-stub] listener threw', path, err);
        if (errorCallback) errorCallback(err);
      }
    },
  };
  db.listeners.add(listener);
  // Async, like the real SDK (it never calls back synchronously).
  queueMicrotask(() => listener.emit());
  return () => db.listeners.delete(listener);
}

export function off(query, callback) {
  const { _db: db, _path: path } = query;
  for (const l of db.listeners) {
    if (l.path === path && (!callback || l.callback === callback)) db.listeners.delete(l);
  }
}

export function update(query, values) {
  const { _db: db, _path: path } = query;
  for (const [key, value] of Object.entries(values)) {
    writeAt(db.root, path ? `${path}/${key}` : key, clone(value));
  }
  // Re-emit only the affected listeners, as RTDB does.
  for (const l of db.listeners) {
    if (path === '' || l.path === path || l.path.startsWith(`${path}/`) || path.startsWith(`${l.path}/`)) {
      l.emit();
    }
  }
  return Promise.resolve();
}

export function set(query, value) {
  const { _db: db, _path: path } = query;
  writeAt(db.root, path, clone(value));
  for (const l of db.listeners) {
    if (path === '' || l.path === path || l.path.startsWith(`${path}/`) || path.startsWith(`${l.path}/`)) {
      l.emit();
    }
  }
  return Promise.resolve();
}

// Harness-only helpers (not part of the Firebase API).
export function __patch(db, path, values) {
  return update(ref(db, path), values);
}

export default { getDatabase, ref, onValue, off, update, set };
