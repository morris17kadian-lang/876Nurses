const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

let firestoreInstance = null;

function resolveServiceAccountPath() {
  const configuredPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const backendRoot = path.resolve(__dirname, '..');

  if (configuredPath) {
    const absolutePath = path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(backendRoot, configuredPath);

    if (fs.existsSync(absolutePath)) {
      return absolutePath;
    }

    console.warn(`[FirebaseAdmin] Service account file not found at ${absolutePath}`);
  }

  // Default to repository root firebase-service-key.json
  const fallbackPath = path.resolve(backendRoot, '../firebase-service-key.json');
  if (fs.existsSync(fallbackPath)) {
    return fallbackPath;
  }

  console.warn('[FirebaseAdmin] No service account file found. Firebase features will be disabled.');
  return null;
}

function initializeFirebaseAdmin() {
  if (firestoreInstance) {
    return firestoreInstance;
  }

  try {
    if (!admin.apps.length) {
      const serviceAccountPath = resolveServiceAccountPath();
      if (!serviceAccountPath) {
        return null;
      }

      const serviceAccount = require(serviceAccountPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_ADMIN_DATABASE_URL,
      });
    }

    firestoreInstance = admin.firestore();
    return firestoreInstance;
  } catch (error) {
    console.error('[FirebaseAdmin] Failed to initialize Firebase Admin SDK:', error.message);
    return null;
  }
}

module.exports = {
  admin,
  getFirestore: initializeFirebaseAdmin,
};
