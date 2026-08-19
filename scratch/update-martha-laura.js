require('dotenv').config();
const { MongoClient } = require('mongodb');

async function run() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/';
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db('roles_usuarios');
    const comisionesColl = db.collection('comisiones-ubicaciones');
    const participantesColl = db.collection('comisiones-participantes');

    // Find the commission by client_name
    const comision = await comisionesColl.findOne({
      client_name: { $regex: /MARTHA LAURA MARTINEZ ALVARADO/i }
    });

    if (!comision) {
      console.log('Comisión no encontrada para MARTHA LAURA MARTINEZ ALVARADO');
      return;
    }

    console.log('Comisión encontrada:', comision._id, comision.client_name);

    // Find the director participant
    const director = await participantesColl.findOne({
      comision_id: comision._id,
      role_in_comision: 'director'
    });

    if (!director) {
      console.log('No se encontró al director para esta comisión.');
      return;
    }

    console.log('Director actual:', director.user, 'Monto actual:', director.commission_amount);

    const oldAmount = director.commission_amount;

    // Update the director's commission to 0
    await participantesColl.updateOne(
      { _id: director._id },
      {
        $set: {
          percentage: 0,
          commission_amount: 0
        }
      }
    );

    console.log('Actualizado el porcentaje y monto del director a 0.');

    // Update the total commission in comisiones-ubicaciones
    const newTotal = (comision.total_commission || 0) - oldAmount;
    await comisionesColl.updateOne(
      { _id: comision._id },
      {
        $set: {
          total_commission: newTotal
        }
      }
    );

    console.log('Total de comisión actualizado a:', newTotal);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.close();
  }
}

run();
