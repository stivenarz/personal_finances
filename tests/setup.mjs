import { installBrowserShims } from './helpers.mjs';
installBrowserShims();
const { DataService } = await import('../src/services/data-service.js');
const { resetLedgerCache } = await import('../src/domain/ledger.js');
const { __setToday } = await import('../src/core/utils.js');

export async function freshApp(today = '2026-10-12') {
    localStorage.clear();
    DataService._reset();
    resetLedgerCache();
    __setToday(today);
    await DataService.init();
    return DataService;
}
export { DataService };
