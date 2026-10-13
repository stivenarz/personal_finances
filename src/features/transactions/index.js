/**
 * Vista TRANSACCIONES: todos los movimientos del mes (incluye intereses de tarjeta calculados).
 */
import { DataService } from '../../services/data-service.js';
import { allTransactions } from '../../domain/ledger.js';
import { uiState } from '../../core/state.js';
import { escapeHtml, formatNumber, formatDate } from '../../core/utils.js';
import { emptyState, onActions } from '../../core/ui.js';
import { openEditTransaction, confirmDeleteTransaction } from './forms.js';
import { categoryLabel } from '../shared/options.js';

let root;

export function mount(container) {
    root = container;
    root.innerHTML = `
        <div class="filter-controls">
            <input type="text" data-filter="search" placeholder="Buscar transacciones..." class="input-control">
            <select data-filter="type" class="input-control">
                <option value="">Todos los tipos</option>
                <option value="Ingreso">Ingresos</option>
                <option value="Egreso">Egresos</option>
                <option value="Transferencia">Transferencias</option>
                <option value="Ahorro">Ahorros</option>
            </select>
            <select data-filter="account" class="input-control"></select>
        </div>
        <div class="transactions-list" data-list></div>
    `;

    root.querySelector('[data-filter="search"]').addEventListener('input', render);
    root.querySelector('[data-filter="type"]').addEventListener('change', render);
    root.querySelector('[data-filter="account"]').addEventListener('change', render);

    onActions(root, {
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
    const accountSelect = root.querySelector('[data-filter="account"]');
    const selectedAccount = accountSelect.value;
    accountSelect.innerHTML = '<option value="">Todas las cuentas</option>' + DataService.all('accounts')
        .map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join('');
    accountSelect.value = selectedAccount;

    const search = root.querySelector('[data-filter="search"]').value.toLowerCase();
    const type = root.querySelector('[data-filter="type"]').value;
    const account = accountSelect.value;

    let transactions = allTransactions().filter(t => (t.date || '').slice(0, 7) === uiState.currentMonth);
    if (type) transactions = transactions.filter(t => t.type === type);
    if (account) transactions = transactions.filter(t => t.account === account || t.toAccount === account);
    if (search) transactions = transactions.filter(t => (t.description || t.incomeType || '').toLowerCase().includes(search));
    transactions = [...transactions].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const list = root.querySelector('[data-list]');
    if (!transactions.length) {
        list.innerHTML = emptyState('No hay movimientos en este mes');
        return;
    }

    list.innerHTML = transactions.map(t => {
        const owner = DataService.find('accounts', t.account);
        const sign = t.type === 'Ingreso' ? '+' : t.type === 'Transferencia' ? '' : '-';
        const color = t.type === 'Ingreso' ? 'var(--secondary)' : t.type === 'Transferencia' ? 'var(--text-secondary)' : 'var(--danger)';
        const rowClass = t.type === 'Ingreso' ? 'ingreso' : t.type === 'Transferencia' ? 'transferencia' : 'egreso';

        return `
            <div class="transaction-row ${rowClass}">
                <div>
                    <div class="tx-title">${escapeHtml(t.description || t.incomeType || '')}</div>
                    <div class="tx-meta">${escapeHtml(owner?.name || 'N/A')} • ${escapeHtml(categoryLabel(t))}</div>
                </div>
                <div class="tx-meta">${formatDate(t.date)}</div>
                <div class="tx-amount" style="color: ${color};">${sign}$${formatNumber(t.amount)}</div>
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
