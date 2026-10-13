# 💰 Finanzas Personales

Aplicación web (PWA) para gestionar tus finanzas personales. Funciona 100 % en local y offline; opcionalmente sincroniza en vivo entre dispositivos con **Firebase** o **Google Sheets**. Sin build ni dependencias: JavaScript con módulos ES.

## ✨ Funcionalidades

- **Dashboard**: KPIs del mes, gráficos, presupuesto vs gasto real, próximos pagos (deudas y tarjetas) y metas.
- **Cuentas** (vista propia): corrientes, efectivo, ahorros y **tarjetas de crédito**.
  - Tarjeta: cupo y tasa editables (mensual nominal o efectiva anual; los cambios rigen desde la fecha en que se editan), día de corte y de pago, cupo usado/disponible, gastos y pagos con la tarjeta, **intereses calculados por ciclo** y fecha límite de pago.
  - Eliminar una cuenta valida el saldo: con deuda se bloquea; con saldo a favor se transfiere a otra cuenta.
- **Gastos / Ingresos / Transacciones**: alta y edición siempre en **formularios modales**.
- **Deudas**, **Ahorros** (metas con abonos y retiros) y **Planificación** (ingresos y gastos fijos, planes de pago, calendario de saldo; incluye las tarjetas como obligación).
- **Exportar** el reporte del mes en **CSV, Excel (.xlsx) o PDF** (resumen, transacciones, cuentas, tarjetas, deudas y metas), a cargo de `services/export-service.js`.
- **Categorías** (vista propia): categorías de egresos e ingresos con presupuesto mensual.
- **Configuración**: apariencia (**modo claro, oscuro o automático** según el sistema), base de datos (Solo local / Firebase / Google Sheets) y zona de peligro.
- **Nada de totales guardados**: saldos, avance de metas, saldo de deudas e intereses se calculan siempre desde los movimientos, así todos los dispositivos coinciden.

## 🚀 Inicio rápido

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

1. En **Cuentas** agrega tus cuentas y tarjetas.
2. En **Configuración** crea tus categorías.
3. Registra movimientos. (Opcional) conecta la nube en **Configuración → Base de datos**.

## 📂 Estructura

```
index.html · manifest.json · service-worker.js · offline.html   (raíz: scope de la PWA)
src/
├── main.js                  arranque: DataService, vistas, migración
├── core/                    utilidades, router, menú móvil, modal de formularios, toasts
├── services/
│   ├── data-service.js      ÚNICA API de datos para los componentes (+ sync/reconciliación)
│   ├── config-service.js    proveedor y credenciales (localStorage del dispositivo)
│   ├── theme-service.js     modo claro / oscuro / automático (prefers-color-scheme)
│   ├── export-service.js    reporte del mes → CSV / XLSX / PDF (lógica separada de la UI)
│   └── providers/           local.js · firebase.js · sheets.js  (mismo contrato)
├── domain/
│   ├── ledger.js            todo lo calculado: saldos, tarjetas e intereses, metas, deudas
│   ├── transactions.js      reglas de crear/editar/eliminar movimientos
│   ├── accounts.js          reglas de cuentas y tarjetas
│   └── migrations.js        paso a totales calculados (idempotente)
├── features/                un componente por vista: dashboard, accounts, expenses, income,
│                            debts, savings, planning, transactions, categories, settings
└── styles/                  main.css · components.css
google-apps-script/Code.gs   backend de Google Sheets
docs/                        guías (Firebase, Google Sheets, PWA) y arquitectura de sincronización
tests/                       pruebas (node --test)
```

## ☁️ Sincronización

Resumen (detalle en [docs/SINCRONIZACION.md](docs/SINCRONIZACION.md)):

| Modo | Cómo | Guía |
|---|---|---|
| Solo local | Sin configurar nada | — |
| Firebase | Tiempo real (Firestore) | [docs/firebase-guide.html](docs/firebase-guide.html) |
| Google Sheets | Apps Script + una URL; sondeo cada ~4 s | [docs/google-sheets-guide.html](docs/google-sheets-guide.html) |

Los componentes siempre usan los mismos métodos (`DataService.save / patch / remove / ...`) sin importar la base de datos elegida. Sin conexión los cambios se guardan y se envían al reconectar; si dos dispositivos editan lo mismo gana el cambio más reciente.

## 🧪 Pruebas

```bash
node --test
```

## 📱 PWA

Ver [docs/PWA_INSTALACION.md](docs/PWA_INSTALACION.md). El service worker usa *network-first*: con red siempre toma la versión más nueva; sin red sirve la caché.

## 🔒 Privacidad

Tus datos viven en tu dispositivo. Sólo salen si configuras Firebase o Google Sheets, y en ese caso van a **tu** proyecto/hoja. La URL del Apps Script y las credenciales de Firebase se guardan únicamente en el `localStorage` de cada dispositivo.
