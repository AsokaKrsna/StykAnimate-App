// The browser's recovery copy: the last unsaved work, kept in IndexedDB as one record ('latest')
// so a closed or crashed tab does not lose it. The app writes it a moment after each edit and
// whenever the page is hidden, offers it on the next start, and clears it once the project is saved.
// Storage that is missing or blocked (private browsing, full disk) is never an error the app has to
// survive: reads find nothing, and the caller decides how to report a write. The document is stored as an
// ArrayBuffer, not a Blob: WebKit cannot keep a Blob in IndexedDB reliably, and every engine keeps an ArrayBuffer.
const NAME = 'stykanimate-recovery', STORE = 'documents', KEY = 'latest';

function open(database) {
  return new Promise((resolve, reject) => {
    if (!database) { reject(new Error('This browser does not allow recovery copies.')); return; }
    let request;
    try { request = database.open(NAME, 1); } catch (error) { reject(error); return; }
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('The recovery copy could not be opened.'));
    request.onblocked = () => reject(new Error('The recovery copy is in use by another tab.'));
  });
}

/** Runs one transaction and resolves with its result once it has committed. */
async function within(database, mode, work) {
  const db = await open(database);
  return new Promise((resolve, reject) => {
    let transaction, value;
    try { transaction = db.transaction(STORE, mode); } catch (error) { db.close(); reject(error); return; }
    transaction.oncomplete = () => { db.close(); resolve(value); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('The recovery copy could not be written.')); };
    try { work(transaction.objectStore(STORE), result => { value = result; }); } catch (error) { try { transaction.abort(); } catch { /* finished */ } reject(error); }
  });
}

/** The saved recovery record ({blob, name, savedAt}) or null. Anything unreadable counts as none; a record written as a Blob by an earlier version still reads. */
export function readBrowserRecovery(database = globalThis.indexedDB) {
  return within(database, 'readonly', (store, done) => { const request = store.get(KEY); request.onsuccess = () => done(request.result ?? null); })
    .then(record => {
      if (!record || typeof record !== 'object') return null;
      if (!record.blob && record.data instanceof ArrayBuffer) return {name: record.name, savedAt: record.savedAt, blob: new Blob([record.data], {type: 'application/octet-stream'})};
      return record.blob ? record : null;
    }, () => null);
}

/** Forgets the recovery copy (the project was saved). */
export function clearBrowserRecovery(database = globalThis.indexedDB) {
  return within(database, 'readwrite', store => { store.delete(KEY); }).then(() => true, () => false);
}

// Resolve success only after the recovery transaction commits. The app passes an ArrayBuffer (see above); a Blob is stored as it is.
export function writeBrowserRecovery(blob, name, signal, database = indexedDB) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { resolve(false); return; }
    const request = database.open(NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (signal.aborted) { db.close(); resolve(false); return; }
      let tx;
      try { tx = db.transaction(STORE, 'readwrite'); }
      catch (error) { db.close(); reject(error); return; }
      const cancel = () => { try { tx.abort(); } catch {} };
      const finish = (value, error) => {
        signal.removeEventListener('abort', cancel); db.close();
        if (error) reject(error); else resolve(value);
      };
      tx.oncomplete = () => finish(true);
      tx.onabort = () => signal.aborted ? finish(false) : finish(false, tx.error || new Error('Recovery transaction aborted.'));
      tx.onerror = () => finish(false, tx.error || new Error('Recovery write failed.'));
      signal.addEventListener('abort', cancel, { once: true });
      try { tx.objectStore(STORE).put(blob instanceof ArrayBuffer ? { data: blob, name, savedAt: Date.now() } : { blob, name, savedAt: Date.now() }, KEY); }
      catch (error) { finish(false, error); try { tx.abort(); } catch {} }
    };
  });
}
