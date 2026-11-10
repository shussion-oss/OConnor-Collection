/* Tiny IndexedDB wrapper. Cards and photos are stored in the browser on this device. */
const DB = (() => {
  const NAME = 'dugout-cards';
  const VERSION = 1;
  let dbPromise;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(store, mode, fn) {
    const db = await open();
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
    allCards: () => tx('cards', 'readonly', (s) => s.getAll()),
    putCard: (card) => tx('cards', 'readwrite', (s) => s.put(card)),
    deleteCard: (id) => tx('cards', 'readwrite', (s) => s.delete(id)),
    getImage: (key) => tx('images', 'readonly', (s) => s.get(key)),
    putImage: (key, blob) => tx('images', 'readwrite', (s) => s.put(blob, key)),
    deleteImage: (key) => tx('images', 'readwrite', (s) => s.delete(key)),
    getSetting: (key) => tx('settings', 'readonly', (s) => s.get(key)),
    putSetting: (key, val) => tx('settings', 'readwrite', (s) => s.put(val, key)),
  };
})();
