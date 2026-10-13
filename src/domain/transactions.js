import { DataService } from '../services/data-service.js';
import { uid, money, todayStr, formatMoney } from '../core/utils.js';
import {
    accountAvailable, creditCardInfo, debtBalance, goalAmount,
    goalIdForTransaction, isCreditCard
} from './ledger.js';

/**
 * Las operaciones de este módulo devuelven `{ ok: true, record }` o `{ error: 'mensaje' }`.
 * Como los saldos se calculan (ledger.js), crear, editar o borrar un movimiento no ajusta ningún saldo.
 */
const fail = (error) => ({ error });
const valid = (amount) => Number.isFinite(amount) && amount > 0;

function insufficient(account, available, needed) {
    const noun = isCreditCard(account) ? 'Cupo' : 'Saldo';
    return `❌ ${noun} insuficiente en ${account.name}. Disponible: ${formatMoney(available)}, requerido: ${formatMoney(needed)}`;
}

/** Valida que la cuenta tenga fondos (o cupo) para `amount`; devuelve el mensaje de error o `null`. */
function checkFunds(accountId, amount, excludeTxId = null) {
    const account = DataService.find('accounts', accountId);
    if (!account) return '❌ Cuenta no encontrada';
    const available = accountAvailable(accountId, { excludeTxId });
    if (available < amount) return insufficient(account, available, amount);
    return null;
}

export function createExpense({ date, category, description, amount, account }) {
    amount = money(amount);
    if (!category) return fail('❌ Selecciona una categoría');
    if (!valid(amount)) return fail('❌ Ingresa un monto válido');
    const error = checkFunds(account, amount);
    if (error) return fail(error);

    const record = DataService.save('transactions', {
        id: uid('exp'), type: 'Egreso', date: date || todayStr(), category,
        description: description || '', amount, account, timestamp: Date.now()
    });
    return { ok: true, record };
}

export function createIncome({ date, incomeType, description, amount, account }) {
    amount = money(amount);
    const target = DataService.find('accounts', account);
    if (!target) return fail('❌ Cuenta no encontrada');
    if (isCreditCard(target)) return fail('❌ No se pueden registrar ingresos en una tarjeta de crédito: usa "Pagar tarjeta"');
    if (!valid(amount)) return fail('❌ Ingresa un monto válido');

    const record = DataService.save('transactions', {
        id: uid('inc'), type: 'Ingreso', date: date || todayStr(), incomeType,
        description, amount, account, timestamp: Date.now()
    });
    return { ok: true, record };
}

/** Transferencia entre cuentas. Si el destino es una tarjeta funciona como pago de tarjeta y no puede superar su deuda. */
export function createTransfer({ from, to, amount, date, description }) {
    amount = money(amount);
    const origin = DataService.find('accounts', from);
    const destination = DataService.find('accounts', to);
    if (!origin || !destination) return fail('❌ Cuenta no encontrada');
    if (from === to) return fail('❌ Las cuentas de origen y destino deben ser distintas');
    if (isCreditCard(origin)) return fail('❌ No se puede transferir desde una tarjeta de crédito');
    if (!valid(amount)) return fail('❌ Ingresa un monto válido');

    const error = checkFunds(from, amount);
    if (error) return fail(error);

    if (isCreditCard(destination)) {
        const owed = creditCardInfo(to).owed;
        if (owed <= 0) return fail(`❌ ${destination.name} no tiene deuda pendiente`);
        if (amount > owed) return fail(`❌ El pago supera la deuda de la tarjeta (${formatMoney(owed)})`);
    }

    const label = isCreditCard(destination) ? 'Pago de tarjeta' : 'Transferencia';
    const record = DataService.save('transactions', {
        id: uid('trans'), type: 'Transferencia',
        category: isCreditCard(destination) ? 'Pago Tarjeta' : 'Transferencia',
        description: `${label} de ${origin.name} a ${destination.name}${description ? ': ' + description : ''}`,
        amount, account: from, toAccount: to, date: date || todayStr(), createdAt: Date.now()
    });
    return { ok: true, record };
}

/** Abono a una meta: sale de una cuenta como movimiento de tipo 'Ahorro' vinculado por `goalId`. */
export function createGoalDeposit({ goalId, account, amount, date }) {
    amount = money(amount);
    const goal = DataService.find('goals', goalId);
    if (!goal) return fail('❌ Meta no encontrada');
    const target = DataService.find('accounts', account);
    if (!target) return fail('❌ Cuenta no encontrada');
    if (isCreditCard(target)) return fail('❌ No se puede ahorrar con una tarjeta de crédito');
    if (!valid(amount)) return fail('❌ Ingresa un monto válido');
    const error = checkFunds(account, amount);
    if (error) return fail(error);

    const record = DataService.save('transactions', {
        id: uid('trans'), type: 'Ahorro', date: date || todayStr(), category: 'Ahorros',
        description: `Abono a meta: ${goal.description}`, amount, account, goalId, timestamp: Date.now()
    });
    return { ok: true, record };
}

/** Retiro de una meta hacia una cuenta, hasta lo ahorrado en ella. */
export function createGoalWithdrawal({ goalId, account, amount, date }) {
    amount = money(amount);
    const goal = DataService.find('goals', goalId);
    if (!goal) return fail('❌ Meta no encontrada');
    const target = DataService.find('accounts', account);
    if (!target) return fail('❌ Cuenta no encontrada');
    if (isCreditCard(target)) return fail('❌ No se puede depositar en una tarjeta de crédito');
    if (!valid(amount)) return fail('❌ Ingresa un monto válido');
    const saved = goalAmount(goal);
    if (amount > saved) return fail(`❌ La meta sólo tiene ${formatMoney(saved)} ahorrados`);

    const record = DataService.save('transactions', {
        id: uid('trans'), type: 'Ingreso', date: date || todayStr(), category: 'Retiro de Ahorros',
        description: `Retiro de ahorros: ${goal.description}`, amount, account, goalId, createdAt: Date.now()
    });
    return { ok: true, record };
}

/** Pago de deuda: registra el egreso y el pago vinculados; no puede superar el saldo pendiente (intereses incluidos). */
export function createDebtPayment({ debtId, account, amount, date }) {
    amount = money(amount);
    const debt = DataService.find('debts', debtId);
    if (!debt) return fail('❌ Deuda no encontrada');
    const target = DataService.find('accounts', account);
    if (!target) return fail('❌ Cuenta no encontrada');
    if (isCreditCard(target)) return fail('❌ Paga las deudas con una cuenta, no con una tarjeta de crédito');
    if (!valid(amount)) return fail('❌ Ingresa un monto válido');
    if (amount > debtBalance(debt)) return fail('❌ El monto no puede exceder el saldo de la deuda');
    const error = checkFunds(account, amount);
    if (error) return fail(error);

    const day = date || todayStr();
    const transaction = DataService.save('transactions', {
        id: uid('trans'), type: 'Egreso', date: day, category: 'Deuda',
        description: `Pago de deuda: ${debt.entity || 'Sin nombre'}`, amount, account,
        debtId, timestamp: Date.now()
    });
    DataService.save('debtPayments', {
        id: uid('pay'), debtId, amount, date: day, accountId: account,
        transactionId: transaction.id, timestamp: Date.now()
    });
    return { ok: true, record: transaction };
}

/** Pago de deuda ligado a un movimiento; en datos antiguos sin vínculo se busca por monto, fecha y cuenta. */
function debtPaymentForTransaction(t) {
    const payments = DataService.all('debtPayments');
    const linked = payments.find(p => p.transactionId === t.id);
    if (linked) return linked;
    if (t.type === 'Egreso' && t.category === 'Deuda') {
        return payments.find(p => p.amount === t.amount && p.date === t.date && p.accountId === t.account) || null;
    }
    return null;
}

/** Qué se puede editar de un movimiento según su naturaleza. */
export function describeTransaction(t) {
    const isDebtPayment = t.type === 'Egreso' && t.category === 'Deuda';
    const isGoalMovement = t.type === 'Ahorro' || t.category === 'Retiro de Ahorros';
    const isTransfer = t.type === 'Transferencia';
    return { isDebtPayment, isGoalMovement, isTransfer, isSystem: !!t.virtual };
}

/** Corrige un movimiento validando fondos y límites; si es un pago de deuda actualiza también el pago. */
export function updateTransaction(t, values) {
    if (t.virtual) return fail('❌ Los intereses de tarjeta se calculan automáticamente');
    const { isDebtPayment, isGoalMovement, isTransfer } = describeTransaction(t);

    const amount = money(values.amount ?? t.amount);
    if (!valid(amount)) return fail('❌ Ingresa un monto válido');

    const accountId = values.account ?? t.account;
    const account = DataService.find('accounts', accountId);
    if (!account) return fail('❌ Cuenta no encontrada');

    if (t.type === 'Ingreso' && isCreditCard(account)) return fail('❌ No se pueden registrar ingresos en una tarjeta de crédito');
    if ((isTransfer || isDebtPayment || isGoalMovement) && isCreditCard(account)) return fail('❌ Este movimiento no puede salir de una tarjeta de crédito');
    if (t.type !== 'Ingreso') {
        const error = checkFunds(accountId, amount, t.id);
        if (error) return fail(error);
    }
    if (isGoalMovement && t.category === 'Retiro de Ahorros') {
        const goal = DataService.find('goals', goalIdForTransaction(t));
        if (goal && amount > goalAmount(goal) + (Number(t.amount) || 0)) {
            return fail('❌ El retiro supera lo ahorrado en la meta');
        }
    }
    if (isDebtPayment) {
        const payment = debtPaymentForTransaction(t);
        const debt = payment && DataService.find('debts', payment.debtId);
        if (debt && amount > debtBalance(debt) + (Number(payment.amount) || 0)) {
            return fail('❌ El monto supera el saldo de la deuda');
        }
    }
    if (isTransfer) {
        const destination = DataService.find('accounts', t.toAccount);
        if (destination && isCreditCard(destination)) {
            const owed = creditCardInfo(destination.id).owed + (Number(t.amount) || 0);
            if (amount > owed) return fail(`❌ El pago supera la deuda de la tarjeta (${formatMoney(owed)})`);
        }
    }

    const patch = { date: values.date ?? t.date, amount, account: accountId };
    if (values.description !== undefined && !isDebtPayment && !isGoalMovement) patch.description = values.description;
    if (values.category !== undefined) patch.category = values.category;
    if (values.incomeType !== undefined) patch.incomeType = values.incomeType;

    DataService.patch('transactions', t.id, patch);

    if (isDebtPayment) {
        const payment = debtPaymentForTransaction(t);
        if (payment) {
            DataService.patch('debtPayments', payment.id, { amount, date: patch.date, accountId, transactionId: t.id });
        }
    }
    return { ok: true };
}

/** Elimina un movimiento y, si es un pago de deuda, el pago asociado. */
export function deleteTransaction(t) {
    if (t.virtual) return fail('❌ Los intereses de tarjeta se calculan automáticamente');
    const payment = debtPaymentForTransaction(t);
    if (payment) DataService.remove('debtPayments', payment.id);
    DataService.remove('transactions', t.id);
    return { ok: true };
}
