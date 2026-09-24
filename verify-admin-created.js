const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-key.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function verify() {
  try {
    // Check for ADMIN477
    const snapshot = await db.collection('admins').where('adminCode', '==', 'ADMIN477').limit(1).get();
    
    if (snapshot.empty) {
      console.log('❌ ADMIN477 NOT FOUND');
    } else {
      console.log('✅ ADMIN477 FOUND!');
      snapshot.forEach(doc => {
        console.log('\nDetails:');
        console.log(`  Code: ${doc.data().adminCode}`);
        console.log(`  Email: ${doc.data().email}`);
        console.log(`  Name: ${doc.data().fullName}`);
      });
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

verify().then(() => process.exit(0));
