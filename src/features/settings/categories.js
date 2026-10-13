/**
 * Gestión de categorías (alta/edición en modal).
 */
import { DataService } from '../../services/data-service.js';
import { openFormModal, confirmDialog } from '../../core/modal.js';
import { showNotification } from '../../core/notifications.js';
import { escapeHtml, formatNumber, money, uid } from '../../core/utils.js';
import { onActions } from '../../core/ui.js';

export function mountCategories(section) {
    section.innerHTML = `
        <div class="section-toolbar">
            <h3>Gestionar Categorías</h3>
            <button type="button" class="btn btn-primary" data-action="add">➕ Agregar</button>
        </div>
        <div class="categories-list" data-list></div>
    `;

    onActions(section, {
        add: () => openCategoryForm(),
        edit: (id) => openCategoryForm(DataService.find('categories', id)),
        delete: (id) => deleteCategory(DataService.find('categories', id))
    });
}

function openCategoryForm(category = null) {
    openFormModal({
        title: category ? 'Editar categoría' : 'Agregar categoría',
        submitLabel: category ? 'Guardar cambios' : 'Agregar categoría',
        successMessage: category ? '✅ Categoría actualizada' : '✅ Categoría agregada',
        fields: [
            { name: 'name', label: 'Nombre', type: 'text', value: category?.name || '', placeholder: 'Ej: Alimentación' },
            {
                name: 'type', label: 'Tipo', type: 'select', value: category?.type || 'Egreso',
                options: [{ value: 'Egreso', label: 'Egreso' }, { value: 'Ingreso', label: 'Ingreso' }]
            },
            { name: 'budget', label: 'Presupuesto mensual ($)', type: 'number', min: 0, required: false, value: category?.budget || '' }
        ],
        onSubmit: (v) => {
            const name = v.name.trim();
            if (!name) return '❌ El nombre no puede estar vacío';
            const fields = { name, type: v.type, budget: money(v.budget || 0) };
            if (category) DataService.patch('categories', category.id, fields);
            else DataService.save('categories', { id: uid('cat'), ...fields });
            return null;
        }
    });
}

async function deleteCategory(category) {
    if (!category) return;
    const used = DataService.all('transactions').filter(t => t.category === category.id).length;
    const ok = await confirmDialog({
        title: 'Eliminar categoría',
        message: `¿Eliminar la categoría "${escapeHtml(category.name)}"?` +
            (used ? `<br>Tiene ${used} movimiento(s) asociados que quedarán sin categoría.` : ''),
        confirmLabel: 'Eliminar',
        danger: true
    });
    if (!ok) return;
    DataService.remove('categories', category.id);
    showNotification('🗑️ Categoría eliminada', 'success');
}

export function renderCategories(section) {
    const categories = DataService.all('categories');
    section.querySelector('[data-list]').innerHTML = categories.map(cat => `
        <div class="category-item">
            <div>
                <div class="category-name">${escapeHtml(cat.name)}</div>
                <div class="category-type">${escapeHtml(cat.type)}</div>
            </div>
            <div class="category-budget">$${formatNumber(cat.budget)}</div>
            <div class="row-actions">
                <button class="btn btn-secondary" data-action="edit" data-id="${escapeHtml(cat.id)}">Editar</button>
                <button class="btn btn-danger" data-action="delete" data-id="${escapeHtml(cat.id)}">Eliminar</button>
            </div>
        </div>
    `).join('') || '<p class="empty-state">No hay categorías</p>';
}
