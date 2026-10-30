const DATABASE = 'wfc.pathfinder.endpoint-pending-coordination.v1';
const STORE = 'owners';
const WAIT_MILLISECONDS = 5000;
const storageMessage = 'Save cannot coordinate browser storage. Allow site storage for this server address, then retry.';
const waitingMessage = 'Save is waiting for another browser window. Finish its pending Save or close that window, then retry.';

export class EndpointPendingLockError extends Error {}

/** Only synchronous localStorage operations belong here. The transaction is a
 * cross-window mutex, not the pending-command store: existing exact recovery
 * records and their storage events remain unchanged. */
function indexedDbLock<T>(name: string, work: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false, database: IDBDatabase | null = null, transaction: IDBTransaction | null = null;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true; clearTimeout(timer); database?.close(); reject(error);
    };
    const timer = setTimeout(() => {
      try { transaction?.abort(); } catch { /* The transaction may already be finishing. */ }
      fail(new EndpointPendingLockError(waitingMessage));
    }, WAIT_MILLISECONDS);
    try {
      if (!globalThis.indexedDB?.open) throw new EndpointPendingLockError(storageMessage);
      const opening = indexedDB.open(DATABASE, 1);
      opening.onblocked = () => fail(new EndpointPendingLockError(waitingMessage));
      opening.onerror = () => fail(new EndpointPendingLockError(storageMessage));
      opening.onupgradeneeded = () => {
        if (settled) { opening.transaction?.abort(); return; }
        opening.result.createObjectStore(STORE);
      };
      opening.onsuccess = () => {
        database = opening.result;
        // An open request can finish after a timeout/blocked notification.
        if (settled) { database.close(); return; }
        database.onversionchange = () => database?.close();
        try {
          // Overlapping readwrite transactions serialize across connections,
          // including pair and legacy writers in separate browser windows.
          const active = database.transaction(STORE, 'readwrite'); transaction = active;
          let result: T, completedWork = false;
          active.onabort = () => fail(new EndpointPendingLockError(storageMessage));
          active.onerror = () => fail(new EndpointPendingLockError(storageMessage));
          active.oncomplete = () => {
            if (settled) return;
            if (!completedWork) { fail(new EndpointPendingLockError(storageMessage)); return; }
            settled = true; clearTimeout(timer); database?.close(); resolve(result);
          };
          const acquired = active.objectStore(STORE).get(name);
          acquired.onsuccess = () => {
            if (settled) return;
            try { result = work(); completedWork = true; }
            catch (error) {
              try { active.abort(); } catch { /* Preserve the original storage/command error. */ }
              fail(error);
            }
          };
        } catch { fail(new EndpointPendingLockError(storageMessage)); }
      };
    } catch (error) { fail(error instanceof EndpointPendingLockError ? error : new EndpointPendingLockError(storageMessage)); }
  });
}

/** Retain Web Locks on secure origins, including coordination with older tabs.
 * LAN HTTP origins do not expose that API; IndexedDB provides an atomic mutex
 * there without replacing durable recovery with an in-memory shortcut. */
export async function withEndpointPendingLock<T>(names: readonly string[], work: () => T): Promise<T> {
  if (!navigator.locks?.request) return indexedDbLock(names[0], work);
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), WAIT_MILLISECONDS);
  const acquire = async (index: number): Promise<T> => index === names.length ? work()
    : await navigator.locks.request(names[index], { mode: 'exclusive', signal: abort.signal }, () => acquire(index + 1));
  try { return await acquire(0); }
  finally { clearTimeout(timer); }
}
