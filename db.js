/* Tiny IndexedDB wrapper. Cards and photos are stored in the browser on this device.
   If the browser blocks storage (some private modes and embedded previews), it falls back
   to memory so the app still works. Nothing is saved after the page closes in that case. */
const LocalDB = (() => {
  const NAME = 'dugout-cards';
  const VERSION = 1;
  const STORES = ['cards', 'images', 'settings'];
  let dbPromise;
  let memory = null; // { cards: Map, images: Map, settings: Map } when IndexedDB is unavailable

  function useMemory() {
    if (!memory) {
      memory = Object.fromEntries(STORES.map((s) => [s, new Map()]));
      console.warn('Storage unavailable: using temporary memory only.');
    }
    return null;
  }

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open(NAME, VERSION);
      } catch {
        return resolve(useMemory());
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(useMemory());
      req.onblocked = () => resolve(useMemory());
    });
    return dbPromise;
  }

  async function tx(store, mode, fn, memFn) {
    const db = await open();
    if (!db) return memFn(memory[store]);
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const result = fn(s);
      t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  return {
    get temporary() { return !!memory; },
    allCards: () => tx('cards', 'readonly', (s) => s.getAll(), (m) => [...m.values()].map((c) => structuredClone(c))),
    putCard: (card) => tx('cards', 'readwrite', (s) => s.put(card), (m) => void m.set(card.id, structuredClone(card))),
    deleteCard: (id) => tx('cards', 'readwrite', (s) => s.delete(id), (m) => void m.delete(id)),
    getImage: (key) => tx('images', 'readonly', (s) => s.get(key), (m) => m.get(key)),
    putImage: (key, blob) => tx('images', 'readwrite', (s) => s.put(blob, key), (m) => void m.set(key, blob)),
    deleteImage: (key) => tx('images', 'readwrite', (s) => s.delete(key), (m) => void m.delete(key)),
    getSetting: (key) => tx('settings', 'readonly', (s) => s.get(key), (m) => structuredClone(m.get(key))),
    putSetting: (key, val) => tx('settings', 'readwrite', (s) => s.put(val, key), (m) => void m.set(key, structuredClone(val))),
  };
})();

// sync.js swaps this for a version that also keeps the shared family collection in step.
var DB = LocalDB; // eslint-disable-line no-var
