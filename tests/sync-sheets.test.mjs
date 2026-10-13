import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowserShims } from './helpers.mjs';
import { createGas, createFakeFetch } from './gas-harness.mjs';

installBrowserShims();

const URL_ = 'http://localhost:8787/macros/s/TEST/exec';
const makeStore = (initial = {}) => {
    const map = new Map(Object.entries(initial));
    return {
        getItem: k => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: k => map.delete(k),
        _map: map
    };
};

let seq = 0;
async function device({ store = makeStore(), local = false } = {}) {
    const tag = `d${++seq}`;
    const { DataService } = await import(`../src/services/data-service.js?${tag}`);
    const provider = local
        ? (await import('../src/services/providers/local.js')).default
        : (await import(`../src/services/providers/sheets.js?${tag}`)).default;
    await DataService.init({ providerOverride: provider, storage: store, config: { sheets: { url: URL_ } } });
    return { DS: DataService, provider, store };
}

const setup = () => {
    const gas = createGas();
    const net = { online: true, calls: 0 };
    globalThis.fetch = createFakeFetch(gas, net);
    return { gas, net };
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, timeout = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (check()) return true;
        await sleep(50);
    }
    return false;
}

test('Code.gs: ping, batch, pull incremental y último updatedAt gana', () => {
    const gas = createGas();
    assert.equal(gas.get({ action: 'ping' }).app, 'finanzas-sheets');

    let r = gas.post({ action: 'batch', ops: [
        { op: 'save', c: 'accounts', id: 'a1', updatedAt: 100, data: { id: 'a1', name: 'Uno' } },
        { op: 'save', c: 'accounts', id: 'a2', updatedAt: 100, data: { id: 'a2', name: 'Dos' } }
    ] });
    assert.equal(r.version, 2);

    const all = gas.get({ action: 'pull', since: 0 });
    assert.equal(all.rows.length, 2);
    assert.deepEqual(gas.get({ action: 'pull', since: 2 }).rows, [], 'sin cambios nuevos');

    gas.post({ action: 'batch', ops: [{ op: 'save', c: 'accounts', id: 'a1', updatedAt: 50, data: { id: 'a1', name: 'VIEJO' } }] });
    assert.equal(gas.get({ action: 'pull', since: 0 }).rows.find(x => x.id === 'a1').data.name, 'Uno');
    gas.post({ action: 'batch', ops: [{ op: 'save', c: 'accounts', id: 'a1', updatedAt: 200, data: { id: 'a1', name: 'NUEVO' } }] });
    const incremental = gas.get({ action: 'pull', since: 2 });
    assert.equal(incremental.rows.length, 1);
    assert.equal(incremental.rows[0].data.name, 'NUEVO');

    gas.post({ action: 'batch', ops: [{ op: 'patch', c: 'accounts', id: 'a1', updatedAt: 300, fields: { color: 'rojo' } }] });
    const merged = gas.get({ action: 'pull', since: 0 }).rows.find(x => x.id === 'a1');
    assert.deepEqual([merged.data.name, merged.data.color], ['NUEVO', 'rojo']);
    gas.post({ action: 'batch', ops: [{ op: 'remove', c: 'accounts', id: 'a2', updatedAt: 400 }] });
    assert.equal(gas.get({ action: 'pull', since: 0 }).rows.find(x => x.id === 'a2').deleted, true);
    gas.post({ action: 'batch', ops: [{ op: 'patch', c: 'accounts', id: 'a2', updatedAt: 500, fields: { name: 'zombie' } }] });
    assert.equal(gas.get({ action: 'pull', since: 0 }).rows.find(x => x.id === 'a2').deleted, true);

    assert.equal(gas.get({ action: 'nope' }).ok, false);
});

test('un dispositivo ve los datos de otro (alta, edición y borrado)', async () => {
    setup();
    const A = await device();
    await A.DS.whenReady();
    A.DS.save('accounts', { id: 'acc1', name: 'Banco', type: 'Corriente', initialBalance: 100 });
    A.DS.save('transactions', { id: 't1', type: 'Egreso', amount: 10, account: 'acc1', date: '2026-10-01' });
    await A.DS.sync();

    const B = await device();
    await B.DS.whenReady();
    assert.equal(B.DS.find('accounts', 'acc1').name, 'Banco');
    assert.equal(B.DS.all('transactions').length, 1);

    B.DS.patch('accounts', 'acc1', { name: 'Banco renombrado' });
    await B.DS.sync();
    await A.DS.sync();
    assert.equal(A.DS.find('accounts', 'acc1').name, 'Banco renombrado');

    A.DS.remove('transactions', 't1');
    await A.DS.sync();
    await B.DS.sync();
    assert.equal(B.DS.all('transactions').length, 0, 'el borrado se propaga');
    await B.DS.sync();
    assert.equal(B.DS.all('transactions').length, 0, 'y no resucita');

    await A.DS.disconnect(); await B.DS.disconnect();
});

test('ediciones simultáneas de campos distintos se fusionan en ambos', async () => {
    setup();
    const A = await device(); await A.DS.whenReady();
    A.DS.save('categories', { id: 'c1', name: 'Comida', type: 'Egreso', budget: 100 });
    await A.DS.sync();
    const B = await device(); await B.DS.whenReady();

    A.DS.patch('categories', 'c1', { name: 'Alimentación' });
    B.DS.patch('categories', 'c1', { budget: 500 });
    await A.DS.sync(); await B.DS.sync(); await A.DS.sync();

    for (const d of [A, B]) {
        const c = d.DS.find('categories', 'c1');
        assert.deepEqual([c.name, c.budget], ['Alimentación', 500]);
    }
    await A.DS.disconnect(); await B.DS.disconnect();
});

test('sin conexión: los cambios se guardan, sobreviven a un reinicio y se envían al volver la red', async () => {
    const { net } = setup();
    const store = makeStore();
    const A = await device({ store });
    await A.DS.whenReady();
    await A.DS.sync();

    net.online = false;
    A.DS.save('transactions', { id: 'off1', type: 'Ingreso', amount: 50, account: 'x', date: '2026-10-02' });
    await assert.rejects(() => A.DS.sync().then(r => { if (!r.success) throw new Error(r.message); }));
    assert.equal(A.DS.all('transactions').length, 1, 'visible en local');
    assert.ok(JSON.parse(store.getItem('sheets_outbox')).length >= 1, 'cola persistida');
    await A.DS.disconnect();

    const A2 = await device({ store });
    assert.equal(A2.DS.all('transactions').length, 1);

    net.online = true;
    await A2.DS.sync();
    assert.equal(JSON.parse(store.getItem('sheets_outbox') || '[]').length, 0);

    const B = await device(); await B.DS.whenReady();
    assert.equal(B.DS.find('transactions', 'off1').amount, 50);
    await A2.DS.disconnect(); await B.DS.disconnect();
});

test('al conectar por primera vez se sube lo que sólo existía en local', async () => {
    setup();
    const store = makeStore();
    const localOnly = await device({ store, local: true });
    localOnly.DS.save('accounts', { id: 'old1', name: 'Cuenta vieja', type: 'Corriente', initialBalance: 5 });
    localOnly.DS.save('goals', { id: 'g9', description: 'Meta', targetAmount: 10, baseAmount: 0 });

    const cloud = await device({ store });
    await cloud.DS.whenReady();
    await cloud.DS.sync();

    const other = await device(); await other.DS.whenReady();
    assert.equal(other.DS.find('accounts', 'old1').name, 'Cuenta vieja');
    assert.equal(other.DS.all('goals').length, 1);
    await cloud.DS.disconnect(); await other.DS.disconnect();
});

test('un dispositivo con datos viejos no pisa los cambios más recientes', async () => {
    const { gas } = setup();
    const A = await device({ store: makeStore() }); await A.DS.whenReady();
    A.DS.save('accounts', { id: 'z', name: 'v1', type: 'Corriente', initialBalance: 0 });
    await A.DS.sync();
    const stale = JSON.parse(JSON.stringify(A.DS.find('accounts', 'z')));
    A.DS.patch('accounts', 'z', { name: 'v2' });
    await A.DS.sync();

    gas.post({ action: 'batch', ops: [{ op: 'save', c: 'accounts', id: 'z', updatedAt: stale.updatedAt, data: stale }] });
    await A.DS.sync();
    assert.equal(A.DS.find('accounts', 'z').name, 'v2');
    assert.equal(gas.get({ action: 'pull', since: 0 }).rows.find(r => r.id === 'z').data.name, 'v2');
    await A.DS.disconnect();
});

test('en vivo: un cambio de otro dispositivo llega solo, sin pulsar sincronizar', async () => {
    setup();
    const A = await device(); await A.DS.whenReady();
    const B = await device(); await B.DS.whenReady();

    let notified = 0;
    B.DS.subscribe(() => { notified++; });

    A.DS.save('accounts', { id: 'live1', name: 'En vivo', type: 'Corriente', initialBalance: 1 });
    const arrived = await waitFor(() => B.DS.find('accounts', 'live1'), 9000);
    assert.ok(arrived, 'B recibió el cambio por sondeo automático');
    assert.ok(notified > 0, 'y la UI fue notificada');
    await A.DS.disconnect(); await B.DS.disconnect();
});

test('prueba de conexión del proveedor', async () => {
    setup();
    const { default: sheets } = await import('../src/services/providers/sheets.js?probe');
    assert.equal((await sheets.test({ sheets: { url: URL_ } })).success, true);
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => { throw new Error('html'); } });
    const bad = await sheets.test({ url: URL_ });
    assert.equal(bad.success, false);
    assert.match(bad.message, /Respuesta inválida/);
});
