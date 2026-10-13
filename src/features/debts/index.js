import { DataService } from '../../services/data-service.js';
import { openFormModal, confirmDialog } from '../../core/modal.js';
import { showNotification } from '../../core/notifications.js';
import { escapeHtml, formatNumber, formatMoney, money, todayStr, uid } from '../../core/utils.js';
import { sectionToolbar, emptyState, onActions } from '../../core/ui.js';
import {
    debtBalance, debtPaid, debtInterestAccrued, debtInterestPaid, debtMonthlyPayment, debtMonthsLeft,
    debtProgress, isCreditCard
} from '../../domain/ledger.js';
import { createDebtPayment } from '../../domain/transactions.js';
import { accountOptions } from '../shared/options.js';

let root;

/** Vista Deudas: saldo con intereses, cuota sugerida calculada, pagos y progreso. */
export function mount(container) {
    root = container;
    root.innerHTML = `
        <div class="list-section">
            ${sectionToolbar('Deudas activas', { addLabel: 'Registrar deuda' })}
            <div class="debt-details-container" data-list></div>
        </div>
    `;

    onActions(root, {
        add: () => openDebtForm(),
        edit: (id) => openDebtForm(DataService.find('debts', id)),
        pay: (id) => openPaymentForm(DataService.find('debts', id)),
        delete: (id) => deleteDebt(DataService.find('debts', id))
    });
}

function debtFields(debt) {
    const balance = debt ? debtBalance(debt) : '';
    return [
        { name: 'entity', label: 'Entidad / Acreedor', type: 'text', value: debt?.entity || '', placeholder: 'Ej: Préstamo Bancolombia' },
        { name: 'holder', label: 'Titular', type: 'text', value: debt?.holder || '', placeholder: 'Nombre' },
        { name: 'balance', label: debt ? 'Saldo actual ($)' : 'Saldo de la deuda ($)', type: 'number', min: 0, value: balance },
        { name: 'interestRate', label: 'Tasa de interés anual (%) — opcional', type: 'number', min: 0, required: false, value: debt?.interestRate || '' },
        { name: 'termMonths', label: 'Plazo en meses — opcional', type: 'number', min: 1, step: 1, required: false, value: debt?.termMonths || '' },
        {
            name: 'monthlyPayment', label: 'Cuota mensual manual ($) — solo si no hay plazo', type: 'number', min: 0, required: false,
            value: debt?.termMonths ? '' : debt?.monthlyPayment || '',
            hint: 'Con plazo, la cuota se calcula sola según el saldo pendiente, tus abonos y la tasa.'
        },
        { name: 'paymentDay', label: 'Día de pago (1-31)', type: 'number', min: 1, max: 31, step: 1, required: false, value: debt?.paymentDay || '' }
    ];
}

function openDebtForm(debt = null) {
    openFormModal({
        title: debt ? 'Editar deuda' : 'Registrar deuda',
        note: debt ? 'El saldo se calcula con los pagos registrados; aquí puedes corregirlo si hace falta.' : '',
        submitLabel: debt ? 'Guardar cambios' : 'Registrar deuda',
        successMessage: debt ? '✅ Cambios guardados' : '✅ Deuda registrada',
        fields: debtFields(debt),
        onSubmit: (v) => {
            const entity = v.entity.trim();
            if (!entity) return '❌ La entidad no puede estar vacía';
            if (!(v.balance >= 0)) return '❌ El saldo no puede ser negativo';

            const interestRate = v.interestRate || 0;
            const termMonths = v.termMonths || 0;
            const manualPayment = v.monthlyPayment || 0;
            if (!termMonths && !(manualPayment > 0)) return '❌ Indica el plazo en meses (la cuota se calcula sola) o una cuota mensual manual';
            const paymentDay = v.paymentDay ? Math.min(31, Math.max(1, Math.round(v.paymentDay))) : 1;

            const fields = {
                entity, holder: v.holder.trim(), interestRate, termMonths,
                monthlyPayment: termMonths ? 0 : money(manualPayment), paymentDay
            };

            if (debt) {
                const base = debt.baseBalance ?? (debtBalance(debt) + debtPaid(debt));
                DataService.patch('debts', debt.id, { ...fields, baseBalance: money(base + (v.balance - debtBalance(debt))) });
            } else {
                const today = todayStr();
                DataService.save('debts', {
                    id: uid('debt'), ...fields, baseBalance: money(v.balance),
                    createdAt: Date.now(), startDate: today, interestFrom: today
                });
            }
            return null;
        }
    });
}

function openPaymentForm(debt) {
    if (!debt) return;
    const balance = debtBalance(debt);
    const suggested = debtMonthlyPayment(debt);
    const interest = debtInterestAccrued(debt);
    openFormModal({
        title: 'Registrar pago de deuda',
        note: `<strong>${escapeHtml(debt.entity)}</strong><br>Saldo pendiente: ${formatMoney(balance)}`
            + (interest > 0 ? ` (incluye ${formatMoney(interest)} de intereses causados)` : '')
            + `<br>Cuota sugerida: ${formatMoney(suggested)}<br><small>El pago cubre primero los intereses y el resto abona a capital; la cuota se recalcula con el nuevo saldo.</small>`,
        submitLabel: 'Registrar pago',
        successMessage: '✅ Pago registrado correctamente',
        fields: [
            { name: 'account', label: 'Cuenta de pago', type: 'select', value: '', options: accountOptions({ filter: a => !isCreditCard(a) }) },
            { name: 'amount', label: 'Monto a pagar ($)', type: 'number', min: 0, value: suggested || balance },
            { name: 'date', label: 'Fecha', type: 'date', value: todayStr() }
        ],
        onSubmit: (v) => {
            if (!v.account) return '❌ Selecciona una cuenta';
            return createDebtPayment({ debtId: debt.id, account: v.account, amount: v.amount, date: v.date }).error || null;
        }
    });
}

async function deleteDebt(debt) {
    if (!debt) return;
    const balance = debtBalance(debt);
    const ok = await confirmDialog({
        title: 'Eliminar deuda',
        message: balance > 0
            ? `La deuda "${escapeHtml(debt.entity)}" aún tiene un saldo de ${formatMoney(balance)}. ¿Eliminarla de todos modos?`
            : `¿Eliminar la deuda "${escapeHtml(debt.entity)}"?`,
        confirmLabel: 'Eliminar',
        danger: true
    });
    if (!ok) return;
    DataService.remove('debts', debt.id);
    showNotification('🗑️ Deuda eliminada', 'success');
}

export function render() {
    const list = root.querySelector('[data-list]');
    const debts = DataService.all('debts');
    if (!debts.length) {
        list.innerHTML = emptyState('No hay deudas registradas');
        return;
    }

    list.innerHTML = debts.map(debt => {
        const balance = debtBalance(debt);
        const progress = debtProgress(debt);
        const monthsLeft = debtMonthsLeft(debt);
        const interest = debtInterestAccrued(debt);

        let statusClass = '';
        let statusText = monthsLeft === null ? 'Sin estimar' : `${monthsLeft} meses`;
        if (balance <= 0) statusText = 'Pagada';
        else if (monthsLeft !== null && monthsLeft <= 1) { statusClass = 'urgent'; statusText = 'Último pago'; }
        else if (monthsLeft !== null && monthsLeft <= 3) statusClass = 'alert';

        return `
            <div class="debt-detail-card">
                <div class="debt-detail-header">
                    <div>
                        <div class="debt-detail-name">${escapeHtml(debt.entity)}</div>
                        <div class="debt-detail-info">Titular: ${escapeHtml(debt.holder || '—')}</div>
                    </div>
                    <span class="debt-item-status ${statusClass}">${statusText}</span>
                </div>
                <div class="debt-detail-info"><strong>Saldo actual:</strong> $${formatNumber(balance)}</div>
                <div class="debt-progress">
                    <div class="debt-progress-bar"><div class="debt-progress-fill" style="width: ${Math.min(Math.max(progress, 0), 100)}%"></div></div>
                    <div class="debt-progress-text">${Math.round(progress)}% pagado</div>
                </div>
                <div class="debt-detail-info"><strong>Cuota sugerida:</strong> $${formatNumber(debtMonthlyPayment(debt))}${debt.termMonths ? ' <small>(calculada)</small>' : ''}</div>
                ${debt.interestRate > 0 ? `<div class="debt-detail-info"><strong>Tasa:</strong> ${debt.interestRate}% anual · intereses causados $${formatNumber(interest)} · pagados $${formatNumber(debtInterestPaid(debt))}</div>` : ''}
                <div class="debt-actions">
                    <button class="btn btn-primary" data-action="pay" data-id="${escapeHtml(debt.id)}" ${balance <= 0 ? 'disabled' : ''}>Registrar pago</button>
                    <button class="btn btn-secondary" data-action="edit" data-id="${escapeHtml(debt.id)}">Editar</button>
                    <button class="btn btn-danger" data-action="delete" data-id="${escapeHtml(debt.id)}">Eliminar</button>
                </div>
            </div>
        `;
    }).join('');
}
