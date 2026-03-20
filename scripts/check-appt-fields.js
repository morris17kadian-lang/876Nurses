const admin = require('firebase-admin');
const key = require('../firebase-service-key.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(key) });
const db = admin.firestore();

async function main() {
  const svcs = await db.collection('services').get();
  console.log('=== services ===', svcs.size);
  svcs.docs.forEach(d => {
    const data = d.data();
    if ((data.title || '').toLowerCase().includes('wound') || (data.title || '').toLowerCase().includes('care')) {
      console.log('\n---', d.id);
      console.log(JSON.stringify({ title: data.title, price: data.price, category: data.category }, null, 2));
    }
  });
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
