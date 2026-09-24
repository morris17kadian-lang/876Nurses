const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-key.json');

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const auth = admin.auth();
const db = admin.firestore();

async function checkAdminAuth() {
  try {
    console.log('🔍 Checking for ADMIN002 Auth User...\n');
    
    // Try to get by email (you'll need to specify the email)
    // For now, let's list all users in auth
    const listResult = await auth.listUsers(100);
    
    console.log('📧 All Firebase Auth Users:\n');
    listResult.users.forEach(user => {
      console.log(`- ${user.email} (UID: ${user.uid})`);
      
      // Check if this user has admin data in Firestore
      console.log(`  → Checking Firestore...`);
    });
    
    // Now check Firestore for any unlinked profiles
    console.log('\n📋 All Firestore Admin Profiles:\n');
    const allAdmins = await db.collection('admins').get();
    
    if (allAdmins.empty) {
      console.log('No admin profiles in Firestore');
    } else {
      allAdmins.forEach(doc => {
        const data = doc.data();
        console.log(`- Doc ID: ${doc.id}`);
        console.log(`  Code: ${data.adminCode}\n  Name: ${data.fullName}\n  Email: ${data.email}`);
      });
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkAdminAuth().then(() => process.exit(0));
