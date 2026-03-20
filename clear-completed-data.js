/**
 * Clear:
 *  1. Completed appointments (status === 'completed')
 *  2. All invoices
 *  3. Pending medical report requests (medicalReports collection, status === 'pending')
 */
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-key.json');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

async function deleteCollection(snap, label) {
  if (snap.empty) {
    console.log(`  No ${label} found.`);
    return 0;
  }
  const batch = db.batch();
  snap.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  console.log(`  Deleted ${snap.size} ${label}.`);
  return snap.size;
}

async function main() {
  console.log('Starting cleanup...\n');

  // 1. Completed appointments
  console.log('1. Completed appointments:');
  const completedSnap = await db.collection('appointments')
    .where('status', '==', 'completed')
    .get();
  await deleteCollection(completedSnap, 'completed appointment(s)');

  // 2. All invoices
  console.log('\n2. Invoices:');
  const invoicesSnap = await db.collection('invoices').get();
  await deleteCollection(invoicesSnap, 'invoice(s)');

  // Reset invoice counter so next invoice starts from 0001
  try {
    await db.collection('counters').doc('invoices').set({ current: 0 }, { merge: true });
    console.log('  Invoice counter reset to 0.');
  } catch (e) {
    console.warn('  Could not reset invoice counter:', e.message);
  }

  // 3. Pending medical report requests
  console.log('\n3. Pending medical report requests:');
  // Try both likely collection names
  for (const colName of ['medicalReports', 'medical_reports', 'medicalReportRequests']) {
    const snap = await db.collection(colName).where('status', '==', 'pending').get();
    if (!snap.empty) {
      await deleteCollection(snap, `pending medical report(s) in "${colName}"`);
    } else {
      // Also try without status filter in case collection exists with different field
      const allSnap = await db.collection(colName).get();
      if (!allSnap.empty) {
        console.log(`  Found ${allSnap.size} doc(s) in "${colName}" (no status filter). Checking...`);
        const pendingDocs = allSnap.docs.filter(d => {
          const s = d.data().status;
          return !s || s === 'pending' || s === 'requested';
        });
        if (pendingDocs.length > 0) {
          const batch = db.batch();
          pendingDocs.forEach(d => batch.delete(d.ref));
          await batch.commit();
          console.log(`  Deleted ${pendingDocs.length} pending/unresolved doc(s) from "${colName}".`);
        } else {
          console.log(`  No pending docs in "${colName}".`);
        }
      }
    }
  }

  console.log('\nDone.');
}

main().catch(console.error).finally(() => process.exit());
