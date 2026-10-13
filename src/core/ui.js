/**
 * Piezas de UI reutilizables entre vistas.
 */
import { escapeHtml } from './utils.js';

/** Encabezado de sección con botón "Agregar" (los alta se hacen siempre en modal). */
export function sectionToolbar(title, { addLabel = 'Agregar', action = 'add' } = {}) {
    return `
        <div class="section-toolbar">
            <h3>${escapeHtml(title)}</h3>
            <button type="button" class="btn btn-primary" data-action="${action}">➕ ${escapeHtml(addLabel)}</button>
        </div>
    `;
}

export function emptyState(message) {
    return `<p class="empty-state">${escapeHtml(message)}</p>`;
}

/**
 * Delegación de eventos para botones con data-action / data-id dentro de `root`.
 * handlers: { edit: (id) => ..., delete: (id) => ... }
 */
export function onActions(root, handlers) {
    root.addEventListener('click', (event) => {
        const target = event.target.closest('[data-action]');
        if (!target || !root.contains(target)) return;
        const handler = handlers[target.dataset.action];
        if (handler) {
            event.preventDefault();
            handler(target.dataset.id, target);
        }
    });
}
