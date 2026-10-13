/**
 * Servidor HTTP local que expone el Code.gs real (con hoja en memoria), con CORS,
 * para probar la app en el navegador sin Google.  Uso:  node tests/mock-gas-server.mjs
 * URL a pegar en la app: http://localhost:8787/macros/s/TEST/exec
 */
import http from 'node:http';
import { createGas } from './gas-harness.mjs';

const gas = createGas();
const PORT = Number(process.env.PORT || 8787);
let latency = 0;

const server = http.createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Content-Type': 'application/json' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === '/__debug') { res.writeHead(200, cors); return res.end(JSON.stringify({ sheets: Object.fromEntries(Object.entries(gas.sheets).map(([k, v]) => [k, v.cells])) })); }
    if (url.pathname === '/__offline') { latency = url.searchParams.get('on') === '1' ? -1 : 0; res.writeHead(200, cors); return res.end('{}'); }
    if (latency < 0) { res.writeHead(503, cors); return res.end('{}'); }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
        try {
            const out = req.method === 'POST' ? gas.post(body) : gas.get(Object.fromEntries(url.searchParams.entries()));
            res.writeHead(200, cors);
            res.end(JSON.stringify(out));
        } catch (error) {
            res.writeHead(500, cors);
            res.end(JSON.stringify({ ok: false, error: String(error) }));
        }
    });
});

server.listen(PORT, () => console.log(`Mock Apps Script en http://localhost:${PORT}/macros/s/TEST/exec`));
