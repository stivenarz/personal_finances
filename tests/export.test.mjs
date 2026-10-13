import test from 'node:test';
import assert from 'node:assert/strict';
import { freshApp, DataService } from './setup.mjs';

const { buildMonthlyReport, toCsv, exportReport, FORMATS } = await import('../src/services/export-service.js');

async function seed() {
    await freshApp('2026-10-12');
    DataService.save('accounts', { id: 'a1', name: 'Banco "Principal"', type: 'Corriente', initialBalance: 1000 });
    DataService.save('categories', { id: 'c1', name: 'Comida', type: 'Egreso', budget: 0 });
    DataService.save('transactions', { id: 't1', type: 'Ingreso', date: '2026-10-01', amount: 500, account: 'a1', incomeType: 'Principal', description: 'Nómina' });
    DataService.save('transactions', { id: 't2', type: 'Egreso', date: '2026-10-03', amount: 200, account: 'a1', category: 'c1', description: 'Mercado, "grande"' });
    DataService.save('transactions', { id: 't3', type: 'Egreso', date: '2026-09-03', amount: 999, account: 'a1', category: 'c1', description: 'Mes anterior' });
    DataService.save('debts', { id: 'd1', entity: 'Banco', baseBalance: 1000, interestRate: 0, termMonths: 10, startDate: '2026-10-01', interestFrom: '2026-10-01' });
    DataService.save('goals', { id: 'g1', description: 'Viaje', targetAmount: 1000, baseAmount: 250 });
}

test('el reporte sólo incluye el mes pedido y los totales son calculados', async () => {
    await seed();
    const report = buildMonthlyReport('2026-10');
    const summary = Object.fromEntries(report.sections.find(s => s.id === 'summary').rows);
    assert.equal(summary['Ingresos totales'], 500);
    assert.equal(summary['Egresos totales'], 200);
    assert.equal(summary['Balance neto'], 300);
    assert.equal(report.sections.find(s => s.id === 'transactions').rows.length, 2);

    const accounts = report.sections.find(s => s.id === 'accounts').rows;
    assert.deepEqual(accounts[0], ['Banco "Principal"', 'Corriente', 1000 + 500 - 200 - 999]);
    assert.equal(report.sections.find(s => s.id === 'debts').rows[0][3], 100, 'cuota sugerida calculada');
    assert.equal(report.sections.find(s => s.id === 'goals').rows[0][1], 250);
    assert.equal(report.sections.some(s => s.id === 'cards'), false, 'sin tarjetas no hay sección');
});

test('CSV: BOM, escape de comillas y secciones separadas', async () => {
    await seed();
    const csv = toCsv(buildMonthlyReport('2026-10'));
    assert.ok(csv.startsWith('﻿"Reporte financiero - 2026-10"'));
    assert.ok(csv.includes('"Mercado, ""grande"""'));
    assert.ok(csv.includes('"RESUMEN DEL MES"') && csv.includes('"METAS DE AHORRO"'));
});

test('exportReport entrega el archivo con el nombre del mes y rechaza formatos desconocidos', async () => {
    await seed();
    let delivered;
    const { filename, blob } = await exportReport('csv', { month: '2026-10', deliver: (b, name) => { delivered = [b, name]; } });
    assert.equal(filename, 'finanzas-2026-10.csv');
    assert.equal(delivered[1], filename);
    assert.equal(blob.type, FORMATS.csv.mime);
    await assert.rejects(() => exportReport('docx', { month: '2026-10' }), /no soportado/);
});
