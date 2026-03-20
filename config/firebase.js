import { initializeApp } from 'firebase/app';
import { 
  getAuth,
  initializeAuth,
  getReactNativePersistence,
  connectAuthEmulator,
  setPersistence,
  browserLocalPersistence 
} from 'firebase/auth';
import { 
  getFirestore, 
  connectFirestoreEmulator,
  enableIndexedDbPersistence 
} from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Firebase Configuration
// NOTE:
// - Do NOT hard-code Firebase keys in this repo.
// - Configure these via environment variables (Expo: EXPO_PUBLIC_*) or your CI/CD secrets.
// - Firebase "apiKey" is typically not treated as a secret by Firebase, but scanners will still
//   flag it if committed. Keeping it in env prevents accidental exposure.
export const firebaseConfig = {
  // Use direct `process.env.EXPO_PUBLIC_*` access so Expo can inline values
  // at bundle time for EAS / production builds.
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || ''
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Get Auth instance with AsyncStorage persistence for React Native
const auth = Platform.OS === 'web' 
  ? getAuth(app)
  : initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage)
    });

// Get Firestore instance
const db = getFirestore(app);

// Get Storage instance
const storage = getStorage(app);

// Enable offline persistence for Firestore (web only).
// NOTE: React Native (Expo Go / dev builds) does not provide IndexedDB.
if (Platform.OS === 'web') {
  try {
    enableIndexedDbPersistence(db).catch(() => {
      // Keep silent: persistence is best-effort.
    });
  } catch {
    // Keep silent: persistence is best-effort.
  }
}

// Connect to emulator in development (optional)
// Uncomment these lines to use Firebase emulator suite locally
/*
const useEmulator = __DEV__;

if (useEmulator) {
  try {
    connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, 'localhost', 8080);
    connectStorageEmulator(storage, 'localhost', 9199);
  } catch (error) {
    // Emulator already initialized
  }
}
*/

export { auth, db, storage, app };
