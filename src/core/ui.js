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

const MIN_FIT_SIZE = 10;

const textRange = document.createRange();

/** Ancho real (con decimales) del texto del elemento; `scrollWidth` redondea y no detecta desbordes de menos de 1 px. */
function textWidth(el) {
    textRange.selectNodeContents(el);
    return textRange.getBoundingClientRect().width;
}

function fitElement(el) {
    el.style.fontSize = '';
    if (!el.clientWidth) return;
    const fits = () => textWidth(el) <= el.getBoundingClientRect().width + 0.1;
    if (fits()) return;

    let low = MIN_FIT_SIZE;
    let high = parseFloat(getComputedStyle(el).fontSize);
    while (high - low > 0.5) {
        const mid = (low + high) / 2;
        el.style.fontSize = `${mid}px`;
        if (fits()) low = mid;
        else high = mid;
    }
    el.style.fontSize = `${low}px`;
}

const refit = new ResizeObserver(entries => entries.forEach(entry => fitElement(entry.target)));

/**
 * Ajusta el tamaño de letra de cada `[data-fit]` dentro de `root` para que su texto quepa en una línea
 * (mínimo 10 px), de modo que cifras largas se vean completas sin ensanchar su contenedor. Cada elemento
 * se vuelve a ajustar solo si cambia su ancho (rotar la pantalla, aparecer la barra de scroll...).
 */
export function fitText(root) {
    refit.disconnect();
    root.querySelectorAll('[data-fit]').forEach(el => {
        fitElement(el);
        refit.observe(el);
    });
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
