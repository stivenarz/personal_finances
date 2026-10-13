import { DataService } from '../../services/data-service.js';
import { PROVIDERS, SHEETS_URL_PATTERN, getConfig, saveConfig } from '../../services/config-service.js';
import { showNotification } from '../../core/notifications.js';
import { escapeHtml } from '../../core/utils.js';

const FIREBASE_FIELDS = [
    { key: 'apiKey', label: 'API Key', placeholder: 'AIzaSy...' },
    { key: 'projectId', label: 'Project ID', placeholder: 'tu-proyecto-id' },
    { key: 'authDomain', label: 'Auth Domain', placeholder: 'tu-proyecto.firebaseapp.com' },
    { key: 'storageBucket', label: 'Storage Bucket', placeholder: 'tu-proyecto.firebasestorage.app', required: false },
    { key: 'messagingSenderId', label: 'Messaging Sender ID', placeholder: '123456789', required: false },
    { key: 'appId', label: 'App ID', placeholder: '1:123456789:web:abc123def456', required: false }
];

let section;

/**
 * Panel de base de datos: Solo local, Firebase o Google Sheets. Sólo se muestra el formulario del proveedor elegido;
 * al guardar, la configuración se persiste en el dispositivo y la app se recarga para conectar.
 */
export function mountProviderPanel(container) {
    section = container;
    const config = getConfig();

    section.innerHTML = `
        <h3>☁️ Base de datos y sincronización</h3>

        <div class="sync-box">
            <div class="sync-box-info">
                <strong>Estado</strong>
                <span class="sync-badge" data-sync-badge>Cargando...</span>
                <small data-sync-extra>Los datos siempre se guardan en este dispositivo y se sincronizan con la nube si hay una configurada.</small>
            </div>
            <button type="button" class="btn btn-secondary" data-action="sync">🔄 Sincronizar</button>
        </div>

        <div class="form-group">
            <label for="provider-select">Dónde guardar tus datos</label>
            <select id="provider-select">
                ${Object.values(PROVIDERS).map(p => `<option value="${p.id}" ${p.id === config.provider ? 'selected' : ''}>${escapeHtml(p.label)}</option>`).join('')}
            </select>
        </div>

        <div data-panel="local" class="provider-panel">
            <p class="provider-help">Los datos viven sólo en este dispositivo. No necesitas configurar nada.</p>
            <button type="button" class="btn btn-primary" data-action="save-local">Usar solo almacenamiento local</button>
        </div>

        <form data-panel="firebase" class="provider-panel form-container" novalidate>
            ${FIREBASE_FIELDS.map(f => `
                <div class="form-group">
                    <label>${f.label}</label>
                    <input type="text" name="${f.key}" placeholder="${f.placeholder}" value="${escapeHtml(config.firebase[f.key] || '')}" autocomplete="off">
                </div>`).join('')}
            <small class="provider-help">Obtén estos valores en Firebase Console → Configuración del proyecto.</small>
            <div class="provider-actions">
                <button type="submit" class="btn btn-primary">Guardar y conectar</button>
                <button type="button" class="btn btn-secondary" data-action="test-firebase">Probar conexión</button>
                <a class="btn btn-secondary" href="docs/firebase-guide.html" target="_blank" rel="noopener">📖 Guía Firebase</a>
            </div>
        </form>

        <form data-panel="sheets" class="provider-panel form-container" novalidate>
            <div class="form-group">
                <label>URL de la aplicación web (Apps Script)</label>
                <input type="url" name="url" placeholder="https://script.google.com/macros/s/.../exec" value="${escapeHtml(config.sheets.url || '')}" autocomplete="off">
            </div>
            <small class="provider-help">Es la URL que obtienes al desplegar el script como "Aplicación web".</small>
            <div class="provider-actions">
                <button type="submit" class="btn btn-primary">Guardar y conectar</button>
                <button type="button" class="btn btn-secondary" data-action="test-sheets">Probar conexión</button>
                <a class="btn btn-secondary" href="docs/google-sheets-guide.html" target="_blank" rel="noopener">📖 Guía Google Sheets</a>
            </div>
        </form>

        <div class="provider-status" data-status hidden></div>
    `;

    const select = section.querySelector('#provider-select');
    select.addEventListener('change', updatePanels);
    updatePanels();

    section.querySelector('[data-action="sync"]').addEventListener('click', onSync);
    section.querySelector('[data-action="save-local"]').addEventListener('click', () => commit({ provider: 'local' }));
    section.querySelector('[data-action="test-firebase"]').addEventListener('click', () => runTest('firebase'));
    section.querySelector('[data-action="test-sheets"]').addEventListener('click', () => runTest('sheets'));

    section.querySelector('form[data-panel="firebase"]').addEventListener('submit', (e) => {
        e.preventDefault();
        const values = readForm(e.currentTarget);
        if (!values.apiKey || !values.projectId || !values.authDomain) {
            showStatus('Completa API Key, Project ID y Auth Domain', 'error');
            return;
        }
        commit({ provider: 'firebase', firebase: values });
    });

    section.querySelector('form[data-panel="sheets"]').addEventListener('submit', (e) => {
        e.preventDefault();
        const { url } = readForm(e.currentTarget);
        if (!SHEETS_URL_PATTERN.test(url)) {
            showStatus('Debe ser la URL de una aplicación web de Google Apps Script (https://script.google.com/...)', 'error');
            return;
        }
        commit({ provider: 'sheets', sheets: { url } });
    });

    renderSyncStatus(DataService.getStatus());
}

function readForm(form) {
    return Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, String(v).trim()]));
}

function updatePanels() {
    const selected = section.querySelector('#provider-select').value;
    section.querySelectorAll('[data-panel]').forEach(panel => {
        panel.hidden = panel.dataset.panel !== selected;
    });
}

function showStatus(message, type) {
    const box = section.querySelector('[data-status]');
    box.hidden = false;
    box.textContent = message;
    box.className = `provider-status ${type}`;
}

function commit(partial) {
    saveConfig(partial);
    showStatus('Configuración guardada. Reconectando...', 'success');
    setTimeout(() => location.reload(), 700);
}

async function runTest(name) {
    const form = section.querySelector(`form[data-panel="${name}"]`);
    const values = readForm(form);
    showStatus('Probando conexión...', 'success');
    const result = await DataService.testConnection(name, values);
    showStatus(result.message, result.success ? 'success' : 'error');
}

async function onSync(event) {
    const button = event.currentTarget;
    button.disabled = true;
    const result = await DataService.sync();
    button.disabled = false;
    showNotification(result.success ? '✅ Sincronizado con la nube' : `⚠️ ${result.message}`, result.success ? 'success' : 'warning');
}

const STATE_LABELS = {
    local: { text: 'Solo local', cls: 'local' },
    connecting: { text: 'Conectando…', cls: 'syncing' },
    syncing: { text: 'Sincronizando…', cls: 'syncing' },
    synced: { text: 'Conectado y sincronizado', cls: 'synced' },
    offline: { text: 'Sin conexión · cambios pendientes', cls: 'offline' },
    error: { text: 'Error de sincronización', cls: 'error' }
};

/** Actualiza todas las insignias de estado (sidebar y panel). */
export function renderSyncStatus(status) {
    const { text, cls } = STATE_LABELS[status.state] || STATE_LABELS.local;
    const providerLabel = status.provider === 'firebase' ? 'Firebase' : status.provider === 'sheets' ? 'Google Sheets' : '';
    document.querySelectorAll('[data-sync-badge]').forEach(badge => {
        badge.textContent = providerLabel && status.state !== 'local' ? `${providerLabel} · ${text}` : text;
        badge.className = `sync-badge sync-${cls}`;
        badge.title = status.error || '';
    });

    const extra = document.querySelector('[data-sync-extra]');
    if (extra) {
        const parts = [];
        if (status.pending) parts.push(`${status.pending} cambio(s) pendiente(s) de enviar`);
        if (status.lastSync) parts.push(`Última sincronización: ${new Date(status.lastSync).toLocaleTimeString()}`);
        if (status.error) parts.push(status.error);
        extra.textContent = parts.join(' · ') || 'Los datos siempre se guardan en este dispositivo y se sincronizan con la nube si hay una configurada.';
    }
}
