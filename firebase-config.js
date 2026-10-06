// Firebase Configuration
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getFirestore, collection, getDocs, updateDoc, deleteDoc, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

// IMPORTANT: NO DEFAULT CONFIG - Each user must configure their own Firebase
// Credentials are stored ONLY in localStorage as a single JSON object, never hardcoded

// Database structure (only this should be hardcoded)
export const DB_STRUCTURE = {
  collections: ['accounts', 'categories', 'transactions', 'debts', 'debtPayments', 'goals']
};

// Check if Firebase is configured
export function isFirebaseConfigured() {
  try {
    const config = localStorage.getItem('firebaseConfig');
    if (!config) return false;

    const parsed = JSON.parse(config);
    return !!(parsed.apiKey && parsed.projectId && parsed.authDomain);
  } catch {
    return false;
  }
}

// Get configuration ONLY from localStorage (no defaults)
export function getFirebaseConfigValues() {
  if (!isFirebaseConfigured()) {
    return null;
  }

  try {
    return JSON.parse(localStorage.getItem('firebaseConfig'));
  } catch {
    return null;
  }
}

// Save configuration as single JSON in localStorage
export function setFirebaseConfig(config) {
  const firebaseConfig = {
    apiKey: config.apiKey || '',
    authDomain: config.authDomain || '',
    projectId: config.projectId || '',
    storageBucket: config.storageBucket || '',
    messagingSenderId: config.messagingSenderId || '',
    appId: config.appId || ''
  };

  localStorage.setItem('firebaseConfig', JSON.stringify(firebaseConfig));
}

// Firebase instances - lazy initialized only if configured
let app = null;
let db = null;
let auth = null;
let currentUser = null;

// ============ SMART CACHE SYSTEM ============
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos
const cacheStore = {
  data: {},
  timestamps: {},
  lastSync: {}
};

function getCacheKey(collection, params = {}) {
  const paramStr = Object.entries(params)
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return `${collection}${paramStr ? ':' + paramStr : ''}`;
}

function isCacheValid(key) {
  const timestamp = cacheStore.timestamps[key];
  if (!timestamp) return false;
  return Date.now() - timestamp < CACHE_DURATION;
}

function getFromCache(key) {
  if (isCacheValid(key)) {
    console.log(`[Cache] Usando datos en caché para ${key}`);
    return cacheStore.data[key];
  }
  return null;
}

function saveToCache(key, data) {
  cacheStore.data[key] = data;
  cacheStore.timestamps[key] = Date.now();
}

function clearCache(collection = null) {
  if (collection) {
    Object.keys(cacheStore.data).forEach(key => {
      if (key.startsWith(collection)) {
        delete cacheStore.data[key];
        delete cacheStore.timestamps[key];
      }
    });
  } else {
    cacheStore.data = {};
    cacheStore.timestamps = {};
  }
}

export function initializeFirebase() {
  if (!isFirebaseConfigured()) {
    return false;
  }

  if (app) {
    return true;
  }

  try {
    const firebaseConfig = getFirebaseConfigValues();
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    return true;
  } catch (error) {
    console.error('Error initializing Firebase:', error);
    return false;
  }
}

// Get Firebase instances (will be null if not configured)
export function getFirebaseInstance() {
  return { app, db, auth };
}

export async function initializeAuth() {
  return new Promise((resolve, reject) => {
    auth.onAuthStateChanged(async (user) => {
      if (user) {
        currentUser = user;
        resolve(user);
      } else {
        signInAnonymously(auth)
          .then((result) => {
            currentUser = result.user;
            resolve(currentUser);
          })
          .catch((error) => {
            console.error('Authentication error:', error);
            reject(error);
          });
      }
    });
  });
}

// ============ DATA OPERATIONS ============
export async function saveData(collectionName, data) {
  if (!currentUser) throw new Error('Usuario no autenticado');
  if (!data.id) throw new Error('El documento debe tener un ID');

  try {
    const docRef = doc(db, collectionName, data.id);
    await setDoc(docRef, {
      ...data,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    return data;
  } catch (error) {
    console.error('Error guardando datos:', error);
    throw error;
  }
}

export async function loadData(collectionName, pageSize = 100, pageNumber = 1) {
  if (!currentUser) throw new Error('Usuario no autenticado');

  const cacheKey = getCacheKey(collectionName, { pageNumber, pageSize });
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  try {
    // Para optimización: solo cargar pageSize documentos
    const q = collection(db, collectionName);
    const querySnapshot = await getDocs(q);

    const data = [];
    let count = 0;
    const startIndex = (pageNumber - 1) * pageSize;
    const endIndex = startIndex + pageSize;

    querySnapshot.forEach((doc) => {
      if (count >= startIndex && count < endIndex) {
        data.push({ id: doc.id, ...doc.data() });
      }
      count++;
    });

    saveToCache(cacheKey, data);
    return data;
  } catch (error) {
    console.error(`Error loading ${collectionName}:`, error);
    return [];
  }
}

export async function updateData(collectionName, docId, data) {
  if (!currentUser) throw new Error('Usuario no autenticado');

  try {
    const docRef = doc(db, collectionName, docId);
    await updateDoc(docRef, {
      ...data,
      updatedAt: new Date()
    });
    clearCache(collectionName); // Limpiar caché de esta colección
    return { id: docId, ...data };
  } catch (error) {
    console.error('Error actualizando datos:', error);
    throw error;
  }
}

export async function deleteData(collectionName, docId) {
  if (!currentUser) throw new Error('Usuario no autenticado');

  try {
    await deleteDoc(doc(db, collectionName, docId));
    clearCache(collectionName); // Limpiar caché de esta colección
    return true;
  } catch (error) {
    console.error('Error eliminando datos:', error);
    throw error;
  }
}


// ============ SYNC ALL DATA ============
export async function loadAllData() {
  if (!currentUser) throw new Error('Usuario no autenticado');

  const cacheKey = getCacheKey('all-data');
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  try {
    const [transactions, debts, accounts, categories, goals, debtPayments] = await Promise.all([
      loadData('transactions', 100, 1),
      loadData('debts', 100, 1),
      loadData('accounts', 100, 1),
      loadData('categories', 100, 1),
      loadData('goals', 100, 1),
      loadData('debtPayments', 100, 1)
    ]);

    const result = {
      transactions,
      debts,
      accounts,
      categories,
      goals,
      debtPayments
    };

    saveToCache(cacheKey, result);
    return result;
  } catch (error) {
    console.error('Error cargando todos los datos:', error);
    return {
      transactions: [],
      debts: [],
      accounts: [],
      categories: [],
      goals: [],
      debtPayments: []
    };
  }
}

// ============ GET CURRENT USER ============
export function getCurrentUser() {
  return currentUser;
}

export function getUserId() {
  return currentUser?.uid;
}

// ============ CONNECTION TEST ============
export async function testFirebaseConnection() {
  try {
    console.log('Probando conexión Firebase...');

    if (!currentUser) {
      throw new Error('Usuario no autenticado');
    }

    // Intentar leer datos del usuario actual
    const testRef = doc(db, 'users', currentUser.uid);
    await getDoc(testRef);

    console.log('Firebase conectado exitosamente');
    return { success: true, message: 'Conexión exitosa' };
  } catch (error) {
    console.error('Error en Firebase:', error);
    return { success: false, message: 'Error: ' + error.message };
  }
}

export function reinitializeFirebase(newApiKey) {
  // Función legacy - mantener para compatibilidad
  const config = getFirebaseConfigValues();
  config.apiKey = newApiKey;
  setFirebaseConfig(config);
  console.log('Configuración actualizada. Recargando...');
  clearCache(); // Limpiar caché al reconfigurar
  setTimeout(() => location.reload(), 500);
}

// ============ CACHE MANAGEMENT ============
export function getCacheStats() {
  const stats = {
    totalCached: Object.keys(cacheStore.data).length,
    items: Object.keys(cacheStore.data).map(key => ({
      key,
      valid: isCacheValid(key),
      age: Date.now() - cacheStore.timestamps[key]
    }))
  };
  return stats;
}

export function clearAllCache() {
  clearCache();
  console.log('[Cache] Caché global limpiado');
}

// ============ LAZY LOAD - Solo datos específicos por vista ============
export async function loadTransactionsData(page = 1) {
  if (!currentUser) throw new Error('Usuario no autenticado');

  const cacheKey = getCacheKey('transactions-view', { page });
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  try {
    const [transactions, accounts, categories] = await Promise.all([
      loadData('transactions', 50, page),
      loadData('accounts', 100, 1),
      loadData('categories', 100, 1)
    ]);

    const result = { transactions, accounts, categories };
    saveToCache(cacheKey, result);
    return result;
  } catch (error) {
    console.error('Error cargando transacciones:', error);
    return { transactions: [], accounts: [], categories: [] };
  }
}

export async function loadDebtsData() {
  if (!currentUser) throw new Error('Usuario no autenticado');

  const cacheKey = getCacheKey('debts-view');
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  try {
    const [debts, debtPayments, accounts] = await Promise.all([
      loadData('debts', 100, 1),
      loadData('debtPayments', 100, 1),
      loadData('accounts', 100, 1)
    ]);

    const result = { debts, debtPayments, accounts };
    saveToCache(cacheKey, result);
    return result;
  } catch (error) {
    console.error('Error cargando deudas:', error);
    return { debts: [], debtPayments: [], accounts: [] };
  }
}

export async function loadGoalsData() {
  if (!currentUser) throw new Error('Usuario no autenticado');

  const cacheKey = getCacheKey('goals-view');
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  try {
    const goals = await loadData('goals', 100, 1);
    saveToCache(cacheKey, goals);
    return goals;
  } catch (error) {
    console.error('Error cargando metas:', error);
    return [];
  }
}
