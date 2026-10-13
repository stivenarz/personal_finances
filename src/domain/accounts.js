/**
 * Reglas de negocio de las cuentas (incluye tarjetas de crédito).
 *
 * Una tarjeta guarda: cupo (`creditLimit`), tasa (`interestRate` + `rateType`:
 * 'mensual' nominal o 'anual' efectiva), día de corte y día de pago. Los cambios
 * de tasa quedan en `rateHistory` con su fecha de vigencia, de modo que un cambio
 * futuro no reescribe los intereses ya cargados.
 */
import { DataService } from '../services/data-service.js';
import { uid, money, todayStr, formatMoney } from '../core/utils.js';
import { accountBalance, creditCardInfo, isCreditCard, CREDIT_TYPE } from './ledger.js';

const fail = (error) => ({ error });
const validDay = (day) => Number.isInteger(day) && day >= 1 && day <= 31;

function validateCard(values) {
    if (!(values.creditLimit > 0)) return '❌ El cupo debe ser mayor a 0';
    if (!(values.interestRate >= 0)) return '❌ La tasa de interés no puede ser negativa';
    if (!validDay(values.cutoffDay)) return '❌ El día de corte debe estar entre 1 y 31';
    if (!validDay(values.paymentDay)) return '❌ El día de pago debe estar entre 1 y 31';
    if (values.usedCredit > values.creditLimit) return '❌ El cupo utilizado supera el cupo total';
    return null;
}

export function createAccount(values) {
    const name = (values.name || '').trim();
    if (!name) return fail('❌ El nombre no puede estar vacío');

    const base = { id: uid('acc'), name, type: values.type, createdAt: Date.now() };

    if (values.type === CREDIT_TYPE) {
        const error = validateCard(values);
        if (error) return fail(error);
        const record = DataService.save('accounts', {
            ...base,
            initialBalance: -money(values.usedCredit),
            creditLimit: money(values.creditLimit),
            interestRate: Number(values.interestRate),
            rateType: values.rateType,
            cutoffDay: values.cutoffDay,
            paymentDay: values.paymentDay,
            interestStart: todayStr()
        });
        return { ok: true, record };
    }

    const record = DataService.save('accounts', { ...base, initialBalance: money(values.initialBalance) });
    return { ok: true, record };
}

export function updateAccount(account, values) {
    const name = (values.name || '').trim();
    if (!name) return fail('❌ El nombre no puede estar vacío');

    if (!isCreditCard(account)) {
        DataService.patch('accounts', account.id, { name, initialBalance: money(values.initialBalance) });
        return { ok: true };
    }

    const error = validateCard(values);
    if (error) return fail(error);

    const fields = {
        name,
        initialBalance: -money(values.usedCredit),
        creditLimit: money(values.creditLimit),
        cutoffDay: values.cutoffDay,
        paymentDay: values.paymentDay
    };

    const rate = Number(values.interestRate);
    if (rate !== Number(account.interestRate) || values.rateType !== account.rateType) {
        // La nueva tasa rige desde hoy; lo anterior se conserva en el historial
        const today = todayStr();
        const history = (account.rateHistory && account.rateHistory.length)
            ? account.rateHistory.filter(e => e.from < today)
            : [{ from: '0000-00-00', rate: Number(account.interestRate) || 0, rateType: account.rateType || 'mensual' }];
        fields.rateHistory = [...history, { from: today, rate, rateType: values.rateType }];
        fields.interestRate = rate;
        fields.rateType = values.rateType;
    }

    DataService.patch('accounts', account.id, fields);
    return { ok: true };
}

/**
 * Valida si una cuenta se puede eliminar según su saldo.
 *  - { ok: true }                         saldo 0
 *  - { needsTransfer: true, balance }     saldo a favor: hay que moverlo a otra cuenta
 *  - { error }                            deuda pendiente (tarjeta o saldo negativo)
 */
export function checkAccountDeletion(account) {
    const balance = accountBalance(account.id);

    if (isCreditCard(account)) {
        if (balance < 0) {
            return fail(`❌ La tarjeta "${account.name}" tiene una deuda de ${formatMoney(-balance)}. Págala completamente antes de eliminarla.`);
        }
        if (balance > 0) return { needsTransfer: true, balance };
        return { ok: true };
    }
    if (balance < 0) {
        return fail(`❌ La cuenta "${account.name}" tiene saldo negativo (${formatMoney(balance)}). Cubre el faltante antes de eliminarla.`);
    }
    if (balance > 0) return { needsTransfer: true, balance };
    return { ok: true };
}

/** Elimina la cuenta, moviendo antes el saldo a favor (si lo hay) a `destinationId`. */
export function deleteAccount(account, destinationId = null) {
    const check = checkAccountDeletion(account);
    if (check.error) return check;

    if (check.needsTransfer) {
        const destination = DataService.find('accounts', destinationId);
        if (!destination || destination.id === account.id) return fail('❌ Selecciona la cuenta que recibirá el saldo');
        if (isCreditCard(destination)) return fail('❌ Elige una cuenta distinta a una tarjeta de crédito');
        DataService.save('transactions', {
            id: uid('trans'), type: 'Transferencia', category: 'Transferencia',
            description: `Transferencia de ${account.name} a ${destination.name}: cierre de cuenta`,
            amount: check.balance, account: account.id, toAccount: destination.id,
            date: todayStr(), createdAt: Date.now()
        });
    }

    DataService.remove('accounts', account.id);
    return { ok: true };
}

export function cardSummary(accountId) {
    return creditCardInfo(accountId);
}
