# 📱 Guía de Instalación PWA - iPhone

## ¿Qué es PWA?

Una **Progressive Web App (PWA)** es una aplicación web que se comporta como una app nativa:
- ✅ Se instala en el home screen
- ✅ Funciona sin conexión a internet
- ✅ Sin necesidad de App Store
- ✅ Actualizaciones automáticas

---

## 📲 Instalar en iPhone

### Paso 1: Abrir en Safari
```
1. Abre Safari en tu iPhone
2. Ve a: http://localhost:8000 (o tu URL)
3. Espera a que cargue completamente
```

### Paso 2: Agregar a Home Screen
```
1. Toca el botón "Compartir" (ícono de caja con flecha)
   - Está en la barra inferior
2. Desplázate y toca "Agregar a la Pantalla de Inicio"
   - Si no ves la opción, toca "Más" primero
```

### Paso 3: Nombrar la App
```
1. En el cuadro que aparece, puedes cambiar el nombre
   - Nombre por defecto: "Finanzas"
2. Toca "Agregar" en la esquina superior derecha
```

### Paso 4: ¡Listo!
```
✅ La app aparecerá en tu home screen
✅ Puedes abrirla como cualquier otra app
✅ Funciona offline con los datos en caché
```

---

## 📱 Instalar en Android

### Chrome/Brave
```
1. Abre Chrome en tu Android
2. Ve a: http://localhost:8000
3. Toca el menú (⋮) → "Instalar app"
4. Confirma tocando "Instalar"
```

### Samsung Internet
```
1. Abre Samsung Internet
2. Ve a: http://localhost:8000
3. Toca el menú → "Agregar a pantalla de inicio"
```

---

## ⚙️ Características de la PWA

### Funcionalidad Offline
- Puedes ver tus datos aunque no tengas internet
- Los datos se cachean automáticamente
- Cuando vuelva la conexión, se sincronizarán

### Actualizaciones Automáticas
- La app busca actualizaciones cada 10 segundos
- Si hay una nueva versión, se instala automáticamente
- No necesitas ir a App Store

### Acceso a Datos Locales
- Tus datos se guardan en **localStorage** del navegador
- Son privados y solo accesibles en este navegador
- No van a ningún servidor externo

---

## 🔄 Sincronización

### Cómo Funciona
```
1. Cambios locales → Se guardan en localStorage
2. Sin conexión → La app funciona normalmente
3. Vuelve conexión → Se sincronizan automáticamente
4. Nota: Solo con localStorage, no con Firebase
```

---

## 💾 Datos y Privacidad

### ¿Dónde se guardan los datos?
- Almacenamiento local del navegador
- NO en un servidor externo
- Solo accesible desde este navegador

### Backup Manual
```
Si quieres hacer backup:
1. Ve a Configuración
2. Toca "Exportar Datos"
3. Se descarga un archivo Excel con tus datos
```

### Restaurar Datos
```
Para importar datos desde backup:
1. Ve a Configuración
2. Toca "Importar Datos"
3. Selecciona el archivo Excel
```

---

## 🔧 Solucionar Problemas

### "No veo el botón 'Agregar a Pantalla de Inicio'"

**Causa**: La app no tiene un manifest.json válido

**Solución**:
1. Asegúrate de estar en Safari
2. Recarga la página (Ctrl+R)
3. Intenta de nuevo

**Si sigue sin funcionar**:
1. Abre DevTools (Menú → Desarrollador → Consola Web)
2. Busca errores relacionados con "manifest"
3. Verifica que la URL sea correcta

---

### "La app está muy lenta"

**Causa**: Caché viejo o mucho datos

**Solución**:
1. Borra la app del home screen (mantén presionado)
2. Ve a Safari → Historial → Borrar historial
3. Vuelve a instalar

---

### "Mis datos desaparecieron"

**Causa**: Probablemente limpiaste el caché de Safari

**Prevención**:
1. NO limpies caché de Safari (elimina los datos)
2. Haz backups regulares (Exportar en Configuración)

**Recuperación**:
- Si tienes un backup, usa "Importar Datos"
- Si no, los datos lamentablemente se perdieron

---

### "¿Funciona sin internet?"

**Sí, pero limitado**:
- ✅ Ver datos previamente cargados
- ✅ Hacer cambios locales
- ✅ Interactuar con la app
- ❌ No se sincronizarán hasta tener conexión
- ❌ Los gráficos pueden no funcionar (requieren Chart.js)

---

## 📊 Monitoreo

### Ver Estado del Service Worker
```
1. Abre Safari → Menú → Desarrollador → Consola Web
2. Busca mensajes que empiecen con "[SW]" o "[App]"
3. Debería ver algo como:
   ✓ "[SW] Service Worker loaded"
   ✓ "[App] Service Worker registrado exitosamente"
```

### Verificar Caché
```
En la consola del navegador (DevTools):
```javascript
// Ver qué hay en caché
caches.keys().then(names => console.log(names));

// Ver qué hay en localStorage
console.log(localStorage.getItem('app_offline_data'));
```
```

---

## 🚀 Actualizaciones

### ¿Cómo me llegan las actualizaciones?
1. Se descargan automáticamente cada 10 segundos
2. Si hay una nueva versión, la app se recarga automáticamente
3. **No necesitas hacer nada**

### Forzar actualización
```
1. Borra la app del home screen
2. Limpia caché de Safari
3. Vuelve a instalar

Alternativa (más fácil):
1. Abre la app
2. Menú → Desarrollador → Consola
3. Ejecuta: location.reload(true)
```

---

## 📱 Atajos Rápidos (iOS)

Después de instalar, puedes crear atajos:

### Atajo 1: Registrar Gasto
- Nombre: "Nuevo Gasto"
- Acción: Abrir "Finanzas" con URL `/?tab=gastos`

### Atajo 2: Registrar Ingreso
- Nombre: "Nuevo Ingreso"
- Acción: Abrir "Finanzas" con URL `/?tab=ingresos`

### Atajo 3: Ver Dashboard
- Nombre: "Mis Finanzas"
- Acción: Abrir "Finanzas" con URL `/?tab=dashboard`

---

## ✅ Checklist de Instalación

- [ ] Abrir en Safari
- [ ] Ver el botón "Agregar a Pantalla de Inicio"
- [ ] Instalar la app
- [ ] App aparece en home screen
- [ ] Abrir y verificar que funciona
- [ ] Verificar en DevTools que Service Worker está registrado
- [ ] Probar sin conexión (Airplane Mode)
- [ ] Volver a conectar y verificar sincronización

---

## 🎯 Próximos Pasos

### Optimización
- Iconos personalizados de verdad (PNG)
- Splash screen
- Más atajos rápidos

### Características Avanzadas
- Notificaciones push
- Sincronización en background
- Widgets en home screen (iOS 14+)

### Migración a App Nativa
- Cuando la app sea muy popular
- Considerar React Native o Swift
- Mantener PWA como fallback

---

**¿Problemas?**
Abre DevTools y revisa los mensajes de consola. Generalmente hay errores descriptivos.

**¿Necesitas ayuda?**
Contacta al desarrollador con:
- Pantalla del error en DevTools
- Qué intentabas hacer
- Navegador y versión de iOS
