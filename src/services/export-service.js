import { DataService } from './data-service.js';
import {
    allTransactions, accountBalance, creditCardInfo, debtBalance, debtMonthlyPayment,
    debtMonthsLeft, goalAmount, isCreditCard, totalAvailable, totalCreditDebt, totalSavings
} from '../domain/ledger.js';
import { formatMoney, formatDate } from '../core/utils.js';

export const FORMATS = {
    csv: { label: 'CSV (texto, compatible con Excel)', extension: 'csv', mime: 'text/csv;charset=utf-8;' },
    xlsx: { label: 'Excel (.xlsx)', extension: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    pdf: { label: 'PDF', extension: 'pdf', mime: 'application/pdf' }
};

const LIBS = {
    xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    jspdf: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
    autotable: 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js'
};

/**
 * Sección: { id, title, headers: string[], rows: any[][], money: number[] }
 * `money` = índices de columnas que son dinero (se formatean en PDF; numéricas en CSV/Excel).
 */
export function buildMonthlyReport(month) {
    const nameOf = (id) => DataService.find('accounts', id)?.name || '';
    const categoryOf = (t) => {
        if (t.type === 'Ingreso') return t.incomeType || t.category || '';
        const category = t.category && DataService.find('categories', t.category);
        return category?.name || t.category || '';
    };

    const monthTx = allTransactions()
        .filter(t => (t.date || '').startsWith(month))
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const income = monthTx.filter(t => t.type === 'Ingreso').reduce((sum, t) => sum + t.amount, 0);
    const expenses = monthTx.filter(t => t.type === 'Egreso').reduce((sum, t) => sum + t.amount, 0);
    const balance = income - expenses;

    const sections = [
        {
            id: 'summary', title: 'Resumen del mes', headers: ['Concepto', 'Valor'], money: [1],
            rows: [
                ['Ingresos totales', income],
                ['Egresos totales', expenses],
                ['Balance neto', balance],
                ['Tasa de ahorro (balance / ingresos)', income > 0 ? `${(balance / income * 100).toFixed(2)}%` : 'N/A'],
                ['Saldo en cuentas (hoy)', totalAvailable()],
                ['Total en metas de ahorro (hoy)', totalSavings()],
                ['Deuda en tarjetas (hoy)', totalCreditDebt()]
            ]
        },
        {
            id: 'transactions', title: 'Transacciones del mes',
            headers: ['Fecha', 'Tipo', 'Descripción', 'Categoría', 'Cuenta', 'Monto ($)'], money: [5],
            rows: monthTx.map(t => [t.date, t.type, t.description || t.incomeType || '', categoryOf(t), nameOf(t.account), t.amount])
        },
        {
            id: 'accounts', title: 'Cuentas (saldo a hoy)', headers: ['Cuenta', 'Tipo', 'Saldo ($)'], money: [2],
            rows: DataService.all('accounts').filter(a => !isCreditCard(a)).map(a => [a.name, a.type, accountBalance(a.id)])
        },
        {
            id: 'cards', title: 'Tarjetas de crédito',
            headers: ['Tarjeta', 'Deuda ($)', 'Cupo ($)', 'Disponible ($)', 'Fecha de pago'], money: [1, 2, 3],
            rows: DataService.all('accounts').filter(isCreditCard).map(card => {
                const info = creditCardInfo(card.id);
                return [card.name, info.owed, info.limit, info.available, info.dueDate];
            })
        },
        {
            id: 'debts', title: 'Deudas activas',
            headers: ['Entidad', 'Titular', 'Saldo pendiente ($)', 'Cuota sugerida ($)', 'Meses restantes'], money: [2, 3],
            rows: DataService.all('debts').map(d => [d.entity, d.holder || '', debtBalance(d), debtMonthlyPayment(d), debtMonthsLeft(d) ?? 'N/A'])
        },
        {
            id: 'goals', title: 'Metas de ahorro',
            headers: ['Meta', 'Ahorrado ($)', 'Objetivo ($)', 'Avance', 'Fecha meta'], money: [1, 2],
            rows: DataService.all('goals').map(g => {
                const saved = goalAmount(g);
                return [g.description, saved, g.targetAmount, g.targetAmount > 0 ? `${Math.round(saved / g.targetAmount * 100)}%` : 'N/A', g.deadline || ''];
            })
        }
    ];

    return { title: 'Reporte financiero', month, generatedAt: new Date(), sections: sections.filter(s => s.rows.length > 0) };
}

const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

/** Devuelve el texto CSV (con BOM para que Excel respete los acentos). */
export function toCsv(report) {
    const lines = [[`${report.title} - ${report.month}`], []];
    report.sections.forEach(section => {
        lines.push([section.title.toUpperCase()], section.headers, ...section.rows, []);
    });
    return '\ufeff' + lines.map(row => row.map(csvCell).join(',')).join('\n');
}

async function loadScript(url, globalCheck) {
    if (globalCheck()) return;
    await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = () => reject(new Error('No se pudo cargar una librería de exportación. Revisa tu conexión e inténtalo de nuevo.'));
        document.head.appendChild(script);
    });
    if (!globalCheck()) throw new Error('La librería de exportación no se inicializó correctamente');
}

/** Devuelve un Blob .xlsx con una hoja por sección. */
async function toXlsx(report) {
    await loadScript(LIBS.xlsx, () => !!window.XLSX);
    const { XLSX } = window;

    const book = XLSX.utils.book_new();
    report.sections.forEach(section => {
        const sheet = XLSX.utils.aoa_to_sheet([section.headers, ...section.rows]);
        sheet['!cols'] = section.headers.map((header, col) => ({
            wch: Math.min(48, Math.max(String(header).length, ...section.rows.map(r => String(r[col] ?? '').length)) + 2)
        }));
        XLSX.utils.book_append_sheet(book, sheet, section.title.replace(/[\\/?*[\]:]/g, '').slice(0, 31));
    });

    const bytes = XLSX.write(book, { bookType: 'xlsx', type: 'array' });
    return new Blob([bytes], { type: FORMATS.xlsx.mime });
}

/** Devuelve un Blob PDF con una tabla por sección. */
async function toPdf(report) {
    await loadScript(LIBS.jspdf, () => !!window.jspdf?.jsPDF);
    await loadScript(LIBS.autotable, () => typeof window.jspdf.jsPDF.API.autoTable === 'function');

    const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFontSize(18);
    doc.text(report.title, 40, 48);
    doc.setFontSize(10);
    doc.setTextColor(110);
    doc.text(`Mes: ${report.month}  ·  Generado: ${report.generatedAt.toLocaleString('es-CO')}`, 40, 66);
    doc.setTextColor(0);

    let y = 88;
    report.sections.forEach(section => {
        const body = section.rows.map(row => row.map((value, col) => {
            if (section.money.includes(col) && typeof value === 'number') return formatMoney(value);
            if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return formatDate(value);
            return String(value ?? '');
        }));

        doc.setFontSize(12);
        doc.text(section.title, 40, y);
        doc.autoTable({
            startY: y + 8,
            head: [section.headers],
            body,
            theme: 'striped',
            styles: { fontSize: 8.5, cellPadding: 4 },
            headStyles: { fillColor: [102, 126, 234] },
            columnStyles: Object.fromEntries(section.money.map(col => [col, { halign: 'right' }])),
            margin: { left: 40, right: 40 }
        });
        y = doc.lastAutoTable.finalY + 26;
        if (y > doc.internal.pageSize.getHeight() - 90) {
            doc.addPage();
            y = 48;
        }
    });

    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
        doc.setPage(page);
        doc.setFontSize(8);
        doc.setTextColor(140);
        doc.text(`Página ${page} de ${pages}`, pageWidth - 40, doc.internal.pageSize.getHeight() - 24, { align: 'right' });
    }

    return doc.output('blob');
}

/** Descarga un Blob como archivo. */
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Exporta el reporte del mes en el formato indicado y devuelve { filename, blob }.
 * @param {'csv'|'xlsx'|'pdf'} format
 */
export async function exportReport(format, { month, deliver = downloadBlob } = {}) {
    const meta = FORMATS[format];
    if (!meta) throw new Error(`Formato de exportación no soportado: ${format}`);

    const report = buildMonthlyReport(month);
    let blob;
    if (format === 'csv') blob = new Blob([toCsv(report)], { type: meta.mime });
    else if (format === 'xlsx') blob = await toXlsx(report);
    else blob = await toPdf(report);

    const filename = `finanzas-${month}.${meta.extension}`;
    deliver(blob, filename);
    return { filename, blob };
}
