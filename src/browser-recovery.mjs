// Resolve success only after the recovery transaction commits.
export function writeBrowserRecovery(blob, name, signal, database = indexedDB) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { resolve(false); return; }
    const request = database.open('stykanimate-recovery', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (signal.aborted) { db.close(); resolve(false); return; }
      let tx;
      try { tx = db.transaction('documents', 'readwrite'); }
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
      try { tx.objectStore('documents').put({ blob, name, savedAt: Date.now() }, 'latest'); }
      catch (error) { finish(false, error); try { tx.abort(); } catch {} }
    };
  });
}
