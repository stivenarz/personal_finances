# Sincronización con Firebase

## Línea base medida (2026-10-07, proyecto con credenciales reales)

| Medición | Resultado |
|---|---|
| Autenticación anónima | ~200 ms |
| Consulta por colección (0–3 documentos) | 200–320 ms cada una |
| Documentos en la nube | 7 en total |
| Tiempo hasta "Conectado a Firebase" (versión anterior) | ~1,9 s |

El costo es la latencia por consulta, no el volumen. La versión anterior volvía a leer las seis colecciones en cada arranque.

## Arquitectura actual

- **Local primero.** Todos los cambios se aplican a `APP.data` y se guardan en `localStorage`. No hay toggle de base de datos: si hay credenciales, la app sincroniza sola.
- **Capa de datos única** (`dbSave`, `dbPatch`, `dbDelete`, `dbAdjustBalance` en [app.js](app.js)). Ningún handler escribe directo en Firebase.
- **Listeners en tiempo real** (`onSnapshot`) sobre las nueve colecciones. Un cambio en un dispositivo aparece en los demás sin recargar.
- **Caché persistente de Firestore** (IndexedDB). Las escrituras offline se encolan y se envían al reconectar, sin duplicados.
- **Borrados como tombstones.** Un borrado marca `deleted: true` en el documento, así otro dispositivo no lo vuelve a crear.
- **Saldos con incrementos atómicos.** Cada movimiento suma o resta con `increment()`, así dos dispositivos no se pisan el saldo.
- **Conflictos: last-write-wins por documento**, que resuelve Firestore en el servidor.
- **Migración.** Los registros que solo existen en el dispositivo se suben la primera vez que el servidor confirma la conexión.

## Estados del indicador

| Estado | Significado |
|---|---|
| Solo local | No hay credenciales de Firebase |
| Conectando… | Esperando la primera confirmación del servidor |
| Sincronizando… | Hay escrituras pendientes |
| Conectado y sincronizado | Servidor confirmado y sin pendientes |
| Sin conexión · cambios pendientes | Sin red, o pendientes durante más de 15 s |
| Error de sincronización | Error al escribir o al escuchar |

El botón **Sincronizar** (Configuración) reinicia la red de Firestore y espera a que las escrituras pendientes se confirmen (máximo 20 s).

## Pruebas realizadas con credenciales reales

- Ingreso y gasto: el saldo se actualiza y persiste tras recargar.
- Modo sin conexión: el saldo cambia al instante; el indicador pasa a "Sin conexión · cambios pendientes" a los 15 s; al reconectar, el gasto se envía una sola vez.
- Edición de gasto (monto), de deuda (cuota y día), de meta (nombre), de cuenta (nombre) y de categoría (presupuesto).
- Deuda: pago, edición del pago y eliminación del pago; el saldo de la deuda y de la cuenta cuadran en cada paso.
- Meta: abono, edición del abono y eliminación; la meta y la cuenta cuadran.
- Transferencia: creación, edición de monto y eliminación.
- Sincronización entre dos pestañas: creación, edición y eliminación de una categoría se reflejan en la otra sin recargar.
- Migración: un registro solo local sube a la nube y vuelve a aparecer desde el servidor.
- Modo local sin credenciales: el indicador muestra "Solo local" y todo funciona.

Los datos de prueba se eliminaron de la base. Los tombstones quedan en la nube como documentos con `deleted: true`; la app los ignora.

## Pendiente

- Reglas de Firestore: la guía actual permite leer y escribir a cualquier usuario autenticado de forma anónima. Conviene restringirlas por usuario.
- Prueba en dos dispositivos reales (iPhone y escritorio) con la misma cuenta.
