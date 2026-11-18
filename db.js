/* Archivio locale su IndexedDB: funziona offline e resta sul dispositivo.
       Versione 3: aggiunge gli archivi "docs" e "workouts" in modo additivo.
   L'aggiornamento è solo additivo: le note e le impostazioni esistenti non vengono toccate. */
(function (N) {
  'use strict';
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open('mie-note', 3);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('notes')) d.createObjectStore('notes', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'k' });
        if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('workouts')) d.createObjectStore('workouts', { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('Archivio bloccato da un’altra scheda aperta: chiudila e riprova.'));
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
    setMeta: (k, v) => run('meta', 'readwrite', (s) => s.put({ k, v })),

    /* Documenti: ogni record contiene anche il file intero (campo "data", un ArrayBuffer). */
    docs: {
      all: () => run('docs', 'readonly', (s) => s.getAll()),
      get: (id) => run('docs', 'readonly', (s) => s.get(id)),
      put: (d) => run('docs', 'readwrite', (s) => s.put(d)),
      del: (id) => run('docs', 'readwrite', (s) => s.delete(id))
    },

    /* Schede e sessioni di allenamento: solo archivio locale, senza richieste di rete. */
    workouts: {
      all: () => run('workouts', 'readonly', (s) => s.getAll()),
      get: (id) => run('workouts', 'readonly', (s) => s.get(id)),
      put: (w) => run('workouts', 'readwrite', (s) => s.put(w)),
      del: (id) => run('workouts', 'readwrite', (s) => s.delete(id))
    }
  };
})((window.N = window.N || {}));
