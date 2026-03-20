const admin = require('./node_modules/firebase-admin');
const serviceAccount = require('./firebase-service-key.json');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

async function main() {
  const snap = await db.collection('shiftRequests').get();
  console.log('Total shiftRequests:', snap.size);
  snap.forEach(doc => {
    const d = doc.data();
    console.log('\n--- ' + doc.id);
    console.log('status:', d.status);
    console.log('service:', d.service || d.serviceType);
    console.log('patientName/clientName:', d.patientName || d.clientName || d.name);
    console.log('clockByNurse:', JSON.stringify(d.clockByNurse || null));
    console.log('finalCompletedAt:', d.finalCompletedAt || 'none');
    console.log('hasValidClockOut fields: actualEndTime:', d.actualEndTime, '| lastClockOutTime:', d.lastClockOutTime, '| clockOutTime:', d.clockOutTime);
  });
}
main().catch(console.error).finally(() => process.exit());
