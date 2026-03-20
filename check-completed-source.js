const admin = require('./node_modules/firebase-admin');
const serviceAccount = require('./firebase-service-key.json');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

async function checkCollection(name) {
  try {
    const snap = await db.collection(name).get();
    if (snap.empty) return;
    console.log(`\n=== ${name} (${snap.size} docs) ===`);
    snap.forEach(doc => {
      const d = doc.data();
      const status = d.status || d.shiftStatus || d.appointmentStatus;
      if (status === 'completed' || status === 'Completed') {
        console.log(`  [COMPLETED] ${doc.id} | service: ${d.service || d.serviceType || d.appointmentType} | patient: ${d.patientName || d.clientName || d.name} | date: ${d.date || d.scheduledDate || d.shiftDate}`);
      }
    });
  } catch (e) {
    // collection doesn't exist
  }
}

async function main() {
  const collections = [
    'appointments', 'shiftRequests', 'shifts', 'nurseShifts',
    'completedAppointments', 'completedShifts', 'visits', 'sessions'
  ];
  for (const col of collections) {
    await checkCollection(col);
  }
  
  // Also list ALL collections to find any we missed
  const cols = await db.listCollections();
  console.log('\nAll collections in Firestore:');
  cols.forEach(c => console.log(' -', c.id));
}
main().catch(console.error).finally(() => process.exit());
