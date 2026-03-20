const admin = require('./node_modules/firebase-admin');
const serviceAccount = require('./firebase-service-key.json');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

async function main() {
  // Delete shiftRequests that are completed (finalCompletedAt set OR status === 'completed')
  const snap = await db.collection('shiftRequests').get();
  const toDelete = [];
  snap.forEach(doc => {
    const d = doc.data();
    if (d.finalCompletedAt || d.finalCompletedDate || String(d.status || '').toLowerCase() === 'completed') {
      toDelete.push(doc.ref);
      console.log(`Will delete: ${doc.id} | service: ${d.service} | patient: ${d.patientName || d.clientName}`);
    }
  });

  if (toDelete.length === 0) {
    console.log('No completed shiftRequests found.');
    process.exit(0);
  }

  const batch = db.batch();
  toDelete.forEach(ref => batch.delete(ref));
  await batch.commit();
  console.log(`\nDeleted ${toDelete.length} completed shiftRequest(s).`);
}
main().catch(console.error).finally(() => process.exit());
