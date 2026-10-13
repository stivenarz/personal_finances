/**
 * Formularios modales de movimientos (alta y edición).
 * Son los únicos formularios para crear/editar gastos, ingresos y pagos.
 */
import { openFormModal, confirmDialog } from '../../core/modal.js';
import { showNotification } from '../../core/notifications.js';
import { todayStr, formatMoney } from '../../core/utils.js';
import { isCreditCard } from '../../domain/ledger.js';
import {
    createExpense, createIncome, describeTransaction, updateTransaction, deleteTransaction
} from '../../domain/transactions.js';
import { accountOptions, categoryOptions, INCOME_TYPES } from '../shared/options.js';

const result = (outcome) => (outcome.error ? outcome.error : null);

export function openExpenseForm({ transaction = null, accountId = '' } = {}) {
    const editing = !!transaction;
    openFormModal({
        title: editing ? 'Editar gasto' : 'Registrar gasto',
        submitLabel: editing ? 'Guardar cambios' : 'Registrar gasto',
        successMessage: editing ? '✅ Cambios guardados' : '✅ Gasto registrado',
        fields: [
            { name: 'date', label: 'Fecha', type: 'date', value: transaction?.date || todayStr() },
            { name: 'category', label: 'Categoría', type: 'select', value: transaction?.category || '', options: categoryOptions('Egreso') },
            { name: 'description', label: 'Descripción', type: 'text', required: false, value: transaction?.description || '', placeholder: 'Ej: Mercado Éxito' },
            { name: 'amount', label: 'Monto ($)', type: 'number', min: 0, value: transaction?.amount ?? '' },
            {
                name: 'account', label: 'Cuenta o tarjeta de pago', type: 'select',
                value: transaction?.account || accountId,
                options: accountOptions()
            }
        ],
        onSubmit: (v) => {
            if (!v.account) return '❌ Selecciona una cuenta';
            if (editing) {
                return result(updateTransaction(transaction, {
                    date: v.date, category: v.category, description: v.description, amount: v.amount, account: v.account
                }));
            }
            return result(createExpense({ ...v }));
        }
    });
}

export function openIncomeForm({ transaction = null } = {}) {
    const editing = !!transaction;
    openFormModal({
        title: editing ? 'Editar ingreso' : 'Registrar ingreso',
        submitLabel: editing ? 'Guardar cambios' : 'Registrar ingreso',
        successMessage: editing ? '✅ Cambios guardados' : '✅ Ingreso registrado',
        fields: [
            { name: 'date', label: 'Fecha', type: 'date', value: transaction?.date || todayStr() },
            { name: 'incomeType', label: 'Tipo de ingreso', type: 'select', value: transaction?.incomeType || '', options: [{ value: '', label: 'Seleccionar tipo' }, ...INCOME_TYPES] },
            { name: 'description', label: 'Descripción', type: 'text', value: transaction?.description || '', placeholder: 'Ej: Nómina' },
            { name: 'amount', label: 'Monto ($)', type: 'number', min: 0, value: transaction?.amount ?? '' },
            {
                name: 'account', label: 'Cuenta destino', type: 'select', value: transaction?.account || '',
                options: accountOptions({ filter: a => !isCreditCard(a) })
            }
        ],
        onSubmit: (v) => {
            if (!v.incomeType) return '❌ Selecciona el tipo de ingreso';
            if (!v.account) return '❌ Selecciona una cuenta';
            if (editing) {
                return result(updateTransaction(transaction, {
                    date: v.date, incomeType: v.incomeType, description: v.description, amount: v.amount, account: v.account
                }));
            }
            return result(createIncome({ ...v }));
        }
    });
}

/** Edita cualquier movimiento respetando lo que puede cambiarse según su tipo. */
export function openEditTransaction(transaction) {
    const { isDebtPayment, isGoalMovement, isTransfer, isSystem } = describeTransaction(transaction);

    if (isSystem) {
        showNotification('Los intereses de tarjeta se calculan automáticamente y no se editan', 'info');
        return;
    }
    if (transaction.type === 'Egreso' && !isDebtPayment) return openExpenseForm({ transaction });
    if (transaction.type === 'Ingreso' && !isGoalMovement) return openIncomeForm({ transaction });

    const date = { name: 'date', label: 'Fecha', type: 'date', value: transaction.date };
    const amount = (disabled = false) => ({ name: 'amount', label: 'Monto', type: 'number', min: 0, value: transaction.amount, disabled });
    const description = (disabled) => ({
        name: 'description', label: 'Descripción', type: 'text', value: transaction.description || '', disabled
    });

    let fields;
    let note = '';
    let hasAccount = true;

    if (isTransfer) {
        hasAccount = false;
        const editable = !!transaction.toAccount;
        note = editable ? '' : 'Transferencia anterior: sólo se puede editar la fecha.';
        fields = [date, description(!editable), amount(!editable)];
    } else {
        note = isGoalMovement
            ? 'Los movimientos de metas se vinculan a su meta: sólo se pueden cambiar la fecha, el monto y la cuenta.'
            : 'Los pagos de deuda se vinculan a su deuda: sólo se pueden cambiar la fecha, el monto y la cuenta.';
        fields = [date, description(true), amount(), {
            name: 'account', label: 'Cuenta', type: 'select', value: transaction.account,
            options: accountOptions({ filter: a => !isCreditCard(a), placeholder: '' })
        }];
    }

    openFormModal({
        title: 'Editar movimiento',
        note,
        fields,
        successMessage: '✅ Cambios guardados',
        onSubmit: (v) => {
            const values = { date: v.date, amount: v.amount };
            if (hasAccount) values.account = v.account;
            if (isTransfer && transaction.toAccount) values.description = v.description;
            return result(updateTransaction(transaction, values));
        }
    });
}

export async function confirmDeleteTransaction(transaction) {
    if (transaction.virtual) {
        showNotification('Los intereses de tarjeta se calculan automáticamente y no se eliminan', 'info');
        return false;
    }
    const kind = transaction.type === 'Ingreso' ? 'ingreso' : transaction.type === 'Transferencia' ? 'transferencia' : 'gasto';
    const ok = await confirmDialog({
        title: `Eliminar ${kind}`,
        message: `¿Eliminar "${transaction.description || transaction.incomeType || kind}" por ${formatMoney(transaction.amount)}? Los saldos se recalcularán.`,
        confirmLabel: 'Eliminar',
        danger: true
    });
    if (!ok) return false;
    const outcome = deleteTransaction(transaction);
    if (outcome.error) {
        showNotification(outcome.error, 'error');
        return false;
    }
    showNotification('🗑️ Movimiento eliminado', 'success');
    return true;
}

