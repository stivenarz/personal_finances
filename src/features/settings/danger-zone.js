/**
 * Zona de peligro: borrado total de datos con doble confirmación.
 */
import { DataService } from '../../services/data-service.js';
import { openFormModal, confirmDialog } from '../../core/modal.js';
import { showNotification } from '../../core/notifications.js';

export function mountDangerZone(section) {
    section.innerHTML = `
        <h3>⚠️ Zona de Peligro</h3>
        <p class="danger-text">Esta acción eliminará TODOS los datos de la aplicación:</p>
        <ul class="danger-text">
            <li>Todas las transacciones, cuentas y tarjetas</li>
            <li>Todas las categorías, deudas, metas y planes</li>
            <li>Los datos guardados en este dispositivo</li>
            <li>Los datos en la nube (Firebase o Google Sheets, si está conectado)</li>
        </ul>
        <button type="button" class="btn btn-danger btn-block" data-action="delete-all">🗑️ Borrar TODOS los Datos</button>
    `;
    section.querySelector('[data-action="delete-all"]').addEventListener('click', start);
}

async function start() {
    const ok = await confirmDialog({
        title: '⚠️ Confirmación de borrado',
        message: 'Esta acción eliminará <strong>TODOS</strong> los datos, también en la nube, y es irreversible.',
        confirmLabel: 'Entendido, continuar',
        danger: true
    });
    if (!ok) return;

    openFormModal({
        title: '🔐 Confirmación de seguridad',
        note: 'Para confirmar, escribe <strong>BORRAR TODO</strong>.',
        submitLabel: 'Borrar todo',
        danger: true,
        fields: [{ name: 'code', label: 'Código de confirmación', type: 'text', value: '', placeholder: 'BORRAR TODO' }],
        onSubmit: async (v) => {
            if (v.code !== 'BORRAR TODO') return '❌ El código no coincide';
            showNotification('🔄 Eliminando datos... Por favor espera', 'info');
            await DataService.clearAll();
            showNotification('✅ Datos eliminados. Recargando...', 'success');
            setTimeout(() => location.reload(), 1200);
            return null;
        }
    });
}
