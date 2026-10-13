import { DataService } from '../../services/data-service.js';
import { uiState } from '../../core/state.js';
import { escapeHtml, formatNumber, formatDate, diffDays, todayStr } from '../../core/utils.js';
import {
    allTransactions, creditCardInfo, debtBalance, debtMonthlyPayment, debtNextPaymentDate, goalAmount,
    isCreditCard, totalAvailable, totalCreditDebt, totalSavings
} from '../../domain/ledger.js';
import { categoryLabel } from '../shared/options.js';
import { onThemeChange } from '../../services/theme-service.js';

let root;
const charts = {};
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#6366f1'];

const kpi = (color, icon, label, key, initial = '$0') => `
    <div class="kpi-card" style="border-left-color: ${color};">
        <div class="kpi-icon">${icon}</div>
        <div class="kpi-content">
            <div class="kpi-label">${label}</div>
            <div class="kpi-value" data-kpi="${key}">${initial}</div>
        </div>
    </div>`;

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Los gráficos toman sus colores del tema: al cambiarlo se recrean. */
function resetCharts() {
    Object.keys(charts).forEach(key => {
        charts[key].destroy();
        delete charts[key];
    });
}

/** Vista Dashboard: KPIs del mes, gráficos, presupuesto vs gasto real, próximos pagos y metas. */
export function mount(container) {
    root = container;
    onThemeChange(() => {
        resetCharts();
        if (root.classList.contains('active')) render();
    });
    root.innerHTML = `
        <div class="dashboard-grid">
            <div class="kpi-container">
                ${kpi('#10b981', '💵', 'Ingresos', 'income')}
                ${kpi('#ef4444', '💳', 'Egresos', 'expenses')}
                ${kpi('#3b82f6', '📈', 'Balance', 'balance')}
                ${kpi('#f59e0b', '💾', 'Tasa Ahorro', 'saving-rate', '0%')}
                ${kpi('#8b5cf6', '🏦', 'Saldo Disponible', 'available')}
                ${kpi('#ec4899', '🎯', 'Total Ahorros', 'savings')}
                ${kpi('#dc2626', '💳', 'Deuda Tarjetas', 'card-debt')}
            </div>

            <div class="charts-container">
                <div class="chart-card"><h3>Egresos por Categorías</h3><canvas data-chart="categories"></canvas></div>
                <div class="chart-card"><h3>Ingresos vs Egresos</h3><canvas data-chart="flow"></canvas></div>
            </div>

            <div class="budget-card"><h3>Presupuesto vs Gasto Real</h3><div class="budget-list" data-budget></div></div>
            <div class="debt-card"><h3>Próximos pagos</h3><div class="debt-list" data-upcoming></div></div>
            <div class="goals-card"><h3>Metas de Ahorro</h3><div class="goals-list" data-goals></div></div>
        </div>
    `;
}

const setKpi = (key, text) => { root.querySelector(`[data-kpi="${key}"]`).textContent = text; };

export function render() {
    const month = allTransactions().filter(t => (t.date || '').startsWith(uiState.currentMonth));

    const income = month.filter(t => t.type === 'Ingreso').reduce((sum, t) => sum + t.amount, 0);
    const expenses = month.filter(t => t.type === 'Egreso').reduce((sum, t) => sum + t.amount, 0);
    const savings = totalSavings();

    setKpi('income', `$${formatNumber(income)}`);
    setKpi('expenses', `$${formatNumber(expenses)}`);
    setKpi('balance', `$${formatNumber(income - expenses)}`);
    setKpi('saving-rate', `${(income > 0 ? (savings / income) * 100 : 0).toFixed(1)}%`);
    setKpi('available', `$${formatNumber(totalAvailable())}`);
    setKpi('savings', `$${formatNumber(savings)}`);
    setKpi('card-debt', `$${formatNumber(totalCreditDebt())}`);

    renderBudget(month);
    renderUpcoming();
    renderGoals();
    renderCharts(month);
}

function renderBudget(monthTransactions) {
    const expenses = monthTransactions.filter(t => t.type === 'Egreso');
    const rows = DataService.all('categories')
        .filter(c => c.type === 'Egreso')
        .map(cat => ({
            name: cat.name,
            budget: Number(cat.budget) || 0,
            spent: expenses.filter(e => e.category === cat.id).reduce((sum, e) => sum + e.amount, 0)
        }))
        .filter(row => row.budget > 0 || row.spent > 0);

    root.querySelector('[data-budget]').innerHTML = rows.map(row => {
        const percentage = row.budget > 0 ? (row.spent / row.budget) * 100 : 100;
        const status = percentage > 100 ? 'danger' : percentage > 80 ? 'warning' : '';
        return `
            <div class="budget-item">
                <span class="budget-item-name">${escapeHtml(row.name)}</span>
                <div class="budget-item-progress"><div class="budget-item-bar ${status}" style="width: ${Math.min(percentage, 100)}%"></div></div>
                <span class="budget-item-amount">$${formatNumber(row.spent)} / $${formatNumber(row.budget)}</span>
            </div>`;
    }).join('') || '<p class="empty-state">Sin categorías con presupuesto</p>';
}

function renderUpcoming() {
    const today = todayStr();
    const upcoming = [];

    DataService.all('debts').filter(d => debtBalance(d) > 0).forEach(debt => {
        const date = debtNextPaymentDate(debt);
        const days = date ? diffDays(today, date) : 0;
        if (days <= 7) upcoming.push({ name: debt.entity, days, amount: debtMonthlyPayment(debt), tag: '' });
    });

    DataService.all('accounts').filter(isCreditCard).forEach(card => {
        const info = creditCardInfo(card.id);
        if (info.amountToAvoidInterest > 0 && info.daysToDue <= 7) {
            upcoming.push({ name: `💳 ${card.name}`, days: info.daysToDue, amount: info.amountToAvoidInterest, tag: formatDate(info.dueDate) });
        }
    });

    upcoming.sort((a, b) => a.days - b.days);
    root.querySelector('[data-upcoming]').innerHTML = upcoming.slice(0, 6).map(item => `
        <div class="debt-item">
            <span class="debt-item-name">${escapeHtml(item.name)}</span>
            <span class="debt-item-status ${item.days <= 2 ? 'urgent' : 'alert'}">${item.days === 0 ? 'Hoy' : `${item.days} días`}</span>
            <span class="debt-amount">$${formatNumber(item.amount)}</span>
        </div>`).join('') || '<p class="empty-state">Sin pagos próximos</p>';
}

function renderGoals() {
    const goals = DataService.all('goals');
    root.querySelector('[data-goals]').innerHTML = goals.map(goal => {
        const progress = goal.targetAmount > 0 ? (goalAmount(goal) / goal.targetAmount) * 100 : 0;
        return `
            <div class="goal-item">
                <span class="budget-item-name">${escapeHtml(goal.description)}</span>
                <div class="budget-item-progress"><div class="budget-item-bar" style="width: ${Math.min(progress, 100)}%"></div></div>
                <span class="budget-item-amount">${Math.round(progress)}%</span>
            </div>`;
    }).join('') || '<p class="empty-state">No hay metas establecidas</p>';
}

function upsertChart(key, canvasKey, config) {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.color = cssVar('--text-secondary');
    Chart.defaults.borderColor = cssVar('--border');
    const canvas = root.querySelector(`[data-chart="${canvasKey}"]`);
    if (!canvas) return;

    if (charts[key]) {
        charts[key].data = config.data;
        charts[key].update('none');
    } else {
        charts[key] = new Chart(canvas.getContext('2d'), config);
    }
}

/** Los gráficos reflejan el mes elegido en el filtro del encabezado. */
function renderCharts(transactions) {
    const expenses = transactions.filter(t => t.type === 'Egreso');
    const income = transactions.filter(t => t.type === 'Ingreso').reduce((sum, t) => sum + t.amount, 0);
    const spent = expenses.reduce((sum, t) => sum + t.amount, 0);

    const byCategory = {};
    expenses.forEach(t => {
        const name = categoryLabel(t);
        byCategory[name] = (byCategory[name] || 0) + t.amount;
    });

    upsertChart('categories', 'categories', {
        type: 'doughnut',
        data: {
            labels: Object.keys(byCategory),
            datasets: [{ data: Object.values(byCategory), backgroundColor: COLORS, borderColor: cssVar('--bg-primary'), borderWidth: 2 }]
        },
        options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom' } } }
    });

    upsertChart('flow', 'flow', {
        type: 'bar',
        data: {
            labels: ['Ingresos', 'Egresos', 'Balance'],
            datasets: [{ label: 'Monto ($)', data: [income, spent, income - spent], backgroundColor: ['#10b981', '#ef4444', '#3b82f6'], borderRadius: 8 }]
        },
        options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
}
