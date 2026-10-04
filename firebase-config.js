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

export async function loadData(collectionName) {
  if (!currentUser) throw new Error('Usuario no autenticado');

  try {
    const querySnapshot = await getDocs(collection(db, collectionName));
    const data = [];
    querySnapshot.forEach((doc) => {
      data.push({ id: doc.id, ...doc.data() });
    });
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
    return true;
  } catch (error) {
    console.error('Error eliminando datos:', error);
    throw error;
  }
}


// ============ SYNC ALL DATA ============
export async function loadAllData() {
  if (!currentUser) throw new Error('Usuario no autenticado');

  try {
    const [transactions, debts, accounts, categories, goals, debtPayments] = await Promise.all([
      loadData('transactions'),
      loadData('debts'),
      loadData('accounts'),
      loadData('categories'),
      loadData('goals'),
      loadData('debtPayments')
    ]);

    return {
      transactions,
      debts,
      accounts,
      categories,
      goals,
      debtPayments
    };
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
  setTimeout(() => location.reload(), 500);
}

// ============ LAZY LOAD - Solo datos específicos por vista ============
export async function loadTransactionsData() {
  if (!currentUser) throw new Error('Usuario no autenticado');
  try {
    return await Promise.all([
      loadData('transactions'),
      loadData('accounts'),
      loadData('categories')
    ]).then(([transactions, accounts, categories]) => ({ transactions, accounts, categories }));
  } catch (error) {
    console.error('Error cargando transacciones:', error);
    return { transactions: [], accounts: [], categories: [] };
  }
}

export async function loadDebtsData() {
  if (!currentUser) throw new Error('Usuario no autenticado');
  try {
    return await Promise.all([
      loadData('debts'),
      loadData('debtPayments'),
      loadData('accounts')
    ]).then(([debts, debtPayments, accounts]) => ({ debts, debtPayments, accounts }));
  } catch (error) {
    console.error('Error cargando deudas:', error);
    return { debts: [], debtPayments: [], accounts: [] };
  }
}

export async function loadGoalsData() {
  if (!currentUser) throw new Error('Usuario no autenticado');
  try {
    return await loadData('goals');
  } catch (error) {
    console.error('Error cargando metas:', error);
    return [];
  }
}
