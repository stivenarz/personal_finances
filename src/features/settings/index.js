/**
 * Vista CONFIGURACIÓN: apariencia (claro / oscuro / automático), base de datos
 * (local / Firebase / Google Sheets) y zona de peligro.
 * (Cuentas y Categorías tienen su propia vista.)
 */
import { mountAppearance } from './appearance.js';
import { mountProviderPanel } from './provider-panel.js';
import { mountDangerZone } from './danger-zone.js';

export function mount(container) {
    container.innerHTML = `
        <div class="config-grid">
            <div class="config-section" data-section="appearance"></div>
            <div class="config-section" data-section="provider"></div>
            <div class="config-section config-danger" data-section="danger"></div>
        </div>
    `;
    mountAppearance(container.querySelector('[data-section="appearance"]'));
    mountProviderPanel(container.querySelector('[data-section="provider"]'));
    mountDangerZone(container.querySelector('[data-section="danger"]'));
}

export function render() {
    // Sin datos que repintar: la configuración es estática
}
