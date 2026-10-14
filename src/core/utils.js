/** Redondea a 2 decimales; valores no numéricos cuentan como 0. */
export const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

const numberFormat = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export const formatNumber = (num) => numberFormat.format(Number(num) || 0);

/** Formatea dinero con signo delante del símbolo: -$1.500 */
export const formatMoney = (num) => {
    const value = Number(num) || 0;
    return `${value < 0 ? '-' : ''}$${formatNumber(Math.abs(value))}`;
};

/**
 * Limpia texto numérico mientras se escribe: acepta coma o punto como separador decimal (el teclado numérico
 * de iOS en español sólo trae la coma), deja un único separador y quita todo lo que no sea dígito.
 * Un número pegado con separadores de miles (1.500.000) se normaliza a 1500000.
 * @param {{decimals?: boolean, negative?: boolean}} options `negative` permite un "-" al inicio.
 */
export function sanitizeDecimal(text, { decimals = true, negative = false } = {}) {
    let out = String(text ?? '').trim();
    if (/^\d{1,3}([.,]\d{3}){2,}$/.test(out)) out = out.replace(/[.,]/g, '');
    out = out.replace(/,/g, '.').replace(negative ? /[^\d.-]/g : /[^\d.]/g, '');
    if (!decimals) out = out.replace(/\./g, '');
    else {
        const first = out.indexOf('.');
        if (first >= 0) out = out.slice(0, first + 1) + out.slice(first + 1).replace(/\./g, '');
    }
    if (negative) out = out.replace(/(?!^)-/g, '');
    return out;
}

/** Convierte texto numérico (con coma o punto decimal) a número: `null` si no hay cifras, `NaN` si sólo quedan signos sueltos ('-', '.'). */
export function parseDecimal(text) {
    const clean = sanitizeDecimal(text, { negative: true });
    if (clean === '') return null;
    const number = Number(clean);
    return Number.isFinite(number) ? number : NaN;
}

export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
}

/** Id con prefijo; la parte aleatoria evita colisiones entre dispositivos que crean en el mismo milisegundo. */
export function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const pad = (n) => String(n).padStart(2, '0');

function toDateStr(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

let todayOverride = null;

/** Gancho de pruebas: fija la fecha de "hoy" (YYYY-MM-DD). */
export const __setToday = (dateStr) => { todayOverride = dateStr; };

/** Fecha local de hoy (YYYY-MM-DD). */
export const todayStr = () => todayOverride || toDateStr(new Date());

export const currentMonthStr = () => todayStr().slice(0, 7);

/** @param {number} month 1-12 */
export function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
}

/**
 * Fecha del día `day` de un mes, recortada al último día si no existe (31 en abril → 30).
 * Admite meses fuera de 1-12 (13 = enero del año siguiente).
 * @returns {string} YYYY-MM-DD
 */
export function dateInMonth(year, month, day) {
    const normalized = new Date(year, month - 1, 1);
    const y = normalized.getFullYear();
    const m = normalized.getMonth() + 1;
    const d = Math.min(daysInMonth(y, m), Math.max(1, Math.round(Number(day)) || 1));
    return `${y}-${pad(m)}-${pad(d)}`;
}

/** Días entre dos fechas YYYY-MM-DD (negativo si `toStr` es anterior). */
export function diffDays(fromStr, toStr) {
    const [fy, fm, fd] = fromStr.split('-').map(Number);
    const [ty, tm, td] = toStr.split('-').map(Number);
    return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

/** YYYY-MM-DD → DD/MM/YYYY */
export function formatDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

/** Próxima fecha, desde `fromStr` inclusive, en la que cae el día `day` del mes. */
export function nextDateForDay(day, fromStr = todayStr()) {
    const [y, m] = fromStr.split('-').map(Number);
    const thisMonth = dateInMonth(y, m, day);
    return thisMonth >= fromStr ? thisMonth : dateInMonth(y, m + 1, day);
}
