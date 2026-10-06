# 💰 Finanzas Personales - Control Integral

Aplicación web moderna para gestionar tus finanzas personales con arquitectura limpia y sin dependencias externas. Los datos se almacenan localmente en tu navegador.

## ✨ Características Principales

### 📊 Dashboard Integral
- **KPIs en tiempo real**: Ingresos, Egresos, Balance, Tasa de Ahorro, Saldo Disponible, Total Ahorros
- **Gráficos dinámicos**: Egresos por categoría, Ingresos vs Egresos
- **Filtro central de mes**: Todos los datos respetan el mes seleccionado
- **Actualización automática**: Los KPIs se recalculan al instante

### 💳 Gestión de Gastos
- Registro de gastos con categoría, descripción, monto y cuenta
- Lista completa de gastos con búsqueda por descripción
- Filtros por tipo y cuenta
- Categorización automática

### 💵 Gestión de Ingresos
- Múltiples tipos de ingresos (Principal, Secundario, Inversiones, Rentas, etc.)
- Registro detallado con fecha, descripción y cuenta destino
- Historial completo filtrable

### 📋 Gestión de Deudas
- Registro de deudas con saldo inicial y actual
- Cálculo automático de cuotas pendientes
- Barra de progreso visual
- Registro individual de pagos
- Historial de transacciones por deuda

### 🎯 Metas de Ahorro
- Crear metas con monto objetivo y fecha límite
- Depósitos y retiros de metas
- Seguimiento de progreso
- Gestión desde cualquier tipo de cuenta

### ⚙️ Configuración Completa
- **Gestionar Cuentas**: Añadir/eliminar cuentas (Corriente, Tarjeta, Efectivo, Ahorros)
- **Gestionar Categorías**: Crear categorías personalizadas y asignar presupuestos
- **Exportar Datos**: Descargar datos en formato Excel

### 📱 Diseño Responsive
- Interfaz completamente responsive para móvil, tablet y desktop
- Menú colapsable con navegación intuitiva
- Header optimizado para pantallas pequeñas
- Cierre automático del menú al perder foco

## 🏗️ Arquitectura Técnica

```
┌─────────────────────────────────────┐
│         HTML5 + CSS3                 │
│    Interface Responsiva              │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│      JavaScript Vanilla              │
│   - app.js (3000+ líneas)           │
│   - Lógica de negocio pura          │
│   - Sin frameworks externos         │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│    LocalStorage (Almacenamiento)    │
│   - Datos persistentes por usuario  │
│   - Backup/Restore opcional         │
└─────────────────────────────────────┘
```

### Dependencias Externas
- **Chart.js**: Gráficos dinámicos
- **Papa Parse**: Parseo de CSV (opcional)

## 🚀 Inicio Rápido

### Instalación
```bash
# 1. Clonar o descargar el proyecto
git clone https://github.com/stivenarz/personal_finances.git
cd personal_finances

# 2. Abrir en navegador (requiere servidor local)
python3 -m http.server 8000
# O usar cualquier servidor local

# 3. Navegar a
http://localhost:8000
```

### Primer Uso
1. Abre la aplicación en tu navegador
2. Crea cuentas bancarias en Configuración
3. Define categorías de gastos (Alimentación, Transporte, etc.)
4. Comienza a registrar transacciones
5. Visualiza tus datos en el Dashboard

## 💾 Almacenamiento de Datos

### LocalStorage
- Todos los datos se guardan automáticamente en localStorage del navegador
- Ubicación: `window.localStorage['app_offline_data']`
- Estructura:
  ```json
  {
    "transactions": [],
    "debts": [],
    "accounts": [],
    "categories": [],
    "goals": [],
    "debtPayments": []
  }
  ```

### Persistencia
- Los datos persisten entre sesiones
- Cada navegador/dispositivo tiene su propia copia
- Recomendado hacer backups periódicos (Exportar)

## 📂 Estructura del Proyecto

```
personal-finances/
├── index.html           # Estructura principal de la aplicación
├── app.js              # Lógica de negocio (3000+ líneas)
├── styles.css          # Estilos responsive (1000+ líneas)
├── firebase-guide.html # Guía de Firebase (referencia)
├── README.md           # Este archivo
└── .claude/
    └── launch.json     # Configuración para desarrollo local
```

## 🔄 Flujo de Datos

### Transacciones
1. Usuario registra un gasto/ingreso
2. Sistema crea registro con ID único
3. Se almacena en localStorage
4. Dashboard se actualiza automáticamente
5. Gráficos se recalculan

### Cálculo de KPIs
- **INGRESOS**: Suma de todos los ingresos del mes
- **EGRESOS**: Suma de gastos del mes (no incluye abonos a metas)
- **BALANCE**: INGRESOS - EGRESOS
- **TASA AHORRO**: (ABONOS A METAS / INGRESOS) * 100
- **SALDO DISPONIBLE**: Suma de saldos de todas las cuentas
- **TOTAL AHORROS**: Suma de saldos de metas de ahorro

## 🎨 Temas y Estilos

### Variables CSS Principales
- Colores de marca: Gradiente azul-morado
- Responsive breakpoints: 768px (tablet), 480px (mobile)
- Paleta de colores para transacciones: Verde (Ingreso), Rojo (Egreso), Naranja (Deuda)

### Iconografía
- Emojis para navegación rápida
- Códigos de color para tipos de transacción
- Barras de progreso para metas y deudas

## 🛠️ Desarrollo

### Requisitos
- Navegador moderno (Chrome, Firefox, Safari, Edge)
- Servidor local (para desarrollo)

### Servidor de Desarrollo
```bash
python3 -m http.server 8000
# Luego acceder a http://localhost:8000
```

## 🔒 Seguridad y Privacidad

- **100% Local**: Los datos nunca dejan tu navegador
- **Sin cuentas**: No requiere registro o login
- **Privado**: Cada usuario tiene su propia instancia
- **Sincronización**: Optional con Google Sheets (público)

## 📋 Categorías Estándar

### Gastos (Egresos)
- Alimentación
- Transporte
- Salud
- Entretenimiento
- Servicios
- Otros

### Ingresos
- Nomina/Salario (Principal)
- Bonificación/Extra (Secundario)
- Inversiones/Rentas
- Otros Ingresos

## 🚀 Mejoras Futuras Sugeridas

### Corto Plazo
- [ ] Importar datos desde CSV
- [ ] Más opciones de gráficos (Línea, Comparativa)
- [ ] Alertas por límite de presupuesto
- [ ] Notas en transacciones

### Mediano Plazo
- [ ] Proyecciones de presupuesto
- [ ] Análisis de tendencias
- [ ] Categorización automática
- [ ] Búsqueda avanzada
- [ ] Filtros más complejos

### Largo Plazo
- [ ] PWA (Progressive Web App)
- [ ] Soporte multimoneda
- [ ] Sincronización en nube (Firebase/Supabase)
- [ ] App móvil nativa
- [ ] Integración con APIs bancarias reales
- [ ] Análisis de patrones de gasto

## 📞 Soporte

### Para Reportar Bugs
1. Abre DevTools (F12)
2. Revisa la consola por errores
3. Reporta con:
   - Descripción del problema
   - Pasos para reproducir
   - Error de consola (si existe)
   - Navegador y versión

### Para Sugerencias
- Crea un issue en el repositorio
- Describe el caso de uso
- Proporciona ejemplos

## 📄 Licencia

Este proyecto es de código abierto y está disponible bajo licencia MIT.

## 🤝 Contribuciones

Las contribuciones son bienvenidas. Por favor:
1. Fork el proyecto
2. Crea una rama para tu feature
3. Commit con mensajes descriptivos
4. Push a la rama
5. Abre un Pull Request

---

**Versión**: 1.0  
**Última actualización**: 2026-10-06  
**Estado**: Activo y en desarrollo
