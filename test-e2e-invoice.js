/**
 * E2E Test: Appointment booking → Invoice creation → Fygaro payment → Invoice stamped Paid
 *
 * Run in two steps:
 *   Step 1 (create):  node test-e2e-invoice.js create
 *   Step 2 (pay):     node test-e2e-invoice.js pay <invoiceFirestoreId>
 *
 * After Step 1 the script prints a Fygaro payment URL — open it in a browser and complete the
 * payment with a test card, then run Step 2 to stamp the invoice Paid via /api/payments/sync.
 */

const admin = require('./node_modules/firebase-admin');
const serviceAccount = require('./firebase-service-key.json');
const http = require('http');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

const BACKEND = 'http://localhost:3000';

// ---------- helpers ----------

function post(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const opts = new URL(url);
    const req = http.request(
      { hostname: opts.hostname, port: opts.port, path: opts.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Format a date as "Mar 10, 2026"
function fmtDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Next invoice counter
async function nextInvoiceId() {
  const ref = db.collection('counters').doc('invoices');
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const next = ((snap.exists ? snap.data().current : 0) || 0) + 1;
    tx.set(ref, { current: next }, { merge: true });
    return `NUR-INV-${String(next).padStart(4, '0')}`;
  });
}

// ---------- Step 1: Create ----------

async function create() {
  console.log('\n=== STEP 1: Creating test appointment + invoice ===\n');

  // Read service from Firestore
  const servicesSnap = await db.collection('services').get();
  let targetService = null;
  servicesSnap.forEach(doc => {
    const d = doc.data();
    if ((d.title || d.name || '').toLowerCase().includes('wound care')) {
      targetService = { id: doc.id, ...d };
    }
  });

  if (!targetService) {
    console.error('No "Wound Care" service found in Firestore. Available:');
    servicesSnap.forEach(d => console.log(' -', d.data().title || d.data().name));
    process.exit(1);
  }

  // Parse price exactly like BookScreen does
  const priceStr = String(targetService.price || '');
  const priceMatch = priceStr.match(/[\d,]+/);
  const servicePrice = priceMatch ? parseFloat(priceMatch[0].replace(/,/g, '')) : 0;

  console.log(`Service:  ${targetService.title || targetService.name}`);
  console.log(`Price:    J$${servicePrice} (from Firestore — raw value: "${priceStr}")`);

  const depositPercent = 50; // 50% just like configuration
  const depositAmount  = servicePrice * (depositPercent / 100);
  const totalAmount    = servicePrice;
  const outstanding    = totalAmount - depositAmount;

  console.log(`Total:    J$${totalAmount.toFixed(2)}`);
  console.log(`Deposit:  J$${depositAmount.toFixed(2)} (${depositPercent}%)`);
  console.log(`Balance:  J$${outstanding.toFixed(2)}`);

  // Generate invoice ID
  const invoiceId = await nextInvoiceId();
  const tempApptId = `appointment-test-${Date.now()}`;
  const now = new Date();

  const invoiceData = {
    invoiceId,
    clientName: 'Test Patient',
    clientEmail: 'testpatient@876nurses.test',
    clientPhone: '876-555-0001',
    clientAddress: '1 Test Lane, Kingston',
    nurseName: 'To be assigned',
    service: targetService.title || targetService.name,
    date: fmtDate(now),
    hours: 1,
    rate: totalAmount,
    total: totalAmount,
    issueDate: fmtDate(now),
    dueDate: fmtDate(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)),
    status: 'Partial',
    paymentStatus: 'partial',
    isConsultation: true,
    createdAt: now.toISOString(),
    appointmentId: tempApptId,          // will be patched after appointment is created
    relatedAppointmentId: tempApptId,
    items: [{
      description: targetService.title || targetService.name,
      detailedDescription: `Professional ${(targetService.title || targetService.name).toLowerCase()} services`,
      quantity: 1,
      price: servicePrice,
      total: servicePrice,
      serviceDates: '',
      nurseNames: ''
    }],
    subtotal: totalAmount,
    tax: 0,
    finalTotal: totalAmount,
    paidAmount: depositAmount,
    outstandingAmount: outstanding,
    payments: [{
      amount: depositAmount,
      transactionId: `test-txn-${Date.now()}`,
      type: 'deposit',
      date: now.toISOString(),
      method: 'fygaro',
      status: 'completed'
    }]
  };

  // Save invoice to Firestore
  const invoiceRef = await db.collection('invoices').add(invoiceData);
  console.log(`\n✅ Invoice created: ${invoiceId} (Firestore ID: ${invoiceRef.id})`);

  // Create a linked test appointment
  const appointmentData = {
    patientId: 'test-patient-001',
    patientName: 'Test Patient',
    patientEmail: 'testpatient@876nurses.test',
    patientPhone: '876-555-0001',
    clientName: 'Test Patient',
    service: targetService.title || targetService.name,
    appointmentType: targetService.title || targetService.name,
    date: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
    time: '10:00',
    address: '1 Test Lane, Kingston',
    notes: 'E2E test appointment',
    status: 'pending',
    totalAmount,
    depositAmount: depositAmount,
    paidAmount: depositAmount,
    outstandingAmount: outstanding,
    depositPaid: true,
    invoiceId,
    invoiceFirestoreId: invoiceRef.id,
    paymentStatus: 'partial',
    createdAt: now.toISOString(),
  };
  const apptRef = await db.collection('appointments').add(appointmentData);
  console.log(`✅ Appointment created: ${apptRef.id}`);

  // Patch invoice with the real appointment ID
  await db.collection('invoices').doc(invoiceRef.id).update({
    appointmentId: apptRef.id,
    relatedAppointmentId: apptRef.id,
    updatedAt: now.toISOString(),
  });
  console.log(`✅ Invoice back-patched with real appointment ID`);

  // Get Fygaro payment URL from backend
  console.log('\n--- Getting Fygaro payment URL from backend ---');
  const initResult = await post(`${BACKEND}/api/payments/initialize`, {
    amount: depositAmount,
    currency: 'JMD',
    invoiceId,
    invoiceFirestoreId: invoiceRef.id,
    appointmentId: apptRef.id,
    customerId: 'test-patient-001',
    customerName: 'Test Patient',
    customerEmail: 'testpatient@876nurses.test',
    description: `Deposit for ${targetService.title || targetService.name} - ${fmtDate(now)}`,
  });

  if (!initResult.success) {
    console.error('Payment init failed:', initResult.error);
    process.exit(1);
  }

  console.log('\n=================================================');
  console.log('PAYMENT URL (open in browser to pay):');
  console.log(initResult.paymentUrl);
  console.log('=================================================');
  console.log(`\nTransaction Reference: ${initResult.transactionId}`);
  console.log(`Invoice Firestore ID:  ${invoiceRef.id}`);
  console.log(`Appointment ID:        ${apptRef.id}`);
  console.log(`Invoice ID:            ${invoiceId}`);
  console.log('\nAfter paying, run:');
  console.log(`  node test-e2e-invoice.js pay ${invoiceRef.id}`);
}

// ---------- Step 2: Pay (sync) ----------

async function pay(invoiceFirestoreId) {
  console.log(`\n=== STEP 2: Stamping invoice ${invoiceFirestoreId} as Paid ===\n`);

  // Read invoice to get IDs
  const snap = await db.collection('invoices').doc(invoiceFirestoreId).get();
  if (!snap.exists) {
    console.error('Invoice not found:', invoiceFirestoreId);
    process.exit(1);
  }
  const inv = snap.data();
  console.log(`Invoice: ${inv.invoiceId} | Current status: ${inv.status} | Amount: J$${inv.subtotal}`);

  const syncResult = await post(`${BACKEND}/api/payments/sync`, {
    transactionId: `test-paid-${Date.now()}`,
    customReference: `876n-${invoiceFirestoreId}`,
    invoiceId: inv.invoiceId,
    invoiceFirestoreId,
    appointmentId: inv.appointmentId,
    amount: inv.subtotal,
    currency: 'JMD',
  });

  console.log('\nSync response:', JSON.stringify(syncResult, null, 2));

  // Verify
  const updated = (await db.collection('invoices').doc(invoiceFirestoreId).get()).data();
  console.log(`\n✅ Invoice status after sync: ${updated.status}`);
  console.log(`   paymentStatus: ${updated.paymentStatus}`);
  console.log(`   paymentProvider: ${updated.paymentProvider || 'N/A'}`);
  console.log(`   paidDate: ${updated.paidDate || 'N/A'}`);

  // Check appointment too
  if (inv.appointmentId) {
    const apptSnap = await db.collection('appointments').doc(inv.appointmentId).get();
    if (apptSnap.exists) {
      const appt = apptSnap.data();
      console.log(`\n✅ Appointment invoiceStatus: ${appt.invoiceStatus || 'not set'}`);
    }
  }

  if (updated.status === 'Paid' || updated.paymentStatus === 'paid') {
    console.log('\n🎉 SUCCESS — Invoice is marked PAID in Firestore.');
  } else {
    console.log('\n⚠️  Invoice was NOT updated to Paid. Check ENABLE_FYGARO_SYNC in backend .env.');
  }
}

// ---------- Entry ----------

const [,, command, arg] = process.argv;

if (command === 'create') {
  create().catch(console.error).finally(() => process.exit());
} else if (command === 'pay') {
  if (!arg) { console.error('Usage: node test-e2e-invoice.js pay <invoiceFirestoreId>'); process.exit(1); }
  pay(arg).catch(console.error).finally(() => process.exit());
} else {
  console.log('Usage:');
  console.log('  node test-e2e-invoice.js create');
  console.log('  node test-e2e-invoice.js pay <invoiceFirestoreId>');
  process.exit(1);
}
