import { fitText } from './ui.js';

const views = new Map();
let active = null;

/**
 * Registra una vista. `feature` debe exponer `mount(contenedor)`, que construye el esqueleto una sola vez,
 * y `render()`, que se ejecuta al entrar a la vista y en cada cambio de datos.
 */
export function registerView(id, { title, feature }) {
    views.set(id, { title, feature, mounted: false });
}

function ensureMounted(id) {
    const view = views.get(id);
    if (!view.mounted) {
        view.feature.mount(document.getElementById(`view-${id}`));
        view.mounted = true;
    }
    return view;
}

export function showView(id) {
    if (!views.has(id)) return;
    active = id;

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === id));
    document.getElementById(`view-${id}`).classList.add('active');
    document.getElementById('view-title').textContent = views.get(id).title;

    ensureMounted(id).feature.render();
    fitText(document.getElementById(`view-${id}`));
}

/** Repinta sólo la vista visible. */
export function renderActive() {
    if (!active) return;
    views.get(active)?.feature.render();
    fitText(document.getElementById(`view-${active}`));
}

export function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            showView(item.dataset.view);
        });
    });
}
