/**
 * Vista CONFIGURACIÓN: categorías, base de datos (local / Firebase / Google Sheets)
 * y zona de peligro. (Cuentas tiene su propia vista.)
 */
import { mountCategories, renderCategories } from './categories.js';
import { mountProviderPanel } from './provider-panel.js';
import { mountDangerZone } from './danger-zone.js';

let categoriesSection;

export function mount(container) {
    container.innerHTML = `
        <div class="config-grid">
            <div class="config-section" data-section="categories"></div>
            <div class="config-section" data-section="provider"></div>
            <div class="config-section config-danger" data-section="danger"></div>
        </div>
    `;
    categoriesSection = container.querySelector('[data-section="categories"]');
    mountCategories(categoriesSection);
    mountProviderPanel(container.querySelector('[data-section="provider"]'));
    mountDangerZone(container.querySelector('[data-section="danger"]'));
}

export function render() {
    renderCategories(categoriesSection);
}
