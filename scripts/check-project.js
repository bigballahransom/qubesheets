const mongoose = require('mongoose');
require('dotenv').config({ path: '.env.local' });

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  
  const project = await db.collection('projects').findOne({ _id: new mongoose.Types.ObjectId('69fe2c4ec4d055d9a67c619e') });
  console.log('PROJECT:', JSON.stringify(project, null, 2));
  
  if (project?.organizationId) {
    const org = await db.collection('organizationsettings').findOne({ organizationId: project.organizationId });
    console.log('ORG SETTINGS:', JSON.stringify(org, null, 2));
    
    const sm = await db.collection('supermoveintegrations').findOne({ organizationId: project.organizationId });
    console.log('SUPERMOVE INTEGRATION:', JSON.stringify({ ...sm, webhookUrl: sm?.webhookUrl?.substring(0, 50) + '...' }, null, 2));
  }
  
  const itemCount = await db.collection('inventoryitems').countDocuments({ projectId: '69fe2c4ec4d055d9a67c619e' });
  console.log('Item count (string projectId):', itemCount);
  const itemCount2 = await db.collection('inventoryitems').countDocuments({ projectId: new mongoose.Types.ObjectId('69fe2c4ec4d055d9a67c619e') });
  console.log('Item count (ObjectId projectId):', itemCount2);
  
  await mongoose.disconnect();
}
run().catch(err => { console.error(err); process.exit(1); });
