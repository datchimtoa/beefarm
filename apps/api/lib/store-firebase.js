// Firebase RTDB store (production). Same contract as MemoryStore.
//
// Setup:
//   1. Firebase console -> create project -> Realtime Database
//   2. Project settings -> Service accounts -> generate a key
//   3. Set env:
//        FIREBASE_DATABASE_URL=https://<project>-default-rtdb.<region>.firebasedatabase.app
//        GOOGLE_APPLICATION_CREDENTIALS=/abs/path/serviceAccount.json
//   4. npm i firebase-admin
//
// Security rules must deny all client access; only this server (admin SDK)
// reads and writes. See database.rules.json.
export class FirebaseStore {
  constructor({ databaseUrl, serviceAccount, appName = 'beefarm' }) {
    this.databaseUrl = databaseUrl;
    this.serviceAccount = serviceAccount;
    this.appName = appName;
    this.db = null;
  }

  async #database() {
    if (this.db) return this.db;
    if (!this.databaseUrl) {
      throw new Error('FIREBASE_DATABASE_URL is not set. See FIREBASE-SETUP.md part 2.');
    }

    let initializeApp;
    let getApps;
    let getDatabase;
    let applicationDefault;
    let cert;
    try {
      // firebase-admin >=14: modular subpath imports.
      const appMod = await import('firebase-admin/app');
      ({ initializeApp, getApps, applicationDefault, cert } = appMod);
      ({ getDatabase } = await import('firebase-admin/database'));
    } catch (err) {
      throw new Error(
        `firebase-admin not available (${err.code ?? err.message}). ` +
          'Run: cd server && npm install firebase-admin'
      );
    }

    const credential = this.serviceAccount ? cert(this.serviceAccount) : applicationDefault();
    const existing = getApps().find((a) => a.name === this.appName);
    const app =
      existing ?? initializeApp({ credential, databaseURL: this.databaseUrl }, this.appName);
    this.db = getDatabase(app);
    return this.db;
  }

  async getUser(id) {
    const db = await this.#database();
    const snap = await db.ref(`users/${id}`).get();
    return snap.exists() ? snap.val() : null;
  }

  async putUser(user) {
    const db = await this.#database();
    await db.ref(`users/${user.telegramId}`).set(user);
  }

  /**
   * Server-side atomic increment (RTDB transaction). A plain get/set would lose
   * updates when two referees harvest at the same moment.
   */
  async increment(id, field, delta) {
    const db = await this.#database();
    const ref = db.ref(`users/${id}/${field}`);
    const result = await ref.transaction((current) => Number(current ?? 0) + delta);
    return result.snapshot.exists() ? result.snapshot.val() : null;
  }

  async getConfig() {
    const db = await this.#database();
    const snap = await db.ref('system_config').get();
    return snap.exists() ? snap.val() : {};
  }
}
