const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-key.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();
const auth = admin.auth();

async function testAdminCreate() {
  try {
    console.log('🧪 Testing Admin Creation with Admin SDK\n');
    
    // Create auth user
    const testEmail = `admin-test-${Date.now()}@876nurses.com`;
    const adminUser = await auth.createUser({
      email: testEmail,
      password: 'temp123',
      displayName: 'Test Admin'
    });
    const uid = adminUser.uid;
    console.log(`✅ Auth user created: ${uid}\n`);

    // Create Firestore profile
    const adminCode = `ADMIN${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
    await db.collection('admins').doc(uid).set({
      fullName: 'Test Admin',
      email: testEmail,
      phone: '+1876-555-0199',
      role: 'admin',
      adminCode: adminCode,
      code: adminCode,
      username: adminCode,
      isActive: true,
      bankingDetails: {
        bankName: 'Test Bank',
        accountNumber: '123456789',
        accountHolderName: 'Test Admin',
        bankBranch: 'Main',
        currency: 'JMD'
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`✅ Firestore profile created for ${adminCode}\n`);

    // Verify
    const doc = await db.collection('admins').doc(uid).get();
    if (doc.exists()) {
      console.log(`✅ VERIFIED: Admin was successfully created in Firestore`);
      console.log(`   UID: ${uid}`);
      console.log(`   Code: ${doc.data().adminCode}`);
      console.log(`   Email: ${doc.data().email}`);
    } else {
      console.log(`❌ ERROR: Admin was not found after creation!`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testAdminCreate().then(() => process.exit(0));
