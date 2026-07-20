const { MongoClient } = require('mongodb');

async function run() {
  const uri = 'mongodb+srv://ti_db_user:oamLIe9PYrzrqhL7@commission-management.e8ueb0g.mongodb.net/?appName=Commission-Management';
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('Commission-Management');
    const roleDirector = await db.collection('roles').findOne({ name: 'Director' });
    console.log('Role Director:', roleDirector);
    if (roleDirector) {
      const users = await db.collection('usuarios').find({ role: roleDirector._id }).toArray();
      console.log('Directors count:', users.length);
      users.forEach(u => console.log(u.name));
    }
  } finally {
    await client.close();
  }
}
run();
