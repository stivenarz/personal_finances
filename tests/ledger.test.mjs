import test from 'node:test';
import assert from 'node:assert/strict';
import { freshApp, DataService } from './setup.mjs';

const ledger = await import('../src/domain/ledger.js');
const tx = await import('../src/domain/transactions.js');
const accountsDomain = await import('../src/domain/accounts.js');
const { runMigrations } = await import('../src/domain/migrations.js');

const addAccount = (fields) => DataService.save('accounts', { id: 'a1', name: 'Cuenta', type: 'Corriente', initialBalance: 0, ...fields });
const addTx = (fields) => DataService.save('transactions', { id: 't' + Math.random(), date: '2026-10-01', amount: 0, ...fields });

test('saldo de cuenta = saldo inicial + movimientos (nunca guardado)', async () => {
    await freshApp();
    addAccount({ id: 'a1', initialBalance: 1000 });
    addAccount({ id: 'a2', name: 'Ahorro', type: 'Ahorros', initialBalance: 0 });
    addTx({ type: 'Ingreso', amount: 500, account: 'a1' });
    addTx({ type: 'Egreso', amount: 200, account: 'a1' });
    addTx({ type: 'Transferencia', amount: 100, account: 'a1', toAccount: 'a2' });

    assert.equal(ledger.accountBalance('a1'), 1200);
    assert.equal(ledger.accountBalance('a2'), 100);
    assert.equal(ledger.totalAvailable(), 1300);
    assert.equal(DataService.find('accounts', 'a1').balance, undefined, 'no se guarda ningún total');
});

test('editar o borrar un movimiento recalcula el saldo sin tocar la cuenta', async () => {
    await freshApp();
    addAccount({ id: 'a1', initialBalance: 1000 });
    const expense = tx.createExpense({ date: '2026-10-02', category: 'c1', amount: 300, account: 'a1' }).record;
    assert.equal(ledger.accountBalance('a1'), 700);

    assert.ok(tx.updateTransaction(expense, { amount: 400, date: expense.date, account: 'a1' }).ok);
    assert.equal(ledger.accountBalance('a1'), 600);

    tx.deleteTransaction(DataService.find('transactions', expense.id));
    assert.equal(ledger.accountBalance('a1'), 1000);
});

test('gasto con saldo insuficiente se rechaza', async () => {
    await freshApp();
    addAccount({ id: 'a1', initialBalance: 100 });
    const r = tx.createExpense({ date: '2026-10-02', category: 'c1', amount: 101, account: 'a1' });
    assert.match(r.error, /Saldo insuficiente/);
});

test('metas y deudas: avance y saldo calculados', async () => {
    await freshApp();
    addAccount({ id: 'a1', initialBalance: 10000 });
    DataService.save('goals', { id: 'g1', description: 'Viaje', targetAmount: 1000, baseAmount: 100 });
    assert.ok(tx.createGoalDeposit({ goalId: 'g1', account: 'a1', amount: 50 }).ok);
    assert.ok(tx.createGoalWithdrawal({ goalId: 'g1', account: 'a1', amount: 30 }).ok);
    assert.equal(ledger.goalAmount(DataService.find('goals', 'g1')), 120);
    assert.equal(ledger.accountBalance('a1'), 10000 - 50 + 30);
    assert.match(tx.createGoalWithdrawal({ goalId: 'g1', account: 'a1', amount: 500 }).error, /ahorrados/);

    DataService.save('debts', { id: 'd1', entity: 'Banco', baseBalance: 1000, monthlyPayment: 100 });
    assert.ok(tx.createDebtPayment({ debtId: 'd1', account: 'a1', amount: 300 }).ok);
    assert.equal(ledger.debtBalance(DataService.find('debts', 'd1')), 700);
    assert.match(tx.createDebtPayment({ debtId: 'd1', account: 'a1', amount: 701 }).error, /exceder/);

    const paymentTx = DataService.all('transactions').find(t => t.debtId === 'd1');
    tx.deleteTransaction(paymentTx);
    assert.equal(ledger.debtBalance(DataService.find('debts', 'd1')), 1000);
});

test('tasas: mensual nominal y efectiva anual', () => {
    assert.equal(ledger.monthlyRate(2, 'mensual'), 0.02);
    assert.ok(Math.abs(ledger.monthlyRate(12.682503, 'anual') - 0.01) < 1e-6);
});

const card = (extra = {}) => ({
    id: 'tc', name: 'Visa', type: ledger.CREDIT_TYPE, initialBalance: 0, creditLimit: 1000000,
    interestRate: 2, rateType: 'mensual', cutoffDay: 15, paymentDay: 30, interestStart: '2026-08-01', ...extra
});

test('tarjeta: intereses por ciclo se calculan y se capitalizan', async () => {
    await freshApp('2026-10-12');
    DataService.save('accounts', card());
    addTx({ type: 'Egreso', amount: 300000, account: 'tc', date: '2026-08-10' });

    const interest = ledger.allTransactions().filter(t => t.virtual);
    assert.deepEqual(interest.map(t => [t.date, t.amount]), [['2026-08-30', 6000], ['2026-09-30', 6120]]);
    assert.equal(ledger.accountBalance('tc'), -312120);

    const info = ledger.creditCardInfo('tc');
    assert.equal(info.owed, 312120);
    assert.equal(info.available, 1000000 - 312120);
    assert.equal(info.dueDate, '2026-10-30');
    assert.equal(info.statementClosed, false);
});

test('tarjeta: pagar el extracto antes de la fecha límite evita intereses', async () => {
    await freshApp('2026-10-12');
    DataService.save('accounts', card());
    addAccount({ id: 'bank', initialBalance: 1000000 });
    addTx({ type: 'Egreso', amount: 300000, account: 'tc', date: '2026-08-10' });
    addTx({ type: 'Transferencia', amount: 300000, account: 'bank', toAccount: 'tc', date: '2026-08-20' });

    assert.equal(ledger.allTransactions().filter(t => t.virtual).length, 0);
    assert.equal(ledger.accountBalance('tc'), 0);
    assert.equal(ledger.accountBalance('bank'), 700000);
});

test('tarjeta: un cambio de tasa sólo aplica hacia adelante', async () => {
    await freshApp('2026-10-12');
    DataService.save('accounts', card());
    addTx({ type: 'Egreso', amount: 300000, account: 'tc', date: '2026-08-10' });

    const account = DataService.find('accounts', 'tc');
    accountsDomain.updateAccount(account, {
        name: 'Visa', creditLimit: 1000000, usedCredit: 0, interestRate: 3, rateType: 'mensual', cutoffDay: 15, paymentDay: 30
    });
    assert.equal(ledger.accountBalance('tc'), -312120);
    assert.equal(DataService.find('accounts', 'tc').rateHistory.length, 2);

    const { __setToday } = await import('../src/core/utils.js');
    __setToday('2026-11-05');
    ledger.resetLedgerCache();
    const oct = ledger.allTransactions().filter(t => t.virtual).at(-1);
    assert.equal(oct.date, '2026-10-30');
    assert.equal(oct.amount, Math.round(312120 * 0.03 * 100) / 100);
});

test('tarjeta: validación de cupo y de pagos', async () => {
    await freshApp('2026-10-12');
    DataService.save('accounts', card({ initialBalance: -900000, interestRate: 0 }));
    addAccount({ id: 'bank', initialBalance: 5000000 });

    assert.match(tx.createExpense({ date: '2026-10-12', category: 'c', amount: 150000, account: 'tc' }).error, /Cupo insuficiente/);
    assert.ok(tx.createExpense({ date: '2026-10-12', category: 'c', amount: 100000, account: 'tc' }).ok);
    assert.match(tx.createTransfer({ from: 'bank', to: 'tc', amount: 1100000 }).error, /supera la deuda/);
    assert.ok(tx.createTransfer({ from: 'bank', to: 'tc', amount: 400000 }).ok);
    assert.equal(ledger.creditCardInfo('tc').owed, 600000);
    assert.match(tx.createTransfer({ from: 'tc', to: 'bank', amount: 10 }).error, /tarjeta de crédito/);
});

test('eliminar cuentas: valida saldos', async () => {
    await freshApp('2026-10-12');
    DataService.save('accounts', card({ initialBalance: -500 }));
    addAccount({ id: 'bank', initialBalance: 700 });
    addAccount({ id: 'cash', name: 'Efectivo', type: 'Efectivo', initialBalance: 0 });

    assert.match(accountsDomain.deleteAccount(DataService.find('accounts', 'tc')).error, /deuda/);
    assert.equal(accountsDomain.checkAccountDeletion(DataService.find('accounts', 'bank')).needsTransfer, true);
    assert.match(accountsDomain.deleteAccount(DataService.find('accounts', 'bank')).error, /Selecciona/);

    assert.ok(accountsDomain.deleteAccount(DataService.find('accounts', 'bank'), 'cash').ok);
    assert.equal(ledger.accountBalance('cash'), 700, 'el saldo se transfirió');
    assert.ok(accountsDomain.deleteAccount(DataService.find('accounts', 'cash'), 'tc').error, 'no se transfiere a tarjeta');
});

test('migración: datos con totales guardados quedan idénticos y es idempotente', async () => {
    await freshApp('2026-10-12');
    DataService.save('accounts', { id: 'a1', name: 'Banco', type: 'Corriente', balance: 1500 });
    DataService.save('accounts', { id: 'tc', name: 'TC vieja', type: 'Tarjeta Crédito', balance: 200 });
    DataService.save('goals', { id: 'g1', description: 'Viaje', targetAmount: 1000, currentAmount: 250 });
    DataService.save('debts', { id: 'd1', entity: 'Banco X', initialBalance: 2000, currentBalance: 1500, monthlyPayment: 100 });
    DataService.save('debtPayments', { id: 'p1', debtId: 'd1', amount: 300, date: '2026-09-01', accountId: 'a1' });
    DataService.save('transactions', { id: 't1', type: 'Egreso', amount: 100, account: 'a1', date: '2026-10-01' });
    DataService.save('transactions', { id: 't2', type: 'Ahorro', amount: 100, account: 'a1', date: '2026-10-02', description: 'Abono a meta: Viaje', category: 'Ahorros' });

    assert.equal(ledger.accountBalance('a1'), 1500);
    assert.equal(ledger.goalAmount(DataService.find('goals', 'g1')), 250);
    assert.equal(ledger.debtBalance(DataService.find('debts', 'd1')), 1500);

    assert.ok(runMigrations() > 0);

    assert.equal(ledger.accountBalance('a1'), 1500);
    assert.equal(ledger.accountBalance('tc'), 200);
    assert.equal(ledger.goalAmount(DataService.find('goals', 'g1')), 250);
    assert.equal(ledger.debtBalance(DataService.find('debts', 'd1')), 1500);
    assert.equal(DataService.find('transactions', 't2').goalId, 'g1');

    const tcAccount = DataService.find('accounts', 'tc');
    assert.equal(tcAccount.creditLimit, 0);
    assert.equal(tcAccount.rateType, 'mensual');

    assert.equal(runMigrations(), 0, 'segunda ejecución: sin cambios');

    addTx({ type: 'Egreso', amount: 50, account: 'a1' });
    assert.equal(ledger.accountBalance('a1'), 1450);
});

const pmt = (balance, monthly, n) => Math.round(balance * monthly / (1 - Math.pow(1 + monthly, -n)) * 100) / 100;

test('deuda: intereses causados, pagos cubren primero intereses y cuota recalculada', async () => {
    await freshApp('2026-10-12');
    addAccount({ id: 'bank', initialBalance: 5000000 });
    DataService.save('debts', {
        id: 'd1', entity: 'Crédito', baseBalance: 1000000, interestRate: 12, termMonths: 12,
        startDate: '2026-09-12', interestFrom: '2026-09-12', paymentDay: 12, monthlyPayment: 0
    });
    const debt = () => DataService.find('debts', 'd1');

    assert.equal(ledger.debtInterestAccrued(debt()), 10000);
    assert.equal(ledger.debtBalance(debt()), 1010000);
    assert.equal(ledger.debtRemainingTerm(debt()), 11);
    assert.equal(ledger.debtMonthlyPayment(debt()), pmt(1010000, 0.01, 11));

    assert.ok(tx.createDebtPayment({ debtId: 'd1', account: 'bank', amount: 100000, date: '2026-10-12' }).ok);
    assert.equal(ledger.debtInterestPaid(debt()), 10000);
    assert.equal(ledger.debtBalance(debt()), 910000);
    const lower = ledger.debtMonthlyPayment(debt());
    assert.equal(lower, pmt(910000, 0.01, 11), 'la cuota baja sola con el abono');
    assert.ok(lower < pmt(1010000, 0.01, 11));

    const { __setToday } = await import('../src/core/utils.js');
    __setToday('2026-11-12');
    ledger.resetLedgerCache();
    assert.equal(ledger.debtInterestAccrued(debt()), 9100);
    assert.equal(ledger.debtBalance(debt()), 919100);
    assert.equal(ledger.debtRemainingTerm(debt()), 10);

    assert.match(tx.createDebtPayment({ debtId: 'd1', account: 'bank', amount: 919101, date: '2026-11-12' }).error, /exceder/);
    assert.ok(tx.createDebtPayment({ debtId: 'd1', account: 'bank', amount: 919100, date: '2026-11-12' }).ok);
    assert.equal(ledger.debtBalance(debt()), 0);
    assert.equal(ledger.debtMonthlyPayment(debt()), 0);
});

test('deuda: sin tasa la cuota es saldo / meses restantes; sin plazo usa la cuota manual', async () => {
    await freshApp('2026-10-12');
    DataService.save('debts', { id: 'a', entity: 'Sin tasa', baseBalance: 1200, interestRate: 0, termMonths: 12, startDate: '2026-10-01', interestFrom: '2026-10-01' });
    assert.equal(ledger.debtMonthlyPayment(DataService.find('debts', 'a')), 1200 / 12);

    DataService.save('debts', { id: 'b', entity: 'Manual', baseBalance: 1000, interestRate: 0, termMonths: 0, monthlyPayment: 250, interestFrom: '2026-10-12' });
    assert.equal(ledger.debtMonthlyPayment(DataService.find('debts', 'b')), 250);
    assert.equal(ledger.debtMonthsLeft(DataService.find('debts', 'b')), 4);

    DataService.save('debts', { id: 'c', entity: 'Insuficiente', baseBalance: 100000, interestRate: 24, termMonths: 0, monthlyPayment: 1000, interestFrom: '2026-10-12' });
    assert.equal(ledger.debtMonthsLeft(DataService.find('debts', 'c')), null);
});

test('deuda: datos sin interestFrom no causan intereses; la migración los fija a hoy', async () => {
    await freshApp('2026-10-12');
    DataService.save('debts', { id: 'old', entity: 'Vieja', baseBalance: 1000, interestRate: 24, termMonths: 0, monthlyPayment: 100 });
    assert.equal(ledger.debtBalance(DataService.find('debts', 'old')), 1000);
    runMigrations();
    assert.equal(DataService.find('debts', 'old').interestFrom, '2026-10-12');
    assert.equal(ledger.debtBalance(DataService.find('debts', 'old')), 1000);
});
