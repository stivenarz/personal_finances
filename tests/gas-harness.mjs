/**
 * Ejecuta el Code.gs REAL de Google Apps Script en Node con mocks de
 * SpreadsheetApp / PropertiesService / LockService / ContentService.
 * Sirve para probar el protocolo de sincronización sin una cuenta de Google.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CODE = fs.readFileSync(path.join(here, '../google-apps-script/Code.gs'), 'utf8');

class MockRange {
    constructor(sheet, row, col, rows, cols) { Object.assign(this, { sheet, row, col, rows, cols }); }
    getValues() {
        const out = [];
        for (let r = 0; r < this.rows; r++) {
            const line = [];
            for (let c = 0; c < this.cols; c++) line.push(this.sheet.cells[`${this.row + r},${this.col + c}`] ?? '');
            out.push(line);
        }
        return out;
    }
    getValue() { return this.getValues()[0][0]; }
    setValues(values) {
        values.forEach((line, r) => line.forEach((v, c) => { this.sheet.cells[`${this.row + r},${this.col + c}`] = v; }));
        const last = this.row + values.length - 1;
        if (last > this.sheet.last) this.sheet.last = last;
        return this;
    }
    setFontWeight() { return this; }
    setNumberFormat() { return this; }
}

class MockSheet {
    constructor(name) { this.name = name; this.cells = {}; this.last = 0; }
    getLastRow() { return this.last; }
    getRange(a, b, c, d) {
        if (typeof a === 'string') return new MockRange(this, 1, 1, 1, 1);
        return new MockRange(this, a, b, c ?? 1, d ?? 1);
    }
    setFrozenRows() {}
}

export function createGas() {
    const sheets = {};
    const props = {};
    const ctx = {
        SpreadsheetApp: {
            getActiveSpreadsheet: () => ({
                getSheetByName: (n) => sheets[n] || null,
                insertSheet: (n) => (sheets[n] = new MockSheet(n))
            })
        },
        PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
        LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
        ContentService: {
            MimeType: { JSON: 'json' },
            createTextOutput: (text) => ({ text, setMimeType() { return this; }, getContent() { return this.text; } })
        },
        Logger: { log() {} },
        console
    };
    vm.createContext(ctx);
    vm.runInContext(CODE, ctx);

    return {
        sheets,
        get(params) { return JSON.parse(ctx.doGet({ parameter: params }).getContent()); },
        post(body) { return JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent()); }
    };
}

/** fetch() falso que enruta a un GAS simulado; `net.online=false` simula falta de red. */
export function createFakeFetch(gas, net = { online: true, calls: 0 }) {
    const fake = async (url, options = {}) => {
        net.calls++;
        if (!net.online) throw new TypeError('Failed to fetch');
        const target = new URL(url);
        const body = (options.method || 'GET') === 'POST'
            ? gas.post(options.body)
            : gas.get(Object.fromEntries(target.searchParams.entries()));
        return { ok: true, status: 200, json: async () => body };
    };
    fake.net = net;
    return fake;
}
