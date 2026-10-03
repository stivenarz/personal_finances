# Firebase Setup - Guía Completa

¡La app ahora usa **Firebase** para guardar tus datos de forma segura en la nube!

---

## ✅ Lo Que Ya Está Hecho

Ya tengo configurado Firebase con tu proyecto:

```
Project ID: personalfinances-88752
API Key: AIzaSyDwhp9OFmc37-tBx1A1YOa-Squ4YgmN748
```

---

## 🚀 Cómo Funciona

### Antes (Google Apps Script)
```
App → Google Apps Script → Google Sheets
                    ↑ Problemas de CORS
```

### Ahora (Firebase)
```
App → Firebase Firestore (Google Cloud)
           ✅ Sin problemas de CORS
           ✅ Datos en la nube
           ✅ Completamente privados
```

---

## 📊 Almacenamiento de Datos

Tus datos se guardan en **Firestore** (base de datos de Google Cloud):

```
firebase-project (personalfinances-88752)
  └── users/
      └── {tu-id-unico}/
          ├── transactions/
          │   ├── transaction-001: {fecha, monto, categoría, ...}
          │   ├── transaction-002: {...}
          │   └── ...
          ├── debts/
          │   ├── debt-001: {...}
          │   └── ...
          ├── accounts/
          │   ├── account-001: {...}
          │   └── ...
          ├── categories/
          │   ├── category-001: {...}
          │   └── ...
          ├── goals/
          │   ├── goal-001: {...}
          │   └── ...
          └── debtPayments/
              └── ...
```

---

## 🔒 Seguridad y Privacidad

✅ **Datos completamente privados:**
- Cada usuario tiene su propio UID único
- Firebase autentica automáticamente
- Nadie puede ver los datos de otros usuarios

✅ **Autenticación anónima:**
- No necesitas login
- Firebase crea automáticamente un ID único para ti
- Se guarda en tu navegador (localStorage de Firebase)

✅ **Sin exposición de datos:**
- La API Key está protegida por Firestore Rules
- Solo puede leer/escribir datos propios

---

## 🎯 Cómo Usar

### 1. Simplemente Abre la App
```
http://localhost:8000
```

### 2. El Resto es Automático
- Firebase se inicializa automáticamente
- Se crea un usuario anónimo para ti
- Tus datos se guardan en la nube

### 3. Tus Datos Se Sincronizan Automáticamente
- ✅ Cuando agregas un gasto → Se guarda en Firebase
- ✅ Cuando reciengas la página → Se cargan desde Firebase
- ✅ En múltiples dispositivos → Los datos se sincronizan

---

## 📱 Acceso Desde Múltiples Dispositivos

Como cada usuario tiene un UID único, **tus datos solo son accesibles desde el dispositivo donde los creaste**.

Si quieres acceder desde otro dispositivo:

### Opción A: Usar el Mismo Navegador
- Abre la app en otro dispositivo
- Se creará un UID diferente
- Los datos serán diferentes

### Opción B: Compartir UID (Avanzado)
- Exporta tu UID desde localStorage
- Comparte en otro dispositivo
- [Instrucciones avanzadas en desarrollo]

---

## 🆘 Troubleshooting

### "No me carga nada"
1. Abre F12 → Console
2. Busca mensajes de error rojo
3. Comparte el error

### "Los datos no se guardan"
1. Verifica que veas en Console: `"Firebase inicializado"`
2. Verifica que veas: `"Autenticación completada"`
3. Si no ves esos mensajes, reporta el error

### "Veo datos de otra persona"
- Esto no debería ser posible
- Si sucede, es un error de seguridad
- Por favor reporta inmediatamente

---

## 📋 Funcionalidades Soportadas

✅ **Completamente funcional:**
- Agregar gastos
- Agregar ingresos  
- Registrar deudas
- Agregar cuentas
- Crear categorías
- Establecer metas
- Dashboard con KPIs
- Gráficos

✅ **Sincronización:**
- Automática con Firebase
- En tiempo real (segundos)
- Sin necesidad de hacer clic en nada

❓ **Exportar/Importar:**
- [En desarrollo]

---

## 🔑 Información Técnica

### Reglas de Seguridad de Firestore

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Solo acceso a datos propios
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth.uid == userId;
    }
  }
}
```

Estas reglas garantizan que:
- Solo tu UID puede leer tus datos
- Solo tu UID puede escribir en tu datos
- Nadie más puede acceder

---

## 📞 Soporte

Si tienes problemas:

1. Abre F12 → Console
2. Copia cualquier error rojo
3. Reporta el error junto con:
   - Lo que intentabas hacer
   - El mensaje de error
   - Tu navegador/dispositivo

---

**¡Listo!** Ahora disfruta de tus datos 100% seguros en la nube. ☁️
