import { DataService } from '../../services/data-service.js';
import { allTransactions } from '../../domain/ledger.js';
import { escapeHtml, formatNumber, formatDate } from '../../core/utils.js';
import { sectionToolbar, emptyState, onActions } from '../../core/ui.js';
import { openExpenseForm, openEditTransaction, confirmDeleteTransaction } from '../transactions/forms.js';
import { categoryLabel } from '../shared/options.js';

let root;

/** Vista Gastos: listado con filtros; alta y edición en modal. */
export function mount(container) {
    root = container;
    root.innerHTML = `
        <div class="list-section">
            ${sectionToolbar('Gastos registrados', { addLabel: 'Registrar gasto' })}
            <div class="filter-controls">
                <input type="text" data-filter="search" placeholder="Buscar por descripción..." class="input-control">
                <select data-filter="category" class="input-control"></select>
            </div>
            <div class="transaction-list" data-list></div>
        </div>
    `;

    root.querySelector('[data-filter="search"]').addEventListener('input', render);
    root.querySelector('[data-filter="category"]').addEventListener('change', render);

    onActions(root, {
        add: () => openExpenseForm(),
        edit: (id) => {
            const t = DataService.find('transactions', id);
            if (t) openEditTransaction(t);
        },
        delete: (id) => {
            const t = DataService.find('transactions', id);
            if (t) confirmDeleteTransaction(t);
        }
    });
}

function renderCategoryFilter() {
    const select = root.querySelector('[data-filter="category"]');
    const selected = select.value;
    select.innerHTML = '<option value="">Todas las categorías</option>' + DataService.all('categories')
        .filter(c => c.type === 'Egreso')
        .map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
    select.value = selected;
}

export function render() {
    renderCategoryFilter();
    const search = root.querySelector('[data-filter="search"]').value.toLowerCase();
    const category = root.querySelector('[data-filter="category"]').value;

    let expenses = allTransactions().filter(t => t.type === 'Egreso' && t.category !== 'Ahorros');
    if (category) expenses = expenses.filter(t => t.category === category);
    if (search) expenses = expenses.filter(t => (t.description || '').toLowerCase().includes(search));
    expenses = [...expenses].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const list = root.querySelector('[data-list]');
    if (!expenses.length) {
        list.innerHTML = emptyState('No hay gastos registrados');
        return;
    }

    list.innerHTML = expenses.map(t => {
        const account = DataService.find('accounts', t.account);
        return `
            <div class="transaction-item egreso">
                <div class="transaction-date">${formatDate(t.date)}</div>
                <div class="transaction-desc">${escapeHtml(t.description || 'Sin descripción')}</div>
                <div class="transaction-category">${escapeHtml(categoryLabel(t))} • ${escapeHtml(account?.name || 'N/A')}</div>
                <div class="transaction-amount negativo" data-fit>-$${formatNumber(t.amount)}</div>
                <div class="row-actions">
                    ${t.virtual
                        ? '<span class="badge-auto">Automático</span>'
                        : `<button class="btn btn-secondary" data-action="edit" data-id="${escapeHtml(t.id)}">Editar</button>
                           <button class="btn btn-danger" data-action="delete" data-id="${escapeHtml(t.id)}">Eliminar</button>`}
                </div>
            </div>
        `;
    }).join('');
}
