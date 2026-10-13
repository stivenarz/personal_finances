import { COLLECTIONS } from '../collections.js';

const SDK_VERSION = '12.19.0';
const BASE = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;

let sdk = null;
let app = null;
let db = null;
let auth = null;
let unsubscribers = [];

async function loadSdk() {
    if (sdk) return sdk;
    const [appMod, fsMod, authMod] = await Promise.all([
        import(`${BASE}/firebase-app.js`),
        import(`${BASE}/firebase-firestore.js`),
        import(`${BASE}/firebase-auth.js`)
    ]);
    sdk = { ...appMod, ...fsMod, ...authMod };
    return sdk;
}

async function signIn(authInstance) {
    const current = await new Promise(resolve => {
        const unsubscribe = sdk.onAuthStateChanged(authInstance, user => {
            unsubscribe();
            resolve(user);
        });
    });
    if (current) return current;
    return (await sdk.signInAnonymously(authInstance)).user;
}

function toMillis(value) {
    if (typeof value === 'number') return value;
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    return 0;
}

/** Convierte un documento de Firestore en { id, updatedAt, deleted, data }. */
function fromDoc(docSnap) {
    const raw = docSnap.data();
    const data = {};
    Object.entries(raw).forEach(([key, value]) => {
        if (key === 'updatedAt' || key === 'deleted') return;
        data[key] = value && typeof value.toDate === 'function' ? value.toDate().toISOString() : value;
    });
    return { id: docSnap.id, updatedAt: toMillis(raw.updatedAt), deleted: raw.deleted === true, data };
}

const plain = (value) => JSON.parse(JSON.stringify(value));

/**
 * Firestore con autenticación anónima. Cada colección de la app es una colección raíz y cada registro un
 * documento con sus campos más `updatedAt` (ms) y `deleted` (borrado lógico). Los cambios llegan en tiempo
 * real con `onSnapshot`; la caché persistente de Firestore encola las escrituras sin conexión.
 * El SDK se descarga sólo cuando este proveedor está activo.
 *
 * @type {import('../data-service.js').Provider}
 */
export default {
    name: 'firebase',

    async connect({ config, onRemote, onReady, onStatus }) {
        const fb = config.firebase;
        await loadSdk();

        app = app || sdk.initializeApp(fb);
        try {
            db = sdk.initializeFirestore(app, {
                localCache: sdk.persistentLocalCache({ tabManager: sdk.persistentMultipleTabManager() })
            });
        } catch {
            db = sdk.getFirestore(app);
        }
        auth = sdk.getAuth(app);
        await signIn(auth);

        const confirmed = {};
        const pendingFlags = {};
        let pendingSince = null;
        let lastError = null;

        const publish = () => {
            const pending = Object.values(pendingFlags).some(Boolean);
            if (pending && !pendingSince) pendingSince = Date.now();
            if (!pending) pendingSince = null;

            let state;
            if (lastError) state = 'error';
            else if (!navigator.onLine) state = 'offline';
            else if (pending && Date.now() - pendingSince > 15000) state = 'offline';
            else if (pending) state = 'syncing';
            else state = COLLECTIONS.every(name => confirmed[name]) ? 'synced' : 'connecting';

            onStatus({
                state,
                pending: Object.values(pendingFlags).filter(Boolean).length,
                error: lastError,
                lastSync: state === 'synced' ? Date.now() : undefined
            });
        };

        let readyFired = false;
        unsubscribers = COLLECTIONS.map(name => sdk.onSnapshot(
            sdk.collection(db, name),
            { includeMetadataChanges: true },
            snapshot => {
                lastError = null;
                const changes = snapshot.docChanges({ includeMetadataChanges: false })
                    .filter(change => change.type !== 'removed')
                    .map(change => fromDoc(change.doc));
                if (changes.length) onRemote(name, changes);

                pendingFlags[name] = snapshot.metadata.hasPendingWrites;
                if (!snapshot.metadata.fromCache) confirmed[name] = true;

                if (!readyFired && COLLECTIONS.every(n => confirmed[n])) {
                    readyFired = true;
                    onReady();
                }
                publish();
            },
            error => {
                console.error(`Error escuchando ${name}:`, error);
                lastError = `${name}: ${error.message}`;
                publish();
            }
        ));

        window.addEventListener('online', publish);
        window.addEventListener('offline', publish);
        publish();
    },

    save(collection, record) {
        return sdk.setDoc(sdk.doc(db, collection, record.id), {
            ...plain(record),
            deleted: false
        }, { merge: true });
    },

    patch(collection, id, fields, updatedAt) {
        return sdk.setDoc(sdk.doc(db, collection, id), { ...plain(fields), updatedAt }, { merge: true });
    },

    remove(collection, id, updatedAt) {
        return sdk.setDoc(sdk.doc(db, collection, id), { deleted: true, updatedAt }, { merge: true });
    },

    async sync() {
        await sdk.disableNetwork(db);
        await sdk.enableNetwork(db);
        await this.flush(20000);
    },

    flush(timeout = 20000) {
        return Promise.race([
            sdk.waitForPendingWrites(db),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Sin conexión: los cambios se enviarán al reconectar')), timeout))
        ]);
    },

    async disconnect() {
        unsubscribers.forEach(unsubscribe => unsubscribe());
        unsubscribers = [];
    },

    async test(config) {
        let testApp = null;
        try {
            const fb = config?.apiKey ? config : config?.firebase;
            await loadSdk();
            testApp = sdk.initializeApp(fb, 'test-' + Date.now());
            const testAuth = sdk.getAuth(testApp);
            await signIn(testAuth);
            const testDb = sdk.getFirestore(testApp);
            await sdk.getDoc(sdk.doc(testDb, 'settings', 'plan'));
            return { success: true, message: 'Conexión exitosa con Firebase' };
        } catch (error) {
            return { success: false, message: 'Error: ' + error.message };
        } finally {
            if (testApp) sdk.deleteApp(testApp).catch(() => {});
        }
    }
};
