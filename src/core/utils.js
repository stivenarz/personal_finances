/**
 * Utilidades puras (sin DOM) compartidas por toda la app.
 */

export const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

const numberFormat = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
export const formatNumber = (num) => numberFormat.format(Number(num) || 0);
export const formatMoney = (num) => {
    const value = Number(num) || 0;
    return `${value < 0 ? '-' : ''}$${formatNumber(Math.abs(value))}`;
};

export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
}

export function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ---- Fechas (siempre en hora local, formato YYYY-MM-DD) ----

const pad = (n) => String(n).padStart(2, '0');

export function toDateStr(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

let todayOverride = null;
/** Sólo pruebas: fija la fecha "de hoy". */
export const __setToday = (dateStr) => { todayOverride = dateStr; };
export const todayStr = () => todayOverride || toDateStr(new Date());
export const currentMonthStr = () => todayStr().slice(0, 7);

export function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate(); // month: 1-12
}

/** Fecha del día `day` del mes (year, month 1-12), recortando al último día si no existe. */
export function dateInMonth(year, month, day) {
    const normalized = new Date(year, month - 1, 1);
    const y = normalized.getFullYear();
    const m = normalized.getMonth() + 1;
    const d = Math.min(daysInMonth(y, m), Math.max(1, Math.round(Number(day)) || 1));
    return `${y}-${pad(m)}-${pad(d)}`;
}

export function diffDays(fromStr, toStr) {
    const [fy, fm, fd] = fromStr.split('-').map(Number);
    const [ty, tm, td] = toStr.split('-').map(Number);
    return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

export function formatDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

/** Próxima fecha (>= hoy) en la que cae el día `day` del mes. */
export function nextDateForDay(day, fromStr = todayStr()) {
    const [y, m] = fromStr.split('-').map(Number);
    const thisMonth = dateInMonth(y, m, day);
    return thisMonth >= fromStr ? thisMonth : dateInMonth(y, m + 1, day);
}

export function parseMoneyInput(value) {
    if (typeof value === 'number') return value;
    const clean = String(value ?? '').replace(/\./g, '').replace(/[^\d,-]/g, '').replace(',', '.');
    return parseFloat(clean) || 0;
}
