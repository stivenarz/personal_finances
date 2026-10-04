const APP = {
    currentMonth: new Date().toISOString().slice(0, 7),
    isOnline: false,
    data: {
        transactions: [],
        debts: [],
        accounts: [],
        categories: [],
        goals: [],
        debtPayments: []
    },
    charts: {},
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
            APP.data = JSON.parse(offlineData);
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

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        background: ${type === 'success' ? '#4CAF50' : type === 'warning' ? '#FF9800' : '#2196F3'};
        color: white;
        border-radius: 4px;
        z-index: 10000;
        font-size: 14px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => notification.remove(), 5000);
}

function updateDatabaseModeStatus() {
    const statusEl = document.getElementById('db-mode-status');
    const syncBtn = document.getElementById('sync-data-btn');

    if (!statusEl) return;

    if (APP.isOnline) {
        statusEl.textContent = '🔵 Usando Firebase (Nube)';
        if (syncBtn) syncBtn.style.display = 'none';
    } else {
        statusEl.textContent = '⚫ Usando Base de Datos Local';
        if (syncBtn) syncBtn.style.display = 'inline-block';
    }
}

function setupDatabaseModeToggle() {
    const localRadio = document.getElementById('db-mode-local');
    const firebaseRadio = document.getElementById('db-mode-firebase');

    if (!localRadio || !firebaseRadio) return;

    const savedMode = localStorage.getItem('db_mode_preference');
    if (savedMode === 'local') {
        localRadio.checked = true;
        APP.useFirebasePreference = false;
    } else if (savedMode === 'firebase') {
        firebaseRadio.checked = true;
        APP.useFirebasePreference = true;
    } else if (window.firebaseDB?.isFirebaseConfigured?.()) {
        firebaseRadio.checked = true;
        APP.useFirebasePreference = true;
    } else {
        localRadio.checked = true;
        APP.useFirebasePreference = false;
    }

    localRadio.addEventListener('change', () => {
        if (localRadio.checked) {
            localStorage.setItem('db_mode_preference', 'local');
            APP.useFirebasePreference = false;
            location.reload();
        }
    });

    firebaseRadio.addEventListener('change', () => {
        if (firebaseRadio.checked) {
            if (!window.firebaseDB?.isFirebaseConfigured?.()) {
                showNotification('⚠️ Firebase no está configurado', 'warning');
                localRadio.checked = true;
                return;
            }
            localStorage.setItem('db_mode_preference', 'firebase');
            APP.useFirebasePreference = true;
            location.reload();
        }
    });
}

// ============ INITIALIZATION ============
async function initApp() {
    const spinner = document.getElementById('loading-spinner');

    await import('./firebase-config.js').then(async (fb) => {
        window.firebaseDB = fb;

        const userPreference = localStorage.getItem('db_mode_preference');
        const firebaseConfigured = fb.isFirebaseConfigured();
        const shouldUseFirebase = userPreference === 'firebase' && firebaseConfigured;

        if (shouldUseFirebase) {
            APP.isOnline = true;

            try {
                const initialized = fb.initializeFirebase();
                if (!initialized) {
                    throw new Error('Failed to initialize Firebase');
                }

                await fb.initializeAuth();
                const allData = await fb.loadAllData();
                APP.data = allData;
                showNotification('🔵 Conectado a Firebase', 'success');
            } catch (error) {
                console.error('Firebase error:', error);
                APP.isOnline = false;
                loadOfflineData();
                showNotification('⚠️ Error conectando a Firebase. Modo offline.', 'warning');
            }
        } else {
            APP.isOnline = false;
            loadOfflineData();
            if (userPreference === 'local') {
                showNotification('📝 Usando Base de Datos Local', 'info');
            } else {
                showNotification('⚠️ Usando Base de Datos Local', 'info');
            }
        }
    });

    setupEventListeners();
    setupMobileMenu();
    setupSyncButton();
    setupDatabaseModeToggle();
    updateDatabaseModeStatus();

    // Hide spinner after loading
    if (spinner) {
        spinner.classList.add('hidden');
    }

    setupFirebaseEventListeners();
    renderAccounts();
    renderCategories();
    setCurrentMonth();
    showView('dashboard');
    updateDashboard();
}

function setupMobileMenu() {
    const toggle = document.getElementById('mobile-menu-toggle');
    const sidebar = document.getElementById('sidebar');
    const closeBtn = document.getElementById('sidebar-close');

    toggle?.addEventListener('click', () => {
        sidebar.classList.add('open');
        toggle.classList.add('hidden');
        toggle.setAttribute('aria-expanded', 'true');
    });

    closeBtn?.addEventListener('click', () => {
        sidebar.classList.remove('open');
        toggle.classList.remove('hidden');
        toggle.setAttribute('aria-expanded', 'false');
    });

    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                sidebar.classList.remove('open');
                toggle.classList.remove('hidden');
                toggle.setAttribute('aria-expanded', 'false');
            }
        });
    });
}

function loadDataFromStorage() {
    // Los datos se cargan desde Firebase automáticamente en initApp
}

async function saveDataToFirebase(collectionName, data) {
    if (!APP.isOnline) {
        // Modo offline: guardar en localStorage
        saveOfflineData();
        console.log('💾 Guardado en localStorage (offline)');
        return;
    }

    if (!window.firebaseDB) {
        console.warn('Firebase no disponible');
        saveOfflineData();
        return;
    }

    try {
        if (data.id) {
            await window.firebaseDB.updateData(collectionName, data.id, data);
        } else {
            await window.firebaseDB.saveData(collectionName, data);
        }
        console.log('✅ Guardado en Firebase');
    } catch (error) {
        console.error('Error guardando en Firebase:', error);
        saveOfflineData();
    }
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
    const syncBtn = document.getElementById('sync-data-btn');
    if (!syncBtn) return;

    syncBtn.addEventListener('click', async () => {
        if (!confirm('¿Sincronizar datos locales a Firebase?\n\nEsto enviará todos tus datos locales a la nube.')) {
            return;
        }

        syncBtn.disabled = true;
        syncBtn.textContent = '⏳ Sincronizando...';

        try {
            // Save current data to Firebase
            const collections = ['accounts', 'categories', 'transactions', 'debts', 'debtPayments', 'goals'];

            for (const collectionName of collections) {
                const items = APP.data[collectionName] || [];
                for (const item of items) {
                    if (item.id) {
                        await window.firebaseDB.saveData(collectionName, item);
                    }
                }
            }

            showNotification('✅ Sincronización completada', 'success');
            syncBtn.textContent = '🔄 Sincronizar';
            syncBtn.style.display = 'none';
            APP.isOnline = true;
            updateDatabaseModeStatus();
        } catch (error) {
            console.error('Error en sincronización:', error);
            showNotification('❌ Error en sincronización: ' + error.message, 'warning');
            syncBtn.textContent = '🔄 Sincronizar';
        } finally {
            syncBtn.disabled = false;
        }
    });
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
    });

    // Forms
    document.getElementById('form-gasto').addEventListener('submit', handleAddExpense);
    document.getElementById('form-ingreso').addEventListener('submit', handleAddIncome);
    document.getElementById('form-deuda').addEventListener('submit', handleAddDebt);
    document.getElementById('form-cuenta').addEventListener('submit', handleAddAccount);
    document.getElementById('form-categoria').addEventListener('submit', handleAddCategory);
    document.getElementById('form-meta').addEventListener('submit', handleAddGoal);

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
    document.getElementById('trans-filter-fecha-inicio').addEventListener('change', renderTransactionsList);
    document.getElementById('trans-filter-fecha-fin').addEventListener('change', renderTransactionsList);

    // Export
    document.getElementById('export-btn').addEventListener('click', exportToExcel);
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
        transacciones: 'Transacciones',
        configuracion: 'Configuración'
    };
    document.getElementById('view-title').textContent = titles[viewName];

    if (viewName === 'deudas') {
        renderDebtsList();
    } else if (viewName === 'gastos') {
        renderExpensesList();
    } else if (viewName === 'ingresos') {
        renderIncomeList();
    } else if (viewName === 'transacciones') {
        renderTransactionsList();
    } else if (viewName === 'configuracion') {
        renderAccountsList();
        renderCategoriesList();
        renderGoalsList();
    }
}

// ============ EXPENSES ============
function handleAddExpense(e) {
    e.preventDefault();

    const expense = {
        id: 'exp-' + Date.now(),
        type: 'Egreso',
        date: document.getElementById('gasto-fecha').value,
        category: document.getElementById('gasto-categoria').value,
        description: document.getElementById('gasto-descripcion').value,
        amount: parseFloat(document.getElementById('gasto-monto').value),
        account: document.getElementById('gasto-cuenta').value,
        timestamp: Date.now()
    };

    APP.data.transactions.push(expense);

    if (APP.isOnline && window.firebaseDB) {
        window.firebaseDB.saveData('transactions', expense).catch(err =>
            console.error('Error guardando en Firebase:', err)
        );
    } else {
        saveOfflineData();
    }

    e.target.reset();
    document.getElementById('gasto-fecha').valueAsDate = new Date();

    updateDashboard();
    renderExpensesList();
    alert('✅ Gasto registrado correctamente');
}

function renderExpensesList() {
    const search = document.getElementById('gastos-search').value.toLowerCase();
    const categoryFilter = document.getElementById('gastos-filter-categoria').value;

    let expenses = APP.data.transactions.filter(t => t.type === 'Egreso');

    if (categoryFilter) {
        expenses = expenses.filter(t => t.category === categoryFilter);
    }

    if (search) {
        expenses = expenses.filter(t => t.description.toLowerCase().includes(search));
    }

    const container = document.getElementById('list-gastos');
    container.innerHTML = expenses.map(exp => {
        const cat = APP.data.categories.find(c => c.id === exp.category);
        return `
            <div class="transaction-item egreso">
                <div class="transaction-date">${new Date(exp.date).toLocaleDateString()}</div>
                <div class="transaction-desc">${exp.description || 'Sin descripción'}</div>
                <div class="transaction-category">${cat?.name || 'N/A'}</div>
                <div class="transaction-amount negativo">-$${formatNumber(exp.amount)}</div>
                <button class="btn btn-danger" onclick="deleteTransaction('${exp.id}')">Eliminar</button>
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

    const income = {
        id: 'inc-' + Date.now(),
        type: 'Ingreso',
        date: document.getElementById('ingreso-fecha').value,
        incomeType: document.getElementById('ingreso-tipo').value,
        description: document.getElementById('ingreso-descripcion').value,
        amount: parseFloat(document.getElementById('ingreso-monto').value),
        account: document.getElementById('ingreso-cuenta').value,
        timestamp: Date.now()
    };

    APP.data.transactions.push(income);

    if (APP.isOnline && window.firebaseDB) {
        window.firebaseDB.saveData('transactions', income).catch(err =>
            console.error('Error guardando en Firebase:', err)
        );
    } else {
        saveOfflineData();
    }

    e.target.reset();
    document.getElementById('ingreso-fecha').valueAsDate = new Date();

    updateDashboard();
    renderIncomeList();
    alert('✅ Ingreso registrado correctamente');
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
        return `
            <div class="transaction-item ingreso">
                <div class="transaction-date">${new Date(inc.date).toLocaleDateString()}</div>
                <div class="transaction-desc">${inc.description}</div>
                <div class="transaction-category">${inc.incomeType}</div>
                <div class="transaction-amount positivo">+$${formatNumber(inc.amount)}</div>
                <button class="btn btn-danger" onclick="deleteTransaction('${inc.id}')">Eliminar</button>
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
function handleAddDebt(e) {
    e.preventDefault();

    const debt = {
        id: 'debt-' + Date.now(),
        entity: document.getElementById('deuda-entidad').value,
        initialBalance: parseFloat(document.getElementById('deuda-inicial').value) || parseFloat(document.getElementById('deuda-saldo').value),
        currentBalance: parseFloat(document.getElementById('deuda-saldo').value),
        monthlyPayment: parseFloat(document.getElementById('deuda-cuota').value),
        holder: document.getElementById('deuda-titular').value,
        nextPaymentDate: document.getElementById('deuda-fecha-pago').value,
        createdAt: Date.now()
    };

    APP.data.debts.push(debt);

    if (APP.isOnline && window.firebaseDB) {
        window.firebaseDB.saveData('debts', debt).catch(err =>
            console.error('Error guardando en Firebase:', err)
        );
    } else {
        saveOfflineData();
    }

    e.target.reset();
    updateDashboard();
    renderDebtsList();
    alert('✅ Deuda registrada correctamente');
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
                    <button class="btn btn-danger" onclick="deleteDebt('${debt.id}')">Eliminar</button>
                </div>
            </div>
        `;
    }).join('');
}

function registerDebtPayment(debtId) {
    const debt = APP.data.debts.find(d => d.id === debtId);
    if (!debt) return;

    const amount = prompt(`Ingrese el monto a pagar (Saldo actual: $${formatNumber(debt.currentBalance)}):`, debt.monthlyPayment.toString());

    if (amount && !isNaN(amount)) {
        const paymentAmount = parseFloat(amount);

        if (paymentAmount > debt.currentBalance) {
            alert('❌ El monto no puede exceder el saldo actual');
            return;
        }

        debt.currentBalance -= paymentAmount;

        APP.data.debtPayments.push({
            id: 'pay-' + Date.now(),
            debtId: debtId,
            amount: paymentAmount,
            date: new Date().toISOString().split('T')[0],
            timestamp: Date.now()
        });

        if (debt.currentBalance <= 0) {
            debt.currentBalance = 0;
        }

        saveDataToStorage();
        updateDashboard();
        renderDebtsList();
        alert('✅ Pago registrado correctamente');
    }
}

window.deleteDebt = async function(debtId) {
    const debt = APP.data.debts.find(d => d.id === debtId);
    if (!debt) return;

    const confirmed = confirm(`¿Eliminar la deuda "${debt.description || 'Sin nombre'}"?`);
    if (!confirmed) return;

    APP.data.debts = APP.data.debts.filter(d => d.id !== debtId);
    updateDashboard();
    renderDebtsList();

    if (APP.isOnline && window.firebaseDB) {
        try {
            await window.firebaseDB.deleteData('debts', debtId);
        } catch (err) {
            console.error('Error deleting debt:', err);
            APP.data.debts.push(debt);
            updateDashboard();
            renderDebtsList();
            alert('⚠️ Error al eliminar: ' + err.message);
        }
    } else {
        saveOfflineData();
    }
}

// ============ TRANSACTIONS ============
window.deleteTransaction = async function(transId) {
    const transaction = APP.data.transactions.find(t => t.id === transId);
    if (!transaction) return;

    const confirmed = confirm(`¿Eliminar la transacción de ${transaction.type === 'Egreso' ? 'gasto' : 'ingreso'}?`);
    if (!confirmed) return;

    APP.data.transactions = APP.data.transactions.filter(t => t.id !== transId);
    updateDashboard();
    renderExpensesList();
    renderIncomeList();
    renderTransactionsList();

    if (APP.isOnline && window.firebaseDB) {
        try {
            await window.firebaseDB.deleteData('transactions', transId);
        } catch (err) {
            console.error('Error deleting transaction:', err);
            APP.data.transactions.push(transaction);
            updateDashboard();
            renderExpensesList();
            renderIncomeList();
            renderTransactionsList();
            alert('⚠️ Error al eliminar: ' + err.message);
        }
    } else {
        saveOfflineData();
    }
}

function renderTransactionsList() {
    const search = document.getElementById('trans-search').value.toLowerCase();
    const typeFilter = document.getElementById('trans-filter-tipo').value;
    const accountFilter = document.getElementById('trans-filter-cuenta').value;
    const dateStart = document.getElementById('trans-filter-fecha-inicio').value;
    const dateEnd = document.getElementById('trans-filter-fecha-fin').value;

    let transactions = [...APP.data.transactions];

    if (typeFilter) {
        transactions = transactions.filter(t => t.type === typeFilter);
    }

    if (accountFilter) {
        transactions = transactions.filter(t => t.account === accountFilter);
    }

    if (dateStart) {
        transactions = transactions.filter(t => t.date >= dateStart);
    }

    if (dateEnd) {
        transactions = transactions.filter(t => t.date <= dateEnd);
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
                <button class="btn btn-danger" onclick="deleteTransaction('${t.id}')">Eliminar</button>
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

// ============ CONFIGURATION ============
function handleAddAccount(e) {
    e.preventDefault();

    const account = {
        id: 'acc-' + Date.now(),
        name: document.getElementById('cuenta-nombre').value,
        type: document.getElementById('cuenta-tipo').value
    };

    APP.data.accounts.push(account);

    if (APP.isOnline && window.firebaseDB) {
        window.firebaseDB.saveData('accounts', account).catch(err =>
            console.error('Error guardando en Firebase:', err)
        );
    } else {
        saveOfflineData();
    }

    e.target.reset();
    renderAccounts();
    renderAccountsList();
    alert('✅ Cuenta agregada');
}

function renderAccounts() {
    const selects = ['gasto-cuenta', 'ingreso-cuenta', 'trans-filter-cuenta'];
    selects.forEach(id => {
        const select = document.getElementById(id);
        select.innerHTML = '<option value="">Seleccionar cuenta</option>';
        APP.data.accounts.forEach(acc => {
            const option = document.createElement('option');
            option.value = acc.id;
            option.textContent = acc.name;
            select.appendChild(option);
        });
    });
}

function renderAccountsList() {
    const container = document.getElementById('list-cuentas');
    container.innerHTML = APP.data.accounts.map(acc => `
        <div class="account-item">
            <div>
                <div class="account-name">${acc.name}</div>
                <div class="account-type">${acc.type}</div>
            </div>
            <div></div>
            <button class="btn btn-danger" onclick="deleteAccount('${acc.id}')">Eliminar</button>
        </div>
    `).join('');
}

window.deleteAccount = async function(accountId) {
    const account = APP.data.accounts.find(a => a.id === accountId);
    if (!account) return;

    const confirmed = confirm(`¿Eliminar la cuenta "${account.name}"?`);
    if (!confirmed) {
        console.log('Eliminación cancelada');
        return;
    }

    APP.data.accounts = APP.data.accounts.filter(a => a.id !== accountId);
    renderAccountsList();
    renderAccounts();

    if (APP.isOnline && window.firebaseDB) {
        try {
            await window.firebaseDB.deleteData('accounts', accountId);
        } catch (err) {
            console.error('Error deleting account:', err);
            APP.data.accounts.push(account);
            renderAccountsList();
            renderAccounts();
            alert('⚠️ Error al eliminar: ' + err.message);
        }
    } else {
        saveOfflineData();
    }
}

function handleAddCategory(e) {
    e.preventDefault();

    const category = {
        id: 'cat-' + Date.now(),
        name: document.getElementById('categoria-nombre').value,
        type: document.getElementById('categoria-tipo').value,
        budget: parseFloat(document.getElementById('categoria-presupuesto').value) || 0
    };

    APP.data.categories.push(category);

    if (APP.isOnline && window.firebaseDB) {
        window.firebaseDB.saveData('categories', category).catch(err =>
            console.error('Error guardando en Firebase:', err)
        );
    } else {
        saveOfflineData();
    }

    e.target.reset();
    renderCategories();
    renderCategoriesList();
    alert('✅ Categoría agregada');
}

function renderCategories() {
    const select = document.getElementById('gasto-categoria');
    select.innerHTML = '<option value="">Seleccionar categoría</option>';
    APP.data.categories.filter(c => c.type === 'Egreso').forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.id;
        option.textContent = cat.name;
        select.appendChild(option);
    });
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
            <button class="btn btn-danger" onclick="deleteCategory('${cat.id}')">Eliminar</button>
        </div>
    `).join('');
}

window.deleteCategory = async function(categoryId) {
    const category = APP.data.categories.find(c => c.id === categoryId);
    if (!category) return;

    const confirmed = confirm(`¿Eliminar la categoría "${category.name}"?`);
    if (!confirmed) {
        console.log('Eliminación cancelada');
        return;
    }

    APP.data.categories = APP.data.categories.filter(c => c.id !== categoryId);
    renderCategoriesList();
    renderCategories();

    if (APP.isOnline && window.firebaseDB) {
        try {
            await window.firebaseDB.deleteData('categories', categoryId);
        } catch (err) {
            console.error('Error deleting category:', err);
            APP.data.categories.push(category);
            renderCategoriesList();
            renderCategories();
            alert('⚠️ Error al eliminar: ' + err.message);
        }
    } else {
        saveOfflineData();
    }
}

function handleAddGoal(e) {
    e.preventDefault();

    const goal = {
        id: 'goal-' + Date.now(),
        description: document.getElementById('meta-descripcion').value,
        targetAmount: parseFloat(document.getElementById('meta-monto').value),
        deadline: document.getElementById('meta-fecha').value,
        currentAmount: 0
    };

    APP.data.goals.push(goal);

    if (APP.isOnline && window.firebaseDB) {
        window.firebaseDB.saveData('goals', goal).catch(err =>
            console.error('Error guardando en Firebase:', err)
        );
    } else {
        saveOfflineData();
    }

    e.target.reset();
    renderGoalsList();
    updateDashboard();
    alert('✅ Meta agregada');
}

function renderGoalsList() {
    const container = document.getElementById('list-metas');
    container.innerHTML = APP.data.goals.map(goal => {
        const progress = (goal.currentAmount / goal.targetAmount) * 100;
        return `
            <div class="goal-item">
                <div>
                    <div class="goal-desc">${goal.description}</div>
                    <div class="goal-progress">Progreso: $${formatNumber(goal.currentAmount)} de $${formatNumber(goal.targetAmount)}</div>
                </div>
                <div style="font-size: 12px; color: var(--text-secondary);">${goal.deadline}</div>
                <button class="btn btn-danger" onclick="deleteGoal('${goal.id}')">Eliminar</button>
            </div>
        `;
    }).join('');
}

window.deleteGoal = async function(goalId) {
    const goal = APP.data.goals.find(g => g.id === goalId);
    if (!goal) return;

    const confirmed = confirm(`¿Eliminar la meta "${goal.name}"?`);
    if (!confirmed) return;

    APP.data.goals = APP.data.goals.filter(g => g.id !== goalId);
    renderGoalsList();
    updateDashboard();

    if (APP.isOnline && window.firebaseDB) {
        try {
            await window.firebaseDB.deleteData('goals', goalId);
        } catch (err) {
            console.error('Error deleting goal:', err);
            APP.data.goals.push(goal);
            renderGoalsList();
            updateDashboard();
            alert('⚠️ Error al eliminar: ' + err.message);
        }
    } else {
        saveOfflineData();
    }
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
    const savingRate = totalIncome > 0 ? (balance / totalIncome) * 100 : 0;

    // Update KPIs
    document.getElementById('kpi-ingresos').textContent = `$${formatNumber(totalIncome)}`;
    document.getElementById('kpi-egresos').textContent = `$${formatNumber(totalExpenses)}`;
    document.getElementById('kpi-balance').textContent = `$${formatNumber(balance)}`;
    document.getElementById('kpi-ahorro').textContent = `${savingRate.toFixed(1)}%`;

    // Update budget comparison
    updateBudgetComparison(monthTransactions);

    // Update debt card
    updateDebtCard();

    // Update savings goals
    updateSavingsGoals();

    // Update charts
    updateCharts(monthTransactions);
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
        const cat = APP.data.categories.find(c => c.id === exp.category);
        const name = cat?.name || 'Otro';
        categoryData[name] = (categoryData[name] || 0) + exp.amount;
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

    alert('✅ Reporte exportado correctamente');
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
