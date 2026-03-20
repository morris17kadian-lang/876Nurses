const admin = require('./node_modules/firebase-admin');
const serviceAccount = require('./firebase-service-key.json');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

async function main() {
  const snap = await db.collection('appointments').get();
  console.log('Total appointments:', snap.size);
  snap.forEach(doc => {
    const d = doc.data();
    console.log(`\n--- ${doc.id}`);
    console.log('status:', d.status, '| service:', d.service || d.serviceType || d.appointmentType);
    console.log('patientName:', d.patientName || d.clientName || d.name);
    console.log('date:', d.date || d.scheduledDate || d.appointmentDate);
    console.log('isShift:', d.isShift, '| isShiftRequest:', d.isShiftRequest, '| clockByNurse:', d.clockByNurse);
    console.log('nurseSchedule:', d.nurseSchedule ? 'yes' : 'no', '| assignmentType:', d.assignmentType);
  });
}
main().catch(console.error).finally(() => process.exit());
