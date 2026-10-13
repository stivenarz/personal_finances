/**
 * Router de vistas. Cada vista es un "feature" con { mount(root), render() }:
 *  - mount se ejecuta una vez y construye el esqueleto (HTML + eventos).
 *  - render se ejecuta al entrar a la vista y cada vez que cambian los datos.
 */
const views = new Map();
let active = null;

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

    const view = ensureMounted(id);
    view.feature.render();
}

export function renderActive() {
    if (!active) return;
    views.get(active)?.feature.render();
}

export function currentView() {
    return active;
}

export function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            showView(item.dataset.view);
        });
    });
}
