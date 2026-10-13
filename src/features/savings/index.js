import { DataService } from '../../services/data-service.js';
import { openFormModal, confirmDialog } from '../../core/modal.js';
import { showNotification } from '../../core/notifications.js';
import { escapeHtml, formatNumber, formatMoney, money, todayStr, uid } from '../../core/utils.js';
import { sectionToolbar, emptyState, onActions } from '../../core/ui.js';
import { goalAmount, goalIdForTransaction, isCreditCard, totalSavings } from '../../domain/ledger.js';
import { createGoalDeposit, createGoalWithdrawal } from '../../domain/transactions.js';
import { accountOptions } from '../shared/options.js';

let root;

/** Vista Ahorros: metas con abonos y retiros; el avance se calcula desde los movimientos. */
export function mount(container) {
    root = container;
    root.innerHTML = `
        <div class="kpi-container savings-kpis">
            <div class="kpi-card" style="border-left-color: #ec4899;">
                <div class="kpi-icon">🎯</div>
                <div class="kpi-content"><div class="kpi-label">Total Ahorros</div><div class="kpi-value" data-kpi="total">$0</div></div>
            </div>
            <div class="kpi-card" style="border-left-color: #06b6d4;">
                <div class="kpi-icon">📊</div>
                <div class="kpi-content"><div class="kpi-label">Metas Activas</div><div class="kpi-value" data-kpi="active">0</div></div>
            </div>
            <div class="kpi-card" style="border-left-color: #10b981;">
                <div class="kpi-icon">✅</div>
                <div class="kpi-content"><div class="kpi-label">Metas Completadas</div><div class="kpi-value" data-kpi="done">0</div></div>
            </div>
        </div>
        <div class="list-section">
            ${sectionToolbar('Mis metas de ahorro', { addLabel: 'Nueva meta' })}
            <div class="goals-list" data-list></div>
        </div>
    `;

    onActions(root, {
        add: () => openGoalForm(),
        edit: (id) => openGoalForm(DataService.find('goals', id)),
        deposit: (id) => openDepositForm(DataService.find('goals', id)),
        withdraw: (id) => openWithdrawForm(DataService.find('goals', id)),
        delete: (id) => deleteGoal(DataService.find('goals', id))
    });
}

function openGoalForm(goal = null) {
    openFormModal({
        title: goal ? 'Editar meta de ahorro' : 'Nueva meta de ahorro',
        note: goal ? 'El monto ahorrado cambia con los abonos y retiros.' : '',
        submitLabel: goal ? 'Guardar cambios' : 'Crear meta',
        successMessage: goal ? '✅ Cambios guardados' : '✅ Meta de ahorro creada',
        fields: [
            { name: 'description', label: 'Descripción', type: 'text', value: goal?.description || '', placeholder: 'Ej: Viaje a Cartagena' },
            { name: 'targetAmount', label: 'Monto a ahorrar ($)', type: 'number', min: 0, value: goal?.targetAmount ?? '' },
            { name: 'deadline', label: 'Fecha meta', type: 'date', value: goal?.deadline || '' }
        ],
        onSubmit: (v) => {
            const description = v.description.trim();
            if (!description) return '❌ La descripción no puede estar vacía';
            if (!(v.targetAmount > 0)) return '❌ Ingresa un monto objetivo válido';

            if (goal) {
                const oldName = goal.description;
                DataService.patch('goals', goal.id, { description, targetAmount: money(v.targetAmount), deadline: v.deadline });
                if (oldName !== description) {
                    DataService.all('transactions')
                        .filter(t => goalIdForTransaction(t) === goal.id)
                        .forEach(t => {
                            const prefix = t.type === 'Ahorro' ? 'Abono a meta: ' : 'Retiro de ahorros: ';
                            DataService.patch('transactions', t.id, { description: prefix + description, goalId: goal.id });
                        });
                }
            } else {
                DataService.save('goals', {
                    id: uid('saving'), description, targetAmount: money(v.targetAmount),
                    baseAmount: 0, deadline: v.deadline, createdAt: Date.now()
                });
            }
            return null;
        }
    });
}

function openDepositForm(goal) {
    if (!goal) return;
    const saved = goalAmount(goal);
    openFormModal({
        title: 'Abonar a meta de ahorro',
        note: `<strong>${escapeHtml(goal.description)}</strong><br>Ahorrado: ${formatMoney(saved)} / ${formatMoney(goal.targetAmount)}<br>Falta: ${formatMoney(Math.max(0, goal.targetAmount - saved))}`,
        submitLabel: 'Registrar abono',
        successMessage: '✅ Abono registrado correctamente',
        fields: [
            { name: 'account', label: 'Cuenta de origen', type: 'select', value: '', options: accountOptions({ filter: a => !isCreditCard(a) }) },
            { name: 'amount', label: 'Monto ($)', type: 'number', min: 0 },
            { name: 'date', label: 'Fecha', type: 'date', value: todayStr() }
        ],
        onSubmit: (v) => {
            if (!v.account) return '❌ Selecciona una cuenta';
            return createGoalDeposit({ goalId: goal.id, account: v.account, amount: v.amount, date: v.date }).error || null;
        }
    });
}

function openWithdrawForm(goal) {
    if (!goal) return;
    const saved = goalAmount(goal);
    if (saved <= 0) {
        showNotification('❌ No hay saldo en esta meta de ahorro', 'error');
        return;
    }
    openFormModal({
        title: 'Retiro de ahorros',
        note: `<strong>${escapeHtml(goal.description)}</strong><br>Disponible en la meta: ${formatMoney(saved)}`,
        submitLabel: 'Confirmar retiro',
        successMessage: '✅ Retiro de ahorros realizado',
        fields: [
            { name: 'account', label: 'Cuenta destino', type: 'select', value: '', options: accountOptions({ filter: a => !isCreditCard(a) }) },
            { name: 'amount', label: 'Monto ($)', type: 'number', min: 0, max: saved },
            { name: 'date', label: 'Fecha', type: 'date', value: todayStr() }
        ],
        onSubmit: (v) => {
            if (!v.account) return '❌ Selecciona una cuenta';
            return createGoalWithdrawal({ goalId: goal.id, account: v.account, amount: v.amount, date: v.date }).error || null;
        }
    });
}

async function deleteGoal(goal) {
    if (!goal) return;
    const saved = goalAmount(goal);

    if (saved > 0) {
        openFormModal({
            title: '⚠️ Meta con saldo',
            note: `La meta <strong>"${escapeHtml(goal.description)}"</strong> tiene ${formatMoney(saved)} ahorrados. Para eliminarla, ese saldo se devolverá a la cuenta que elijas.`,
            submitLabel: 'Devolver saldo y eliminar',
            danger: true,
            fields: [
                { name: 'account', label: 'Devolver a', type: 'select', value: '', options: accountOptions({ filter: a => !isCreditCard(a) }) }
            ],
            onSubmit: (v) => {
                if (!v.account) return '❌ Selecciona una cuenta destino';
                const outcome = createGoalWithdrawal({ goalId: goal.id, account: v.account, amount: saved });
                if (outcome.error) return outcome.error;
                DataService.remove('goals', goal.id);
                showNotification('✅ Meta eliminada. Saldo devuelto a la cuenta', 'success');
                return null;
            }
        });
        return;
    }

    const ok = await confirmDialog({
        title: 'Eliminar meta',
        message: `¿Eliminar la meta "${escapeHtml(goal.description)}"?`,
        confirmLabel: 'Eliminar',
        danger: true
    });
    if (!ok) return;
    DataService.remove('goals', goal.id);
    showNotification('🗑️ Meta eliminada', 'success');
}

export function render() {
    const goals = DataService.all('goals');
    const completed = goals.filter(g => goalAmount(g) >= g.targetAmount).length;

    root.querySelector('[data-kpi="total"]').textContent = `$${formatNumber(totalSavings())}`;
    root.querySelector('[data-kpi="active"]').textContent = goals.length - completed;
    root.querySelector('[data-kpi="done"]').textContent = completed;

    const list = root.querySelector('[data-list]');
    if (!goals.length) {
        list.innerHTML = emptyState('No hay metas de ahorro');
        return;
    }

    list.innerHTML = goals.map(goal => {
        const saved = goalAmount(goal);
        const progress = goal.targetAmount > 0 ? (saved / goal.targetAmount) * 100 : 0;
        const isCompleted = saved >= goal.targetAmount;
        const daysLeft = goal.deadline ? Math.ceil((new Date(goal.deadline) - new Date()) / 86400000) : null;
        const color = isCompleted ? '#10b981' : '#3b82f6';

        return `
            <div class="goal-card" style="border-left-color: ${color};">
                <div class="goal-card-top">
                    <div class="goal-card-info">
                        <h4>${escapeHtml(goal.description)}</h4>
                        <p>$${formatNumber(saved)} / $${formatNumber(goal.targetAmount)}</p>
                        ${daysLeft !== null ? `<p class="goal-card-deadline">Plazo: ${daysLeft} días</p>` : ''}
                    </div>
                    <div class="goal-card-actions">
                        <button class="btn btn-secondary btn-sm" data-action="edit" data-id="${escapeHtml(goal.id)}">✏️ Editar</button>
                        <button class="btn btn-primary btn-sm" data-action="deposit" data-id="${escapeHtml(goal.id)}">+ Abonar</button>
                        <button class="btn btn-info btn-sm" data-action="withdraw" data-id="${escapeHtml(goal.id)}">💰 Retiro</button>
                        <button class="btn btn-danger btn-sm" data-action="delete" data-id="${escapeHtml(goal.id)}">🗑️ Eliminar</button>
                    </div>
                </div>
                <div class="goal-progress"><div style="width: ${Math.min(progress, 100)}%; background: ${color};"></div></div>
                <p class="goal-card-percent">${progress.toFixed(0)}% completado</p>
            </div>
        `;
    }).join('');
}
