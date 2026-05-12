const mongoose = require('mongoose');
require('dotenv').config({ path: '.env.local' });

const PROJECT_ID = process.argv[2];
if (!PROJECT_ID) { console.error('usage: node clear-supermove-sync.js <projectId>'); process.exit(1); }

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const _id = new mongoose.Types.ObjectId(PROJECT_ID);

  const before = await db.collection('projects').findOne({ _id }, { projection: { name: 1, customerEmail: 1, 'metadata.supermoveSync': 1 } });
  console.log('BEFORE:', JSON.stringify(before, null, 2));

  const result = await db.collection('projects').updateOne(
    { _id },
    { $unset: { 'metadata.supermoveSync': '' } }
  );
  console.log('UPDATE RESULT:', result);

  const after = await db.collection('projects').findOne({ _id }, { projection: { name: 1, customerEmail: 1, 'metadata.supermoveSync': 1 } });
  console.log('AFTER:', JSON.stringify(after, null, 2));

  await mongoose.disconnect();
}
run().catch(err => { console.error(err); process.exit(1); });
