/* Archivio locale su IndexedDB: funziona offline e resta sul dispositivo. */
(function (N) {
  'use strict';
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open('mie-note', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('notes')) d.createObjectStore('notes', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'k' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return dbp;
  }

  function run(store, mode, fn) {
    return open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction(store, mode);
          const req = fn(t.objectStore(store));
          t.oncomplete = () => resolve(req ? req.result : undefined);
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error);
        })
    );
  }

  N.db = {
    all: () => run('notes', 'readonly', (s) => s.getAll()),
    put: (n) => run('notes', 'readwrite', (s) => s.put(n)),
    del: (id) => run('notes', 'readwrite', (s) => s.delete(id)),
    putMany: (list) =>
      run('notes', 'readwrite', (s) => {
        let last;
        for (const n of list) last = s.put(n);
        return last;
      }),
    getMeta: async (k) => {
      const r = await run('meta', 'readonly', (s) => s.get(k));
      return r ? r.v : undefined;
    },
    setMeta: (k, v) => run('meta', 'readwrite', (s) => s.put({ k, v }))
  };
})((window.N = window.N || {}));
