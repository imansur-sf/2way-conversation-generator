(window.TwoWayV2 ||= {}).createScenarioBackup = function createScenarioBackup({ scenarioKey, announce, databaseName = 'two-way-experience-studio-v2', storeName = 'scenario-backups', recordKey = 'active-scenarios', restoreFlag = 'two-way-experience-studio-v2-idb-restored' }) {
  const openDatabase = () => new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, database) => {
      if (settled) { database?.close(); return; }
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(database);
    };
    const timer = setTimeout(() => finish(new Error('Legacy recovery database timed out.')), 5000);
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName); };
    request.onsuccess = () => finish(null, request.result);
    request.onerror = () => finish(request.error);
    request.onblocked = () => finish(new Error('Legacy recovery database is blocked.'));
  });
  const readBackup = async () => {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).get(recordKey);
      const timer = setTimeout(() => { database.close(); reject(new Error('Legacy recovery read timed out.')); }, 5000);
      request.onsuccess = () => { clearTimeout(timer); database.close(); resolve(request.result?.value || ''); };
      request.onerror = () => { clearTimeout(timer); database.close(); reject(request.error); };
    });
  };
  const hasValidScenarios = value => {
    try {
      const parsed = JSON.parse(value || '');
      const records = Array.isArray(parsed) ? parsed : parsed?.scenarios;
      return Array.isArray(records) && records.length > 0 && records.some(scenario => scenario && typeof scenario === 'object' && (Array.isArray(scenario.steps) || Object.values(scenario.variants || {}).some(variant => Array.isArray(variant?.steps))));
    } catch { return false; }
  };
  return async () => {
    try {
      await window.__twoWayScenarioInitialization;
      if (window.__twoWayPrimaryScenarioLoaded || window.__twoWayScenarioEdited || sessionStorage.getItem(restoreFlag)) return;
      const backup = await readBackup();
      // Re-read after the asynchronous operation. The original mirror remains
      // a read-only recovery source; the primary store owns all future saves.
      const current = localStorage.getItem(scenarioKey);
      if (!window.__twoWayPrimaryScenarioLoaded && !window.__twoWayScenarioEdited && !hasValidScenarios(current) && hasValidScenarios(backup) && !sessionStorage.getItem(restoreFlag)) {
        localStorage.setItem(scenarioKey, backup);
        sessionStorage.setItem(restoreFlag, '1');
        location.reload();
      }
    } catch { announce('Local scenario backup is unavailable in this browser.'); }
  };
};
