/**
 * MIGRACIÓN a totales calculados.
 *
 * Versiones anteriores guardaban saldos (`balance`, `currentAmount`, `currentBalance`).
 * Ahora esos totales se calculan (domain/ledger.js), así que cada registro necesita
 * un valor BASE que, sumado a los movimientos, reproduzca exactamente el total que
 * el usuario ya tenía:
 *
 *   cuenta.initialBalance = balance guardado − efecto de sus movimientos
 *   meta.baseAmount       = currentAmount guardado − abonos + retiros
 *   deuda.baseBalance     = currentBalance guardado + pagos registrados
 *                           (los intereses se causan desde la migración: `interestFrom`)
 *
 * Además, los movimientos de metas pasan a vincularse por `goalId` (antes por
 * descripción) y las cuentas "Tarjeta Crédito" reciben los campos de tarjeta.
 *
 * Es idempotente y determinista (dos dispositivos producen los mismos valores).
 * Debe ejecutarse sólo cuando el estado local ya está sincronizado con la nube
 * (DataService.whenReady()), para no calcular bases con datos incompletos.
 */
import { DataService } from '../services/data-service.js';
import { money, todayStr } from '../core/utils.js';
import { CREDIT_TYPE, effectOn, goalIdForTransaction } from './ledger.js';

export function runMigrations() {
    let changes = 0;
    const patch = (collection, id, fields) => {
        DataService.patch(collection, id, fields);
        changes++;
    };

    const transactions = DataService.all('transactions');

    // 1) Vincular abonos/retiros con su meta por id
    transactions.forEach(t => {
        if (t.goalId) return;
        const goalId = goalIdForTransaction(t);
        if (goalId) patch('transactions', t.id, { goalId });
    });

    // 2) Metas: base = guardado − movimientos
    DataService.all('goals').forEach(goal => {
        if (goal.baseAmount !== undefined) return;
        const derived = transactions.reduce((sum, t) => {
            if (goalIdForTransaction(t) !== goal.id) return sum;
            return sum + (t.type === 'Ahorro' ? 1 : -1) * (Number(t.amount) || 0);
        }, 0);
        patch('goals', goal.id, { baseAmount: money((Number(goal.currentAmount) || 0) - derived) });
    });

    // 3) Deudas: base = saldo guardado + pagos
    const payments = DataService.all('debtPayments');
    DataService.all('debts').forEach(debt => {
        if (debt.baseBalance !== undefined) {
            // Deudas ya migradas sin fecha de inicio de intereses: los causan desde hoy (no se reescribe el pasado)
            if (debt.interestFrom === undefined) patch('debts', debt.id, { interestFrom: todayStr() });
            return;
        }
        const paid = payments
            .filter(p => p.debtId === debt.id)
            .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        const stored = debt.currentBalance !== undefined ? debt.currentBalance : debt.initialBalance;
        patch('debts', debt.id, { baseBalance: money((Number(stored) || 0) + paid), interestFrom: todayStr() });
    });

    // 4) Cuentas: saldo inicial = saldo guardado − movimientos (+ campos de tarjeta)
    DataService.all('accounts').forEach(account => {
        if (account.initialBalance !== undefined) return;
        const effect = transactions.reduce((sum, t) => sum + effectOn(t, account.id), 0);
        const fields = { initialBalance: money((Number(account.balance) || 0) - effect) };

        if (account.type === CREDIT_TYPE) {
            if (account.creditLimit === undefined) fields.creditLimit = 0;
            if (account.interestRate === undefined) fields.interestRate = 0;
            if (account.rateType === undefined) fields.rateType = 'mensual';
            if (account.cutoffDay === undefined) fields.cutoffDay = 1;
            if (account.paymentDay === undefined) fields.paymentDay = 15;
            if (account.interestStart === undefined) fields.interestStart = todayStr();
        }
        patch('accounts', account.id, fields);
    });

    return changes;
}
