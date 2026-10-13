import { DataService } from './services/data-service.js';
import { registerView, showView, renderActive, setupNavigation } from './core/router.js';
import { setupMobileMenu } from './core/menu.js';
import { registerServiceWorker } from './core/pwa.js';
import { uiState } from './core/state.js';
import { showNotification } from './core/notifications.js';
import { runMigrations } from './domain/migrations.js';
import { initTheme } from './services/theme-service.js';
import { renderSyncStatus } from './features/settings/provider-panel.js';
import { openExportDialog } from './features/shared/export-dialog.js';

import * as dashboard from './features/dashboard/index.js';
import * as accounts from './features/accounts/index.js';
import * as expenses from './features/expenses/index.js';
import * as income from './features/income/index.js';
import * as debts from './features/debts/index.js';
import * as savings from './features/savings/index.js';
import * as planning from './features/planning/index.js';
import * as transactions from './features/transactions/index.js';
import * as categories from './features/categories/index.js';
import * as settings from './features/settings/index.js';

registerServiceWorker();

async function start() {
    initTheme();
    await DataService.init();

    registerView('dashboard', { title: 'Dashboard', feature: dashboard });
    registerView('cuentas', { title: 'Cuentas', feature: accounts });
    registerView('categorias', { title: 'Categorías', feature: categories });
    registerView('gastos', { title: 'Gastos', feature: expenses });
    registerView('ingresos', { title: 'Ingresos', feature: income });
    registerView('deudas', { title: 'Deudas', feature: debts });
    registerView('ahorros', { title: 'Ahorros', feature: savings });
    registerView('planificacion', { title: 'Planificación', feature: planning });
    registerView('transacciones', { title: 'Transacciones', feature: transactions });
    registerView('configuracion', { title: 'Configuración', feature: settings });

    setupNavigation();
    setupMobileMenu();

    const monthInput = document.getElementById('month-filter');
    monthInput.value = uiState.currentMonth;
    monthInput.addEventListener('change', (e) => {
        if (!e.target.value) return;
        uiState.currentMonth = e.target.value;
        renderActive();
    });
    document.getElementById('export-btn').addEventListener('click', openExportDialog);

    DataService.onStatus(renderSyncStatus);
    DataService.subscribe(renderActive);

    showView('dashboard');
    document.getElementById('loading-spinner')?.classList.add('hidden');

    DataService.whenReady().then(() => {
        const changes = runMigrations();
        if (changes > 0) console.info(`[Migración] ${changes} registro(s) actualizados a totales calculados`);
    }).catch(error => {
        console.error('Error en la migración:', error);
        showNotification('⚠️ No se pudo actualizar el formato de los datos', 'warning');
    });
}

start().catch(error => {
    console.error('Error iniciando la app:', error);
    document.getElementById('loading-spinner')?.classList.add('hidden');
    showNotification('❌ Error iniciando la app: ' + error.message, 'error');
});
