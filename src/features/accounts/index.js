/**
 * Vista CUENTAS (componente independiente): cuentas bancarias, efectivo, ahorros
 * y tarjetas de crédito. Los saldos y el estado de las tarjetas se calculan.
 */
import { DataService } from '../../services/data-service.js';
import { escapeHtml, formatMoney, formatDate } from '../../core/utils.js';
import { sectionToolbar, emptyState, onActions } from '../../core/ui.js';
import { accountBalance, creditCardInfo, isCreditCard, totalAvailable, totalCreditDebt } from '../../domain/ledger.js';
import { openExpenseForm } from '../transactions/forms.js';
import { openAccountForm, openTransferForm, startAccountDeletion } from './forms.js';

let root;

export function mount(container) {
    root = container;
    root.innerHTML = `
        <div class="kpi-container accounts-kpis">
            <div class="kpi-card" style="border-left-color: #8b5cf6;">
                <div class="kpi-icon">🏦</div>
                <div class="kpi-content"><div class="kpi-label">Saldo en cuentas</div><div class="kpi-value" data-kpi="available">$0</div></div>
            </div>
            <div class="kpi-card" style="border-left-color: #ef4444;">
                <div class="kpi-icon">💳</div>
                <div class="kpi-content"><div class="kpi-label">Deuda en tarjetas</div><div class="kpi-value" data-kpi="debt">$0</div></div>
            </div>
        </div>
        <div class="list-section">
            ${sectionToolbar('Mis cuentas y tarjetas', { addLabel: 'Agregar cuenta' })}
            <div class="accounts-list" data-list></div>
        </div>
    `;

    const byId = (id) => DataService.find('accounts', id);
    onActions(root, {
        add: () => openAccountForm(),
        edit: (id) => openAccountForm(byId(id)),
        transfer: (id) => openTransferForm({ fromId: id }),
        'pay-card': (id) => openTransferForm({ toId: id }),
        'card-expense': (id) => openExpenseForm({ accountId: id }),
        delete: (id) => startAccountDeletion(byId(id))
    });
}

function rateText(rate) {
    if (rate.type === 'anual') {
        return `${rate.value}% E.A. (≈ ${(rate.monthly * 100).toFixed(2)}% mensual)`;
    }
    return `${rate.value}% mensual nominal`;
}

function renderCard(account) {
    const info = creditCardInfo(account.id);
    const id = escapeHtml(account.id);
    const dueText = info.daysToDue === 0 ? 'hoy' : info.daysToDue === 1 ? 'mañana' : `en ${info.daysToDue} días`;
    const urgent = info.owed > 0 && info.daysToDue <= 3;

    return `
        <div class="account-item credit-card">
            <div class="account-main">
                <div>
                    <div class="account-name">💳 ${escapeHtml(account.name)}</div>
                    <div class="account-type">Tarjeta de crédito</div>
                </div>
                <div class="account-balance ${info.owed > 0 ? 'negative' : ''}">${info.owed > 0 ? '-' : ''}${formatMoney(info.owed).replace('-', '')}</div>
            </div>
            <div class="cc-usage" title="Cupo utilizado">
                <div class="cc-usage-bar"><div class="cc-usage-fill ${info.usage > 85 ? 'high' : ''}" style="width: ${info.usage}%"></div></div>
                <div class="cc-usage-legend">
                    <span>Usado ${formatMoney(info.owed)}</span>
                    <span>Disponible ${formatMoney(info.available)}</span>
                    <span>Cupo ${formatMoney(info.limit)}</span>
                </div>
            </div>
            <dl class="cc-details">
                <div><dt>Tasa</dt><dd>${rateText(info.rate)}</dd></div>
                <div><dt>Corte</dt><dd>Día ${info.cutoffDay} · próximo ${formatDate(info.nextCutoff)}</dd></div>
                <div class="${urgent ? 'urgent' : ''}"><dt>Fecha de pago</dt><dd>${formatDate(info.dueDate)} (${dueText})</dd></div>
                ${info.statementClosed && info.owed > 0
                    ? `<div><dt>Para no pagar intereses</dt><dd>${formatMoney(info.amountToAvoidInterest)}${info.estimatedInterest > 0 ? ` · si no pagas: +${formatMoney(info.estimatedInterest)}` : ''}</dd></div>`
                    : ''}
                <div><dt>Intereses cargados</dt><dd>${formatMoney(info.interestCharged)}</dd></div>
            </dl>
            <div class="row-actions">
                <button class="btn btn-secondary btn-sm" data-action="edit" data-id="${id}">✏️ Editar</button>
                <button class="btn btn-secondary btn-sm" data-action="card-expense" data-id="${id}">🛒 Gasto</button>
                <button class="btn btn-primary btn-sm" data-action="pay-card" data-id="${id}" ${info.owed <= 0 ? 'disabled' : ''}>💸 Pagar tarjeta</button>
                <button class="btn btn-danger btn-sm" data-action="delete" data-id="${id}">🗑️ Eliminar</button>
            </div>
        </div>
    `;
}

function renderAccount(account) {
    const balance = accountBalance(account.id);
    const id = escapeHtml(account.id);
    return `
        <div class="account-item">
            <div class="account-main">
                <div>
                    <div class="account-name">${escapeHtml(account.name)}</div>
                    <div class="account-type">${escapeHtml(account.type)}</div>
                </div>
                <div class="account-balance ${balance < 0 ? 'negative' : ''}">${formatMoney(balance)}</div>
            </div>
            <div class="row-actions">
                <button class="btn btn-secondary btn-sm" data-action="edit" data-id="${id}">✏️ Editar</button>
                <button class="btn btn-primary btn-sm" data-action="transfer" data-id="${id}">💸 Transferir</button>
                <button class="btn btn-danger btn-sm" data-action="delete" data-id="${id}">🗑️ Eliminar</button>
            </div>
        </div>
    `;
}

export function render() {
    root.querySelector('[data-kpi="available"]').textContent = formatMoney(totalAvailable());
    root.querySelector('[data-kpi="debt"]').textContent = formatMoney(totalCreditDebt());

    const accounts = DataService.all('accounts');
    const list = root.querySelector('[data-list]');
    if (!accounts.length) {
        list.innerHTML = emptyState('Aún no tienes cuentas. Agrega la primera para empezar a registrar movimientos.');
        return;
    }
    list.innerHTML = accounts.map(a => (isCreditCard(a) ? renderCard(a) : renderAccount(a))).join('');
}
