import { DataService } from '../../services/data-service.js';
import { escapeHtml, formatNumber, formatDate } from '../../core/utils.js';
import { sectionToolbar, emptyState, onActions } from '../../core/ui.js';
import { openIncomeForm, openEditTransaction, confirmDeleteTransaction } from '../transactions/forms.js';

let root;

/** Vista Ingresos: listado con filtros; alta y edición en modal. Sólo los ingresos registrados manualmente cuentan como reales. */
export function mount(container) {
    root = container;
    root.innerHTML = `
        <div class="list-section">
            ${sectionToolbar('Ingresos registrados', { addLabel: 'Registrar ingreso' })}
            <div class="filter-controls">
                <input type="text" data-filter="search" placeholder="Buscar por descripción..." class="input-control">
                <select data-filter="type" class="input-control"></select>
            </div>
            <div class="transaction-list" data-list></div>
        </div>
    `;

    root.querySelector('[data-filter="search"]').addEventListener('input', render);
    root.querySelector('[data-filter="type"]').addEventListener('change', render);

    onActions(root, {
        add: () => openIncomeForm(),
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

export function render() {
    const incomes = DataService.all('transactions').filter(t => t.type === 'Ingreso');

    const typeSelect = root.querySelector('[data-filter="type"]');
    const selected = typeSelect.value;
    const types = [...new Set(incomes.map(t => t.incomeType).filter(Boolean))];
    typeSelect.innerHTML = '<option value="">Todos los tipos</option>' +
        types.map(type => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join('');
    typeSelect.value = selected;

    const search = root.querySelector('[data-filter="search"]').value.toLowerCase();
    let filtered = incomes;
    if (typeSelect.value) filtered = filtered.filter(t => t.incomeType === typeSelect.value);
    if (search) filtered = filtered.filter(t => (t.description || '').toLowerCase().includes(search));
    filtered = [...filtered].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const list = root.querySelector('[data-list]');
    if (!filtered.length) {
        list.innerHTML = emptyState('No hay ingresos registrados');
        return;
    }

    list.innerHTML = filtered.map(t => {
        const account = DataService.find('accounts', t.account);
        return `
            <div class="transaction-item ingreso">
                <div class="transaction-date">${formatDate(t.date)}</div>
                <div class="transaction-desc">${escapeHtml(t.description || '')}</div>
                <div class="transaction-category">${escapeHtml(t.incomeType || t.category || '')} • ${escapeHtml(account?.name || 'N/A')}</div>
                <div class="transaction-amount positivo">+$${formatNumber(t.amount)}</div>
                <div class="row-actions">
                    <button class="btn btn-secondary" data-action="edit" data-id="${escapeHtml(t.id)}">Editar</button>
                    <button class="btn btn-danger" data-action="delete" data-id="${escapeHtml(t.id)}">Eliminar</button>
                </div>
            </div>
        `;
    }).join('');
}
