const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-key.json');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

async function main() {
  const snap = await db.collection('invoices').orderBy('createdAt', 'desc').limit(10).get();
  console.log('Total invoices fetched:', snap.size);
  snap.forEach(doc => {
    const d = doc.data();
    console.log('\n--- ' + doc.id);
    console.log('invoiceId:', d.invoiceId, '| status:', d.status, '| paymentStatus:', d.paymentStatus);
    console.log('service:', d.service);
    console.log('subtotal:', d.subtotal, '| paidAmount:', d.paidAmount, '| outstandingAmount:', d.outstandingAmount, '| finalTotal:', d.finalTotal);
    console.log('appointmentId:', d.appointmentId, '| relatedAppointmentId:', d.relatedAppointmentId);
    console.log('isConsultation:', d.isConsultation, '| createdAt:', d.createdAt);
  });
}
main().catch(console.error).finally(() => process.exit());
