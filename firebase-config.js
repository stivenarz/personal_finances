// Firebase Configuration
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, updateDoc, deleteDoc, doc, setDoc, getDoc, query, where } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

// Firebase config defaults (compartida)
const DEFAULT_CONFIG = {
  apiKey: "AIzaSyDwhp9OFmc37-tBx1A1YOa-Squ4YgmN748",
  authDomain: "personalfinances-88752.firebaseapp.com",
  projectId: "personalfinances-88752",
  storageBucket: "personalfinances-88752.firebasestorage.app",
  messagingSenderId: "476766925228",
  appId: "1:476766925228:web:b608abe3314d5021bb0a09"
};

// Obtener configuración desde localStorage o usar defaults
export function getFirebaseConfigValues() {
  return {
    apiKey: localStorage.getItem('firebaseApiKey') || DEFAULT_CONFIG.apiKey,
    authDomain: localStorage.getItem('firebaseAuthDomain') || DEFAULT_CONFIG.authDomain,
    projectId: localStorage.getItem('firebaseProjectId') || DEFAULT_CONFIG.projectId,
    storageBucket: localStorage.getItem('firebaseStorageBucket') || DEFAULT_CONFIG.storageBucket,
    messagingSenderId: localStorage.getItem('firebaseMessagingSenderId') || DEFAULT_CONFIG.messagingSenderId,
    appId: localStorage.getItem('firebaseAppId') || DEFAULT_CONFIG.appId
  };
}

// Guardar configuración completa en localStorage
export function setFirebaseConfig(config) {
  if (config.apiKey) localStorage.setItem('firebaseApiKey', config.apiKey);
  if (config.authDomain) localStorage.setItem('firebaseAuthDomain', config.authDomain);
  if (config.projectId) localStorage.setItem('firebaseProjectId', config.projectId);
  if (config.storageBucket) localStorage.setItem('firebaseStorageBucket', config.storageBucket);
  if (config.messagingSenderId) localStorage.setItem('firebaseMessagingSenderId', config.messagingSenderId);
  if (config.appId) localStorage.setItem('firebaseAppId', config.appId);
  console.log('Configuración Firebase guardada');
}

// Crear configuración de Firebase con valores actuales
function getFirebaseConfig() {
  return getFirebaseConfigValues();
}

// Compatibilidad hacia atrás
export function getApiKey() {
  return getFirebaseConfigValues().apiKey;
}

const firebaseConfig = getFirebaseConfig();

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let currentUser = null;

// ============ AUTH ============
export async function initializeAuth() {
  return new Promise((resolve, reject) => {
    auth.onAuthStateChanged(async (user) => {
      if (user) {
        currentUser = user;
        console.log('Autenticado como:', user.uid);
        resolve(user);
      } else {
        // Sign in anonymously
        signInAnonymously(auth)
          .then((result) => {
            currentUser = result.user;
            console.log('Sesión anónima creada:', currentUser.uid);
            resolve(currentUser);
          })
          .catch((error) => {
            console.error('Error en autenticación:', error);
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
    const userCollectionPath = `users/${currentUser.uid}/${collectionName}`;
    const docRef = doc(db, userCollectionPath, data.id);
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
    const userCollectionPath = `users/${currentUser.uid}/${collectionName}`;
    const querySnapshot = await getDocs(collection(db, userCollectionPath));
    const data = [];
    querySnapshot.forEach((doc) => {
      data.push({ id: doc.id, ...doc.data() });
    });
    return data;
  } catch (error) {
    console.error('Error cargando datos:', error);
    return [];
  }
}

export async function updateData(collectionName, docId, data) {
  if (!currentUser) throw new Error('Usuario no autenticado');

  try {
    const userCollectionPath = `users/${currentUser.uid}/${collectionName}`;
    const docRef = doc(db, userCollectionPath, docId);
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
    const userCollectionPath = `users/${currentUser.uid}/${collectionName}`;
    await deleteDoc(doc(db, userCollectionPath, docId));
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
