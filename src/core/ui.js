import { escapeHtml } from './utils.js';

/** Encabezado de sección con el botón "Agregar" que abre el formulario modal de alta. */
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
 * Delegación de eventos: llama a `handlers[data-action](data-id, elemento)` al pulsar un
 * botón `[data-action]` dentro de `root`.
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
