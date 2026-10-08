/**
 * APLICACIÓN DE FINANZAS PERSONALES
 * ===================================
 * Sistema completo de gestión de finanzas personales con almacenamiento local.
 *
 * Características:
 * - Dashboard con KPIs en tiempo real
 * - Gestión de gastos, ingresos y deudas
 * - Metas de ahorro y presupuesto
 * - Gráficos dinámicos
 * - Almacenamiento en LocalStorage
 *
 * Estructura de datos:
 * - Transacciones: Ingresos, Egresos, Abonos a Metas, Pagos de Deudas
 * - Cuentas: Corriente, Tarjeta, Efectivo, Ahorros
 * - Categorías: Personalizables por tipo de transacción
 * - Deudas: Con seguimiento de saldo y pagos
 * - Metas de Ahorro: Con depósitos y retiros
 */

const APP = {
    // Mes actual para filtrado de datos
    currentMonth: new Date().toISOString().slice(0, 7),
    // Almacenamiento central de datos
    data: {
        transactions: [],  // Todos los movimientos (ingresos, egresos, abonos, pagos)
        debts: [],         // Deudas registradas
        accounts: [],      // Cuentas bancarias/de efectivo
        categories: [],    // Categorías de gastos e ingresos
        goals: [],         // Metas de ahorro
        debtPayments: [],  // Historial de pagos de deudas
        recurringExpenses: [], // Gastos fijos con día de pago
        paymentPlans: [],  // Planes de pago guardados
        settings: []       // Configuración (doc 'plan': ingresos fijos y frecuencia)
    },
    // Instancias de gráficos (Chart.js)
    charts: {},
    // Configuración para sincronización con Google Sheets (opcional)
    gsheet: {
        url: '',
        scriptUrl: '',
        spreadsheetId: '',
        isConnected: false,
        isSyncing: false
    }
};

// ============ OFFLINE SUPPORT ============
function loadOfflineData() {
    try {
        const offlineData = localStorage.getItem('app_offline_data');
        if (offlineData) {
            APP.data = { ...APP.data, ...JSON.parse(offlineData) };
            // Ensure all accounts have a valid numeric balance property
            if (APP.data.accounts && APP.data.accounts.length > 0) {
                APP.data.accounts.forEach(acc => {
                    if (acc.balance === null || acc.balance === undefined || isNaN(acc.balance)) {
                        acc.balance = 0;
                    } else {
                        acc.balance = Number(acc.balance);
                    }
                });
            }
            // Fix transaction categories
            fixTransactionCategories();
            // Save the migrated data back to localStorage
            saveOfflineData();
            return;
        }
    } catch (error) {
        console.error('Error loading offline data:', error);
    }
}

function saveOfflineData() {
    try {
        localStorage.setItem('app_offline_data', JSON.stringify(APP.data));
    } catch (error) {
        console.error('Error saving offline data:', error);
    }
}

// ============ DATA LAYER ============
// Única vía para modificar datos: actualiza APP.data + localStorage y, si hay
// Firebase configurado, escribe en la nube (Firestore guarda los cambios offline).
const CLOUD = {
    enabled: false,
    unsubscribers: [],
    serverConfirmed: {},
    pending: false,
    pendingSince: null,
    error: null
};

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

function cloudCall(promise) {
    promise.catch(error => {
        console.error('Error de sincronización:', error);
        CLOUD.error = error;
        showNotification('⚠️ No se pudo guardar en la nube: ' + error.message, 'warning');
        updateSyncStatus();
    });
}

function upsertLocal(collectionName, record) {
    const list = APP.data[collectionName];
    const index = list.findIndex(item => item.id === record.id);
    if (index >= 0) list[index] = record;
    else list.push(record);
}

function dbSave(collectionName, record) {
    upsertLocal(collectionName, record);
    saveOfflineData();
    if (CLOUD.enabled) cloudCall(window.firebaseDB.saveRecord(collectionName, record));
}

function dbPatch(collectionName, id, fields) {
    const record = APP.data[collectionName].find(item => item.id === id);
    if (!record) return;
    Object.assign(record, fields);
    saveOfflineData();
    if (CLOUD.enabled) cloudCall(window.firebaseDB.patchRecord(collectionName, id, fields));
}

function dbDelete(collectionName, id) {
    APP.data[collectionName] = APP.data[collectionName].filter(item => item.id !== id);
    saveOfflineData();
    if (CLOUD.enabled) cloudCall(window.firebaseDB.deleteRecord(collectionName, id));
}

function dbAdjustBalance(accountId, delta) {
    const account = APP.data.accounts.find(item => item.id === accountId);
    if (!account || !delta) return;
    account.balance = money((account.balance || 0) + delta);
    saveOfflineData();
    if (CLOUD.enabled) cloudCall(window.firebaseDB.adjustNumericField('accounts', accountId, 'balance', delta));
}

function dismissNotification(notification) {
    if (notification.classList.contains('leaving')) return;
    notification.classList.add('leaving');
    setTimeout(() => notification.remove(), 300);
}

function showNotification(message, type = 'info') {
    let root = document.getElementById('toast-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'toast-root';
        document.body.appendChild(root);
    }

    const notification = document.createElement('div');
    notification.className = `toast toast-${type}`;
    notification.textContent = message;
    notification.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        dismissNotification(notification);
    });

    root.appendChild(notification);
    setTimeout(() => dismissNotification(notification), 5000);
}

const SYNC_LABELS = {
    local: { text: 'Solo local', cls: 'local' },
    connecting: { text: 'Conectando…', cls: 'syncing' },
    syncing: { text: 'Sincronizando…', cls: 'syncing' },
    synced: { text: 'Conectado y sincronizado', cls: 'synced' },
    offline: { text: 'Sin conexión · cambios pendientes', cls: 'offline' },
    error: { text: 'Error de sincronización', cls: 'error' }
};

function currentSyncState() {
    if (!CLOUD.enabled) return 'local';
    if (CLOUD.error) return 'error';
    if (!navigator.onLine) return 'offline';
    if (CLOUD.pending && CLOUD.pendingSince && Date.now() - CLOUD.pendingSince > 15000) return 'offline';
    if (CLOUD.pending) return 'syncing';
    const allConfirmed = COLLECTION_NAMES.every(name => CLOUD.serverConfirmed[name]);
    return allConfirmed ? 'synced' : 'connecting';
}

function updateSyncStatus() {
    const state = currentSyncState();
    const { text, cls } = SYNC_LABELS[state];

    document.querySelectorAll('[data-sync-badge]').forEach(badge => {
        badge.textContent = text;
        badge.className = `sync-badge sync-${cls}`;
    });

    const statusEl = document.getElementById('db-mode-status');
    if (statusEl) statusEl.textContent = text;
}

const COLLECTION_NAMES = ['accounts', 'categories', 'transactions', 'debts', 'debtPayments', 'goals', 'recurringExpenses', 'paymentPlans', 'settings'];
const pendingFlags = {};

function handleCollectionSnapshot(collectionName, snapshot) {
    const serverConfirmed = !snapshot.metadata.fromCache;
    const remoteIds = new Set();

    snapshot.docs.forEach(docSnap => {
        remoteIds.add(docSnap.id);
        const data = docSnap.data();
        if (data.deleted === true) {
            APP.data[collectionName] = APP.data[collectionName].filter(item => item.id !== docSnap.id);
            return;
        }
        const record = { id: docSnap.id, ...normalizeRemote(data) };
        upsertLocal(collectionName, record);
    });

    if (serverConfirmed) {
        CLOUD.serverConfirmed[collectionName] = true;
        APP.data[collectionName]
            .filter(item => !remoteIds.has(item.id))
            .forEach(item => cloudCall(window.firebaseDB.saveRecord(collectionName, item)));
        migrateLegacyDeletions(collectionName);
    }

    pendingFlags[collectionName] = snapshot.metadata.hasPendingWrites;
    const wasPending = CLOUD.pending;
    CLOUD.pending = Object.values(pendingFlags).some(Boolean);
    if (CLOUD.pending && !wasPending) CLOUD.pendingSince = Date.now();
    if (!CLOUD.pending) CLOUD.pendingSince = null;

    saveOfflineData();
    scheduleRefresh();
    updateSyncStatus();
}

function normalizeRemote(data) {
    const result = {};
    Object.entries(data).forEach(([key, value]) => {
        if (key === 'updatedAt' || key === 'deleted') return;
        result[key] = value && typeof value.toDate === 'function' ? value.toDate().toISOString() : value;
    });
    return result;
}

function migrateLegacyDeletions(collectionName) {
    const legacy = JSON.parse(localStorage.getItem('deletedRecords') || '{}');
    const ids = Object.keys(legacy[collectionName] || {});
    if (ids.length === 0) return;
    ids.forEach(id => cloudCall(window.firebaseDB.deleteRecord(collectionName, id)));
    delete legacy[collectionName];
    localStorage.setItem('deletedRecords', JSON.stringify(legacy));
}

let refreshTimer = null;
function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshAllViews, 50);
}

function refreshAllViews() {
    renderCategories();
    renderAccounts();
    renderAccountsList();
    renderCategoriesList();
    renderExpensesList();
    renderIncomeList();
    renderTransactionsList();
    renderDebtsList();
    renderSavingsGoalsList();
    updateSavingsKpis();
    updateDashboard();
    renderPlanning();
}

async function initCloud() {
    const fb = window.firebaseDB;
    CLOUD.enabled = false;
    if (!fb.isFirebaseConfigured()) {
        updateSyncStatus();
        return;
    }

    try {
        fb.initializeFirebase();
        await fb.ensureSignedIn();
    } catch (error) {
        console.error('Firebase error:', error);
        CLOUD.error = error;
        showNotification('⚠️ No se pudo conectar con Firebase. Modo local.', 'warning');
        updateSyncStatus();
        return;
    }

    CLOUD.enabled = true;
    setInterval(updateSyncStatus, 5000);
    CLOUD.unsubscribers = COLLECTION_NAMES.map(name =>
        fb.subscribeCollection(
            name,
            snapshot => handleCollectionSnapshot(name, snapshot),
            error => {
                console.error(`Error escuchando ${name}:`, error);
                CLOUD.error = error;
                showNotification(`⚠️ Error de sincronización (${name}): ${error.message}`, 'warning');
                updateSyncStatus();
            }
        )
    );
    updateSyncStatus();
}

async function forceSync() {
    if (!CLOUD.enabled) {
        showNotification('⚠️ Configura Firebase en Configuración para sincronizar', 'warning');
        return;
    }

    const button = document.getElementById('sync-data-btn');
    if (button) button.disabled = true;
    CLOUD.pending = true;
    updateSyncStatus();

    try {
        await window.firebaseDB.setNetworkEnabled(false);
        await window.firebaseDB.setNetworkEnabled(true);
        await Promise.race([
            window.firebaseDB.pendingWrites(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 20000))
        ]);
        CLOUD.error = null;
        showNotification('✅ Sincronizado con la nube', 'success');
    } catch {
        showNotification('⚠️ Sin conexión: los cambios se enviarán al reconectar', 'warning');
    } finally {
        if (button) button.disabled = false;
        updateSyncStatus();
    }
}

// ============ INITIALIZATION ============
async function initApp() {
    const spinner = document.getElementById('loading-spinner');

    const fb = await import('./firebase-config.js?v=3');
    window.firebaseDB = fb;

    loadOfflineData();
    setupEventListeners();
    setupPlanning();
    setupMobileMenu();
    setupSyncButton();
    setupFirebaseEventListeners();
    setCurrentMonth();
    showView('dashboard');
    refreshAllViews();

    if (spinner) spinner.classList.add('hidden');

    window.addEventListener('online', updateSyncStatus);
    window.addEventListener('offline', updateSyncStatus);

    await initCloud();
}

function setMenuOpen(open) {
    const toggle = document.getElementById('mobile-menu-toggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    sidebar.classList.toggle('open', open);
    overlay?.classList.toggle('open', open);
    toggle.classList.toggle('hidden', open);
    toggle.setAttribute('aria-expanded', String(open));
}

function setupMobileMenu() {
    const toggle = document.getElementById('mobile-menu-toggle');
    const sidebar = document.getElementById('sidebar');
    const closeBtn = document.getElementById('sidebar-close');
    const overlay = document.getElementById('sidebar-overlay');

    toggle?.addEventListener('click', () => setMenuOpen(true));
    closeBtn?.addEventListener('click', () => setMenuOpen(false));
    overlay?.addEventListener('click', () => setMenuOpen(false));

    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth <= 768) setMenuOpen(false);
        });
    });

    let touchStartX = 0;
    let touchStartY = 0;

    document.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, false);

    document.addEventListener('touchend', (e) => {
        const deltaX = e.changedTouches[0].clientX - touchStartX;
        const deltaY = e.changedTouches[0].clientY - touchStartY;

        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
            if (touchStartX < 50 && deltaX > 50) {
                setMenuOpen(true);
            } else if (sidebar.classList.contains('open') && deltaX < -50) {
                setMenuOpen(false);
            }
        }
    }, false);
}

function loadDataFromStorage() {
    // Los datos se cargan desde Firebase automáticamente en initApp
}

function loadGSheetConfig() {
    const scriptUrl = localStorage.getItem('gasScriptUrl');
    if (scriptUrl) {
        APP.gsheet.scriptUrl = scriptUrl;
        document.getElementById('gsheet-url').value = scriptUrl;
        APP.gsheet.isConnected = true;
        syncAllDataFromSheet();
    }
}

function saveGSheetConfig(scriptUrl) {
    APP.gsheet.scriptUrl = scriptUrl;
    localStorage.setItem('gasScriptUrl', scriptUrl);
    testGSheetConnection();
    setTimeout(() => {
        if (APP.gsheet.isConnected) {
            syncAllDataFromSheet();
        }
    }, 1000);
}


async function saveDataToStorage() {
    // Los datos se guardan automáticamente en Firebase
    // Esta función se mantiene por compatibilidad pero ahora es async
}

function syncDataToSheet() {
    if (!APP.gsheet.scriptUrl || APP.gsheet.isSyncing) return;

    APP.gsheet.isSyncing = true;

    // Sincronizar transacciones
    APP.data.transactions.forEach(trans => {
        addDataToSheet('Transacciones', trans);
    });

    // Sincronizar deudas
    APP.data.debts.forEach(debt => {
        addDataToSheet('Deudas', debt);
    });

    // Sincronizar cuentas
    APP.data.accounts.forEach(acc => {
        addDataToSheet('Cuentas', acc);
    });

    // Sincronizar categorías
    APP.data.categories.forEach(cat => {
        addDataToSheet('Categorías', cat);
    });

    // Sincronizar metas
    APP.data.goals.forEach(goal => {
        addDataToSheet('Metas', goal);
    });

    APP.gsheet.isSyncing = false;
}

function syncAllDataFromSheet() {
    if (!APP.gsheet.scriptUrl) {
        showGSheetStatus('⚠️ URL de Apps Script no configurada', 'error');
        return;
    }

    APP.gsheet.isSyncing = true;
    showGSheetStatus('🔄 Sincronizando datos desde la hoja...', 'success');

    Promise.all([
        readDataFromSheet('Transacciones').then(data => APP.data.transactions = data),
        readDataFromSheet('Deudas').then(data => APP.data.debts = data),
        readDataFromSheet('Cuentas').then(data => APP.data.accounts = data),
        readDataFromSheet('Categorías').then(data => APP.data.categories = data),
        readDataFromSheet('Metas').then(data => APP.data.goals = data)
    ]).then(() => {
        APP.gsheet.isSyncing = false;
        showGSheetStatus('✅ Sincronización completada', 'success');
        updateDashboard();
        renderAccounts();
        renderCategories();
        renderExpensesList();
        renderIncomeList();
        renderDebtsList();
    }).catch(error => {
        APP.gsheet.isSyncing = false;
        showGSheetStatus('❌ Error: ' + error.message, 'error');
    });
}

function addDataToSheet(sheetName, dataObject) {
    if (!APP.gsheet.scriptUrl) return;

    fetch(APP.gsheet.scriptUrl, {
        method: 'POST',
        body: JSON.stringify({
            action: 'addData',
            sheet: sheetName,
            data: dataObject
        })
    }).catch(e => console.error('Error adding to sheet:', e));
}

function readDataFromSheet(sheetName) {
    if (!APP.gsheet.scriptUrl) return Promise.reject(new Error('URL no configurada'));

    return fetch(APP.gsheet.scriptUrl + '?action=readData&sheet=' + encodeURIComponent(sheetName))
        .then(response => response.json())
        .then(result => {
            if (result.success) {
                return result.data || [];
            } else {
                throw new Error(result.error);
            }
        });
}

function updateDataInSheet(sheetName, id, dataObject) {
    if (!APP.gsheet.scriptUrl) return;

    fetch(APP.gsheet.scriptUrl, {
        method: 'POST',
        body: JSON.stringify({
            action: 'updateData',
            sheet: sheetName,
            id: id,
            data: dataObject
        })
    }).catch(e => console.error('Error updating sheet:', e));
}

function deleteDataFromSheet(sheetName, id) {
    if (!APP.gsheet.scriptUrl) return;

    fetch(APP.gsheet.scriptUrl, {
        method: 'POST',
        body: JSON.stringify({
            action: 'deleteData',
            sheet: sheetName,
            id: id
        })
    }).catch(e => console.error('Error deleting from sheet:', e));
}

// ============ EVENT LISTENERS ============
function setupSyncButton() {
    document.getElementById('sync-data-btn')?.addEventListener('click', forceSync);
}

function getMoneyValue(value) {
    if (typeof value === 'string') {
        // Remove all dots (thousand separators) and keep only digits
        const cleanValue = value.replace(/\./g, '').replace(/[^\d]/g, '');
        return parseFloat(cleanValue) || 0;
    }
    return parseFloat(value) || 0;
}


function setupEventListeners() {
    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const view = e.currentTarget.dataset.view;
            showView(view);
        });
    });

    // Month filter
    document.getElementById('month-filter').addEventListener('change', (e) => {
        APP.currentMonth = e.target.value;
        updateDashboard();
        renderTransactionsList();
        renderPlanning();
    });

    // Forms
    document.getElementById('form-gasto').addEventListener('submit', handleAddExpense);
    document.getElementById('form-ingreso').addEventListener('submit', handleAddIncome);
    document.getElementById('form-deuda').addEventListener('submit', handleAddDebt);
    document.getElementById('form-cuenta').addEventListener('submit', handleAddAccount);
    document.getElementById('form-categoria').addEventListener('submit', handleAddCategory);
    const formMetaAhorro = document.getElementById('form-meta-ahorro');
    if (formMetaAhorro) formMetaAhorro.addEventListener('submit', handleAddSavingsGoal);

    // Gastos filters
    document.getElementById('gastos-search').addEventListener('input', renderExpensesList);
    document.getElementById('gastos-filter-categoria').addEventListener('change', renderExpensesList);

    // Ingresos filters
    document.getElementById('ingresos-search').addEventListener('input', renderIncomeList);
    document.getElementById('ingresos-filter-tipo').addEventListener('change', renderIncomeList);

    // Transacciones filters
    document.getElementById('trans-search').addEventListener('input', renderTransactionsList);
    document.getElementById('trans-filter-tipo').addEventListener('change', renderTransactionsList);
    document.getElementById('trans-filter-cuenta').addEventListener('change', renderTransactionsList);

    // Export
    document.getElementById('export-btn').addEventListener('click', exportToExcel);

    // Delete all data button
    const deleteAllBtn = document.getElementById('delete-all-data-btn');
    if (deleteAllBtn) {
        deleteAllBtn.addEventListener('click', handleDeleteAllData);
    }
}

function setupGSheetEventListeners() {
    const formGsheet = document.getElementById('form-gsheet');
    const testBtn = document.getElementById('gsheet-test-btn');
    const syncBtn = document.getElementById('gsheet-sync-btn');

    if (formGsheet) formGsheet.addEventListener('submit', handleGSheetConnection);
    if (testBtn) testBtn.addEventListener('click', testGSheetConnection);
    if (syncBtn) syncBtn.addEventListener('click', syncWithGSheet);
}

function setupFirebaseEventListeners() {
    const formFirebase = document.getElementById('form-firebase');
    const testBtn = document.getElementById('firebase-test-btn');

    if (formFirebase) {
        formFirebase.addEventListener('submit', async (e) => {
            e.preventDefault();

            const config = {
                apiKey: document.getElementById('firebase-api-key').value.trim(),
                projectId: document.getElementById('firebase-project-id').value.trim(),
                authDomain: document.getElementById('firebase-auth-domain').value.trim(),
                storageBucket: document.getElementById('firebase-storage-bucket').value.trim(),
                messagingSenderId: document.getElementById('firebase-messaging-sender-id').value.trim(),
                appId: document.getElementById('firebase-app-id').value.trim()
            };

            if (!config.apiKey || !config.projectId || !config.authDomain) {
                showFirebaseStatus('Por favor completa los campos requeridos', 'error');
                return;
            }

            if (window.firebaseDB) {
                window.firebaseDB.setFirebaseConfig(config);
                showFirebaseStatus('Configuración guardada. Recargando...', 'success');
                setTimeout(() => location.reload(), 1000);
            }
        });
    }

    if (testBtn) {
        testBtn.addEventListener('click', async () => {
            showFirebaseStatus('Probando conexión...', 'success');
            if (window.firebaseDB) {
                const result = await window.firebaseDB.testFirebaseConnection();
                showFirebaseStatus(result.message, result.success ? 'success' : 'error');
            }
        });
    }

    // Cargar configuración guardada si existe
    const config = window.firebaseDB?.getFirebaseConfigValues?.();
    if (config) {
        const inputs = [
            { id: 'firebase-api-key', key: 'apiKey' },
            { id: 'firebase-project-id', key: 'projectId' },
            { id: 'firebase-auth-domain', key: 'authDomain' },
            { id: 'firebase-storage-bucket', key: 'storageBucket' },
            { id: 'firebase-messaging-sender-id', key: 'messagingSenderId' },
            { id: 'firebase-app-id', key: 'appId' }
        ];

        inputs.forEach(({ id, key }) => {
            const input = document.getElementById(id);
            if (input && config[key]) {
                input.value = config[key];
            }
        });
    }
}

function showFirebaseStatus(message, type) {
    const statusDiv = document.getElementById('firebase-status');
    const statusText = document.getElementById('firebase-status-text');

    if (statusDiv && statusText) {
        statusDiv.style.display = 'block';
        statusText.textContent = message;
        statusDiv.style.background = type === 'error' ? 'var(--danger-light)' : 'var(--secondary-light)';
        statusDiv.style.color = type === 'error' ? 'var(--danger)' : 'var(--secondary)';
    }
}

function setCurrentMonth() {
    document.getElementById('month-filter').value = APP.currentMonth;
}

function fixTransactionCategories() {
    if (!APP.data.transactions) return;

    let updated = false;
    APP.data.transactions.forEach(trans => {
        // Fix transactions with missing or invalid categories
        if ((trans.category === null || trans.category === undefined || trans.category === '') && trans.description) {
            if (trans.description.startsWith('Pago de deuda:')) {
                trans.category = 'Deuda';
                updated = true;
            } else if (trans.description.startsWith('Abono a meta:')) {
                trans.category = 'Ahorros';
                updated = true;
            } else if (trans.description.startsWith('Traslado:')) {
                trans.category = 'Traslado';
                updated = true;
            }
        }
    });

    if (updated) saveOfflineData();
}

// ============ VIEW MANAGEMENT ============
function showView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    document.getElementById(`view-${viewName}`).classList.add('active');
    document.querySelector(`[data-view="${viewName}"]`).classList.add('active');

    const titles = {
        dashboard: 'Dashboard',
        gastos: 'Gastos',
        ingresos: 'Ingresos',
        deudas: 'Deudas',
        ahorros: 'Ahorros',
        transacciones: 'Transacciones',
        configuracion: 'Configuración',
        planificacion: 'Planificación'
    };
    document.getElementById('view-title').textContent = titles[viewName];

    if (viewName === 'deudas') {
        renderDebtsList();
    } else if (viewName === 'ahorros') {
        renderSavingsGoalsList();
        updateSavingsKpis();
    } else if (viewName === 'gastos') {
        renderExpensesList();
    } else if (viewName === 'ingresos') {
        renderIncomeList();
    } else if (viewName === 'transacciones') {
        renderTransactionsList();
    } else if (viewName === 'configuracion') {
        renderAccountsList();
        renderCategoriesList();
    } else if (viewName === 'planificacion') {
        renderPlanning();
    }
}

// ============ EXPENSES ============
function handleAddExpense(e) {
    e.preventDefault();

    const accountId = document.getElementById('gasto-cuenta').value;
    const amount = getMoneyValue(document.getElementById('gasto-monto').value);
    const categoryId = document.getElementById('gasto-categoria').value;

    if (!categoryId) {
        showNotification('❌ Selecciona una categoría', 'error');
        return;
    }

    if (!accountId) {
        showNotification('❌ Selecciona una cuenta', 'error');
        return;
    }

    if (!amount || amount <= 0) {
        showNotification('❌ Ingresa un monto válido', 'error');
        return;
    }

    const account = APP.data.accounts.find(a => a.id === accountId);
    if (!account) {
        showNotification('❌ Cuenta no encontrada', 'error');
        return;
    }

    if (account.balance < amount) {
        showNotification(`❌ Saldo insuficiente. Disponible: $${formatNumber(account.balance)}, Requerido: $${formatNumber(amount)}`, 'error');
        return;
    }

    const expense = {
        id: 'exp-' + Date.now(),
        type: 'Egreso',
        date: document.getElementById('gasto-fecha').value,
        category: categoryId,
        description: document.getElementById('gasto-descripcion').value,
        amount: amount,
        account: accountId,
        timestamp: Date.now()
    };

    dbSave('transactions', expense);
    dbAdjustBalance(accountId, -amount);

    e.target.reset();
    document.getElementById('gasto-fecha').valueAsDate = new Date();

    updateDashboard();
    renderAccounts();
    renderExpensesList();
    renderAccountsList();
    showNotification('Gasto registrado correctamente', 'success');
}

function renderExpensesList() {
    const search = document.getElementById('gastos-search').value.toLowerCase();
    const categoryFilter = document.getElementById('gastos-filter-categoria').value;

    let expenses = APP.data.transactions.filter(t => t.type === 'Egreso' && t.category !== 'Ahorros');

    if (categoryFilter) {
        expenses = expenses.filter(t => t.category === categoryFilter);
    }

    if (search) {
        expenses = expenses.filter(t => t.description.toLowerCase().includes(search));
    }

    const container = document.getElementById('list-gastos');
    container.innerHTML = expenses.map(exp => {
        let categoryName = 'N/A';

        // Try to find category by ID
        if (exp.category && exp.category.startsWith('cat-')) {
            const cat = APP.data.categories.find(c => c.id === exp.category);
            if (cat) categoryName = cat.name;
        } else if (exp.category) {
            // If category is not an ID, use it directly
            categoryName = exp.category;
        } else {
            // If no category, extract from description
            if (exp.description.startsWith('Pago de deuda:')) {
                categoryName = 'Pago de deuda';
            } else if (exp.description.startsWith('Abono a meta:')) {
                categoryName = 'Abono a meta';
            } else if (exp.description.startsWith('Traslado:')) {
                categoryName = 'Traslado';
            }
        }

        return `
            <div class="transaction-item egreso">
                <div class="transaction-date">${new Date(exp.date).toLocaleDateString()}</div>
                <div class="transaction-desc">${exp.description || 'Sin descripción'}</div>
                <div class="transaction-category">${categoryName}</div>
                <div class="transaction-amount negativo">-$${formatNumber(exp.amount)}</div>
                <div class="row-actions">
                    <button class="btn btn-secondary" onclick="editTransaction('${exp.id}')">Editar</button>
                    <button class="btn btn-danger" onclick="deleteTransaction('${exp.id}')">Eliminar</button>
                </div>
            </div>
        `;
    }).join('');

    // Update category filter options
    const categorySelect = document.getElementById('gastos-filter-categoria');
    const selectedValue = categorySelect.value;
    categorySelect.innerHTML = '<option value="">Todas las categorías</option>';
    APP.data.categories.filter(c => c.type === 'Egreso').forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.id;
        option.textContent = cat.name;
        categorySelect.appendChild(option);
    });
    categorySelect.value = selectedValue;
}

// ============ INCOME ============
function handleAddIncome(e) {
    e.preventDefault();

    const accountId = document.getElementById('ingreso-cuenta').value;
    const amount = getMoneyValue(document.getElementById("ingreso-monto").value);

    if (!accountId) {
        showNotification('❌ Selecciona una cuenta', 'error');
        return;
    }

    if (!amount || amount <= 0) {
        showNotification('❌ Ingresa un monto válido', 'error');
        return;
    }

    const account = APP.data.accounts.find(a => a.id === accountId);
    if (!account) {
        showNotification('❌ Cuenta no encontrada', 'error');
        return;
    }

    const income = {
        id: 'inc-' + Date.now(),
        type: 'Ingreso',
        date: document.getElementById('ingreso-fecha').value,
        incomeType: document.getElementById('ingreso-tipo').value,
        description: document.getElementById('ingreso-descripcion').value,
        amount: amount,
        account: accountId,
        timestamp: Date.now()
    };

    dbSave('transactions', income);
    dbAdjustBalance(accountId, amount);

    e.target.reset();
    document.getElementById('ingreso-fecha').valueAsDate = new Date();

    updateDashboard();
    renderAccounts();
    renderIncomeList();
    renderAccountsList();
    showNotification('Ingreso registrado correctamente', 'success');
}

function renderIncomeList() {
    const search = document.getElementById('ingresos-search').value.toLowerCase();
    const typeFilter = document.getElementById('ingresos-filter-tipo').value;

    let incomes = APP.data.transactions.filter(t => t.type === 'Ingreso');

    if (typeFilter) {
        incomes = incomes.filter(t => t.incomeType === typeFilter);
    }

    if (search) {
        incomes = incomes.filter(t => t.description.toLowerCase().includes(search));
    }

    const container = document.getElementById('list-ingresos');
    container.innerHTML = incomes.map(inc => {
        const account = APP.data.accounts.find(a => a.id === inc.account);
        return `
            <div class="transaction-item ingreso">
                <div class="transaction-date">${new Date(inc.date).toLocaleDateString()}</div>
                <div class="transaction-desc">${inc.description}</div>
                <div class="transaction-category">${inc.incomeType} • ${account?.name || 'N/A'}</div>
                <div class="transaction-amount positivo">+$${formatNumber(inc.amount)}</div>
                <div class="row-actions">
                    <button class="btn btn-secondary" onclick="editTransaction('${inc.id}')">Editar</button>
                    <button class="btn btn-danger" onclick="deleteTransaction('${inc.id}')">Eliminar</button>
                </div>
            </div>
        `;
    }).join('');

    // Update type filter options
    const typeSelect = document.getElementById('ingresos-filter-tipo');
    const selectedValue = typeSelect.value;
    typeSelect.innerHTML = '<option value="">Todos los tipos</option>';
    const types = [...new Set(APP.data.transactions.filter(t => t.type === 'Ingreso').map(t => t.incomeType))];
    types.forEach(type => {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = type;
        typeSelect.appendChild(option);
    });
    typeSelect.value = selectedValue;
}

// ============ DEBTS ============
function calculateDebtMetrics(initialBalance, interestRate, termMonths) {
    if (!initialBalance || !interestRate || !termMonths) return null;

    const monthlyRate = interestRate / 100 / 12;

    // Calculate monthly payment using standard loan formula
    // M = P * [r(1+r)^n] / [(1+r)^n - 1]
    if (monthlyRate === 0) {
        return {
            monthlyPayment: initialBalance / termMonths,
            totalInterest: 0
        };
    }

    const numerator = monthlyRate * Math.pow(1 + monthlyRate, termMonths);
    const denominator = Math.pow(1 + monthlyRate, termMonths) - 1;
    const monthlyPayment = initialBalance * (numerator / denominator);
    const totalInterest = (monthlyPayment * termMonths) - initialBalance;

    return {
        monthlyPayment: Math.round(monthlyPayment * 100) / 100,
        totalInterest: Math.round(totalInterest * 100) / 100
    };
}

function handleAddDebt(e) {
    e.preventDefault();

    const initialBalance = getMoneyValue(document.getElementById("deuda-saldo").value);
    const interestRateEl = document.getElementById('deuda-interes');
    const termMonthsEl = document.getElementById('deuda-plazo');

    let interestRate = interestRateEl ? parseFloat(interestRateEl.value) : 0;
    let termMonths = termMonthsEl ? parseFloat(termMonthsEl.value) : 0;
    let monthlyPayment = getMoneyValue(document.getElementById("deuda-cuota").value);

    // Auto-calculate if interest rate and term months are provided
    if (interestRate > 0 && termMonths > 0) {
        const metrics = calculateDebtMetrics(initialBalance, interestRate, termMonths);
        if (metrics) {
            monthlyPayment = metrics.monthlyPayment;
        }
    }

    // Calculate next payment date based on payment day
    const paymentDay = parseInt(document.getElementById('deuda-fecha-pago').value) || 1;
    const today = new Date();
    let nextPayment = new Date(today.getFullYear(), today.getMonth(), paymentDay);

    if (nextPayment <= today) {
        nextPayment = new Date(today.getFullYear(), today.getMonth() + 1, paymentDay);
    }

    const debt = {
        id: 'debt-' + Date.now(),
        entity: document.getElementById('deuda-entidad').value,
        initialBalance: initialBalance,
        currentBalance: getMoneyValue(document.getElementById("deuda-saldo").value),
        monthlyPayment: monthlyPayment,
        holder: document.getElementById('deuda-titular').value,
        paymentDay: paymentDay,
        nextPaymentDate: nextPayment.toISOString().split('T')[0],
        interestRate: interestRate,
        termMonths: termMonths,
        createdAt: Date.now(),
        startDate: new Date().toISOString().split('T')[0]
    };

    dbSave('debts', debt);

    e.target.reset();
    updateDashboard();
    renderDebtsList();
    showNotification('Deuda registrada correctamente', 'success');
}

function renderDebtsList() {
    const container = document.getElementById('list-deudas');

    if (APP.data.debts.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 40px;">No hay deudas registradas</p>';
        return;
    }

    container.innerHTML = APP.data.debts.map(debt => {
        const progress = ((debt.initialBalance - debt.currentBalance) / debt.initialBalance) * 100;
        const monthsLeft = debt.currentBalance > 0 ? Math.ceil(debt.currentBalance / debt.monthlyPayment) : 0;

        let statusClass = '';
        let statusText = '';
        if (monthsLeft <= 1 && monthsLeft > 0) {
            statusClass = 'urgent';
            statusText = 'Último pago';
        } else if (monthsLeft <= 3) {
            statusClass = 'alert';
            statusText = `${monthsLeft} meses`;
        } else {
            statusText = `${monthsLeft} meses`;
        }

        return `
            <div class="debt-detail-card">
                <div class="debt-detail-header">
                    <div>
                        <div class="debt-detail-name">${debt.entity}</div>
                        <div class="debt-detail-info">Titular: ${debt.holder}</div>
                    </div>
                    <span class="debt-item-status ${statusClass}">${statusText}</span>
                </div>

                <div class="debt-detail-info">
                    <strong>Saldo Actual:</strong> $${formatNumber(debt.currentBalance)}
                </div>

                <div class="debt-progress">
                    <div class="debt-progress-bar">
                        <div class="debt-progress-fill" style="width: ${Math.min(progress, 100)}%"></div>
                    </div>
                    <div class="debt-progress-text">${Math.round(progress)}% pagado</div>
                </div>

                <div class="debt-detail-info">
                    <strong>Cuota Mensual:</strong> $${formatNumber(debt.monthlyPayment)}
                </div>

                <div class="debt-actions">
                    <button class="btn btn-primary" onclick="registerDebtPayment('${debt.id}')">Registrar Pago</button>
                    <button class="btn btn-secondary" onclick="editDebt('${debt.id}')">Editar</button>
                    <button class="btn btn-danger" onclick="deleteDebt('${debt.id}')">Eliminar</button>
                </div>
            </div>
        `;
    }).join('');
}

window.showPaymentModal = function(debtId) {
    const debt = APP.data.debts.find(d => d.id === debtId);
    if (!debt) return;

    const accountOptions = APP.data.accounts.map(acc =>
        `<option value="${acc.id}">${acc.name}</option>`
    ).join('');

    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
        background: white;
        padding: 30px;
        border-radius: 12px;
        max-width: 450px;
        width: 90%;
        box-shadow: 0 10px 40px rgba(0,0,0,0.3);
        max-height: 80vh;
        overflow-y: auto;
    `;

    content.innerHTML = `
        <h2 style="margin-top: 0; color: #333;">Registrar Pago de Deuda</h2>
        <p style="color: #666; margin-bottom: 20px; font-size: 14px;">
            <strong>Deuda:</strong> ${debt.description || 'Sin nombre'}<br>
            <strong>Saldo actual:</strong> $${formatNumber(debt.currentBalance)}<br>
            <strong>Cuota sugerida:</strong> $${formatNumber(debt.monthlyPayment)}
        </p>

        <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; color: #333; font-weight: 600;">Seleccionar Cuenta</label>
            <select id="paymentAccount" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px;">
                <option value="">-- Selecciona una cuenta --</option>
                ${accountOptions}
            </select>
        </div>

        <div style="margin-bottom: 20px;">
            <label style="display: block; margin-bottom: 5px; color: #333; font-weight: 600;">Monto a Pagar</label>
            <input type="number" id="paymentAmount" placeholder="Monto a pagar" value="${debt.monthlyPayment}"
                style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 16px;">
        </div>

        <div style="display: flex; gap: 10px;">
            <button id="confirmPayment" style="flex: 1; padding: 12px; background: #667eea; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: 600;">Registrar Pago</button>
            <button id="cancelPayment" style="flex: 1; padding: 12px; background: #f0f0f0; color: #333; border: none; border-radius: 6px; cursor: pointer; font-size: 16px;">Cancelar</button>
        </div>
    `;

    modal.appendChild(content);
    document.body.appendChild(modal);

    const amountInput = document.getElementById('paymentAmount');
    const accountSelect = document.getElementById('paymentAccount');
    amountInput.focus();
    amountInput.select();

    document.getElementById('confirmPayment').addEventListener('click', () => {
        const amount = parseFloat(amountInput.value);
        const accountId = accountSelect.value;
        modal.remove();

        const current = APP.data.debts.find(d => d.id === debtId);
        if (!current) {
            showNotification('❌ Deuda no encontrada', 'error');
            return;
        }

        if (!accountId) {
            showNotification('❌ Selecciona una cuenta', 'error');
            return;
        }

        if (!amount || isNaN(amount) || amount <= 0) {
            showNotification('❌ Ingrese un monto válido', 'error');
            return;
        }

        if (amount > current.currentBalance) {
            showNotification('❌ El monto no puede exceder el saldo actual', 'error');
            return;
        }

        const account = APP.data.accounts.find(a => a.id === accountId);
        if (!account) {
            showNotification('❌ Cuenta no encontrada', 'error');
            return;
        }

        if (account.balance < amount) {
            showNotification('❌ Saldo insuficiente en la cuenta', 'error');
            return;
        }

        const newBalance = money(Math.max(0, current.currentBalance - amount));
        const debtFields = { currentBalance: newBalance };

        if (current.interestRate > 0 && current.termMonths > 0 && newBalance > 0) {
            const remainingMonths = Math.ceil((newBalance / current.monthlyPayment) * 12 / current.termMonths);
            if (remainingMonths > 0) {
                const metrics = calculateDebtMetrics(newBalance, current.interestRate, remainingMonths);
                if (metrics) debtFields.monthlyPayment = metrics.monthlyPayment;
            }
        }

        if (current.paymentDay) {
            const today = new Date();
            let nextPayment = new Date(today.getFullYear(), today.getMonth(), current.paymentDay);
            if (nextPayment <= today) {
                nextPayment = new Date(today.getFullYear(), today.getMonth() + 1, current.paymentDay);
            }
            debtFields.nextPaymentDate = nextPayment.toISOString().split('T')[0];
        }

        const today = new Date().toISOString().split('T')[0];
        const transaction = {
            id: 'trans-' + Date.now(),
            type: 'Egreso',
            date: today,
            category: 'Deuda',
            description: `Pago de deuda: ${current.entity || 'Sin nombre'}`,
            amount: amount,
            account: accountId,
            timestamp: Date.now()
        };

        const debtPayment = {
            id: 'pay-' + Date.now(),
            debtId: debtId,
            amount: amount,
            date: today,
            timestamp: Date.now(),
            accountId: accountId,
            transactionId: transaction.id
        };

        dbPatch('debts', debtId, debtFields);
        dbSave('debtPayments', debtPayment);
        dbSave('transactions', transaction);
        dbAdjustBalance(accountId, -amount);

        updateDashboard();
        renderDebtsList();
        renderAccountsList();
        renderTransactionsList();
        showNotification('✅ Pago registrado correctamente', 'success');
    });

    document.getElementById('cancelPayment').addEventListener('click', () => {
        modal.remove();
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
};

window.registerDebtPayment = function(debtId) {
    window.showPaymentModal(debtId);
}

window.deleteDebt = async function(debtId) {
    const debt = APP.data.debts.find(d => d.id === debtId);
    if (!debt) return;

    const confirmed = confirm(`¿Eliminar la deuda "${debt.description || 'Sin nombre'}"?`);
    if (!confirmed) return;

    dbDelete('debts', debtId);
    updateDashboard();
    renderDebtsList();
}

// ============ TRANSACTIONS ============
function goalForTransaction(t) {
    const description = t.description || '';
    if (t.category === 'Retiro de Ahorros' && description.startsWith('Retiro de ahorros: ')) {
        const name = description.slice('Retiro de ahorros: '.length);
        return APP.data.goals.find(g => g.description === name);
    }
    if (t.type === 'Ahorro' && description.startsWith('Abono a meta: ')) {
        const name = description.slice('Abono a meta: '.length);
        return APP.data.goals.find(g => g.description === name);
    }
    return null;
}

function transferAccounts(t) {
    const origin = APP.data.accounts.find(a => a.id === t.account);
    let destination = t.toAccount ? APP.data.accounts.find(a => a.id === t.toAccount) : null;
    if (!destination) {
        const match = (t.description || '').match(/^Transferencia de (.+?) a (.+?)(:|$)/);
        if (match) destination = APP.data.accounts.find(a => a.name === match[2]);
    }
    return { origin, destination };
}

function debtPaymentForTransaction(t) {
    const linked = APP.data.debtPayments.find(p => p.transactionId === t.id);
    if (linked) return linked;
    if (t.type === 'Egreso' && t.category === 'Deuda') {
        return APP.data.debtPayments.find(p =>
            p.amount === t.amount && p.date === t.date && p.accountId === t.account
        );
    }
    return null;
}

function undoTransactionEffects(t) {
    const amount = t.amount || 0;

    if (t.type === 'Egreso' || t.type === 'Ahorro') {
        dbAdjustBalance(t.account, amount);
    } else if (t.type === 'Ingreso') {
        dbAdjustBalance(t.account, -amount);
    } else if (t.type === 'Transferencia') {
        const { origin, destination } = transferAccounts(t);
        if (origin) dbAdjustBalance(origin.id, amount);
        if (destination) dbAdjustBalance(destination.id, -amount);
    }

    const goal = goalForTransaction(t);
    if (goal) {
        const sign = t.type === 'Ahorro' ? -1 : 1;
        dbPatch('goals', goal.id, { currentAmount: money(goal.currentAmount + sign * amount) });
    }

    const payment = debtPaymentForTransaction(t);
    if (payment) {
        const debt = APP.data.debts.find(d => d.id === payment.debtId);
        if (debt) dbPatch('debts', debt.id, { currentBalance: money(debt.currentBalance + payment.amount) });
        dbDelete('debtPayments', payment.id);
    }
}

function applyTransactionEffects(t) {
    const amount = t.amount || 0;

    if (t.type === 'Egreso') {
        dbAdjustBalance(t.account, -amount);
    } else if (t.type === 'Ingreso') {
        dbAdjustBalance(t.account, amount);
    } else if (t.type === 'Ahorro') {
        dbAdjustBalance(t.account, -amount);
    } else if (t.type === 'Transferencia') {
        const { origin, destination } = transferAccounts(t);
        if (origin) dbAdjustBalance(origin.id, -amount);
        if (destination) dbAdjustBalance(destination.id, amount);
    }

    const goal = goalForTransaction(t);
    if (goal) {
        const sign = t.type === 'Ahorro' ? 1 : -1;
        dbPatch('goals', goal.id, { currentAmount: money(goal.currentAmount + sign * amount) });
    }

    if (t.type === 'Egreso' && t.category === 'Deuda') {
        const entity = (t.description || '').replace(/^Pago de deuda: /, '');
        const debt = APP.data.debts.find(d => (d.entity || 'Sin nombre') === entity);
        if (debt) {
            dbPatch('debts', debt.id, { currentBalance: money(Math.max(0, debt.currentBalance - amount)) });
            dbSave('debtPayments', {
                id: 'pay-' + Date.now(),
                debtId: debt.id,
                amount: amount,
                date: t.date,
                timestamp: Date.now(),
                accountId: t.account,
                transactionId: t.id
            });
        }
    }
}

function refreshMovementViews() {
    updateDashboard();
    renderExpensesList();
    renderIncomeList();
    renderTransactionsList();
    renderAccounts();
    renderAccountsList();
    renderDebtsList();
    renderSavingsGoalsList();
    updateSavingsKpis();
}

window.deleteTransaction = function(transId) {
    const transaction = APP.data.transactions.find(t => t.id === transId);
    if (!transaction) return;

    const confirmed = confirm(`¿Eliminar la transacción de ${transaction.type === 'Egreso' ? 'gasto' : 'ingreso'}?`);
    if (!confirmed) return;

    undoTransactionEffects(transaction);
    dbDelete('transactions', transId);
    refreshMovementViews();
}

function renderTransactionsList() {
    const search = document.getElementById('trans-search').value.toLowerCase();
    const typeFilter = document.getElementById('trans-filter-tipo').value;
    const accountFilter = document.getElementById('trans-filter-cuenta').value;

    let transactions = [...APP.data.transactions];

    transactions = transactions.filter(t => t.date.slice(0, 7) === APP.currentMonth);

    if (typeFilter) {
        transactions = transactions.filter(t => t.type === typeFilter);
    }

    if (accountFilter) {
        transactions = transactions.filter(t => t.account === accountFilter);
    }

    if (search) {
        transactions = transactions.filter(t => (t.description || t.incomeType || '').toLowerCase().includes(search));
    }

    transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

    const container = document.getElementById('list-transacciones');
    container.innerHTML = transactions.map(t => {
        const account = APP.data.accounts.find(a => a.id === t.account);
        const isExpense = t.type === 'Egreso';
        const categoryName = isExpense
            ? APP.data.categories.find(c => c.id === t.category)?.name
            : t.incomeType;

        return `
            <div class="transaction-row ${t.type.toLowerCase()}">
                <div>
                    <div style="font-weight: 500;">${t.description || t.incomeType}</div>
                    <div style="font-size: 12px; color: var(--text-secondary);">${account?.name || 'N/A'} • ${categoryName}</div>
                </div>
                <div style="font-size: 12px; color: var(--text-secondary);">${new Date(t.date).toLocaleDateString()}</div>
                <div style="font-weight: 600; color: ${isExpense ? 'var(--danger)' : 'var(--secondary)'};">
                    ${isExpense ? '-' : '+'}$${formatNumber(t.amount)}
                </div>
                <div class="row-actions">
                    <button class="btn btn-secondary" onclick="editTransaction('${t.id}')">Editar</button>
                    <button class="btn btn-danger" onclick="deleteTransaction('${t.id}')">Eliminar</button>
                </div>
            </div>
        `;
    }).join('');

    // Update account filter options
    const accountSelect = document.getElementById('trans-filter-cuenta');
    const selectedValue = accountSelect.value;
    accountSelect.innerHTML = '<option value="">Todas las cuentas</option>';
    APP.data.accounts.forEach(acc => {
        const option = document.createElement('option');
        option.value = acc.id;
        option.textContent = acc.name;
        accountSelect.appendChild(option);
    });
    accountSelect.value = selectedValue;
}

// ============ EDICIÓN ============
function openEditModal({ title, note, fields, onSave }) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-card" role="dialog" aria-modal="true" aria-label="${title}">
            <h2>${title}</h2>
            ${note ? `<p class="modal-note">${note}</p>` : ''}
            <form class="modal-form">
                ${fields.map(field => renderModalField(field)).join('')}
                <div class="modal-actions">
                    <button type="submit" class="btn btn-primary">Guardar cambios</button>
                    <button type="button" class="btn btn-secondary" data-cancel>Cancelar</button>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(overlay);

    const form = overlay.querySelector('.modal-form');
    const close = () => overlay.remove();
    overlay.querySelector('[data-cancel]').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const values = {};
        fields.forEach(field => {
            const raw = form.elements[field.name].value;
            values[field.name] = field.type === 'number' ? Number(raw) : raw;
        });
        const error = onSave(values);
        if (error) {
            showNotification(error, 'error');
            return;
        }
        close();
        showNotification('✅ Cambios guardados', 'success');
    });
}

function renderModalField(field) {
    const id = `modal-${field.name}`;
    const label = `<label for="${id}">${field.label}</label>`;
    if (field.type === 'select') {
        const options = field.options.map(opt =>
            `<option value="${opt.value}" ${opt.value === field.value ? 'selected' : ''}>${opt.label}</option>`
        ).join('');
        return `<div class="modal-field">${label}<select id="${id}" name="${field.name}" ${field.disabled ? 'disabled' : ''}>${options}</select></div>`;
    }
    const attrs = field.type === 'number'
        ? 'type="number" step="0.01" min="0"'
        : `type="${field.type || 'text'}"`;
    return `<div class="modal-field">${label}<input id="${id}" name="${field.name}" ${attrs} value="${field.value ?? ''}" ${field.disabled ? 'disabled' : ''} required></div>`;
}

function optionsFromSelect(selectId, includeEmpty = false) {
    return [...document.getElementById(selectId).options]
        .filter(o => includeEmpty || o.value)
        .map(o => ({ value: o.value, label: o.textContent }));
}

function validPositiveAmount(value) {
    return Number.isFinite(value) && value > 0;
}

window.editTransaction = function(transId) {
    const t = APP.data.transactions.find(item => item.id === transId);
    if (!t) return;

    const accountOptions = APP.data.accounts.map(a => ({ value: a.id, label: a.name }));
    const dateField = { name: 'date', label: 'Fecha', type: 'date', value: t.date };
    const descriptionField = (locked) => ({
        name: 'description', label: 'Descripción', type: 'text',
        value: t.description || t.incomeType || '', disabled: locked
    });
    const accountField = (locked) => ({
        name: 'account', label: 'Cuenta', type: 'select', value: t.account,
        options: accountOptions, disabled: locked
    });
    const amountField = (locked) => ({
        name: 'amount', label: 'Monto', type: 'number', value: t.amount, disabled: locked
    });

    let fields;
    let note = '';
    const isDebtPayment = t.type === 'Egreso' && t.category === 'Deuda';
    const isGoalMovement = t.type === 'Ahorro' || t.category === 'Retiro de Ahorros';
    const isTransfer = t.type === 'Transferencia';

    if (t.type === 'Egreso' && !isDebtPayment) {
        const categoryOptions = APP.data.categories
            .filter(c => c.type === 'Egreso')
            .map(c => ({ value: c.id, label: c.name }));
        fields = [
            dateField,
            descriptionField(false),
            amountField(false),
            { name: 'category', label: 'Categoría', type: 'select', value: t.category, options: categoryOptions },
            accountField(false)
        ];
    } else if (t.type === 'Ingreso' && !isGoalMovement) {
        fields = [
            dateField,
            descriptionField(false),
            amountField(false),
            { name: 'incomeType', label: 'Tipo de ingreso', type: 'select', value: t.incomeType, options: optionsFromSelect('ingreso-tipo') },
            accountField(false)
        ];
    } else if (isTransfer) {
        const editable = !!transferAccounts(t).destination && !!t.toAccount;
        note = editable ? '' : 'Transferencia anterior: solo se pueden editar la fecha y la descripción.';
        fields = [dateField, descriptionField(false), amountField(!editable)];
    } else {
        note = isGoalMovement
            ? 'Los movimientos de metas se vinculan por su descripción: solo se pueden cambiar la fecha, el monto y la cuenta.'
            : 'Los pagos de deuda se vinculan por su descripción: solo se pueden cambiar la fecha, el monto y la cuenta.';
        fields = [dateField, descriptionField(true), amountField(false), accountField(false)];
    }

    openEditModal({
        title: 'Editar movimiento',
        note,
        fields,
        onSave: (values) => {
            const amount = values.amount ?? t.amount;
            if (!validPositiveAmount(amount)) return '❌ Ingresa un monto válido';

            const newAccountId = values.account ?? t.account;
            const newAccount = APP.data.accounts.find(a => a.id === newAccountId);
            if (!newAccount) return '❌ Cuenta no encontrada';

            if (t.type === 'Egreso') {
                const available = newAccountId === t.account ? newAccount.balance + t.amount : newAccount.balance;
                if (available < amount) return `❌ Saldo insuficiente. Disponible: $${formatNumber(available)}`;
            }

            const next = { ...t, ...values, amount, account: newAccountId };

            const patch = { date: next.date, amount: next.amount, account: next.account };
            if (values.description !== undefined && !isDebtPayment && !isGoalMovement) patch.description = values.description;
            if (values.category !== undefined) patch.category = values.category;
            if (values.incomeType !== undefined) patch.incomeType = values.incomeType;

            undoTransactionEffects(t);
            dbPatch('transactions', t.id, patch);
            applyTransactionEffects({ ...next, ...patch, type: t.type, category: patch.category ?? t.category });
            refreshMovementViews();
            return null;
        }
    });
};

window.editDebt = function(debtId) {
    const debt = APP.data.debts.find(d => d.id === debtId);
    if (!debt) return;

    openEditModal({
        title: 'Editar deuda',
        note: 'El saldo actual cambia con los pagos; aquí puedes corregirlo manualmente.',
        fields: [
            { name: 'entity', label: 'Entidad', type: 'text', value: debt.entity },
            { name: 'holder', label: 'Titular', type: 'text', value: debt.holder },
            { name: 'currentBalance', label: 'Saldo actual', type: 'number', value: debt.currentBalance },
            { name: 'monthlyPayment', label: 'Cuota mensual', type: 'number', value: debt.monthlyPayment },
            { name: 'paymentDay', label: 'Día de pago (1-31)', type: 'number', value: debt.paymentDay }
        ],
        onSave: (values) => {
            if (!values.entity.trim()) return '❌ La entidad no puede estar vacía';
            if (!validPositiveAmount(values.monthlyPayment)) return '❌ Ingresa una cuota válida';
            if (!(values.currentBalance >= 0)) return '❌ El saldo no puede ser negativo';
            const day = Math.min(31, Math.max(1, Math.round(values.paymentDay) || 1));
            const today = new Date();
            let next = new Date(today.getFullYear(), today.getMonth(), day);
            if (next <= today) next = new Date(today.getFullYear(), today.getMonth() + 1, day);

            dbPatch('debts', debtId, {
                entity: values.entity.trim(),
                holder: values.holder,
                currentBalance: money(values.currentBalance),
                monthlyPayment: money(values.monthlyPayment),
                paymentDay: day,
                nextPaymentDate: next.toISOString().split('T')[0]
            });
            updateDashboard();
            renderDebtsList();
            return null;
        }
    });
};

window.editAccount = function(accountId) {
    const account = APP.data.accounts.find(a => a.id === accountId);
    if (!account) return;

    openEditModal({
        title: 'Editar cuenta',
        note: 'El saldo cambia con los movimientos; no se edita directamente.',
        fields: [
            { name: 'name', label: 'Nombre', type: 'text', value: account.name },
            { name: 'type', label: 'Tipo', type: 'select', value: account.type, options: optionsFromSelect('cuenta-tipo', true).filter(o => o.value) }
        ],
        onSave: (values) => {
            if (!values.name.trim()) return '❌ El nombre no puede estar vacío';
            dbPatch('accounts', accountId, { name: values.name.trim(), type: values.type });
            refreshAllViews();
            return null;
        }
    });
};

window.editCategory = function(categoryId) {
    const category = APP.data.categories.find(c => c.id === categoryId);
    if (!category) return;

    openEditModal({
        title: 'Editar categoría',
        fields: [
            { name: 'name', label: 'Nombre', type: 'text', value: category.name },
            { name: 'type', label: 'Tipo', type: 'select', value: category.type, options: optionsFromSelect('categoria-tipo') },
            { name: 'budget', label: 'Presupuesto', type: 'number', value: category.budget || 0 }
        ],
        onSave: (values) => {
            if (!values.name.trim()) return '❌ El nombre no puede estar vacío';
            dbPatch('categories', categoryId, { name: values.name.trim(), type: values.type, budget: money(values.budget) });
            refreshAllViews();
            return null;
        }
    });
};

window.editGoal = function(goalId) {
    const goal = APP.data.goals.find(g => g.id === goalId);
    if (!goal) return;

    openEditModal({
        title: 'Editar meta de ahorro',
        note: 'El monto ahorrado cambia con los abonos y retiros.',
        fields: [
            { name: 'description', label: 'Descripción', type: 'text', value: goal.description },
            { name: 'targetAmount', label: 'Monto objetivo', type: 'number', value: goal.targetAmount },
            { name: 'deadline', label: 'Fecha límite', type: 'date', value: goal.deadline }
        ],
        onSave: (values) => {
            if (!values.description.trim()) return '❌ La descripción no puede estar vacía';
            if (!validPositiveAmount(values.targetAmount)) return '❌ Ingresa un monto objetivo válido';
            const oldName = goal.description;
            const newName = values.description.trim();
            dbPatch('goals', goalId, { description: newName, targetAmount: money(values.targetAmount), deadline: values.deadline });
            if (oldName !== newName) {
                APP.data.transactions
                    .filter(t => t.description === `Abono a meta: ${oldName}` || t.description === `Retiro de ahorros: ${oldName}`)
                    .forEach(t => {
                        const prefix = t.description.startsWith('Abono a meta: ') ? 'Abono a meta: ' : 'Retiro de ahorros: ';
                        dbPatch('transactions', t.id, { description: prefix + newName });
                    });
            }
            refreshAllViews();
            return null;
        }
    });
};

// ============ PLANIFICACIÓN ============
const PLAN_UI = { selectedPlanId: '', draft: {} };

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
}

function getPlanSettings() {
    const saved = APP.data.settings.find(s => s.id === 'plan') || {};
    return { frecuencia: 'mensual', diaCobro1: 1, diaCobro2: 15, ingresosFijos: 0, ...saved };
}

function daysInMonth(ym) {
    const [year, month] = ym.split('-').map(Number);
    return new Date(year, month, 0).getDate();
}

function clampDay(day, ym) {
    return Math.min(daysInMonth(ym), Math.max(1, Math.round(Number(day)) || 1));
}

function projectedIncomes(ym) {
    const settings = getPlanSettings();
    const total = Number(settings.ingresosFijos) || 0;
    if (total <= 0) return [];

    if (settings.frecuencia === 'quincenal') {
        const first = money(total / 2);
        return [
            { key: 'ingreso:1', day: clampDay(settings.diaCobro1, ym), amount: first, label: 'Ingreso quincena 1', kind: 'ingreso' },
            { key: 'ingreso:2', day: clampDay(settings.diaCobro2, ym), amount: money(total - first), label: 'Ingreso quincena 2', kind: 'ingreso' }
        ];
    }
    return [{ key: 'ingreso:1', day: clampDay(settings.diaCobro1, ym), amount: money(total), label: 'Ingreso mensual', kind: 'ingreso' }];
}

function plannedObligations() {
    const debts = APP.data.debts
        .filter(d => d.currentBalance > 0)
        .map(d => ({
            key: 'debt:' + d.id,
            label: `Deuda: ${d.entity || 'Sin nombre'}`,
            amount: money(d.monthlyPayment),
            day: d.paymentDay || 1,
            kind: 'egreso'
        }));
    const fixed = APP.data.recurringExpenses.map(r => ({
        key: 'rec:' + r.id,
        label: r.name,
        amount: money(r.amount),
        day: r.day,
        kind: 'egreso'
    }));
    return [...debts, ...fixed];
}

function planningStartBalance() {
    return money(APP.data.accounts
        .filter(a => a.type !== 'Ahorros')
        .reduce((sum, a) => sum + (a.balance || 0), 0));
}

function simulatePlan(ym, overrides) {
    const incomes = projectedIncomes(ym);
    const obligations = plannedObligations();
    const events = [
        ...incomes,
        ...obligations.map(o => ({ ...o, day: clampDay(overrides[o.key] ?? o.day, ym) }))
    ].sort((a, b) => a.day - b.day || (a.kind === 'ingreso' ? -1 : 1));

    const startBalance = planningStartBalance();
    let balance = startBalance;
    let minBalance = startBalance;
    let minDay = 0;
    const rows = events.map(event => {
        balance = money(balance + (event.kind === 'ingreso' ? event.amount : -event.amount));
        if (balance < minBalance) {
            minBalance = balance;
            minDay = event.day;
        }
        return { ...event, balance };
    });

    const totalIncome = money(incomes.reduce((sum, i) => sum + i.amount, 0));
    const totalOut = money(obligations.reduce((sum, o) => sum + o.amount, 0));
    return {
        rows,
        startBalance,
        minBalance,
        minDay,
        totalIncome,
        totalOut,
        margin: money(totalIncome - totalOut)
    };
}

function realIncomeThisMonth(ym) {
    return money(APP.data.transactions
        .filter(t => t.type === 'Ingreso' && t.category !== 'Retiro de Ahorros' && (t.date || '').startsWith(ym))
        .reduce((sum, t) => sum + (t.amount || 0), 0));
}

function renderPlanning() {
    const ym = APP.currentMonth;
    const settings = getPlanSettings();

    const form = document.getElementById('form-plan-ingresos');
    if (form && !form.contains(document.activeElement)) {
        document.getElementById('plan-ingresos-fijos').value = settings.ingresosFijos || '';
        document.getElementById('plan-frecuencia').value = settings.frecuencia;
        document.getElementById('plan-dia-1').value = settings.diaCobro1;
        document.getElementById('plan-dia-2').value = settings.diaCobro2;
        document.getElementById('plan-dia-2-wrap').classList.toggle('hidden', settings.frecuencia !== 'quincenal');
    }

    renderFixedExpensesList();
    renderPlanSelector();

    const selected = simulatePlan(ym, PLAN_UI.draft);
    const base = simulatePlan(ym, {});
    renderPlanKpis(selected, base, ym);
    renderPlanObligations(ym);
    renderPlanCalendar(selected);
}

function renderFixedExpensesList() {
    const container = document.getElementById('list-gastos-fijos');
    if (!container) return;
    if (APP.data.recurringExpenses.length === 0) {
        container.innerHTML = '<p class="plan-empty">No hay gastos fijos registrados</p>';
        return;
    }
    container.innerHTML = APP.data.recurringExpenses.map(r => `
        <div class="plan-item">
            <div>
                <strong>${escapeHtml(r.name)}</strong>
                <div class="plan-item-meta">Día ${r.day} · $${formatNumber(r.amount)}</div>
            </div>
            <div class="plan-item-actions">
                <button class="btn btn-secondary btn-sm" onclick="editRecurring('${r.id}')">Editar</button>
                <button class="btn btn-danger btn-sm" onclick="deleteRecurring('${r.id}')">Eliminar</button>
            </div>
        </div>
    `).join('');
}

function renderPlanSelector() {
    const select = document.getElementById('plan-selector');
    if (!select) return;

    if (PLAN_UI.selectedPlanId && !APP.data.paymentPlans.some(p => p.id === PLAN_UI.selectedPlanId)) {
        PLAN_UI.selectedPlanId = '';
        PLAN_UI.draft = {};
    }

    const plans = [...APP.data.paymentPlans].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    select.innerHTML = '<option value="">Plan base (días actuales)</option>' +
        plans.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    select.value = PLAN_UI.selectedPlanId;

    const hasSelection = !!PLAN_UI.selectedPlanId;
    document.getElementById('plan-update').disabled = !hasSelection;
    document.getElementById('plan-delete').disabled = !hasSelection;
}

function renderPlanKpis(selected, base, ym) {
    const container = document.getElementById('plan-kpis');
    const alerts = document.getElementById('plan-alerts');
    const realIncome = realIncomeThisMonth(ym);

    container.innerHTML = `
        <div class="plan-kpi"><span>Ingresos proyectados</span><strong>$${formatNumber(selected.totalIncome)}</strong></div>
        <div class="plan-kpi"><span>Obligaciones del mes</span><strong>$${formatNumber(selected.totalOut)}</strong></div>
        <div class="plan-kpi"><span>Margen</span><strong class="${selected.margin < 0 ? 'neg' : 'pos'}">$${formatNumber(selected.margin)}</strong></div>
        <div class="plan-kpi"><span>Saldo mínimo</span><strong class="${selected.minBalance < 0 ? 'neg' : ''}">$${formatNumber(selected.minBalance)}${selected.minDay ? ` (día ${selected.minDay})` : ''}</strong></div>
        <div class="plan-kpi"><span>Ingreso real registrado</span><strong>$${formatNumber(realIncome)}</strong></div>
    `;

    const messages = [];
    if (selected.totalIncome === 0) {
        messages.push('<div class="plan-note">Configura tus ingresos fijos del mes para ver el análisis.</div>');
    }
    if (selected.margin < 0) {
        messages.push('<div class="plan-alert">⚠️ Las obligaciones del mes superan los ingresos fijos.</div>');
    }
    if (selected.minBalance < 0) {
        messages.push(`<div class="plan-alert">⚠️ Con este plan el saldo baja a $${formatNumber(selected.minBalance)} el día ${selected.minDay}.</div>`);
    } else if (selected.totalIncome > 0) {
        messages.push('<div class="plan-ok">✅ El plan mantiene el saldo en positivo durante el mes.</div>');
    }
    if (PLAN_UI.selectedPlanId) {
        messages.push(`<div class="plan-note">Plan base: saldo mínimo $${formatNumber(base.minBalance)}${base.minDay ? ` (día ${base.minDay})` : ''}.</div>`);
    }
    alerts.innerHTML = messages.join('');
}

function renderPlanObligations(ym) {
    const container = document.getElementById('plan-obligations');
    const obligations = plannedObligations();
    if (obligations.length === 0) {
        container.innerHTML = '<p class="plan-empty">No hay obligaciones: agrega deudas o gastos fijos.</p>';
        return;
    }
    const max = daysInMonth(ym);
    const dayOptions = (selectedDay) => Array.from({ length: max }, (_, i) => i + 1)
        .map(d => `<option value="${d}" ${d === selectedDay ? 'selected' : ''}>${d}</option>`).join('');

    container.innerHTML = obligations.map(o => {
        const day = clampDay(PLAN_UI.draft[o.key] ?? o.day, ym);
        return `
            <div class="plan-item">
                <div>
                    <strong>${escapeHtml(o.label)}</strong>
                    <div class="plan-item-meta">$${formatNumber(o.amount)} al mes</div>
                </div>
                <label class="plan-day-select">Día
                    <select data-plan-key="${escapeHtml(o.key)}">${dayOptions(day)}</select>
                </label>
            </div>
        `;
    }).join('');
}

function renderPlanCalendar(selected) {
    const container = document.getElementById('plan-calendar');
    const [year, month] = APP.currentMonth.split('-');
    const formatDay = (day) => `${String(day).padStart(2, '0')}/${month}/${year}`;

    const body = selected.rows.map(row => `
        <tr class="${row.balance < 0 ? 'neg-row' : ''}">
            <td>${formatDay(row.day)}</td>
            <td>${escapeHtml(row.label)}</td>
            <td class="${row.kind === 'ingreso' ? 'pos' : 'neg'}">${row.kind === 'ingreso' ? '+' : '−'}$${formatNumber(row.amount)}</td>
            <td class="${row.balance < 0 ? 'neg' : ''}">$${formatNumber(row.balance)}</td>
        </tr>
    `).join('');

    container.innerHTML = `
        <table class="plan-table">
            <thead><tr><th>Fecha</th><th>Concepto</th><th>Movimiento</th><th>Saldo</th></tr></thead>
            <tbody>
                <tr><td colspan="3">Saldo inicial (cuentas sin ahorro)</td><td>$${formatNumber(selected.startBalance)}</td></tr>
                ${body}
            </tbody>
        </table>
    `;
}

function setupPlanning() {
    document.getElementById('plan-frecuencia').addEventListener('change', (e) => {
        document.getElementById('plan-dia-2-wrap').classList.toggle('hidden', e.target.value !== 'quincenal');
    });

    document.getElementById('form-plan-ingresos').addEventListener('submit', (e) => {
        e.preventDefault();
        const ingresosFijos = Number(document.getElementById('plan-ingresos-fijos').value);
        const frecuencia = document.getElementById('plan-frecuencia').value;
        const diaCobro1 = clampDay(document.getElementById('plan-dia-1').value, APP.currentMonth);
        const diaCobro2 = clampDay(document.getElementById('plan-dia-2').value, APP.currentMonth);

        if (!(ingresosFijos >= 0)) {
            showNotification('❌ Ingresa un monto válido', 'error');
            return;
        }
        dbSave('settings', { id: 'plan', ingresosFijos: money(ingresosFijos), frecuencia, diaCobro1, diaCobro2 });
        renderPlanning();
        showNotification('✅ Ingresos fijos guardados', 'success');
    });

    document.getElementById('form-gasto-fijo').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('fijo-nombre').value.trim();
        const amount = Number(document.getElementById('fijo-monto').value);
        const day = clampDay(document.getElementById('fijo-dia').value, APP.currentMonth);
        if (!name || !validPositiveAmount(amount)) {
            showNotification('❌ Revisa el nombre y el monto', 'error');
            return;
        }
        dbSave('recurringExpenses', { id: 'rec-' + Date.now(), name, amount: money(amount), day, createdAt: Date.now() });
        e.target.reset();
        renderPlanning();
    });

    document.getElementById('plan-obligations').addEventListener('change', (e) => {
        const key = e.target.dataset.planKey;
        if (!key) return;
        PLAN_UI.draft[key] = Number(e.target.value);
        renderPlanning();
    });

    document.getElementById('plan-selector').addEventListener('change', (e) => {
        PLAN_UI.selectedPlanId = e.target.value;
        const plan = APP.data.paymentPlans.find(p => p.id === e.target.value);
        PLAN_UI.draft = plan ? { ...(plan.overrides || {}) } : {};
        renderPlanning();
    });

    document.getElementById('plan-save').addEventListener('click', () => {
        const name = document.getElementById('plan-name').value.trim();
        if (!name) {
            showNotification('❌ Escribe un nombre para el plan', 'error');
            return;
        }
        const plan = { id: 'plan-' + Date.now(), name, overrides: { ...PLAN_UI.draft }, createdAt: Date.now() };
        dbSave('paymentPlans', plan);
        PLAN_UI.selectedPlanId = plan.id;
        document.getElementById('plan-name').value = '';
        renderPlanning();
        showNotification('✅ Plan guardado', 'success');
    });

    document.getElementById('plan-update').addEventListener('click', () => {
        if (!PLAN_UI.selectedPlanId) return;
        dbPatch('paymentPlans', PLAN_UI.selectedPlanId, { overrides: { ...PLAN_UI.draft } });
        renderPlanning();
        showNotification('✅ Plan actualizado', 'success');
    });

    document.getElementById('plan-delete').addEventListener('click', () => {
        if (!PLAN_UI.selectedPlanId) return;
        const plan = APP.data.paymentPlans.find(p => p.id === PLAN_UI.selectedPlanId);
        if (!confirm(`¿Eliminar el plan "${plan?.name || ''}"?`)) return;
        dbDelete('paymentPlans', PLAN_UI.selectedPlanId);
        PLAN_UI.selectedPlanId = '';
        PLAN_UI.draft = {};
        renderPlanning();
    });
}

window.editRecurring = function(id) {
    const item = APP.data.recurringExpenses.find(r => r.id === id);
    if (!item) return;
    openEditModal({
        title: 'Editar gasto fijo',
        fields: [
            { name: 'name', label: 'Nombre', type: 'text', value: item.name },
            { name: 'amount', label: 'Monto', type: 'number', value: item.amount },
            { name: 'day', label: 'Día de pago (1-31)', type: 'number', value: item.day }
        ],
        onSave: (values) => {
            if (!values.name.trim()) return '❌ El nombre no puede estar vacío';
            if (!validPositiveAmount(values.amount)) return '❌ Ingresa un monto válido';
            dbPatch('recurringExpenses', id, {
                name: values.name.trim(),
                amount: money(values.amount),
                day: clampDay(values.day, APP.currentMonth)
            });
            renderPlanning();
            return null;
        }
    });
};

window.deleteRecurring = function(id) {
    const item = APP.data.recurringExpenses.find(r => r.id === id);
    if (!item || !confirm(`¿Eliminar el gasto fijo "${item.name}"?`)) return;
    dbDelete('recurringExpenses', id);
    renderPlanning();
};

// ============ CONFIGURATION ============
function handleAddAccount(e) {
    e.preventDefault();

    const account = {
        id: 'acc-' + Date.now(),
        name: document.getElementById('cuenta-nombre').value,
        type: document.getElementById('cuenta-tipo').value,
        balance: 0
    };

    dbSave('accounts', account);

    e.target.reset();
    renderAccounts();
    renderAccountsList();
    showNotification('Cuenta agregada', 'success');
}

function renderAccounts() {
    const selects = ['gasto-cuenta', 'ingreso-cuenta', 'trans-filter-cuenta'];
    selects.forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;
        const previous = select.value;
        select.innerHTML = '<option value="">Seleccionar cuenta</option>';
        APP.data.accounts.forEach(acc => {
            const option = document.createElement('option');
            option.value = acc.id;
            option.textContent = acc.name;
            select.appendChild(option);
        });
        select.value = previous;
    });

    // Render cuentas disponibles para abono
    const abonoOrigen = document.getElementById('abono-cuenta-origen');
    if (abonoOrigen) {
        abonoOrigen.innerHTML = '<option value="">Seleccionar cuenta</option>';
        APP.data.accounts
            .filter(acc => acc.type !== 'Ahorros')
            .forEach(acc => {
                const option = document.createElement('option');
                option.value = acc.id;
                option.textContent = `${acc.name} ($${formatNumber(acc.balance)})`;
                abonoOrigen.appendChild(option);
            });
    }

    // Render cuentas de ahorro para destino de abono
    const abonoDestino = document.getElementById('abono-cuenta-destino');
    if (abonoDestino) {
        abonoDestino.innerHTML = '<option value="">Seleccionar cuenta</option>';
        APP.data.accounts
            .filter(acc => acc.type === 'Ahorros')
            .forEach(acc => {
                const option = document.createElement('option');
                option.value = acc.id;
                option.textContent = `${acc.name} ($${formatNumber(acc.balance)})`;
                abonoDestino.appendChild(option);
            });
    }

    // Render cuentas de ahorro para retiro
    const retiroOrigen = document.getElementById('retiro-cuenta-origen');
    if (retiroOrigen) {
        retiroOrigen.innerHTML = '<option value="">Seleccionar cuenta</option>';
        APP.data.accounts
            .filter(acc => acc.type === 'Ahorros')
            .forEach(acc => {
                const option = document.createElement('option');
                option.value = acc.id;
                option.textContent = `${acc.name} ($${formatNumber(acc.balance)})`;
                retiroOrigen.appendChild(option);
            });
    }

    // Render cuentas disponibles para destino de retiro
    const retiroDestino = document.getElementById('retiro-cuenta-destino');
    if (retiroDestino) {
        retiroDestino.innerHTML = '<option value="">Seleccionar cuenta</option>';
        APP.data.accounts
            .filter(acc => acc.type !== 'Ahorros')
            .forEach(acc => {
                const option = document.createElement('option');
                option.value = acc.id;
                option.textContent = `${acc.name} ($${formatNumber(acc.balance)})`;
                retiroDestino.appendChild(option);
            });
    }
}

function renderAccountsList() {
    const container = document.getElementById('list-cuentas');
    container.innerHTML = APP.data.accounts.map(acc => {
        const balance = acc.balance || 0;
        return `
        <div class="account-item">
            <div>
                <div class="account-name">${acc.name}</div>
                <div class="account-type">${acc.type}</div>
            </div>
            <div class="account-balance">$${formatNumber(balance)}</div>
            <div class="row-actions">
                <button class="btn btn-secondary btn-sm" onclick="editAccount('${acc.id}')">✏️ Editar</button>
                <button class="btn btn-primary btn-sm" onclick="showTransferModal('${acc.id}')">💸 Transferir</button>
                <button class="btn btn-danger" onclick="deleteAccount('${acc.id}')">🗑️ Eliminar</button>
            </div>
        </div>
    `;
    }).join('');
}

window.showTransferModal = function(origenId) {
    const cuentaOrigen = APP.data.accounts.find(a => a.id === origenId);
    if (!cuentaOrigen) return;

    const otherAccounts = APP.data.accounts.filter(a => a.id !== origenId);
    if (otherAccounts.length === 0) {
        showNotification('❌ No hay otra cuenta para transferir', 'error');
        return;
    }

    const destinoOptions = otherAccounts
        .map(acc => `<option value="${acc.id}">${acc.name} ($${formatNumber(acc.balance || 0)})</option>`)
        .join('');

    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
        background: white;
        padding: 30px;
        border-radius: 12px;
        max-width: 450px;
        width: 90%;
        box-shadow: 0 10px 40px rgba(0,0,0,0.3);
    `;

    content.innerHTML = `
        <h2 style="margin-top: 0; color: #333;">Transferencia de Dinero</h2>
        <p style="color: #666; margin-bottom: 20px; font-size: 14px;">
            <strong>Desde:</strong> ${cuentaOrigen.name}<br>
            <strong>Saldo disponible:</strong> $${formatNumber(cuentaOrigen.balance || 0)}
        </p>

        <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; color: #333; font-weight: 600;">Cuenta Destino</label>
            <select id="modalDestino" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px;">
                <option value="">-- Selecciona una cuenta --</option>
                ${destinoOptions}
            </select>
        </div>

        <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; color: #333; font-weight: 600;">Monto</label>
            <input type="text" id="modalMonto" inputmode="decimal" placeholder="0" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 16px;">
        </div>

        <div style="margin-bottom: 20px;">
            <label style="display: block; margin-bottom: 5px; color: #333; font-weight: 600;">Descripción (opcional)</label>
            <input type="text" id="modalDescripcion" placeholder="Nota..." style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px;">
        </div>

        <div style="display: flex; gap: 10px;">
            <button id="confirmTransfer" style="flex: 1; padding: 12px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: 600;">Transferir</button>
            <button id="cancelTransfer" style="flex: 1; padding: 12px; background: #e5e7eb; color: #333; border: none; border-radius: 6px; cursor: pointer; font-size: 16px;">Cancelar</button>
        </div>
    `;

    modal.appendChild(content);
    document.body.appendChild(modal);

    document.getElementById('confirmTransfer').addEventListener('click', () => {
        const destinoId = document.getElementById('modalDestino').value;
        const amount = getMoneyValue(document.getElementById('modalMonto').value);
        const descripcion = document.getElementById('modalDescripcion').value;

        if (!destinoId) {
            showNotification('❌ Selecciona una cuenta destino', 'error');
            return;
        }
        if (amount <= 0) {
            showNotification('❌ Ingresa un monto válido', 'error');
            return;
        }
        if (cuentaOrigen.balance < amount) {
            showNotification(`❌ Saldo insuficiente. Disponible: $${formatNumber(cuentaOrigen.balance)}`, 'error');
            return;
        }

        const cuentaDestino = APP.data.accounts.find(a => a.id === destinoId);
        if (!cuentaDestino) {
            showNotification('❌ Cuenta destino no encontrada', 'error');
            return;
        }

        const transaction = {
            id: 'trans-' + Date.now(),
            type: 'Transferencia',
            category: 'Transferencia',
            description: `Transferencia de ${cuentaOrigen.name} a ${cuentaDestino.name}${descripcion ? ': ' + descripcion : ''}`,
            amount: amount,
            account: origenId,
            toAccount: destinoId,
            date: new Date().toISOString().split('T')[0],
            createdAt: Date.now()
        };

        dbSave('transactions', transaction);
        dbAdjustBalance(origenId, -amount);
        dbAdjustBalance(destinoId, amount);

        modal.remove();
        renderAccountsList();
        renderAccounts();
        updateDashboard();
        showNotification(`✅ Transferencia de $${formatNumber(amount)} realizada`, 'success');
    });

    document.getElementById('cancelTransfer').addEventListener('click', () => {
        modal.remove();
    });
};

window.deleteAccount = async function(accountId) {
    const account = APP.data.accounts.find(a => a.id === accountId);
    if (!account) return;

    if (account.balance > 0) {
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        const availableAccounts = APP.data.accounts
            .filter(a => a.id !== accountId)
            .map(acc => `<option value="${acc.id}">${acc.name}</option>`)
            .join('');

        const content = document.createElement('div');
        content.style.cssText = `
            background: white;
            padding: 30px;
            border-radius: 12px;
            max-width: 450px;
            width: 90%;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
        `;

        content.innerHTML = `
            <h2 style="margin-top: 0; color: #d32f2f;">⚠️ Cuenta con Saldo</h2>
            <p style="color: #666; margin-bottom: 20px; font-size: 14px;">
                La cuenta <strong>"${account.name}"</strong> tiene un saldo de <strong>$${formatNumber(account.balance)}</strong>.<br><br>
                Para eliminarla, debes transferir este saldo a otra cuenta.
            </p>

            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 5px; color: #333; font-weight: 600;">Transferir a:</label>
                <select id="transferDestinoCuenta" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px;">
                    <option value="">-- Selecciona una cuenta --</option>
                    ${availableAccounts}
                </select>
            </div>

            <div style="display: flex; gap: 10px;">
                <button id="confirmDeleteCuenta" style="flex: 1; padding: 12px; background: #d32f2f; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: 600;">Transferir y Eliminar</button>
                <button id="cancelDeleteCuenta" style="flex: 1; padding: 12px; background: #e5e7eb; color: #333; border: none; border-radius: 6px; cursor: pointer; font-size: 16px;">Cancelar</button>
            </div>
        `;

        modal.appendChild(content);
        document.body.appendChild(modal);

        document.getElementById('confirmDeleteCuenta').addEventListener('click', async () => {
            const destinoId = document.getElementById('transferDestinoCuenta').value;
            if (!destinoId) {
                showNotification('❌ Selecciona una cuenta destino', 'error');
                return;
            }

            const cuentaDestino = APP.data.accounts.find(a => a.id === destinoId);
            if (!cuentaDestino) {
                showNotification('❌ Cuenta no encontrada', 'error');
                return;
            }

            dbAdjustBalance(destinoId, account.balance);
            dbDelete('accounts', accountId);

            modal.remove();
            renderAccountsList();
            renderAccounts();
            updateDashboard();
            showNotification(`✅ Cuenta eliminada. Saldo transferido a ${cuentaDestino.name}`, 'success');
        });

        document.getElementById('cancelDeleteCuenta').addEventListener('click', () => {
            modal.remove();
        });
        return;
    }

    const confirmed = confirm(`¿Eliminar la cuenta "${account.name}"?`);
    if (!confirmed) {
        return;
    }

    dbDelete('accounts', accountId);
    renderAccountsList();
    renderAccounts();
}

function handleAddCategory(e) {
    e.preventDefault();

    const category = {
        id: 'cat-' + Date.now(),
        name: document.getElementById('categoria-nombre').value,
        type: document.getElementById('categoria-tipo').value,
        budget: getMoneyValue(document.getElementById("categoria-presupuesto").value) || 0
    };

    dbSave('categories', category);

    e.target.reset();
    renderCategories();
    renderCategoriesList();
    showNotification('Categoría agregada', 'success');
}

function renderCategories() {
    const select = document.getElementById('gasto-categoria');
    const previous = select.value;
    select.innerHTML = '<option value="">Seleccionar categoría</option>';
    APP.data.categories.filter(c => c.type === 'Egreso').forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.id;
        option.textContent = cat.name;
        select.appendChild(option);
    });
    select.value = previous;
}

function renderCategoriesList() {
    const container = document.getElementById('list-categorias');
    container.innerHTML = APP.data.categories.map(cat => `
        <div class="category-item">
            <div>
                <div class="category-name">${cat.name}</div>
                <div class="category-type">${cat.type}</div>
            </div>
            <div class="category-budget">$${formatNumber(cat.budget)}</div>
            <div class="row-actions">
                <button class="btn btn-secondary" onclick="editCategory('${cat.id}')">Editar</button>
                <button class="btn btn-danger" onclick="deleteCategory('${cat.id}')">Eliminar</button>
            </div>
        </div>
    `).join('');
}

window.deleteCategory = async function(categoryId) {
    const category = APP.data.categories.find(c => c.id === categoryId);
    if (!category) return;

    const confirmed = confirm(`¿Eliminar la categoría "${category.name}"?`);
    if (!confirmed) {
        return;
    }

    dbDelete('categories', categoryId);
    renderCategoriesList();
    renderCategories();
}

window.deleteGoal = function(goalId) {
    const goal = APP.data.goals.find(g => g.id === goalId);
    if (!goal) return;

    const confirmed = confirm(`¿Eliminar la meta "${goal.description}"?`);
    if (!confirmed) return;

    dbDelete('goals', goalId);
    renderSavingsGoalsList();
    updateDashboard();
}

// ============ SAVINGS GOALS ============
function handleAddSavingsGoal(e) {
    e.preventDefault();

    const goal = {
        id: 'saving-' + Date.now(),
        description: document.getElementById('meta-ahorro-descripcion').value,
        targetAmount: getMoneyValue(document.getElementById("meta-ahorro-monto").value),
        currentAmount: 0,
        deadline: document.getElementById('meta-ahorro-fecha').value,
        createdAt: Date.now()
    };

    dbSave('goals', goal);

    e.target.reset();
    renderSavingsGoalsList();
    updateSavingsKpis();
    updateDashboard();
    showNotification('✅ Meta de ahorro creada', 'success');
}

function renderSavingsGoalsList() {
    const container = document.getElementById('list-metas-ahorros');
    const goals = APP.data.goals || [];

    if (goals.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 40px;">No hay metas de ahorro</p>';
        return;
    }

    container.innerHTML = goals.map(goal => {
        const progress = (goal.currentAmount / goal.targetAmount) * 100;
        const daysLeft = goal.deadline ? Math.ceil((new Date(goal.deadline) - new Date()) / (1000 * 60 * 60 * 24)) : 0;
        const isCompleted = goal.currentAmount >= goal.targetAmount;

        return `
            <div class="goal-card" style="border-left: 4px solid ${isCompleted ? '#10b981' : '#3b82f6'}; padding: 20px; margin-bottom: 15px; background: white; border-radius: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: start; gap: 15px;">
                    <div style="flex: 1;">
                        <h4 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">${goal.description}</h4>
                        <p style="margin: 8px 0; color: #666; font-size: 14px;">
                            $${formatNumber(goal.currentAmount)} / $${formatNumber(goal.targetAmount)}
                        </p>
                        ${goal.deadline ? `<p style="margin: 8px 0; color: #999; font-size: 13px;">Plazo: ${daysLeft} días</p>` : ''}
                    </div>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <button class="btn btn-secondary btn-sm" onclick="editGoal('${goal.id}')">✏️ Editar</button>
                        <button class="btn btn-primary btn-sm" onclick="promptAbonoAhorros('${goal.id}')">+ Abonar</button>
                        <button class="btn btn-info btn-sm" onclick="promptRetiroAhorros('${goal.id}')">💰 Retiro</button>
                        <button class="btn btn-danger btn-sm" onclick="deleteSavingsGoal('${goal.id}')">🗑️ Eliminar</button>
                    </div>
                </div>
                <div style="width: 100%; background: #f0f0f0; border-radius: 4px; height: 8px; margin-top: 15px; overflow: hidden;">
                    <div style="width: ${Math.min(progress, 100)}%; height: 100%; background: ${isCompleted ? '#10b981' : '#3b82f6'};"></div>
                </div>
                <p style="margin: 10px 0 0 0; text-align: right; color: #666; font-size: 12px;">${progress.toFixed(0)}% completado</p>
            </div>
        `;
    }).join('');
}

window.promptAbonoAhorros = function(goalId) {
    window.showSavingsAbono(goalId);
};

window.promptRetiroAhorros = function(goalId) {
    const goal = APP.data.goals.find(g => g.id === goalId);
    if (!goal || goal.currentAmount <= 0) {
        showNotification('❌ No hay saldo en esta meta de ahorro', 'error');
        return;
    }

    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;

    const availableAccounts = APP.data.accounts
        .map(acc => `<option value="${acc.id}">${acc.name} ($${formatNumber(acc.balance || 0)})</option>`)
        .join('');

    const content = document.createElement('div');
    content.style.cssText = `
        background: white;
        padding: 30px;
        border-radius: 12px;
        max-width: 450px;
        width: 90%;
        box-shadow: 0 10px 40px rgba(0,0,0,0.3);
    `;

    content.innerHTML = `
        <h2 style="margin-top: 0; color: #333;">Retiro de Ahorros</h2>
        <p style="color: #666; margin-bottom: 20px; font-size: 14px;">
            <strong>Meta:</strong> ${goal.description}<br>
            <strong>Saldo disponible:</strong> $${formatNumber(goal.currentAmount)}
        </p>

        <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; color: #333; font-weight: 600;">Cuenta Destino</label>
            <select id="retiroAccount" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px;">
                <option value="">-- Selecciona una cuenta --</option>
                ${availableAccounts}
            </select>
        </div>

        <div style="margin-bottom: 20px;">
            <label style="display: block; margin-bottom: 5px; color: #333; font-weight: 600;">Monto</label>
            <input type="number" id="retiroAmount" placeholder="Monto" min="0" step="0.01" max="${goal.currentAmount}"
                style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 16px;">
        </div>

        <div style="display: flex; gap: 10px;">
            <button id="confirmRetiro" style="flex: 1; padding: 12px; background: #10b981; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: 600;">Confirmar Retiro</button>
            <button id="cancelRetiro" style="flex: 1; padding: 12px; background: #e5e7eb; color: #333; border: none; border-radius: 6px; cursor: pointer; font-size: 16px;">Cancelar</button>
        </div>
    `;

    modal.appendChild(content);
    document.body.appendChild(modal);

    document.getElementById('confirmRetiro').addEventListener('click', () => {
        const destinoId = document.getElementById('retiroAccount').value;
        const amount = parseFloat(document.getElementById('retiroAmount').value);

        if (!destinoId) {
            showNotification('❌ Selecciona una cuenta destino', 'error');
            return;
        }
        if (amount <= 0 || isNaN(amount)) {
            showNotification('❌ Ingresa un monto válido', 'error');
            return;
        }
        if (goal.currentAmount < amount) {
            showNotification(`❌ Saldo insuficiente. Disponible: $${formatNumber(goal.currentAmount)}`, 'error');
            return;
        }

        const cuentaDestino = APP.data.accounts.find(acc => acc.id === destinoId);
        if (!cuentaDestino) {
            showNotification('❌ Cuenta no encontrada', 'error');
            return;
        }

        const transaction = {
            id: 'trans-' + Date.now(),
            type: 'Ingreso',
            category: 'Retiro de Ahorros',
            description: `Retiro de ahorros: ${goal.description}`,
            amount: amount,
            account: destinoId,
            date: new Date().toISOString().split('T')[0],
            createdAt: Date.now()
        };

        dbSave('transactions', transaction);
        dbAdjustBalance(destinoId, amount);
        const currentGoal = APP.data.goals.find(g => g.id === goalId);
        if (currentGoal) dbPatch('goals', goalId, { currentAmount: money(currentGoal.currentAmount - amount) });

        modal.remove();
        renderSavingsGoalsList();
        renderAccountsList();
        renderAccounts();
        updateDashboard();
        showNotification('✅ Retiro de ahorros realizado', 'success');
    });

    document.getElementById('cancelRetiro').addEventListener('click', () => {
        modal.remove();
    });
}

window.showSavingsAbono = function(goalId) {
    const goal = APP.data.goals.find(g => g.id === goalId);
    if (!goal) return;

    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;

    const accountOptions = APP.data.accounts.map(acc =>
        `<option value="${acc.id}">${acc.name} ($${formatNumber(acc.balance || 0)})</option>`
    ).join('');

    const content = document.createElement('div');
    content.style.cssText = `
        background: white;
        padding: 30px;
        border-radius: 12px;
        max-width: 450px;
        width: 90%;
        box-shadow: 0 10px 40px rgba(0,0,0,0.3);
        max-height: 80vh;
        overflow-y: auto;
    `;

    content.innerHTML = `
        <h2 style="margin-top: 0; color: #333;">Abonar a Meta de Ahorro</h2>
        <p style="color: #666; margin-bottom: 20px; font-size: 14px;">
            <strong>Meta:</strong> ${goal.description}<br>
            <strong>Ahorrado:</strong> $${formatNumber(goal.currentAmount)} / $${formatNumber(goal.targetAmount)}<br>
            <strong>Falta:</strong> $${formatNumber(Math.max(0, goal.targetAmount - goal.currentAmount))}
        </p>

        <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; color: #333; font-weight: 600;">Seleccionar Cuenta</label>
            <select id="abonoAccount" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px;">
                <option value="">-- Selecciona una cuenta --</option>
                ${accountOptions}
            </select>
        </div>

        <div style="margin-bottom: 20px;">
            <label style="display: block; margin-bottom: 5px; color: #333; font-weight: 600;">Monto de Ahorro</label>
            <input type="number" id="abonoAmount" placeholder="Monto" min="0" step="0.01"
                style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 16px;">
        </div>

        <div style="display: flex; gap: 10px;">
            <button id="confirmAbono" style="flex: 1; padding: 12px; background: #667eea; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: 600;">Registrar Abono</button>
            <button id="cancelAbono" style="flex: 1; padding: 12px; background: #f0f0f0; color: #333; border: none; border-radius: 6px; cursor: pointer; font-size: 16px;">Cancelar</button>
        </div>
    `;

    modal.appendChild(content);
    document.body.appendChild(modal);

    const amountInput = document.getElementById('abonoAmount');
    amountInput.focus();

    document.getElementById('confirmAbono').addEventListener('click', async () => {
        const accountId = document.getElementById('abonoAccount').value;
        const amount = parseFloat(amountInput.value);

        if (!accountId) {
            showNotification('❌ Selecciona una cuenta', 'error');
            return;
        }

        if (!amount || isNaN(amount) || amount <= 0) {
            showNotification('❌ Ingresa un monto válido', 'error');
            return;
        }

        const account = APP.data.accounts.find(a => a.id === accountId);
        if (!account || account.balance < amount) {
            showNotification('❌ Saldo insuficiente en la cuenta', 'error');
            return;
        }

        const currentGoal = APP.data.goals.find(g => g.id === goalId);
        if (!currentGoal) {
            showNotification('❌ Meta no encontrada', 'error');
            return;
        }

        const transaction = {
            id: 'trans-' + Date.now(),
            type: 'Ahorro',
            date: new Date().toISOString().split('T')[0],
            category: 'Ahorros',
            description: `Abono a meta: ${currentGoal.description}`,
            amount: amount,
            account: accountId,
            timestamp: Date.now()
        };

        dbPatch('goals', goalId, { currentAmount: money(currentGoal.currentAmount + amount) });
        dbSave('transactions', transaction);
        dbAdjustBalance(accountId, -amount);

        modal.remove();
        updateDashboard();
        updateSavingsKpis();
        renderSavingsGoalsList();
        renderAccountsList();
        renderTransactionsList();
        showNotification('✅ Abono registrado correctamente', 'success');
    });

    document.getElementById('cancelAbono').addEventListener('click', () => {
        modal.remove();
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
};

window.deleteSavingsGoal = async function(goalId) {
    const goal = APP.data.goals.find(g => g.id === goalId);
    if (!goal) return;

    if (goal.currentAmount > 0) {
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        const availableAccounts = APP.data.accounts
            .map(acc => `<option value="${acc.id}">${acc.name} ($${formatNumber(acc.balance || 0)})</option>`)
            .join('');

        const content = document.createElement('div');
        content.style.cssText = `
            background: white;
            padding: 30px;
            border-radius: 12px;
            max-width: 450px;
            width: 90%;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
        `;

        content.innerHTML = `
            <h2 style="margin-top: 0; color: #d32f2f;">⚠️ Meta con Saldo</h2>
            <p style="color: #666; margin-bottom: 20px; font-size: 14px;">
                La meta <strong>"${goal.description}"</strong> tiene un saldo de <strong>$${formatNumber(goal.currentAmount)}</strong>.<br><br>
                Para eliminarla, debes transferir este saldo a una cuenta disponible.
            </p>

            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 5px; color: #333; font-weight: 600;">Transferir a:</label>
                <select id="transferDestino" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px;">
                    <option value="">-- Selecciona una cuenta --</option>
                    ${availableAccounts}
                </select>
            </div>

            <div style="display: flex; gap: 10px;">
                <button id="confirmDelete" style="flex: 1; padding: 12px; background: #d32f2f; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: 600;">Transferir y Eliminar</button>
                <button id="cancelDelete" style="flex: 1; padding: 12px; background: #e5e7eb; color: #333; border: none; border-radius: 6px; cursor: pointer; font-size: 16px;">Cancelar</button>
            </div>
        `;

        modal.appendChild(content);
        document.body.appendChild(modal);

        document.getElementById('confirmDelete').addEventListener('click', async () => {
            const destinoId = document.getElementById('transferDestino').value;
            if (!destinoId) {
                showNotification('❌ Selecciona una cuenta destino', 'error');
                return;
            }

            const cuentaDestino = APP.data.accounts.find(a => a.id === destinoId);
            if (!cuentaDestino) {
                showNotification('❌ Cuenta no encontrada', 'error');
                return;
            }

            dbAdjustBalance(destinoId, goal.currentAmount);
            dbDelete('goals', goalId);

            modal.remove();
            renderSavingsGoalsList();
            renderAccountsList();
            updateSavingsKpis();
            updateDashboard();
            showNotification(`✅ Meta eliminada. Saldo transferido a ${cuentaDestino.name}`, 'success');
        });

        document.getElementById('cancelDelete').addEventListener('click', () => {
            modal.remove();
        });
        return;
    }

    const confirmed = confirm(`¿Eliminar la meta "${goal.description}"?`);
    if (!confirmed) return;

    dbDelete('goals', goalId);
    renderSavingsGoalsList();
    updateSavingsKpis();
    updateDashboard();
};

function updateSavingsKpis() {
    const totalSavings = APP.data.goals.reduce((sum, goal) => sum + (goal.currentAmount || 0), 0);
    const activeMetas = APP.data.goals.filter(g => g.currentAmount < g.targetAmount).length;
    const completedMetas = APP.data.goals.filter(g => g.currentAmount >= g.targetAmount).length;

    const kpiAhorrosTotal = document.getElementById('kpi-ahorros-total');
    const kpiMetasActivas = document.getElementById('kpi-metas-activas');
    const kpiMetasCompletadas = document.getElementById('kpi-metas-completadas');

    if (kpiAhorrosTotal) kpiAhorrosTotal.textContent = `$${formatNumber(totalSavings)}`;
    if (kpiMetasActivas) kpiMetasActivas.textContent = activeMetas;
    if (kpiMetasCompletadas) kpiMetasCompletadas.textContent = completedMetas;
}

// ============ DASHBOARD ============
function updateDashboard() {
    if (!APP.gsheet.isConnected && localStorage.getItem('gsheetUrl')) {
        // Auto-test connection if URL is set
        APP.gsheet.isConnected = true;
    }

    const monthTransactions = APP.data.transactions.filter(t => {
        return t.date.startsWith(APP.currentMonth);
    });

    const totalIncome = monthTransactions
        .filter(t => t.type === 'Ingreso')
        .reduce((sum, t) => sum + t.amount, 0);

    const totalExpenses = monthTransactions
        .filter(t => t.type === 'Egreso')
        .reduce((sum, t) => sum + t.amount, 0);

    const balance = totalIncome - totalExpenses;

    // Calculate total account balance (all accounts, regardless of type)
    const totalAccountBalance = APP.data.accounts
        .reduce((sum, acc) => sum + (acc.balance || 0), 0);

    // Calculate total savings goals (only metas, not savings accounts)
    const totalSavings = APP.data.goals.reduce((sum, goal) => sum + (goal.currentAmount || 0), 0);

    // Saving rate is the percentage of income that went to savings goals only
    const savingRate = totalIncome > 0 ? (totalSavings / totalIncome) * 100 : 0;

    // Update KPIs
    document.getElementById('kpi-ingresos').textContent = `$${formatNumber(totalIncome)}`;
    document.getElementById('kpi-egresos').textContent = `$${formatNumber(totalExpenses)}`;
    document.getElementById('kpi-balance').textContent = `$${formatNumber(balance)}`;
    document.getElementById('kpi-ahorro').textContent = `${savingRate.toFixed(1)}%`;
    document.getElementById('kpi-saldo-disponible').textContent = `$${formatNumber(totalAccountBalance)}`;
    document.getElementById('kpi-total-ahorros').textContent = `$${formatNumber(totalSavings)}`;

    // Update budget comparison
    updateBudgetComparison(monthTransactions);

    // Update debt card
    updateDebtCard();

    // Update savings goals
    updateSavingsGoals();

    // Update charts
    updateCharts(APP.data.transactions);
}

function updateBudgetComparison(transactions) {
    const container = document.getElementById('budget-comparison');
    const expenses = transactions.filter(t => t.type === 'Egreso');

    const budgetByCategory = {};
    APP.data.categories.filter(c => c.type === 'Egreso').forEach(cat => {
        const spent = expenses
            .filter(e => e.category === cat.id)
            .reduce((sum, e) => sum + e.amount, 0);

        budgetByCategory[cat.id] = {
            name: cat.name,
            budget: cat.budget,
            spent: spent
        };
    });

    container.innerHTML = Object.entries(budgetByCategory)
        .filter(([_, data]) => data.budget > 0 || data.spent > 0)
        .map(([_, data]) => {
            const percentage = (data.spent / data.budget) * 100;
            const status = percentage > 100 ? 'danger' : percentage > 80 ? 'warning' : '';

            return `
                <div class="budget-item">
                    <span class="budget-item-name">${data.name}</span>
                    <div class="budget-item-progress">
                        <div class="budget-item-bar ${status}" style="width: ${Math.min(percentage, 100)}%"></div>
                    </div>
                    <span class="budget-item-amount">$${formatNumber(data.spent)} / $${formatNumber(data.budget)}</span>
                </div>
            `;
        }).join('');
}

function updateDebtCard() {
    const container = document.getElementById('debt-pending');
    const today = new Date();

    const pendingDebts = APP.data.debts
        .filter(d => d.currentBalance > 0)
        .filter(d => {
            if (!d.nextPaymentDate) return true;
            const paymentDate = new Date(d.nextPaymentDate);
            const daysUntilPayment = Math.floor((paymentDate - today) / (1000 * 60 * 60 * 24));
            return daysUntilPayment <= 7;
        })
        .slice(0, 5);

    if (pendingDebts.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">Sin pagos próximos</p>';
        return;
    }

    container.innerHTML = pendingDebts.map(debt => {
        const paymentDate = new Date(debt.nextPaymentDate || new Date());
        const daysLeft = Math.ceil((paymentDate - new Date()) / (1000 * 60 * 60 * 24));

        return `
            <div class="debt-item">
                <span class="debt-item-name">${debt.entity}</span>
                <span class="debt-item-status ${daysLeft <= 2 ? 'urgent' : 'alert'}">${daysLeft} días</span>
                <span style="font-weight: 600; color: var(--warning);">$${formatNumber(debt.monthlyPayment)}</span>
            </div>
        `;
    }).join('');
}

function updateSavingsGoals() {
    const container = document.getElementById('savings-goals');

    if (APP.data.goals.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">No hay metas establecidas</p>';
        return;
    }

    container.innerHTML = APP.data.goals.map(goal => {
        const progress = (goal.currentAmount / goal.targetAmount) * 100;
        const daysLeft = Math.ceil((new Date(goal.deadline) - new Date()) / (1000 * 60 * 60 * 24));

        return `
            <div class="goal-item">
                <span class="budget-item-name">${goal.description}</span>
                <div class="budget-item-progress">
                    <div class="budget-item-bar" style="width: ${Math.min(progress, 100)}%"></div>
                </div>
                <span class="budget-item-amount">${Math.round(progress)}%</span>
            </div>
        `;
    }).join('');
}

function updateCharts(monthTransactions) {
    updateExpensesByCategoryChart(monthTransactions);
    updateIncomeExpensesChart(monthTransactions);
}

function updateExpensesByCategoryChart(transactions) {
    const expenses = transactions.filter(t => t.type === 'Egreso');
    const categoryData = {};

    expenses.forEach(exp => {
        let categoryName = 'Otro';

        // If there's an explicit category, use it
        if (exp.category) {
            const cat = APP.data.categories.find(c => c.id === exp.category);
            if (cat) {
                categoryName = cat.name;
            }
        }

        // Also check description for special transaction types
        if (categoryName === 'Otro' || !exp.category) {
            if (exp.description && exp.description.includes('Pago de deuda:')) {
                categoryName = 'Pago de deuda';
            } else if (exp.description && exp.description.includes('Abono a meta:')) {
                categoryName = 'Abono a meta';
            } else if (exp.description && exp.description.includes('Traslado:')) {
                categoryName = 'Traslado';
            } else if (exp.description && exp.description.includes('Retiro de Ahorros:')) {
                categoryName = 'Retiro de Ahorros';
            }
        }

        categoryData[categoryName] = (categoryData[categoryName] || 0) + exp.amount;
    });

    const ctx = document.getElementById('chart-gastos-categoria').getContext('2d');

    if (APP.charts.gastosCat) APP.charts.gastosCat.destroy();

    APP.charts.gastosCat = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(categoryData),
            datasets: [{
                data: Object.values(categoryData),
                backgroundColor: [
                    '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
                    '#8b5cf6', '#06b6d4', '#ec4899', '#6366f1'
                ],
                borderColor: '#fff',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { position: 'bottom' }
            }
        }
    });
}

function updateIncomeExpensesChart(transactions) {
    const incomes = transactions.filter(t => t.type === 'Ingreso');
    const expenses = transactions.filter(t => t.type === 'Egreso');

    const totalIncome = incomes.reduce((sum, t) => sum + t.amount, 0);
    const totalExpense = expenses.reduce((sum, t) => sum + t.amount, 0);

    const ctx = document.getElementById('chart-ingresos-egresos').getContext('2d');

    if (APP.charts.ingresosEgresos) APP.charts.ingresosEgresos.destroy();

    APP.charts.ingresosEgresos = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Ingresos', 'Egresos', 'Balance'],
            datasets: [{
                label: 'Monto ($)',
                data: [totalIncome, totalExpense, totalIncome - totalExpense],
                backgroundColor: ['#10b981', '#ef4444', '#3b82f6'],
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            indexAxis: 'x',
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

// ============ DELETE ALL DATA ============
function showDeleteConfirmationModal() {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
        background: var(--bg-primary);
        border-radius: 12px;
        padding: 30px;
        max-width: 500px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
        border: 2px solid var(--danger);
    `;

    content.innerHTML = `
        <h2 style="color: var(--danger); margin-top: 0; margin-bottom: 20px;">⚠️ Confirmación de Borrado</h2>
        <p style="color: var(--text-secondary); line-height: 1.6; margin-bottom: 20px;">
            Esta acción eliminará <strong>TODOS</strong> los datos de la aplicación:
        </p>
        <ul style="color: var(--text-secondary); margin-bottom: 20px; padding-left: 20px;">
            <li>Todas las transacciones</li>
            <li>Todas las cuentas</li>
            <li>Todas las categorías</li>
            <li>Datos guardados localmente</li>
            <li>Datos en Firebase (si está conectado)</li>
        </ul>
        <p style="color: var(--danger); font-weight: bold; margin-bottom: 20px;">
            ⚠️ Esta acción es irreversible
        </p>
        <div style="display: flex; gap: 10px; justify-content: flex-end;">
            <button id="cancel-delete-btn" class="btn btn-secondary" style="cursor: pointer;">Cancelar</button>
            <button id="confirm-delete-btn" class="btn btn-danger" style="cursor: pointer;">Entendido, continuar</button>
        </div>
    `;

    modal.appendChild(content);
    document.body.appendChild(modal);

    document.getElementById('cancel-delete-btn').addEventListener('click', () => {
        modal.remove();
        showNotification('Operación cancelada', 'info');
    });

    document.getElementById('confirm-delete-btn').addEventListener('click', () => {
        modal.remove();
        showDeleteCodeConfirmation();
    });
}

function showDeleteCodeConfirmation() {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
        background: var(--bg-primary);
        border-radius: 12px;
        padding: 30px;
        max-width: 500px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
        border: 2px solid var(--danger);
    `;

    content.innerHTML = `
        <h2 style="color: var(--danger); margin-top: 0; margin-bottom: 20px;">🔐 Confirmación de Seguridad</h2>
        <p style="color: var(--text-secondary); margin-bottom: 15px;">
            Para confirmar el borrado irreversible de todos tus datos, escribe:
        </p>
        <p style="background: var(--bg-secondary); padding: 10px; border-radius: 6px; font-family: monospace; font-weight: bold; color: var(--danger); text-align: center; margin-bottom: 20px;">
            BORRAR TODO
        </p>
        <input type="text" id="delete-code-input" placeholder="Escribe el código aquí..." style="width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 6px; box-sizing: border-box; margin-bottom: 20px; background: var(--bg-secondary); color: var(--text-primary);">
        <div style="display: flex; gap: 10px; justify-content: flex-end;">
            <button id="cancel-code-btn" class="btn btn-secondary" style="cursor: pointer;">Cancelar</button>
            <button id="confirm-code-btn" class="btn btn-danger" style="cursor: pointer;" disabled>Borrar Todo</button>
        </div>
    `;

    modal.appendChild(content);
    document.body.appendChild(modal);

    const input = document.getElementById('delete-code-input');
    const confirmBtn = document.getElementById('confirm-code-btn');

    input.addEventListener('input', () => {
        confirmBtn.disabled = input.value !== 'BORRAR TODO';
    });

    input.focus();

    document.getElementById('cancel-code-btn').addEventListener('click', () => {
        modal.remove();
        showNotification('Operación cancelada', 'info');
    });

    document.getElementById('confirm-code-btn').addEventListener('click', () => {
        modal.remove();
        performDeleteAllData();
    });
}

async function performDeleteAllData() {
    try {
        showNotification('🔄 Eliminando datos... Por favor espera', 'info');

        if (CLOUD.enabled) {
            COLLECTION_NAMES.forEach(name => {
                APP.data[name].forEach(item => cloudCall(window.firebaseDB.deleteRecord(name, item.id)));
            });
            await Promise.race([
                window.firebaseDB.pendingWrites(),
                new Promise(resolve => setTimeout(resolve, 10000))
            ]);
        }

        const firebaseConfig = localStorage.getItem('firebaseConfig');
        localStorage.clear();
        if (firebaseConfig) localStorage.setItem('firebaseConfig', firebaseConfig);

        showNotification('✅ Datos eliminados. Recargando...', 'success');
        setTimeout(() => location.reload(), 1500);
    } catch (error) {
        console.error('Error al borrar datos:', error);
        showNotification('❌ Error: ' + error.message, 'error');
    }
}

async function handleDeleteAllData() {
    // Deprecated: Use showDeleteConfirmationModal() instead
    showDeleteConfirmationModal();
}

// ============ EXPORT TO EXCEL ============
function exportToExcel() {
    const monthTransactions = APP.data.transactions.filter(t =>
        t.date.startsWith(APP.currentMonth)
    );

    const data = [];

    // Headers
    data.push(['REPORTE FINANCIERO - ' + APP.currentMonth, '', '', '', '']);
    data.push(['', '', '', '', '']);

    // Summary
    const totalIncome = monthTransactions
        .filter(t => t.type === 'Ingreso')
        .reduce((sum, t) => sum + t.amount, 0);

    const totalExpenses = monthTransactions
        .filter(t => t.type === 'Egreso')
        .reduce((sum, t) => sum + t.amount, 0);

    const balance = totalIncome - totalExpenses;

    data.push(['RESUMEN DEL MES', '', '', '', '']);
    data.push(['Ingresos Totales', totalIncome, '', '', '']);
    data.push(['Egresos Totales', totalExpenses, '', '', '']);
    data.push(['Balance Neto', balance, '', '', '']);
    data.push(['Tasa de Ahorro', (balance / totalIncome * 100).toFixed(2) + '%', '', '', '']);
    data.push(['', '', '', '', '']);

    // Transactions
    data.push(['TRANSACCIONES DETALLADAS', '', '', '', '']);
    data.push(['Fecha', 'Tipo', 'Descripción', 'Categoría', 'Monto ($)']);

    monthTransactions
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .forEach(t => {
            const category = t.type === 'Egreso'
                ? APP.data.categories.find(c => c.id === t.category)?.name
                : t.incomeType;

            data.push([
                t.date,
                t.type,
                t.description || t.incomeType,
                category || '',
                t.amount
            ]);
        });

    data.push(['', '', '', '', '']);

    // Debts
    data.push(['DEUDAS ACTIVAS', '', '', '', '']);
    data.push(['Entidad', 'Saldo Actual ($)', 'Cuota Mensual ($)', 'Titular', 'Meses Restantes']);

    APP.data.debts.forEach(debt => {
        const monthsLeft = Math.ceil(debt.currentBalance / debt.monthlyPayment);
        data.push([
            debt.entity,
            debt.currentBalance,
            debt.monthlyPayment,
            debt.holder,
            monthsLeft
        ]);
    });

    // Create CSV
    let csv = '';
    data.forEach(row => {
        csv += row.map(cell => `"${cell}"`).join(',') + '\n';
    });

    // Download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `finanzas-${APP.currentMonth}.csv`);
    link.click();

    showNotification('Reporte exportado correctamente', 'success');
}

// ============ UTILITIES ============
function formatNumber(num) {
    return new Intl.NumberFormat('es-CO', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(num);
}

// ============ GOOGLE SHEETS INTEGRATION ============
function handleGSheetConnection(e) {
    e.preventDefault();
    const url = document.getElementById('gsheet-url').value.trim();

    if (!url) {
        showGSheetStatus('❌ Por favor ingresa una URL válida', 'error');
        return;
    }

    // Aceptar URLs de Google Apps Script (múltiples formatos)
    if (!url.includes('script.google') && !url.includes('googleapis.com')) {
        showGSheetStatus('❌ Debe ser una URL de Google Apps Script', 'error');
        return;
    }

    saveGSheetConfig(url);
    showGSheetStatus('✅ Apps Script conectado. Probando...', 'success');
}

function showGSheetStatus(message, type) {
    const statusDiv = document.getElementById('gsheet-status');
    const statusText = document.getElementById('gsheet-status-text');

    statusDiv.style.display = 'block';
    statusText.textContent = message;
    statusDiv.style.background = type === 'error' ? 'var(--danger-light)' : 'var(--secondary-light)';
    statusDiv.style.color = type === 'error' ? 'var(--danger)' : 'var(--secondary)';
}

function testGSheetConnection() {
    if (!APP.gsheet.scriptUrl) {
        showGSheetStatus('⚠️ Primero debes ingresar la URL de Apps Script', 'error');
        return;
    }

    showGSheetStatus('🔄 Probando conexión...', 'success');

    const callbackName = 'jsonpCallback_' + Math.random().toString(36).substr(2, 9);
    const testUrl = APP.gsheet.scriptUrl.includes('?')
        ? APP.gsheet.scriptUrl + '&action=test&callback=' + callbackName
        : APP.gsheet.scriptUrl + '?action=test&callback=' + callbackName;

    // Crear callback global
    window[callbackName] = function(result) {
        if (result && result.success) {
            showGSheetStatus('Conexión exitosa. Apps Script está funcionando.', 'success');
            APP.gsheet.isConnected = true;

            setTimeout(() => {
                syncAllDataFromSheet();
            }, 500);
        } else {
            showGSheetStatus('Error: ' + (result?.error || 'Error desconocido'), 'error');
            APP.gsheet.isConnected = false;
        }
        delete window[callbackName];
        if (document.body.contains(script)) {
            document.body.removeChild(script);
        }
    };

    // Usar script tag para JSONP
    const script = document.createElement('script');
    script.src = testUrl;
    script.onerror = function() {
        showGSheetStatus('Error de conexión: No se pudo conectar', 'error');
        APP.gsheet.isConnected = false;
        delete window[callbackName];
        if (document.body.contains(script)) {
            document.body.removeChild(script);
        }
    };
    document.body.appendChild(script);

}

function syncWithGSheet() {
    if (!APP.gsheet.isConnected) {
        showGSheetStatus('⚠️ Primero debes probar la conexión', 'error');
        return;
    }

    syncAllDataFromSheet();
}

// ============ START APP ============
document.addEventListener('DOMContentLoaded', initApp);
