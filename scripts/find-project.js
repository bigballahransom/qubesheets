const mongoose = require('mongoose');
require('dotenv').config({ path: '.env.local' });

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const projects = await db.collection('projects').find({
    customerName: { $regex: 'Bouchard', $options: 'i' }
  }, { projection: { name: 1, customerName: 1, customerEmail: 1, organizationId: 1, 'metadata.supermoveSync': 1, createdAt: 1 } }).toArray();

  console.log('MATCHES:', JSON.stringify(projects, null, 2));

  for (const p of projects) {
    if (p.organizationId) {
      const sm = await db.collection('supermoveintegrations').findOne({ organizationId: p.organizationId }, { projection: { organizationId: 1, enabled: 1 } });
      console.log(`Project ${p._id} org ${p.organizationId} integration:`, sm);
    }
  }

  await mongoose.disconnect();
}
run().catch(err => { console.error(err); process.exit(1); });
