/**
 * Opciones de selects compartidas por los formularios modales.
 */
import { DataService } from '../../services/data-service.js';
import { formatMoney } from '../../core/utils.js';
import { accountAvailable, accountBalance, isCreditCard } from '../../domain/ledger.js';

export const INCOME_TYPES = [
    { value: 'Principal', label: 'Ingresos Principales' },
    { value: 'Secundario', label: 'Ingresos Secundarios/Extras' },
    { value: 'Inversiones', label: 'Rentas e Inversiones' }
];

/**
 * Cuentas para un select. Las tarjetas muestran su cupo disponible.
 * filter: (account) => boolean
 */
export function accountOptions({ filter = () => true, placeholder = 'Seleccionar cuenta', showBalance = true } = {}) {
    const options = DataService.all('accounts').filter(filter).map(account => {
        let suffix = '';
        if (showBalance) {
            suffix = isCreditCard(account)
                ? ` · cupo disponible ${formatMoney(accountAvailable(account.id))}`
                : ` · ${formatMoney(accountBalance(account.id))}`;
        }
        return { value: account.id, label: account.name + suffix };
    });
    return placeholder ? [{ value: '', label: placeholder }, ...options] : options;
}

export function categoryOptions(type = 'Egreso', placeholder = 'Seleccionar categoría') {
    const options = DataService.all('categories')
        .filter(c => c.type === type)
        .map(c => ({ value: c.id, label: c.name }));
    return placeholder ? [{ value: '', label: placeholder }, ...options] : options;
}

/** Nombre legible de la categoría de un movimiento (soporta ids, textos y datos antiguos). */
export function categoryLabel(t) {
    if (t.type === 'Ingreso') return t.incomeType || t.category || 'Ingreso';
    if (t.category) {
        const category = DataService.find('categories', t.category);
        if (category) return category.name;
        if (!String(t.category).startsWith('cat-')) return t.category;
    }
    const description = t.description || '';
    if (description.startsWith('Pago de deuda:')) return 'Pago de deuda';
    if (description.startsWith('Abono a meta:')) return 'Abono a meta';
    if (description.startsWith('Traslado:')) return 'Traslado';
    return 'Otro';
}
