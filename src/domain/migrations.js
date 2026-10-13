import { DataService } from '../services/data-service.js';
import { money, todayStr } from '../core/utils.js';
import { CREDIT_TYPE, effectOn, goalIdForTransaction } from './ledger.js';

/**
 * Convierte datos de versiones anteriores, que guardaban totales (`balance`, `currentAmount`, `currentBalance`),
 * al modelo de totales calculados: a cada registro le asigna un valor base que, sumado a los movimientos,
 * reproduce exactamente el total que ya tenía (cuenta: saldo inicial; meta: monto base; deuda: capital base).
 * También vincula abonos y retiros con su meta por `goalId`, completa los campos de las tarjetas y fija
 * `interestFrom` en las deudas.
 *
 * Es idempotente y determinista. Debe ejecutarse cuando el estado local ya está sincronizado con la nube
 * (DataService.whenReady()) para no calcular bases con datos incompletos.
 * @returns {number} cantidad de registros actualizados
 */
export function runMigrations() {
    let changes = 0;
    const patch = (collection, id, fields) => {
        DataService.patch(collection, id, fields);
        changes++;
    };

    const transactions = DataService.all('transactions');

    transactions.forEach(t => {
        if (t.goalId) return;
        const goalId = goalIdForTransaction(t);
        if (goalId) patch('transactions', t.id, { goalId });
    });

    DataService.all('goals').forEach(goal => {
        if (goal.baseAmount !== undefined) return;
        const derived = transactions.reduce((sum, t) => {
            if (goalIdForTransaction(t) !== goal.id) return sum;
            return sum + (t.type === 'Ahorro' ? 1 : -1) * (Number(t.amount) || 0);
        }, 0);
        patch('goals', goal.id, { baseAmount: money((Number(goal.currentAmount) || 0) - derived) });
    });

    const payments = DataService.all('debtPayments');
    DataService.all('debts').forEach(debt => {
        if (debt.baseBalance !== undefined) {
            if (debt.interestFrom === undefined) patch('debts', debt.id, { interestFrom: todayStr() });
            return;
        }
        const paid = payments
            .filter(p => p.debtId === debt.id)
            .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        const stored = debt.currentBalance !== undefined ? debt.currentBalance : debt.initialBalance;
        patch('debts', debt.id, { baseBalance: money((Number(stored) || 0) + paid), interestFrom: todayStr() });
    });

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
