require('dotenv').config();
const { MongoClient } = require('mongodb');

async function run() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/';
  const client = new MongoClient(uri);

  try {
    await client.connect();
    
    const db = client.db('roles_usuarios');
    const comisionesColl = db.collection('comisiones-ubicaciones');

    // Find the commission by client_name
    const comisiones = await comisionesColl.find({
      client_name: { $regex: /martha/i }
    }).toArray();

    console.log(`Found ${comisiones.length} comisiones with 'martha' in client_name`);
    comisiones.forEach(c => {
      console.log(`_id: ${c._id}, client_name: ${c.client_name}`);
    });

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.close();
  }
}

run();
