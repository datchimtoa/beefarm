// Phase 2 stub: stands in for gstatic.com/firebasejs/10.7.1/firebase-app.js
// Implements only what the LuckySheepFarm bundle imports: initializeApp().
const apps = new Map();

export function initializeApp(config, name = '[DEFAULT]') {
  const app = { name, options: config, _stub: true };
  apps.set(name, app);
  console.info('[firebase-stub] initializeApp', { databaseURL: config.databaseURL });
  return app;
}

export function getApp(name = '[DEFAULT]') {
  const app = apps.get(name);
  if (!app) throw new Error(`firebase-stub: no app named ${name}`);
  return app;
}

export function deleteApp(app) {
  return Promise.resolve(apps.delete(app.name));
}

export default { initializeApp, getApp, deleteApp };
