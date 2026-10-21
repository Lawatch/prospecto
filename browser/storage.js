// Enregistrement de la base dans le navigateur (IndexedDB) et instantanés de sauvegarde.
const DB_NAME = 'prospecto';
const STORE = 'fichiers';

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; });
    t.oncomplete = () => { db.close(); resolve(result); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

const reqP = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export const loadBytes = (key = 'base') => tx('readonly', (s) => reqP(s.get(key)));
export const saveBytes = (bytes, key = 'base') => tx('readwrite', (s) => reqP(s.put(bytes, key)));
export const deleteKey = (key) => tx('readwrite', (s) => reqP(s.delete(key)));
export const listKeys = () => tx('readonly', (s) => reqP(s.getAllKeys()));
