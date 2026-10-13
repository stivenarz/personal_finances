import { DataService } from '../../services/data-service.js';
import { openFormModal, confirmDialog } from '../../core/modal.js';
import { showNotification } from '../../core/notifications.js';
import { uiState } from '../../core/state.js';
import { escapeHtml, formatNumber, formatMoney, money, uid, daysInMonth } from '../../core/utils.js';
import { accountBalance, creditCardInfo, debtBalance, debtMonthlyPayment, isCreditCard } from '../../domain/ledger.js';

let root;
const PLAN_UI = { selectedPlanId: '', draft: {} };

/** Configuración de ingresos fijos (documento 'plan' de settings) con valores por defecto. */
function getPlanSettings() {
    const saved = DataService.find('settings', 'plan') || {};
    return { frecuencia: 'mensual', diaCobro1: 1, diaCobro2: 15, ingresosFijos: 0, ...saved };
}

function monthDays(ym) {
    const [year, month] = ym.split('-').map(Number);
    return daysInMonth(year, month);
}

function clampDay(day, ym) {
    return Math.min(monthDays(ym), Math.max(1, Math.round(Number(day)) || 1));
}

/** Ingresos fijos del mes como proyección: uno mensual o dos quincenales. No son ingresos reales. */
function projectedIncomes(ym) {
    const settings = getPlanSettings();
    const total = Number(settings.ingresosFijos) || 0;
    if (total <= 0) return [];

    if (settings.frecuencia === 'quincenal') {
        const first = money(total / 2);
        return [
            { key: 'ingreso:1', day: clampDay(settings.diaCobro1, ym), amount: first, label: 'Ingreso quincena 1', kind: 'ingreso' },
            { key: 'ingreso:2', day: clampDay(settings.diaCobro2, ym), amount: money(total - first), label: 'Ingreso quincena 2', kind: 'ingreso' }
        ];
    }
    return [{ key: 'ingreso:1', day: clampDay(settings.diaCobro1, ym), amount: money(total), label: 'Ingreso mensual', kind: 'ingreso' }];
}

/** Pagos del mes: deudas (cuota sugerida), tarjetas (lo que hay que pagar para no generar intereses) y gastos fijos. */
function plannedObligations() {
    const debts = DataService.all('debts')
        .filter(d => debtBalance(d) > 0)
        .map(d => ({
            key: 'debt:' + d.id,
            label: `Deuda: ${d.entity || 'Sin nombre'}`,
            amount: debtMonthlyPayment(d),
            day: d.paymentDay || 1,
            kind: 'egreso'
        }));

    const cards = DataService.all('accounts')
        .filter(isCreditCard)
        .map(card => ({ card, info: creditCardInfo(card.id) }))
        .filter(({ info }) => info && info.amountToAvoidInterest > 0)
        .map(({ card, info }) => ({
            key: 'card:' + card.id,
            label: `Tarjeta: ${card.name}`,
            amount: money(info.amountToAvoidInterest),
            day: info.paymentDay,
            kind: 'egreso'
        }));

    const fixed = DataService.all('recurringExpenses').map(r => ({
        key: 'rec:' + r.id,
        label: r.name,
        amount: money(r.amount),
        day: r.day,
        kind: 'egreso'
    }));
    return [...debts, ...cards, ...fixed];
}

/** Saldo con el que arranca el mes: cuentas líquidas (sin ahorros ni tarjetas, cuya deuda ya es una obligación). */
function planningStartBalance() {
    return money(DataService.all('accounts')
        .filter(a => a.type !== 'Ahorros' && !isCreditCard(a))
        .reduce((sum, a) => sum + accountBalance(a.id), 0));
}

/**
 * Simula el saldo día a día del mes. `overrides` cambia el día de pago de cada obligación (clave → día).
 * Devuelve las filas del calendario, el saldo mínimo y el margen del mes.
 */
function simulatePlan(ym, overrides) {
    const incomes = projectedIncomes(ym);
    const obligations = plannedObligations();
    const events = [
        ...incomes,
        ...obligations.map(o => ({ ...o, day: clampDay(overrides[o.key] ?? o.day, ym) }))
    ].sort((a, b) => a.day - b.day || (a.kind === 'ingreso' ? -1 : 1));

    const startBalance = planningStartBalance();
    let balance = startBalance;
    let minBalance = startBalance;
    let minDay = 0;
    const rows = events.map(event => {
        balance = money(balance + (event.kind === 'ingreso' ? event.amount : -event.amount));
        if (balance < minBalance) {
            minBalance = balance;
            minDay = event.day;
        }
        return { ...event, balance };
    });

    const totalIncome = money(incomes.reduce((sum, i) => sum + i.amount, 0));
    const totalOut = money(obligations.reduce((sum, o) => sum + o.amount, 0));
    return { rows, startBalance, minBalance, minDay, totalIncome, totalOut, margin: money(totalIncome - totalOut) };
}

function realIncomeThisMonth(ym) {
    return money(DataService.all('transactions')
        .filter(t => t.type === 'Ingreso' && t.category !== 'Retiro de Ahorros' && (t.date || '').startsWith(ym))
        .reduce((sum, t) => sum + (t.amount || 0), 0));
}

function openIncomeSettingsForm() {
    const settings = getPlanSettings();
    openFormModal({
        title: 'Ingresos fijos del mes',
        note: 'Son una proyección para planificar. Sólo los ingresos registrados manualmente cuentan como ingreso real.',
        successMessage: '✅ Ingresos fijos guardados',
        fields: [
            { name: 'ingresosFijos', label: 'Ingresos fijos del mes ($)', type: 'number', min: 0, value: settings.ingresosFijos || '' },
            {
                name: 'frecuencia', label: 'Frecuencia de cobro', type: 'select', value: settings.frecuencia,
                options: [{ value: 'mensual', label: 'Mensual' }, { value: 'quincenal', label: 'Quincenal' }]
            },
            { name: 'diaCobro1', label: 'Día de cobro', type: 'number', min: 1, max: 31, step: 1, value: settings.diaCobro1 },
            {
                name: 'diaCobro2', label: 'Segundo día de cobro (quincena)', type: 'number', min: 1, max: 31, step: 1,
                value: settings.diaCobro2, visibleIf: v => v.frecuencia === 'quincenal'
            }
        ],
        onSubmit: (v) => {
            if (!(v.ingresosFijos >= 0)) return '❌ Ingresa un monto válido';
            DataService.save('settings', {
                id: 'plan',
                ingresosFijos: money(v.ingresosFijos),
                frecuencia: v.frecuencia,
                diaCobro1: clampDay(v.diaCobro1, uiState.currentMonth),
                diaCobro2: clampDay(v.diaCobro2 ?? settings.diaCobro2, uiState.currentMonth)
            });
            return null;
        }
    });
}

function openFixedExpenseForm(item = null) {
    openFormModal({
        title: item ? 'Editar gasto fijo' : 'Agregar gasto fijo',
        submitLabel: item ? 'Guardar cambios' : 'Agregar gasto fijo',
        successMessage: item ? '✅ Cambios guardados' : '✅ Gasto fijo agregado',
        fields: [
            { name: 'name', label: 'Nombre', type: 'text', value: item?.name || '', placeholder: 'Ej: Arriendo' },
            { name: 'amount', label: 'Monto ($)', type: 'number', min: 0, value: item?.amount ?? '' },
            { name: 'day', label: 'Día de pago (1-31)', type: 'number', min: 1, max: 31, step: 1, value: item?.day ?? '' }
        ],
        onSubmit: (v) => {
            const name = v.name.trim();
            if (!name) return '❌ El nombre no puede estar vacío';
            if (!(v.amount > 0)) return '❌ Ingresa un monto válido';
            const fields = { name, amount: money(v.amount), day: clampDay(v.day, uiState.currentMonth) };
            if (item) DataService.patch('recurringExpenses', item.id, fields);
            else DataService.save('recurringExpenses', { id: uid('rec'), ...fields, createdAt: Date.now() });
            return null;
        }
    });
}

async function deleteFixedExpense(item) {
    if (!item) return;
    const ok = await confirmDialog({
        title: 'Eliminar gasto fijo',
        message: `¿Eliminar el gasto fijo "${escapeHtml(item.name)}"?`,
        confirmLabel: 'Eliminar',
        danger: true
    });
    if (ok) DataService.remove('recurringExpenses', item.id);
}

function openSavePlanForm() {
    openFormModal({
        title: 'Guardar como plan',
        successMessage: '✅ Plan guardado',
        submitLabel: 'Guardar plan',
        fields: [{ name: 'name', label: 'Nombre del plan', type: 'text', value: '', placeholder: 'Ej: Pagar tarjeta primero' }],
        onSubmit: (v) => {
            const name = v.name.trim();
            if (!name) return '❌ Escribe un nombre para el plan';
            const plan = DataService.save('paymentPlans', { id: uid('plan'), name, overrides: { ...PLAN_UI.draft }, createdAt: Date.now() });
            PLAN_UI.selectedPlanId = plan.id;
            return null;
        }
    });
}

/** Vista Planificación: ingresos fijos (proyección), gastos fijos, planes de pago y calendario de saldo del mes. */
export function mount(container) {
    root = container;
    root.innerHTML = `
        <div class="plan-grid">
            <section class="plan-card">
                <div class="plan-card-head">
                    <h3>Ingresos fijos del mes</h3>
                    <button type="button" class="btn btn-primary btn-sm" data-action="income-settings">✏️ Configurar</button>
                </div>
                <p class="plan-help">Son una proyección para planificar. Sólo los ingresos registrados manualmente cuentan como ingreso real.</p>
                <div data-income-summary></div>
            </section>

            <section class="plan-card">
                <div class="plan-card-head">
                    <h3>Gastos fijos</h3>
                    <button type="button" class="btn btn-primary btn-sm" data-action="fixed-add">➕ Agregar</button>
                </div>
                <div class="plan-list" data-fixed-list></div>
            </section>

            <section class="plan-card plan-wide">
                <h3>Análisis del mes</h3>
                <div class="plan-kpis" data-kpis></div>
                <div data-alerts></div>
            </section>

            <section class="plan-card plan-wide">
                <h3>Planes de pago</h3>
                <div class="plan-toolbar">
                    <select data-plan-selector></select>
                    <button type="button" class="btn btn-secondary" data-action="plan-update">Actualizar plan</button>
                    <button type="button" class="btn btn-danger" data-action="plan-delete">Eliminar plan</button>
                    <button type="button" class="btn btn-primary" data-action="plan-save">Guardar como plan</button>
                </div>
                <div class="plan-list" data-obligations></div>
            </section>

            <section class="plan-card plan-wide">
                <h3>Calendario de pagos</h3>
                <div class="plan-calendar" data-calendar></div>
            </section>
        </div>
    `;

    root.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action]');
        if (!target) return;
        const id = target.dataset.id;
        switch (target.dataset.action) {
            case 'income-settings': openIncomeSettingsForm(); break;
            case 'fixed-add': openFixedExpenseForm(); break;
            case 'fixed-edit': openFixedExpenseForm(DataService.find('recurringExpenses', id)); break;
            case 'fixed-delete': deleteFixedExpense(DataService.find('recurringExpenses', id)); break;
            case 'plan-save': openSavePlanForm(); break;
            case 'plan-update':
                if (!PLAN_UI.selectedPlanId) return;
                DataService.patch('paymentPlans', PLAN_UI.selectedPlanId, { overrides: { ...PLAN_UI.draft } });
                showNotification('✅ Plan actualizado', 'success');
                break;
            case 'plan-delete': deletePlan(); break;
        }
    });

    root.querySelector('[data-obligations]').addEventListener('change', (e) => {
        const key = e.target.dataset.planKey;
        if (!key) return;
        PLAN_UI.draft[key] = Number(e.target.value);
        render();
    });

    root.querySelector('[data-plan-selector]').addEventListener('change', (e) => {
        PLAN_UI.selectedPlanId = e.target.value;
        const plan = DataService.find('paymentPlans', e.target.value);
        PLAN_UI.draft = plan ? { ...(plan.overrides || {}) } : {};
        render();
    });
}

async function deletePlan() {
    if (!PLAN_UI.selectedPlanId) return;
    const plan = DataService.find('paymentPlans', PLAN_UI.selectedPlanId);
    const ok = await confirmDialog({
        title: 'Eliminar plan',
        message: `¿Eliminar el plan "${escapeHtml(plan?.name || '')}"?`,
        confirmLabel: 'Eliminar',
        danger: true
    });
    if (!ok) return;
    DataService.remove('paymentPlans', PLAN_UI.selectedPlanId);
    PLAN_UI.selectedPlanId = '';
    PLAN_UI.draft = {};
}

export function render() {
    const ym = uiState.currentMonth;
    const settings = getPlanSettings();

    root.querySelector('[data-income-summary]').innerHTML = settings.ingresosFijos > 0
        ? `<div class="plan-item"><div><strong>${formatMoney(settings.ingresosFijos)}</strong>
            <div class="plan-item-meta">${settings.frecuencia === 'quincenal' ? `Quincenal · días ${settings.diaCobro1} y ${settings.diaCobro2}` : `Mensual · día ${settings.diaCobro1}`}</div></div></div>`
        : '<p class="plan-empty">Aún no configuras ingresos fijos</p>';

    renderFixedExpenses();
    renderPlanSelector();

    const selected = simulatePlan(ym, PLAN_UI.draft);
    const base = simulatePlan(ym, {});
    renderKpis(selected, base, ym);
    renderObligations(ym);
    renderCalendar(selected, ym);
}

function renderFixedExpenses() {
    const container = root.querySelector('[data-fixed-list]');
    const items = DataService.all('recurringExpenses');
    if (!items.length) {
        container.innerHTML = '<p class="plan-empty">No hay gastos fijos registrados</p>';
        return;
    }
    container.innerHTML = items.map(r => `
        <div class="plan-item">
            <div>
                <strong>${escapeHtml(r.name)}</strong>
                <div class="plan-item-meta">Día ${r.day} · $${formatNumber(r.amount)}</div>
            </div>
            <div class="plan-item-actions">
                <button class="btn btn-secondary btn-sm" data-action="fixed-edit" data-id="${escapeHtml(r.id)}">Editar</button>
                <button class="btn btn-danger btn-sm" data-action="fixed-delete" data-id="${escapeHtml(r.id)}">Eliminar</button>
            </div>
        </div>
    `).join('');
}

function renderPlanSelector() {
    const select = root.querySelector('[data-plan-selector]');
    const plans = [...DataService.all('paymentPlans')].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

    if (PLAN_UI.selectedPlanId && !plans.some(p => p.id === PLAN_UI.selectedPlanId)) {
        PLAN_UI.selectedPlanId = '';
        PLAN_UI.draft = {};
    }

    select.innerHTML = '<option value="">Plan base (días actuales)</option>' +
        plans.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
    select.value = PLAN_UI.selectedPlanId;

    const hasSelection = !!PLAN_UI.selectedPlanId;
    root.querySelector('[data-action="plan-update"]').disabled = !hasSelection;
    root.querySelector('[data-action="plan-delete"]').disabled = !hasSelection;
}

function renderKpis(selected, base, ym) {
    const realIncome = realIncomeThisMonth(ym);

    root.querySelector('[data-kpis]').innerHTML = `
        <div class="plan-kpi"><span>Ingresos proyectados</span><strong>$${formatNumber(selected.totalIncome)}</strong></div>
        <div class="plan-kpi"><span>Obligaciones del mes</span><strong>$${formatNumber(selected.totalOut)}</strong></div>
        <div class="plan-kpi"><span>Margen</span><strong class="${selected.margin < 0 ? 'neg' : 'pos'}">$${formatNumber(selected.margin)}</strong></div>
        <div class="plan-kpi"><span>Saldo mínimo</span><strong class="${selected.minBalance < 0 ? 'neg' : ''}">$${formatNumber(selected.minBalance)}${selected.minDay ? ` (día ${selected.minDay})` : ''}</strong></div>
        <div class="plan-kpi"><span>Ingreso real registrado</span><strong>$${formatNumber(realIncome)}</strong></div>
    `;

    const messages = [];
    if (selected.totalIncome === 0) messages.push('<div class="plan-note">Configura tus ingresos fijos del mes para ver el análisis.</div>');
    if (selected.margin < 0) messages.push('<div class="plan-alert">⚠️ Las obligaciones del mes superan los ingresos fijos.</div>');
    if (selected.minBalance < 0) {
        messages.push(`<div class="plan-alert">⚠️ Con este plan el saldo baja a $${formatNumber(selected.minBalance)} el día ${selected.minDay}.</div>`);
    } else if (selected.totalIncome > 0) {
        messages.push('<div class="plan-ok">✅ El plan mantiene el saldo en positivo durante el mes.</div>');
    }
    if (PLAN_UI.selectedPlanId) {
        messages.push(`<div class="plan-note">Plan base: saldo mínimo $${formatNumber(base.minBalance)}${base.minDay ? ` (día ${base.minDay})` : ''}.</div>`);
    }
    root.querySelector('[data-alerts]').innerHTML = messages.join('');
}

function renderObligations(ym) {
    const container = root.querySelector('[data-obligations]');
    const obligations = plannedObligations();
    if (!obligations.length) {
        container.innerHTML = '<p class="plan-empty">No hay obligaciones: agrega deudas, tarjetas con saldo o gastos fijos.</p>';
        return;
    }
    const max = monthDays(ym);
    const dayOptions = (selectedDay) => Array.from({ length: max }, (_, i) => i + 1)
        .map(d => `<option value="${d}" ${d === selectedDay ? 'selected' : ''}>${d}</option>`).join('');

    container.innerHTML = obligations.map(o => {
        const day = clampDay(PLAN_UI.draft[o.key] ?? o.day, ym);
        return `
            <div class="plan-item">
                <div>
                    <strong>${escapeHtml(o.label)}</strong>
                    <div class="plan-item-meta">$${formatNumber(o.amount)} al mes</div>
                </div>
                <label class="plan-day-select">Día
                    <select data-plan-key="${escapeHtml(o.key)}">${dayOptions(day)}</select>
                </label>
            </div>
        `;
    }).join('');
}

function renderCalendar(selected, ym) {
    const [year, month] = ym.split('-');
    const formatDay = (day) => `${String(day).padStart(2, '0')}/${month}/${year}`;

    const body = selected.rows.map(row => `
        <tr class="${row.balance < 0 ? 'neg-row' : ''}">
            <td>${formatDay(row.day)}</td>
            <td>${escapeHtml(row.label)}</td>
            <td class="${row.kind === 'ingreso' ? 'pos' : 'neg'}">${row.kind === 'ingreso' ? '+' : '−'}$${formatNumber(row.amount)}</td>
            <td class="${row.balance < 0 ? 'neg' : ''}">$${formatNumber(row.balance)}</td>
        </tr>
    `).join('');

    root.querySelector('[data-calendar]').innerHTML = `
        <table class="plan-table">
            <thead><tr><th>Fecha</th><th>Concepto</th><th>Movimiento</th><th>Saldo</th></tr></thead>
            <tbody>
                <tr><td colspan="3">Saldo inicial (cuentas sin ahorro ni tarjetas)</td><td>$${formatNumber(selected.startBalance)}</td></tr>
                ${body}
            </tbody>
        </table>
    `;
}
