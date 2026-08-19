require('dotenv').config();
const { MongoClient } = require('mongodb');

async function run() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/';
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db('roles_usuarios');
    const collections = await db.listCollections().toArray();

    for (let c of collections) {
      const coll = db.collection(c.name);
      
      // We don't know the exact field, so we use $text or just search all fields in documents
      // Since it's a small DB for development, we can just fetch some docs and JSON.stringify
      const docs = await coll.find().toArray();
      const matches = docs.filter(doc => JSON.stringify(doc).toLowerCase().includes('martha laura'));
      
      if (matches.length > 0) {
        console.log(`Found ${matches.length} matches in collection: ${c.name}`);
        matches.forEach(m => {
          console.log(`_id: ${m._id}`);
          if (m.client_name) console.log('client_name:', m.client_name);
          if (m.name) console.log('name:', m.name);
          if (m.location) console.log('location:', m.location);
        });
      }
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.close();
  }
}

run();
