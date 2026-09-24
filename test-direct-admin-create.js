const admin = require('firebase-admin');
const { initializeApp, getApp, getApps } = require('firebase/app');
const { getAuth, createUserWithEmailAndPassword } = require('firebase/auth');
const { getFirestore, doc, setDoc, Timestamp } = require('firebase/firestore');
const serviceAccount = require('./firebase-service-key.json');
const firebaseConfig = require('./src/config/firebase').firebaseConfig;

// Initialize Firebase Admin SDK (for backend)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const adminDb = admin.firestore();

async function testAdminCreate() {
  try {
    console.log('🧪 Testing Admin Creation Directly...\n');
    
    // Step 1: Create auth user
    console.log('1️⃣  Creating Firebase Auth user with Admin SDK...');
    const testEmail = `admin-test-${Date.now()}@876nurses.com`;
    
    let adminAuthUser;
    try {
      adminAuthUser = await admin.auth().createUser({
        email: testEmail,
        password: 'temp123',
        displayName: 'Test Admin'
      });
      console.log(`✅ Auth user created: ${adminAuthUser.uid}`);
    } catch (authError) {
      console.log(`⚠️  Auth error: ${authError.message}`);
      return;
    }

    // Step 2: Create Firestore profile using Admin SDK (should always work)
    console.log('\n2️⃣  Creating Firestore profile with Admin SDK...');
    const adminCode = `ADMIN${Math.floor(Math.random() * 1000)}`;
    const profileData = {
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
    };
    
    await adminDb.collection('admins').doc(adminAuthUser.uid).set(profileData);
    console.log(`✅ Firestore profile created for ${adminCode}`);
    
    // Step 3: Verify it was created
    console.log('\n3️⃣  Verifying creation...');
    const doc1 = await adminDb.collection('admins').doc(adminAuthUser.uid).get();
    if (doc1.exists()) {
      console.log(`✅ VERIFIED: Admin exists in Firestore`);
      console.log(`   Code: ${doc1.data().adminCode}`);
      console.log(`   Email: ${doc1.data().email}`);
    } else {
      console.log(`❌ ERROR: Admin was NOT created in Firestore!`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testAdminCreate().then(() => process.exit(0));
