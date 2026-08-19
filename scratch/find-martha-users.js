require('dotenv').config();
const { MongoClient } = require('mongodb');

async function run() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/';
  const client = new MongoClient(uri);

  try {
    await client.connect();
    
    const db = client.db('roles_usuarios');
    const usersColl = db.collection('usuarios');

    const users = await usersColl.find({
      name: { $regex: /martha/i }
    }).toArray();

    console.log(`Found ${users.length} users with 'martha' in name`);
    users.forEach(u => {
      console.log(`_id: ${u._id}, name: ${u.name}`);
    });

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.close();
  }
}

run();
