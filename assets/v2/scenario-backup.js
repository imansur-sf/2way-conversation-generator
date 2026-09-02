(window.TwoWayV2 ||= {}).createScenarioBackup = function createScenarioBackup({ scenarioKey, announce, databaseName = 'two-way-experience-studio-v2', storeName = 'scenario-backups', recordKey = 'active-scenarios', restoreFlag = 'two-way-experience-studio-v2-idb-restored' }) {
  const openDatabase = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const readBackup = async () => {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).get(recordKey);
      request.onsuccess = () => resolve(request.result?.value || '');
      request.onerror = () => reject(request.error);
    });
  };
  const writeBackup = async value => {
    if (!value) return;
    const database = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put({ value, updatedAt:Date.now() }, recordKey);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  };
  const hasValidScenarios = value => {
    try {
      const parsed = JSON.parse(value || '');
      const records = Array.isArray(parsed) ? parsed : parsed?.scenarios;
      return Array.isArray(records);
    } catch { return false; }
  };
  return async () => {
    try {
      const current = localStorage.getItem(scenarioKey);
      const backup = await readBackup();
      /* IndexedDB is a recovery source, never an authority over a valid active
         save. This prevents a stale mirror from replacing newer browser work. */
      if (!hasValidScenarios(current) && hasValidScenarios(backup) && !sessionStorage.getItem(restoreFlag)) {
        sessionStorage.setItem(restoreFlag, '1');
        localStorage.setItem(scenarioKey, backup);
        location.reload();
        return;
      }
      const originalSetItem = Storage.prototype.setItem;
      if (!window.__twoWayV2StoragePatched) {
        window.__twoWayV2StoragePatched = true;
        Storage.prototype.setItem = function(key, value) {
          const result = originalSetItem.call(this, key, value);
          if (this === localStorage && key === scenarioKey) writeBackup(String(value)).catch(() => {});
          return result;
        };
      }
      if (hasValidScenarios(current)) await writeBackup(current);
    } catch { announce('Local scenario backup is unavailable in this browser.'); }
  };
};
