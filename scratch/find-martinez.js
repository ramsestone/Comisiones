require('dotenv').config();
const { MongoClient } = require('mongodb');

async function run() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/';
  const client = new MongoClient(uri);

  try {
    await client.connect();
    
    const db = client.db('roles_usuarios');
    const coll = db.collection('comisiones-ubicaciones');

    const comisiones = await coll.find().toArray();
    comisiones.forEach(c => {
      if (c.client_name && typeof c.client_name === 'string') {
        if (c.client_name.toLowerCase().includes('martinez') || c.client_name.toLowerCase().includes('alvarado') || c.client_name.toLowerCase().includes('martha')) {
          console.log(`Match found: _id: ${c._id}, client_name: ${c.client_name}`);
        }
      }
    });

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.close();
  }
}

run();
