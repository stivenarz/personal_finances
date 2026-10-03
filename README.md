# 💰 Finanzas Personales - Control Integral

Aplicación web moderna para gestionar tus finanzas personales con **Firebase** como backend en la nube.

## Características

### 📊 Dashboard
- KPIs en tiempo real (ingresos, egresos, balance, tasa de ahorro)
- Gráficos dinámicos (gastos por categoría, ingresos vs egresos)
- Comparativa presupuesto vs gasto real
- Deudas próximas a pagar con alertas
- Metas de ahorro con progreso

### 💳 Gestión de Gastos
- Registro de gastos con categoría, descripción y cuenta
- Lista de gastos con búsqueda y filtros
- Actualización automática del dashboard

### 💵 Gestión de Ingresos
- Múltiples fuentes de ingresos (Principal, Secundario, Inversiones)
- Registro detallado de cada ingreso
- Filtros por tipo de ingreso

### 📋 Gestión de Deudas
- Registro de deudas con saldo inicial y actual
- Cálculo automático de meses restantes
- Barra de progreso de pago
- Registro de pagos individuales
- Alertas de vencimiento

### 🔄 Sincronización Google Sheets

#### Para Conectar:
1. Ve a **Configuración** → **Conexión Google Sheets**
2. Ingresa la URL completa de tu hoja de cálculo:
   ```
   https://docs.google.com/spreadsheets/d/TU_ID_AQUI/edit
   ```
3. Haz clic en "Conectar Hoja"
4. Prueba la conexión con "Probar Conexión"
5. Usa "Sincronizar Datos" para cargar datos desde la hoja

#### Estructura de Google Sheets:
La hoja debe tener las siguientes columnas (sin encabezados):
```
ID | Type | Date | Category | Description | Amount | Account
```

Tipos de transacción:
- `Ingreso` - para ingresos
- `Egreso` - para gastos
- `Deuda` - para deudas

#### Requisitos:
- La hoja debe estar **compartida públicamente**
- Formato CSV compatible

### ⚙️ Configuración

#### Gestionar Cuentas
- Agregar cuentas bancarias, tarjetas de crédito, efectivo
- Eliminar cuentas no usadas

#### Gestionar Categorías
- Crear categorías personalizadas
- Asignar presupuesto mensual por categoría
- Clasificar como Ingreso o Egreso

#### Metas de Ahorro
- Crear metas con monto objetivo y fecha límite
- Ver progreso en el dashboard
- Trackear múltiples metas simultáneamente

### 📱 Mobile
- Interfaz completamente responsive
- Menú colapsable en móvil
- Navegación intuitiva con cierre automático

### 💾 Persistencia de Datos
- **LocalStorage**: Almacenamiento local de datos (por defecto)
- **Google Sheets**: Sincronización opcional con hojas públicas
- Datos privados por usuario (URL única en localStorage)

## Tecnología

- **HTML5**: Estructura semántica
- **CSS3**: Responsive design, gradientes, animaciones
- **JavaScript Vanilla**: Sin dependencias externas
- **Chart.js**: Gráficos dinámicos
- **Papa Parse**: Parseo de CSV desde Google Sheets
- **LocalStorage**: Almacenamiento de configuración

## Uso

1. Abre `index.html` en un navegador moderno
2. Comienza a registrar gastos e ingresos
3. Configura tus cuentas y categorías
4. (Opcional) Conecta una hoja de Google Sheets para sincronización

## Notas Importantes

- Los datos se guardan automáticamente en LocalStorage
- Para usar Google Sheets, la hoja DEBE estar compartida públicamente
- La URL de conexión a Google Sheets se guarda en localStorage
- La app es multiusuario: cada URL de hoja tiene sus propios datos
- Los cambios se sincronizan al hacer clic en "Sincronizar Datos"

## Próximas Mejoras (Sugeridas)

- [ ] Exportar datos a CSV/Excel
- [ ] Gráficos comparativos mensuales/anuales
- [ ] Predicciones de presupuesto
- [ ] Alertas de gastos excesivos
- [ ] Integración con APIs de bancos reales
- [ ] App móvil nativa (PWA)
- [ ] Soporte multimoneda
