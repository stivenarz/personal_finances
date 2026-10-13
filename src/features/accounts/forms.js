import { openFormModal, confirmDialog } from '../../core/modal.js';
import { showNotification } from '../../core/notifications.js';
import { escapeHtml, formatMoney, formatDate, todayStr } from '../../core/utils.js';
import { DataService } from '../../services/data-service.js';
import { ACCOUNT_TYPES, CREDIT_TYPE, accountBalance, creditCardInfo, isCreditCard } from '../../domain/ledger.js';
import { createAccount, updateAccount, checkAccountDeletion, deleteAccount } from '../../domain/accounts.js';
import { createTransfer } from '../../domain/transactions.js';
import { accountOptions } from '../shared/options.js';

const isCard = (values) => values.type === CREDIT_TYPE;

/** Formulario modal de cuenta: alta, o edición si se pasa `account`. Los campos de tarjeta sólo aparecen para tarjetas de crédito. */
export function openAccountForm(account = null) {
    const editing = !!account;
    const card = editing && isCreditCard(account);
    const rate = card ? (account.rateHistory?.length
        ? [...account.rateHistory].sort((a, b) => a.from.localeCompare(b.from)).at(-1)
        : { rate: account.interestRate, rateType: account.rateType })
        : { rate: '', rateType: 'mensual' };

    openFormModal({
        title: editing ? 'Editar cuenta' : 'Agregar cuenta',
        note: editing
            ? 'El saldo = saldo inicial + movimientos. Si lo corriges aquí, todo se recalcula en todos tus dispositivos.'
            : '',
        submitLabel: editing ? 'Guardar cambios' : 'Agregar cuenta',
        successMessage: editing ? '✅ Cuenta actualizada' : '✅ Cuenta agregada',
        fields: [
            { name: 'name', label: 'Nombre', type: 'text', value: account?.name || '', placeholder: 'Ej: Ahorros Bancolombia' },
            {
                name: 'type', label: 'Tipo', type: 'select', value: account?.type || 'Corriente', disabled: editing,
                options: ACCOUNT_TYPES.map(t => ({ value: t, label: t === CREDIT_TYPE ? 'Tarjeta de Crédito' : t }))
            },
            {
                name: 'initialBalance', label: 'Saldo inicial ($)', type: 'number', value: editing && !card ? account.initialBalance ?? 0 : 0,
                visibleIf: v => !isCard(v), hint: 'Dinero que ya tenías en la cuenta antes de registrar movimientos.'
            },
            { name: 'creditLimit', label: 'Cupo total ($)', type: 'number', min: 0, value: card ? account.creditLimit : '', visibleIf: isCard },
            {
                name: 'usedCredit', label: 'Cupo ya utilizado hoy ($)', type: 'number', value: card ? -(account.initialBalance || 0) : 0,
                visibleIf: isCard, hint: 'Deuda con la que empiezas a registrar esta tarjeta (0 si está en cero).'
            },
            {
                name: 'rateType', label: 'Tipo de tasa de interés', type: 'select', value: rate.rateType || 'mensual', visibleIf: isCard,
                options: [
                    { value: 'mensual', label: 'Mensual nominal (% mes)' },
                    { value: 'anual', label: 'Efectiva anual (% E.A.)' }
                ]
            },
            {
                name: 'interestRate', label: 'Tasa de interés (%)', type: 'number', min: 0, value: rate.rate ?? '', visibleIf: isCard,
                hint: 'Si cambia con el tiempo, edítala: la nueva tasa aplica desde hoy y no altera intereses anteriores.'
            },
            { name: 'cutoffDay', label: 'Día de corte (1-31)', type: 'number', min: 1, max: 31, step: 1, value: card ? account.cutoffDay : '', visibleIf: isCard },
            { name: 'paymentDay', label: 'Día límite de pago (1-31)', type: 'number', min: 1, max: 31, step: 1, value: card ? account.paymentDay : '', visibleIf: isCard }
        ],
        onSubmit: (v) => {
            const outcome = editing ? updateAccount(account, v) : createAccount(v);
            return outcome.error || null;
        }
    });
}

/** Formulario de transferencia. Si el destino (`toId`) es una tarjeta funciona como "Pagar tarjeta". */
export function openTransferForm({ fromId = '', toId = '' } = {}) {
    const destination = toId ? DataService.find('accounts', toId) : null;
    const payingCard = !!destination && isCreditCard(destination);
    const info = payingCard ? creditCardInfo(toId) : null;

    let note = '';
    let defaultAmount = '';
    if (payingCard) {
        defaultAmount = info.amountToAvoidInterest > 0 ? info.amountToAvoidInterest : info.owed;
        note = `<strong>${escapeHtml(destination.name)}</strong><br>Deuda total: ${formatMoney(info.owed)}`
            + (info.statementClosed ? `<br>Para no pagar intereses antes del ${formatDate(info.dueDate)}: ${formatMoney(info.amountToAvoidInterest)}` : '');
    }

    openFormModal({
        title: payingCard ? 'Pagar tarjeta de crédito' : 'Transferir dinero',
        note,
        submitLabel: payingCard ? 'Registrar pago' : 'Transferir',
        successMessage: payingCard ? '✅ Pago de tarjeta registrado' : '✅ Transferencia realizada',
        fields: [
            {
                name: 'from', label: 'Cuenta de origen', type: 'select', value: fromId, disabled: !!fromId,
                options: accountOptions({ filter: a => !isCreditCard(a) })
            },
            {
                name: 'to', label: payingCard ? 'Tarjeta' : 'Cuenta destino', type: 'select', value: toId, disabled: !!toId,
                options: accountOptions({ filter: a => a.id !== fromId, placeholder: 'Seleccionar cuenta' })
            },
            { name: 'amount', label: 'Monto ($)', type: 'number', min: 0, value: defaultAmount },
            { name: 'date', label: 'Fecha', type: 'date', value: todayStr() },
            { name: 'description', label: 'Descripción (opcional)', type: 'text', required: false, placeholder: 'Nota...' }
        ],
        onSubmit: (v) => {
            if (!v.from) return '❌ Selecciona la cuenta de origen';
            if (!v.to) return '❌ Selecciona la cuenta destino';
            return createTransfer({ from: v.from, to: v.to, amount: v.amount, date: v.date, description: v.description }).error || null;
        }
    });
}

/** Elimina una cuenta validando su saldo: con deuda se bloquea; con saldo a favor pide a qué cuenta transferirlo. */
export async function startAccountDeletion(account) {
    const check = checkAccountDeletion(account);

    if (check.error) {
        await confirmDialog({
            title: 'No se puede eliminar',
            message: escapeHtml(check.error.replace('❌ ', '')),
            confirmLabel: 'Entendido',
            cancelLabel: 'Cerrar'
        });
        return;
    }

    if (check.needsTransfer) {
        openFormModal({
            title: '⚠️ Cuenta con saldo',
            note: `La cuenta <strong>"${escapeHtml(account.name)}"</strong> tiene un saldo de <strong>${formatMoney(check.balance)}</strong>. Para eliminarla, ese saldo se transferirá a otra cuenta.`,
            submitLabel: 'Transferir y eliminar',
            danger: true,
            fields: [{
                name: 'to', label: 'Transferir a', type: 'select', value: '',
                options: accountOptions({ filter: a => a.id !== account.id && !isCreditCard(a) })
            }],
            onSubmit: (v) => {
                if (!v.to) return '❌ Selecciona una cuenta destino';
                const outcome = deleteAccount(account, v.to);
                if (outcome.error) return outcome.error;
                showNotification(`✅ Cuenta eliminada. Saldo transferido a ${DataService.find('accounts', v.to)?.name}`, 'success');
                return null;
            }
        });
        return;
    }

    const hasMovements = DataService.all('transactions').some(t => t.account === account.id || t.toAccount === account.id);
    const ok = await confirmDialog({
        title: 'Eliminar cuenta',
        message: `¿Eliminar la cuenta "${escapeHtml(account.name)}" (saldo ${formatMoney(accountBalance(account.id))})?`
            + (hasMovements ? '<br>Sus movimientos pasados se conservan en el historial.' : ''),
        confirmLabel: 'Eliminar',
        danger: true
    });
    if (!ok) return;
    const outcome = deleteAccount(account);
    if (outcome.error) showNotification(outcome.error, 'error');
    else showNotification('🗑️ Cuenta eliminada', 'success');
}
