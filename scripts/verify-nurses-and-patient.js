/*
  Mark all nurses and patient "kadian red" as emailVerified=true in Firebase Auth.

  Usage:
    node scripts/verify-nurses-and-patient.js
      (dry-run; shows who will be verified)

    node scripts/verify-nurses-and-patient.js --apply
      (actually marks them verified)

  Notes:
  - Requires firebase-admin service account JSON.
  - Looks for GOOGLE_APPLICATION_CREDENTIALS or ./firebase-service-key.json
*/

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

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

  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(svc) });
  }
}

async function getAllNurses() {
  const db = admin.firestore();
  const snap = await db.collection('nurses').get();
  
  return snap.docs.map(doc => ({
    uid: doc.id,
    data: doc.data()
  }));
}

async function findPatientKadianRed() {
  const db = admin.firestore();
  
  // Try patients collection first
  const patientsSnap = await db.collection('patients').get();
  
  for (const doc of patientsSnap.docs) {
    const data = doc.data();
    const fullName = (data.fullName || '').toLowerCase();
    const firstName = (data.firstName || '').toLowerCase();
    const lastName = (data.lastName || '').toLowerCase();
    
    if (
      fullName.includes('kadian') && fullName.includes('red') ||
      (firstName.includes('kadian') && lastName.includes('red'))
    ) {
      return { uid: doc.id, data, collection: 'patients' };
    }
  }
  
  // Try users collection
  const usersSnap = await db.collection('users').get();
  
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    const fullName = (data.fullName || '').toLowerCase();
    const firstName = (data.firstName || '').toLowerCase();
    const lastName = (data.lastName || '').toLowerCase();
    
    if (
      fullName.includes('kadian') && fullName.includes('red') ||
      (firstName.includes('kadian') && lastName.includes('red'))
    ) {
      return { uid: doc.id, data, collection: 'users' };
    }
  }
  
  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  const shouldApply = argv.includes('--apply');

  await initAdmin();

  console.log('🔍 Finding nurses and patient "kadian red"...\n');

  const nurses = await getAllNurses();
  const patient = await findPatientKadianRed();

  const accounts = [];

  // Add all nurses
  for (const nurse of nurses) {
    try {
      const userRecord = await admin.auth().getUser(nurse.uid);
      accounts.push({
        uid: nurse.uid,
        type: 'nurse',
        name: nurse.data.fullName || nurse.data.firstName || 'N/A',
        email: userRecord.email || 'N/A',
        currentlyVerified: Boolean(userRecord.emailVerified)
      });
    } catch (err) {
      console.log(`⚠ Could not find Auth user for nurse ${nurse.uid} (${nurse.data.fullName})`);
    }
  }

  // Add patient kadian red if found
  if (patient) {
    try {
      const userRecord = await admin.auth().getUser(patient.uid);
      accounts.push({
        uid: patient.uid,
        type: 'patient',
        name: patient.data.fullName || patient.data.firstName || 'kadian red',
        email: userRecord.email || 'N/A',
        currentlyVerified: Boolean(userRecord.emailVerified)
      });
    } catch (err) {
      console.log(`⚠ Could not find Auth user for patient ${patient.uid}`);
    }
  } else {
    console.log('⚠ Patient "kadian red" not found in Firestore patients or users collections\n');
  }

  if (accounts.length === 0) {
    console.log('No accounts found to verify.');
    return;
  }

  console.log(`Found ${accounts.length} accounts:\n`);
  
  accounts.forEach((acc, i) => {
    const status = acc.currentlyVerified ? '✓ already verified' : '✗ not verified';
    console.log(`${i + 1}. [${acc.type.toUpperCase()}] ${acc.name} (${acc.email}) - ${status}`);
  });

  const needsVerification = accounts.filter(acc => !acc.currentlyVerified);

  if (needsVerification.length === 0) {
    console.log('\n✅ All accounts are already verified!');
    return;
  }

  console.log(`\n📝 ${needsVerification.length} account(s) need verification.`);

  if (!shouldApply) {
    console.log('\nDry run only (no changes applied). Re-run with --apply to verify these accounts.');
    return;
  }

  console.log('\n🔧 Marking accounts as verified...\n');

  let successCount = 0;
  let failCount = 0;

  for (const acc of needsVerification) {
    try {
      await admin.auth().updateUser(acc.uid, { emailVerified: true });
      console.log(`✓ Verified: ${acc.name} (${acc.email})`);
      successCount++;
    } catch (err) {
      console.log(`✗ Failed: ${acc.name} - ${err.message}`);
      failCount++;
    }
  }

  console.log(`\n✅ Done: ${successCount} verified, ${failCount} failed.`);
}

main().catch((error) => {
  console.error('\n❌ ERROR:', error?.message || error);
  process.exit(1);
});
