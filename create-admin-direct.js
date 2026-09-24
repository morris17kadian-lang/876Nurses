const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-key.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();
const auth = admin.auth();

async function createAdmin(fullName, email, phone, adminCode) {
  try {
    console.log(`\n🔨 Creating ${adminCode}: ${fullName}\n`);
    
    // Step 1: Create Firebase Auth user
    console.log(`1️⃣  Creating Firebase Auth user...`);
    let authUser = await auth.createUser({
      email: email,
      password: 'temp123',
      displayName: fullName
    });
    const uid = authUser.uid;
    console.log(`✅ Auth user created: ${uid}`);

    // Step 2: Create Firestore admin profile
    console.log(`\n2️⃣  Creating Firestore admin profile...`);
    await db.collection('admins').doc(uid).set({
      fullName: fullName,
      email: email,
      phone: phone,
      role: 'admin',
      adminCode: adminCode,
      code: adminCode,
      username: adminCode,
      isActive: true,
      isSuperAdmin: false,
      adminLevel: 'admin',
      bankingDetails: {
        bankName: 'Not provided',
        accountNumber: 'Not provided',
        accountHolderName: fullName,
        bankBranch: 'Main Branch',
        currency: 'JMD'
      },
      profilePhoto: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`✅ Firestore profile created`);

    // Step 3: Verify
    console.log(`\n3️⃣  Verifying...`);
    const doc = await db.collection('admins').where('adminCode', '==', adminCode).limit(1).get();
    if (!doc.empty) {
      console.log(`✅ SUCCESS: ${adminCode} has been created!\n`);
      console.log(`   Name: ${doc.docs[0].data().fullName}`);
      console.log(`   Email: ${doc.docs[0].data().email}`);
      console.log(`   Phone: ${doc.docs[0].data().phone}`);
      console.log(`   Password: temp123 (must change on first login)`);
    } else {
      console.log(`❌ ERROR: Could not verify creation`);
    }
    
  } catch (error) {
    console.error(`❌ Error creating admin:`, error.message);
    process.exit(1);
  }
}

// Create ADMIN002
createAdmin(
  'Destena Sinclair',     // Full name
  'destena@876nurses.com', // Email
  '+1876-555-0102',       // Phone
  'ADMIN002'              // Code
).then(() => process.exit(0));
