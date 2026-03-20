/*
  Fix ADMIN001 Firebase Auth settings without requiring a new app build.

  What it can do:
  - Inspect ADMIN001: shows Firebase Auth email + emailVerified and Firestore admin profile email fields.
  - Update email (Auth + Firestore profile).
  - Mark emailVerified=true (Auth).

  Usage:
    node scripts/fix-admin001-auth.js
      (dry-run; prints current state)

    node scripts/fix-admin001-auth.js --verify --apply
      (marks ADMIN001 emailVerified=true)

    node scripts/fix-admin001-auth.js --email nurse@876.com --verify --apply
      (updates email + marks verified)

  Notes:
  - Requires firebase-admin service account JSON.
  - Looks for GOOGLE_APPLICATION_CREDENTIALS or ./firebase-service-key.json
*/

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const getArgValue = (argv, name) => {
  const idx = argv.indexOf(name);
  if (idx === -1) return null;
  const val = argv[idx + 1];
  if (!val || val.startsWith('--')) return null;
  return val;
};

async function initAdmin() {
  const keyPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(process.cwd(), 'firebase-service-key.json');

  if (!fs.existsSync(keyPath)) {
    throw new Error(
      `Firebase service account key not found at ${keyPath}. Set GOOGLE_APPLICATION_CREDENTIALS or add firebase-service-key.json.`
    );
  }

  const svc = require(keyPath);

  // Avoid "app already exists" errors if script is re-run in same process.
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(svc) });
  }
}

async function findAdmin001Doc() {
  const db = admin.firestore();
  const snap = await db
    .collection('admins')
    .where('adminCode', '==', 'ADMIN001')
    .limit(1)
    .get();

  if (snap.empty) {
    throw new Error('Could not find ADMIN001 in Firestore admins collection (adminCode == ADMIN001).');
  }

  const docSnap = snap.docs[0];
  return { id: docSnap.id, ref: docSnap.ref, data: docSnap.data() || {} };
}

async function main() {
  const argv = process.argv.slice(2);

  const newEmailRaw = getArgValue(argv, '--email') || getArgValue(argv, '--new-email');
  const newEmail = newEmailRaw ? String(newEmailRaw).trim() : '';

  const shouldVerify = argv.includes('--verify');
  const shouldApply = argv.includes('--apply');

  await initAdmin();

  const { id: uid, ref, data: profile } = await findAdmin001Doc();
  const userRecord = await admin.auth().getUser(uid);

  console.log('ADMIN001 (Firestore doc id / Auth uid):', uid);
  console.log('Auth email:', userRecord.email || 'N/A');
  console.log('Auth emailVerified:', Boolean(userRecord.emailVerified));
  console.log('Firestore profile email:', profile.email || 'N/A');
  console.log('Firestore profile contactEmail:', profile.contactEmail || 'N/A');

  const authUpdates = {};
  const firestoreUpdates = {};

  if (newEmail) {
    authUpdates.email = newEmail;
    firestoreUpdates.email = newEmail;
    firestoreUpdates.contactEmail = newEmail;
  }
  if (shouldVerify) {
    authUpdates.emailVerified = true;
  }

  const hasChanges = Object.keys(authUpdates).length > 0;

  if (!hasChanges) {
    console.log('\nNo changes requested.');
    console.log('Tip: add --verify to mark emailVerified=true, and/or --email <address> to change email.');
    console.log('Add --apply to actually perform updates.');
    return;
  }

  console.log('\nPlanned changes:');
  console.log('- Auth updates:', authUpdates);
  if (Object.keys(firestoreUpdates).length > 0) {
    console.log('- Firestore updates:', firestoreUpdates);
  }

  if (!shouldApply) {
    console.log('\nDry run only (no changes applied). Re-run with --apply to perform the updates.');
    return;
  }

  await admin.auth().updateUser(uid, authUpdates);
  console.log('\n✓ Updated Firebase Auth user.');

  if (Object.keys(firestoreUpdates).length > 0) {
    await ref.set(
      {
        ...firestoreUpdates,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    console.log('✓ Updated Firestore admin profile.');
  }

  const updatedUser = await admin.auth().getUser(uid);
  console.log('\nUpdated Auth email:', updatedUser.email || 'N/A');
  console.log('Updated Auth emailVerified:', Boolean(updatedUser.emailVerified));
}

main().catch((error) => {
  console.error('\n❌ ERROR:', error?.message || error);
  process.exit(1);
});
