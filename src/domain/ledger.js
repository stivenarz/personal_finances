import { DataService } from '../services/data-service.js';
import { money, todayStr, dateInMonth, nextDateForDay, diffDays } from '../core/utils.js';

export const CREDIT_TYPE = 'Tarjeta Crédito';
export const ACCOUNT_TYPES = ['Corriente', CREDIT_TYPE, 'Efectivo', 'Ahorros', 'Otro'];
const INTEREST_CATEGORY = 'Interés';

export const isCreditCard = (account) => account?.type === CREDIT_TYPE;

let cache = null;
let cacheKey = '';

/**
 * Contexto de cálculo cacheado: se reconstruye cuando cambian los datos (DataService.version) o el día.
 * Evita recalcular saldos, tarjetas, metas y deudas en cada llamada.
 */
function context() {
    const key = `${DataService.version}|${todayStr()}`;
    if (cache && key === cacheKey) return cache;

    const accounts = DataService.all('accounts');
    const accountsById = new Map(accounts.map(a => [a.id, a]));
    const accountsByName = new Map(accounts.map(a => [a.name, a]));

    cache = {
        accountsById,
        accountsByName,
        balances: new Map(),
        cards: new Map(),
        goalTotals: null,
        debtPaid: null,
        all: null
    };
    cacheKey = key;
    return cache;
}

/** Gancho de pruebas: descarta el caché de cálculos. */
export function resetLedgerCache() {
    cache = null;
    cacheKey = '';
}

/** Cuenta destino de una transferencia: `toAccount`, o el nombre dentro de la descripción en datos antiguos. */
function transferDestinationId(t, ctx = context()) {
    if (t.toAccount) return t.toAccount;
    const match = (t.description || '').match(/^Transferencia de (.+?) a (.+?)(:|$)/);
    return match ? ctx.accountsByName.get(match[2])?.id || null : null;
}

/** Efecto (+/−) de un movimiento sobre el saldo de una cuenta. */
export function effectOn(t, accountId, ctx = context()) {
    const amount = Number(t.amount) || 0;
    if (t.type === 'Ingreso') return t.account === accountId ? amount : 0;
    if (t.type === 'Egreso' || t.type === 'Ahorro') return t.account === accountId ? -amount : 0;
    if (t.type === 'Transferencia') {
        let effect = 0;
        if (t.account === accountId) effect -= amount;
        if (transferDestinationId(t, ctx) === accountId) effect += amount;
        return effect;
    }
    return 0;
}

/**
 * Tasa mensual en fracción (0.02 = 2 %).
 * @param {'mensual'|'anual'} type 'mensual' nominal, o efectiva anual (se convierte con (1+EA)^(1/12)−1).
 */
export function monthlyRate(rate, type) {
    const value = Number(rate) || 0;
    if (type === 'anual') return Math.pow(1 + value / 100, 1 / 12) - 1;
    return value / 100;
}

/** Tasa vigente en una fecha según el historial de cambios de la tarjeta (`rateHistory`). */
function rateEntryAt(account, dateStr) {
    const history = (account.rateHistory && account.rateHistory.length)
        ? [...account.rateHistory].sort((a, b) => a.from.localeCompare(b.from))
        : [{ from: '0000-00-00', rate: account.interestRate, rateType: account.rateType }];
    let chosen = history[0];
    history.forEach(entry => { if (entry.from <= dateStr) chosen = entry; });
    return chosen;
}

/** Fecha de corte y fecha límite de pago de un ciclo (el pago cae el mismo mes si su día es posterior al del corte). */
function cycleDates(account, year, month) {
    const cutoff = dateInMonth(year, month, account.cutoffDay || 1);
    const payDay = account.paymentDay || account.cutoffDay || 1;
    const due = payDay > (account.cutoffDay || 1)
        ? dateInMonth(year, month, payDay)
        : dateInMonth(year, month + 1, payDay);
    return { cutoff, due };
}

function interestStartOf(account, realTxns) {
    if (account.interestStart) return account.interestStart;
    const dates = realTxns.filter(t => t.account === account.id).map(t => t.date).sort();
    return dates[0] || todayStr();
}

/**
 * Intereses de una tarjeta, ciclo a ciclo: al corte se fija el saldo del extracto; los pagos recibidos
 * entre el corte y la fecha límite lo reducen; sobre lo que queda sin pagar se cobra la tasa del corte,
 * que se carga en la fecha límite. Pagar el extracto completo a tiempo no genera intereses.
 * @returns {{balance: number, entries: Array, cycles: Array}} saldo final (negativo = deuda), intereses cargados y ciclos
 */
function computeCard(account, ctx) {
    const today = todayStr();
    const realTxns = DataService.all('transactions');
    const initial = Number(account.initialBalance) || 0;

    const effects = [];
    realTxns.forEach(t => {
        const e = effectOn(t, account.id, ctx);
        if (e !== 0) effects.push({ date: t.date || '', e });
    });

    const entries = [];
    const balanceAt = (date) => {
        let balance = initial;
        effects.forEach(x => { if (x.date <= date) balance += x.e; });
        entries.forEach(x => { if (x.date <= date) balance -= x.amount; });
        return balance;
    };

    const start = interestStartOf(account, realTxns);
    const [startYear, startMonth] = start.split('-').map(Number);
    const [todayYear, todayMonth] = today.split('-').map(Number);

    const cycles = [];
    const totalMonths = (todayYear * 12 + todayMonth + 1) - (startYear * 12 + startMonth);
    for (let i = 0; i <= totalMonths; i++) {
        const absolute = startYear * 12 + (startMonth - 1) + i;
        const year = Math.floor(absolute / 12);
        const month = (absolute % 12) + 1;
        const { cutoff, due } = cycleDates(account, year, month);
        if (cutoff < start) continue;

        const statement = Math.max(0, -balanceAt(cutoff));
        let paid = 0;
        effects.forEach(x => { if (x.e > 0 && x.date > cutoff && x.date <= due) paid += x.e; });
        const unpaid = Math.max(0, statement - paid);
        const entry = rateEntryAt(account, cutoff);
        const interest = money(unpaid * monthlyRate(entry.rate, entry.rateType));
        const posted = due <= today;

        cycles.push({ cutoff, due, statement: money(statement), paid: money(paid), unpaid: money(unpaid), interest, posted });
        if (posted && interest > 0) entries.push({ date: due, amount: interest, cutoff });
    }

    const balance = money(balanceAt('9999-12-31'));
    return { balance, entries, cycles };
}

function cardData(account, ctx = context()) {
    if (!ctx.cards.has(account.id)) ctx.cards.set(account.id, computeCard(account, ctx));
    return ctx.cards.get(account.id);
}

/** Intereses cargados a las tarjetas como movimientos virtuales: no se guardan, se recalculan. */
function virtualInterest(ctx) {
    const result = [];
    DataService.all('accounts').filter(isCreditCard).forEach(account => {
        if (account.initialBalance === undefined) return;
        cardData(account, ctx).entries.forEach(entry => {
            result.push({
                id: `int-${account.id}-${entry.date}`,
                type: 'Egreso',
                category: INTEREST_CATEGORY,
                date: entry.date,
                amount: entry.amount,
                account: account.id,
                description: `Intereses ${account.name} (corte ${entry.cutoff})`,
                virtual: true
            });
        });
    });
    return result;
}

/** Movimientos reales + intereses calculados de las tarjetas. */
export function allTransactions() {
    const ctx = context();
    if (!ctx.all) ctx.all = [...DataService.all('transactions'), ...virtualInterest(ctx)];
    return ctx.all;
}

/**
 * Saldo = saldo inicial + efecto de cada movimiento (en tarjetas, además, los intereses cargados; negativo = deuda).
 * Las cuentas anteriores a la migración usan el saldo guardado.
 */
export function accountBalance(accountId) {
    const ctx = context();
    if (ctx.balances.has(accountId)) return ctx.balances.get(accountId);

    const account = ctx.accountsById.get(accountId);
    let balance = 0;
    if (account) {
        if (account.initialBalance === undefined) {
            balance = money(account.balance);
        } else if (isCreditCard(account)) {
            balance = cardData(account, ctx).balance;
        } else {
            balance = Number(account.initialBalance) || 0;
            DataService.all('transactions').forEach(t => { balance += effectOn(t, accountId, ctx); });
            balance = money(balance);
        }
    }
    ctx.balances.set(accountId, balance);
    return balance;
}

/**
 * Dinero que se puede gastar: saldo, o cupo disponible en tarjetas.
 * `excludeTxId` ignora un movimiento (para validar su edición).
 */
export function accountAvailable(accountId, { excludeTxId = null } = {}) {
    const ctx = context();
    const account = ctx.accountsById.get(accountId);
    if (!account) return 0;
    let balance = accountBalance(accountId);
    if (excludeTxId) {
        const excluded = DataService.find('transactions', excludeTxId);
        if (excluded) balance -= effectOn(excluded, accountId, ctx);
    }
    return money(isCreditCard(account) ? (Number(account.creditLimit) || 0) + balance : balance);
}

export function totalAvailable() {
    return money(DataService.all('accounts')
        .filter(a => !isCreditCard(a))
        .reduce((sum, a) => sum + accountBalance(a.id), 0));
}

export function totalCreditDebt() {
    return money(DataService.all('accounts')
        .filter(isCreditCard)
        .reduce((sum, a) => sum + Math.max(0, -accountBalance(a.id)), 0));
}

/**
 * Estado completo de una tarjeta: cupo usado y disponible, tasa vigente, corte, fecha límite de pago,
 * lo que hay que pagar para no generar intereses y los intereses ya cargados. `null` si no es tarjeta.
 */
export function creditCardInfo(accountId) {
    const ctx = context();
    const account = ctx.accountsById.get(accountId);
    if (!account || !isCreditCard(account)) return null;

    const today = todayStr();
    const balance = accountBalance(accountId);
    const owed = Math.max(0, -balance);
    const limit = Number(account.creditLimit) || 0;
    const entry = rateEntryAt(account, today);
    const data = account.initialBalance === undefined ? { cycles: [], entries: [] } : cardData(account, ctx);

    const [year, month] = today.split('-').map(Number);
    let target = null;
    for (const offset of [-1, 0, 1]) {
        const dates = cycleDates(account, year, month + offset);
        if (dates.due >= today) { target = dates; break; }
    }
    const computed = data.cycles.find(c => c.cutoff === target.cutoff) || null;
    const statementClosed = target.cutoff <= today;

    let amountToAvoidInterest = owed;
    let estimatedInterest = 0;
    if (statementClosed && computed) {
        amountToAvoidInterest = computed.unpaid;
        estimatedInterest = computed.interest;
    }

    return {
        account,
        balance,
        owed,
        limit,
        available: money(limit + balance),
        usage: limit > 0 ? Math.min(100, (owed / limit) * 100) : 0,
        rate: { value: Number(entry.rate) || 0, type: entry.rateType || 'mensual', monthly: monthlyRate(entry.rate, entry.rateType) },
        cutoffDay: account.cutoffDay || 1,
        paymentDay: account.paymentDay || 1,
        statementClosed,
        nextCutoff: statementClosed ? nextDateForDay(account.cutoffDay || 1, today) : target.cutoff,
        dueDate: target.due,
        daysToDue: diffDays(today, target.due),
        amountToAvoidInterest: money(amountToAvoidInterest),
        estimatedInterest,
        interestCharged: money(data.entries.reduce((sum, e) => sum + e.amount, 0))
    };
}

/** Abonos menos retiros de cada meta. */
function goalTotals(ctx) {
    if (!ctx.goalTotals) {
        const totals = new Map();
        DataService.all('transactions').forEach(t => {
            const goalId = goalIdForTransaction(t);
            if (!goalId) return;
            const sign = t.type === 'Ahorro' ? 1 : -1;
            totals.set(goalId, (totals.get(goalId) || 0) + sign * (Number(t.amount) || 0));
        });
        ctx.goalTotals = totals;
    }
    return ctx.goalTotals;
}

/** Meta a la que pertenece un movimiento (vínculo por id; por descripción en datos antiguos). */
export function goalIdForTransaction(t) {
    if (t.goalId) return t.goalId;
    const description = t.description || '';
    let name = null;
    if (t.type === 'Ahorro' && description.startsWith('Abono a meta: ')) name = description.slice('Abono a meta: '.length);
    else if (t.category === 'Retiro de Ahorros' && description.startsWith('Retiro de ahorros: ')) name = description.slice('Retiro de ahorros: '.length);
    if (!name) return null;
    return DataService.all('goals').find(g => g.description === name)?.id || null;
}

/** Avance de una meta = base + abonos − retiros (las anteriores a la migración usan el monto guardado). */
export function goalAmount(goal) {
    if (goal.baseAmount === undefined && goal.currentAmount !== undefined) return money(goal.currentAmount);
    return money((Number(goal.baseAmount) || 0) + (goalTotals(context()).get(goal.id) || 0));
}

export function totalSavings() {
    return money(DataService.all('goals').reduce((sum, g) => sum + goalAmount(g), 0));
}

/** Fecha centinela: una deuda sin `interestFrom` (datos anteriores) no causa intereses. */
const NEVER = '9999-12-31';

function debtPaidTotals(ctx) {
    if (!ctx.debtPaid) {
        const paid = new Map();
        DataService.all('debtPayments').forEach(p => {
            paid.set(p.debtId, (paid.get(p.debtId) || 0) + (Number(p.amount) || 0));
        });
        ctx.debtPaid = paid;
    }
    return ctx.debtPaid;
}

/** Suma de todo lo pagado a la deuda (capital + intereses). */
export function debtPaid(debt) {
    return money(debtPaidTotals(context()).get(debt.id) || 0);
}

/** Meses (con fracción: días/30) entre dos fechas YYYY-MM-DD. */
function monthsBetween(from, to) {
    if (to <= from) return 0;
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    let whole = (ty - fy) * 12 + (tm - fm);
    if (td < fd) whole -= 1;
    const anchor = dateInMonth(fy, fm + whole, fd);
    return whole + diffDays(anchor, to) / 30;
}

/**
 * Amortiza la deuda cronológicamente: los intereses se causan sobre el capital desde `interestFrom`;
 * cada pago cubre primero los intereses y el resto abona a capital.
 */
function debtState(debt, ctx = context()) {
    if (!ctx.debtStates) ctx.debtStates = new Map();
    if (ctx.debtStates.has(debt.id)) return ctx.debtStates.get(debt.id);

    const monthly = (Number(debt.interestRate) || 0) / 1200;
    const from = debt.interestFrom || NEVER;
    const today = todayStr();
    const payments = DataService.all('debtPayments')
        .filter(p => p.debtId === debt.id)
        .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.timestamp || 0) - (b.timestamp || 0));

    let capital = Number(debt.baseBalance) || 0;
    let accrued = 0;
    let interestPaid = 0;
    let last = from;

    payments.forEach(p => {
        const amount = Number(p.amount) || 0;
        if (monthly === 0 || (p.date || '') < from) {
            capital = Math.max(0, capital - amount);
            return;
        }
        accrued += capital * monthly * monthsBetween(last, p.date);
        last = p.date > last ? p.date : last;
        const toInterest = Math.min(accrued, amount);
        accrued -= toInterest;
        interestPaid += toInterest;
        capital = Math.max(0, capital - (amount - toInterest));
    });

    if (monthly > 0 && from <= today) accrued += capital * monthly * monthsBetween(last, today);

    const state = {
        capital: money(capital),
        accruedInterest: money(accrued),
        interestPaid: money(interestPaid),
        balance: money(capital + accrued)
    };
    ctx.debtStates.set(debt.id, state);
    return state;
}

/** Saldo pendiente = capital + intereses causados (las deudas anteriores a la migración usan el saldo guardado). */
export function debtBalance(debt) {
    if (debt.baseBalance === undefined && debt.currentBalance !== undefined) return money(debt.currentBalance);
    return debtState(debt).balance;
}

export function debtInterestAccrued(debt) {
    return debt.baseBalance === undefined ? 0 : debtState(debt).accruedInterest;
}

export function debtInterestPaid(debt) {
    return debt.baseBalance === undefined ? 0 : debtState(debt).interestPaid;
}

/** Avance (0-100) de capital pagado. */
export function debtProgress(debt) {
    if (debt.baseBalance === undefined) {
        const principal = Number(debt.initialBalance) || 0;
        return principal > 0 ? Math.min(100, Math.max(0, (principal - debtBalance(debt)) / principal * 100)) : 0;
    }
    const base = Number(debt.baseBalance) || 0;
    return base > 0 ? Math.min(100, Math.max(0, (base - debtState(debt).capital) / base * 100)) : 100;
}

/** Cuotas que faltan según el plazo (null si la deuda no tiene plazo). */
export function debtRemainingTerm(debt) {
    const term = Number(debt.termMonths) || 0;
    if (!term) return null;
    const [ty, tm] = todayStr().split('-').map(Number);
    const [sy, sm] = (debt.startDate || todayStr()).split('-').map(Number);
    return Math.max(1, term - ((ty * 12 + tm) - (sy * 12 + sm)));
}

/**
 * Cuota mensual calculada: con plazo, cuota francesa sobre el saldo pendiente, la
 * tasa y los meses restantes. Sin plazo se usa la cuota manual (`monthlyPayment`).
 */
export function debtMonthlyPayment(debt) {
    const balance = debtBalance(debt);
    if (balance <= 0) return 0;
    const n = debtRemainingTerm(debt);
    const monthly = (Number(debt.interestRate) || 0) / 1200;
    let payment;
    if (n) payment = monthly > 0 ? balance * monthly / (1 - Math.pow(1 + monthly, -n)) : balance / n;
    else payment = Number(debt.monthlyPayment) || 0;
    return money(Math.min(payment, balance));
}

/** Meses que faltan para terminar de pagar (null si no se puede estimar). */
export function debtMonthsLeft(debt) {
    const balance = debtBalance(debt);
    if (balance <= 0) return 0;
    const n = debtRemainingTerm(debt);
    if (n) return n;
    const payment = Number(debt.monthlyPayment) || 0;
    if (payment <= 0) return null;
    const monthly = (Number(debt.interestRate) || 0) / 1200;
    if (monthly > 0) {
        if (payment <= balance * monthly) return null;
        return Math.ceil(-Math.log(1 - balance * monthly / payment) / Math.log(1 + monthly));
    }
    return Math.ceil(balance / payment);
}

export function debtNextPaymentDate(debt) {
    return debt.paymentDay ? nextDateForDay(debt.paymentDay) : null;
}
