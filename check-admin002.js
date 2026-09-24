const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-key.json');

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function checkAdmin() {
  try {
    console.log('🔍 Searching for ADMIN002...\n');
    
    // Search by adminCode
    const snapshot = await db.collection('admins')
      .where('adminCode', '==', 'ADMIN002')
      .get();
    
    if (!snapshot.empty) {
      console.log('✅ ADMIN002 FOUND!\n');
      snapshot.forEach(doc => {
        console.log('📋 Admin Details:');
        console.log(JSON.stringify(doc.data(), null, 2));
      });
    } else {
      console.log('❌ ADMIN002 NOT FOUND in Firebase\n');
      
      // List all admins to see what exists
      console.log('📊 All Admins Currently in Database:\n');
      const allAdmins = await db.collection('admins').get();
      
      if (allAdmins.empty) {
        console.log('No admins found in database');
      } else {
        allAdmins.forEach(doc => {
          const data = doc.data();
          console.log(`- ${data.adminCode || 'UNKNOWN'}: ${data.fullName || 'No name'} (${data.email || 'No email'})`);
        });
      }
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkAdmin().then(() => process.exit(0));
