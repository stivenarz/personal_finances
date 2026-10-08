import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  getFirestore,
  collection,
  doc,
  setDoc,
  onSnapshot,
  increment,
  serverTimestamp,
  waitForPendingWrites,
  disableNetwork,
  enableNetwork,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

export const COLLECTIONS = [
  'accounts',
  'categories',
  'transactions',
  'debts',
  'debtPayments',
  'goals',
  'recurringExpenses',
  'paymentPlans',
  'settings'
];

export function isFirebaseConfigured() {
  try {
    const parsed = JSON.parse(localStorage.getItem('firebaseConfig') || 'null');
    return !!(parsed && parsed.apiKey && parsed.projectId && parsed.authDomain);
  } catch {
    return false;
  }
}

export function getFirebaseConfigValues() {
  if (!isFirebaseConfigured()) return null;
  try {
    return JSON.parse(localStorage.getItem('firebaseConfig'));
  } catch {
    return null;
  }
}

export function setFirebaseConfig(config) {
  localStorage.setItem('firebaseConfig', JSON.stringify({
    apiKey: config.apiKey || '',
    authDomain: config.authDomain || '',
    projectId: config.projectId || '',
    storageBucket: config.storageBucket || '',
    messagingSenderId: config.messagingSenderId || '',
    appId: config.appId || ''
  }));
}

let app = null;
let db = null;
let auth = null;

export function initializeFirebase() {
  if (app) return true;
  if (!isFirebaseConfigured()) return false;

  app = initializeApp(getFirebaseConfigValues());
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
  } catch (error) {
    console.warn('Caché persistente no disponible, se usa solo memoria:', error);
    db = getFirestore(app);
  }
  auth = getAuth(app);
  return true;
}

export async function ensureSignedIn() {
  const current = await new Promise(resolve => {
    const unsubscribe = onAuthStateChanged(auth, user => {
      unsubscribe();
      resolve(user);
    });
  });
  if (current) return current;
  const result = await signInAnonymously(auth);
  return result.user;
}

export function subscribeCollection(name, onSnapshotCallback, onErrorCallback) {
  return onSnapshot(
    collection(db, name),
    { includeMetadataChanges: true },
    onSnapshotCallback,
    onErrorCallback
  );
}

function toPlain(record) {
  return JSON.parse(JSON.stringify(record));
}

export function saveRecord(name, record) {
  return setDoc(doc(db, name, record.id), {
    ...toPlain(record),
    updatedAt: serverTimestamp()
  }, { merge: true });
}

export function patchRecord(name, id, fields) {
  return setDoc(doc(db, name, id), {
    ...toPlain(fields),
    updatedAt: serverTimestamp()
  }, { merge: true });
}

export function deleteRecord(name, id) {
  return setDoc(doc(db, name, id), {
    deleted: true,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

export function adjustNumericField(name, id, field, delta) {
  return setDoc(doc(db, name, id), {
    [field]: increment(delta),
    updatedAt: serverTimestamp()
  }, { merge: true });
}

export function pendingWrites() {
  return waitForPendingWrites(db);
}

export function setNetworkEnabled(enabled) {
  return enabled ? enableNetwork(db) : disableNetwork(db);
}

export async function testFirebaseConnection() {
  try {
    if (!db) initializeFirebase();
    await ensureSignedIn();
    await getDoc(doc(db, 'settings', 'plan'));
    return { success: true, message: 'Conexión exitosa' };
  } catch (error) {
    return { success: false, message: 'Error: ' + error.message };
  }
}
