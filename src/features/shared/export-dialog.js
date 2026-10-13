/**
 * Diálogo del botón "Exportar": elige el formato y delega en el servicio de exportación.
 */
import { openFormModal } from '../../core/modal.js';
import { showNotification } from '../../core/notifications.js';
import { uiState } from '../../core/state.js';
import { FORMATS, exportReport } from '../../services/export-service.js';

export function openExportDialog() {
    openFormModal({
        title: 'Exportar reporte',
        note: `Se exportará el mes <strong>${uiState.currentMonth}</strong>: resumen, transacciones, cuentas, tarjetas, deudas y metas.`,
        submitLabel: 'Exportar',
        fields: [{
            name: 'format', label: 'Formato', type: 'select', value: 'xlsx',
            options: Object.entries(FORMATS).map(([value, { label }]) => ({ value, label }))
        }],
        onSubmit: async (v) => {
            try {
                const { filename } = await exportReport(v.format, { month: uiState.currentMonth });
                showNotification(`✅ Reporte exportado: ${filename}`, 'success');
                return null;
            } catch (error) {
                return '❌ ' + error.message;
            }
        }
    });
}
