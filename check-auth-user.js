const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-key.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const auth = admin.auth();
const db = admin.firestore();

async function checkEmail(email) {
  try {
    console.log(`\n🔍 Checking ${email}...\n`);
    
    // Get auth user
    const authUser = await auth.getUserByEmail(email);
    console.log(`✅ Auth user found:`);
    console.log(`   UID: ${authUser.uid}`);
    console.log(`   Email: ${authUser.email}`);
    console.log(`   Created: ${authUser.metadata.creationTime}`);

    // Check if Firestore profile exists
    console.log(`\n🔍 Checking Firestore profile...`);
    const adminDoc = await db.collection('admins').doc(authUser.uid).get();
    
    if (adminDoc.exists()) {
      console.log(`✅ Firestore profile EXISTS:`);
      console.log(`   Code: ${adminDoc.data().adminCode}`);
    } else {
      console.log(`❌ Firestore profile DOES NOT EXIST`);
      console.log(`   This explains why ADMIN002 isn't showing!`);
      console.log(`   The app can create the Auth user but can't write to Firestore`);
      console.log(`   (likely a Firestore security rules issue)`);
    }
    
  } catch (error) {
    console.error(`❌ Error:`, error.message);
  }
}

checkEmail('destena@876nurses.com').then(() => process.exit(0));
