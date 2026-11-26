// Tiny persistent key-value store: IndexedDB in the browser, memory elsewhere (Node, private mode).
// Values are structured-cloned, so plain JSON-able objects only.

const mem = new Map();
let dbPromise = null;

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open('sideline', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction('kv', mode);
    const store = t.objectStore('kv');
    const req = fn(store);
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function kvGet(key) {
  const db = await openDb();
  if (!db) return mem.get(key);
  try {
    return await tx(db, 'readonly', (s) => s.get(key));
  } catch {
    return mem.get(key);
  }
}

export async function kvSet(key, value) {
  const db = await openDb();
  if (!db) { mem.set(key, value); return; }
  try {
    await tx(db, 'readwrite', (s) => s.put(value, key));
  } catch {
    mem.set(key, value);
  }
}

export async function kvDel(key) {
  const db = await openDb();
  mem.delete(key);
  if (!db) return;
  try { await tx(db, 'readwrite', (s) => s.delete(key)); } catch { /* ignore */ }
}

/** All keys starting with `prefix`. */
export async function kvKeys(prefix = '') {
  const db = await openDb();
  if (!db) return [...mem.keys()].filter((k) => String(k).startsWith(prefix));
  try {
    const keys = await tx(db, 'readonly', (s) => s.getAllKeys());
    return keys.filter((k) => String(k).startsWith(prefix));
  } catch {
    return [];
  }
}
