# Sincronización y modelo de datos

## Principios

1. **Local primero.** Todo se guarda siempre en `localStorage` (`app_offline_data`). La app funciona igual sin nube y sin conexión.
2. **Un solo punto de acceso a los datos:** [`DataService`](../src/services/data-service.js). Los componentes sólo llaman `save / patch / remove / all / find / subscribe / sync`; no saben si por debajo hay Firebase, Google Sheets o nada.
3. **Proveedores intercambiables** con el mismo contrato (`src/services/providers/`):

   | Método | Para qué |
   |---|---|
   | `connect({ onRemote, onReady, onStatus })` | abrir la conexión y empezar a recibir cambios |
   | `save(col, record)` / `patch(col, id, fields, updatedAt)` / `remove(col, id, updatedAt)` | enviar cambios |
   | `sync()` / `flush()` | forzar sincronización / esperar pendientes |
   | `test(config)` | probar credenciales |
   | `disconnect()` | cerrar |

   Para añadir otra base de datos basta con escribir un proveedor nuevo con estos métodos.
4. **Nunca se guardan totales.** Saldos de cuentas, cupo de tarjetas, intereses, avance de metas y saldo de deudas se **calculan** en [`domain/ledger.js`](../src/domain/ledger.js) a partir de registros base. Dos dispositivos que editen a la vez no pueden desajustar un saldo.

## Qué se guarda y qué se calcula

| Se guarda (registro base) | Se calcula |
|---|---|
| Cuenta: `initialBalance` (para tarjetas: −cupo ya usado), `creditLimit`, tasa, corte, pago | Saldo = saldo inicial + movimientos; cupo usado/disponible |
| Movimientos (ingreso, egreso, ahorro, transferencia) | Efecto en cada cuenta |
| Meta: `targetAmount`, `baseAmount` | Avance = base + abonos − retiros |
| Deuda: `baseBalance`, tasa anual, plazo, `startDate`, `interestFrom` (y cuota manual si no hay plazo) | Intereses causados, saldo pendiente, **cuota sugerida** y meses restantes |
| Tarjeta: `rateHistory` (cambios de tasa con fecha) | **Intereses** de cada ciclo (se muestran como movimientos "Automático") |

### Deudas

- Los intereses se causan sobre el capital pendiente desde `interestFrom` (tasa anual / 12 por mes). Cada pago cubre primero los intereses causados y el resto abona a capital.
- **Saldo pendiente** = capital + intereses causados a hoy. No se puede pagar más que eso.
- **Cuota sugerida** (con plazo) = cuota francesa sobre el saldo pendiente, la tasa y los meses que faltan. Si abonas de más, el saldo baja y la cuota se recalcula sola. Sin plazo se usa la cuota manual y los meses restantes se estiman con la tasa.
- Las deudas anteriores a esta versión empiezan a causar intereses desde la migración (no se reescribe el pasado).

### Tarjetas de crédito

- Saldo negativo = deuda. Un gasto con la tarjeta resta; un pago (transferencia desde una cuenta a la tarjeta) suma. El gasto valida el **cupo**; el pago valida que no supere la deuda.
- Tasa **mensual nominal** o **efectiva anual** (se convierte a mensual: `(1+EA)^(1/12)−1`). Al editarla, la nueva tasa rige **desde hoy**; los ciclos anteriores conservan la suya (`rateHistory`).
- Ciclo: al **corte** se fija el saldo del extracto; los pagos entre el corte y la **fecha límite** lo reducen; sobre lo que queda sin pagar se cobra la tasa del corte, que se carga en la fecha límite. Pagar el extracto completo a tiempo = sin intereses.
- Eliminar una tarjeta (o cuenta) exige saldo 0: con deuda se bloquea; con saldo a favor se transfiere a otra cuenta.

## Conflictos entre dispositivos

- Cada registro lleva `updatedAt` (ms). Gana la escritura más reciente **por registro**; `patch` fusiona campos (dos dispositivos que editen campos distintos conservan ambos).
- Los borrados se propagan como *tombstones* (`deleted: true`), así otro dispositivo no resucita lo eliminado.
- Tras el primer sync confirmado por el servidor, `DataService` **reconcilia**: sube lo que sólo existe en local o es más reciente (cambios hechos sin conexión o antes de configurar la nube).
- La migración a totales calculados (`domain/migrations.js`) sólo corre después de ese primer sync, para no calcular bases con datos incompletos. Es idempotente.

## Firebase

[`providers/firebase.js`](../src/services/providers/firebase.js): Firestore + autenticación anónima; una colección raíz por cada colección de la app. `onSnapshot` en cada colección ⇒ los cambios llegan **en tiempo real**. Caché persistente de Firestore (IndexedDB): las escrituras offline se encolan y se envían al reconectar. El SDK se descarga sólo cuando Firebase es el proveedor elegido. Guía: [firebase-guide.html](firebase-guide.html).

## Google Sheets

[`providers/sheets.js`](../src/services/providers/sheets.js) + [`google-apps-script/Code.gs`](../google-apps-script/Code.gs). Guía: [google-sheets-guide.html](google-sheets-guide.html).

- Una pestaña por colección: `id | updatedAt | deleted | seq | data(JSON)`.
- `seq` es un contador del servidor: cada dispositivo pide `pull?since=<seq>` y recibe sólo lo nuevo, sin depender de que los relojes coincidan.
- Escrituras a una **cola persistente** (`sheets_outbox`) con reintento; las operaciones son idempotentes (el servidor aplica last-write-wins).
- "En vivo": sondeo cada 4 s con la app visible, inmediato al volver al primer plano o recuperar red (cada 60 s en segundo plano).
- Las peticiones usan `Content-Type: text/plain` para evitar el preflight CORS de Apps Script.

## Indicador de estado

| Estado | Significado |
|---|---|
| Solo local | Sin proveedor de nube |
| Conectando… | Esperando la primera confirmación del servidor |
| Sincronizando… | Hay cambios pendientes de enviar |
| Conectado y sincronizado | Servidor confirmado y sin pendientes |
| Sin conexión · cambios pendientes | Sin red; se enviarán al reconectar |
| Error de sincronización | Error del servidor o de configuración (ver detalle en Configuración) |

## Pruebas

```bash
node --test
```

- `ledger.test.mjs`: saldos, metas, deudas, tarjetas (intereses por ciclo, pagos, cambio de tasa, EA vs mensual), validaciones y migración.
- `sync-sheets.test.mjs`: ejecuta el `Code.gs` **real** en Node (con mocks de SpreadsheetApp) y simula varios dispositivos: alta/edición/borrado, fusión de campos, sin conexión + reinicio, subida inicial de datos locales, escrituras antiguas y actualización en vivo.
- `node tests/mock-gas-server.mjs` levanta ese mismo script como servidor local (`http://localhost:8787/macros/s/TEST/exec`) para probar la app en el navegador sin una cuenta de Google.

> El proveedor de Firebase comparte el mismo contrato y la misma lógica de `DataService`, pero necesita un proyecto real para probarse de extremo a extremo.
