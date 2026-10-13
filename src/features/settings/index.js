import { mountAppearance } from './appearance.js';
import { mountProviderPanel } from './provider-panel.js';
import { mountDangerZone } from './danger-zone.js';

/** Vista Configuración: apariencia, base de datos y zona de peligro. */
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
}
