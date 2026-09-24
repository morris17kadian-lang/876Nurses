const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-key.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();
const auth = admin.auth();

async function deleteOtherAdmins() {
  try {
    console.log('\n🗑️  Deleting test/temporary admins...\n');
    
    // Get all admins
    const adminSnapshot = await db.collection('admins').get();
    const adminsToKeep = ['ADMIN001', 'ADMIN005'];
    
    console.log('📊 Current admins in database:\n');
    let deletedCount = 0;
    
    for (const adminDoc of adminSnapshot.docs) {
      const data = adminDoc.data();
      const code = data.adminCode;
      const name = data.fullName;
      const email = data.email;
      
      console.log(`   ${code}: ${name} (${email})`);
      
      if (!adminsToKeep.includes(code)) {
        console.log(`   ❌ Deleting ${code}...`);
        
        // Delete from Firestore
        await db.collection('admins').doc(adminDoc.id).delete();
        
        // Delete from Firebase Auth
        try {
          await auth.deleteUser(adminDoc.id);
          console.log(`      ✅ Deleted Auth user\n`);
        } catch (authError) {
          console.log(`      ⚠️  Auth delete failed: ${authError.message}\n`);
        }
        
        deletedCount++;
      } else {
        console.log(`   ✅ KEEPING ${code}\n`);
      }
    }
    
    console.log(`\n🎉 Done! Deleted ${deletedCount} admin(s)`);
    console.log(`📌 Remaining admins: ADMIN001, ADMIN005\n`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

deleteOtherAdmins().then(() => process.exit(0));
