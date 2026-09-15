require('dotenv').config();
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

/**
 * Script de copia de seguridad (Backup & Restore JSON) para MongoDB
 * 
 * Uso:
 *   node backup_db.js          (Genera una copia en formato JSON en ./backups/)
 *   node backup_db.js restore  (Restaura la última copia disponible)
 */

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/';
const DB_NAME = 'roles_usuarios';
const BACKUPS_DIR = path.join(__dirname, 'backups');

async function createBackup() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    console.log('✅ Conectado a MongoDB');

    const db = client.db(DB_NAME);
    const collections = await db.listCollections().toArray();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const targetFolder = path.join(BACKUPS_DIR, `backup_${timestamp}`);

    if (!fs.existsSync(targetFolder)) {
      fs.mkdirSync(targetFolder, { recursive: true });
    }

    console.log(`\n📦 Generando copia de seguridad en: ${targetFolder}\n`);

    let totalDocs = 0;

    for (const col of collections) {
      const colName = col.name;
      if (colName.startsWith('system.')) continue;

      const docs = await db.collection(colName).find({}).toArray();
      const filePath = path.join(targetFolder, `${colName}.json`);

      fs.writeFileSync(filePath, JSON.stringify(docs, null, 2), 'utf-8');
      console.log(`  📄 ${colName}.json -> ${docs.length} documentos respaldados`);
      totalDocs += docs.length;
    }

    console.log(`\n🎉 Copia de seguridad finalizada exitosamente.`);
    console.log(`📊 Total colecciones: ${collections.length}`);
    console.log(`📊 Total documentos: ${totalDocs}`);
    console.log(`📁 Carpeta: ${targetFolder}\n`);
  } catch (err) {
    console.error('❌ Error al crear la copia de seguridad:', err);
  } finally {
    await client.close();
  }
}

async function restoreBackup(backupFolderName) {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);

    let folderPath = '';
    if (backupFolderName) {
      folderPath = path.join(BACKUPS_DIR, backupFolderName);
    } else {
      // Buscar la carpeta más reciente
      if (!fs.existsSync(BACKUPS_DIR)) {
        console.error('❌ No se encontró la carpeta de respaldos ./backups');
        return;
      }
      const folders = fs.readdirSync(BACKUPS_DIR).filter(f => f.startsWith('backup_')).sort().reverse();
      if (folders.length === 0) {
        console.error('❌ No se encontraron respaldos previos');
        return;
      }
      folderPath = path.join(BACKUPS_DIR, folders[0]);
    }

    console.log(`\n🔄 Restaurando desde: ${folderPath}\n`);

    const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.json'));

    for (const file of files) {
      const colName = path.basename(file, '.json');
      const filePath = path.join(folderPath, file);
      const docs = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      if (docs.length > 0) {
        await db.collection(colName).deleteMany({});
        await db.collection(colName).insertMany(docs);
        console.log(`  ✅ ${colName} -> ${docs.length} documentos restaurados`);
      } else {
        console.log(`  ℹ️ ${colName} -> vacía`);
      }
    }

    console.log(`\n🎉 Restauración completada exitosamente.\n`);
  } catch (err) {
    console.error('❌ Error al restaurar la copia de seguridad:', err);
  } finally {
    await client.close();
  }
}

const action = process.argv[2];
if (action === 'restore') {
  const specificFolder = process.argv[3];
  restoreBackup(specificFolder);
} else {
  createBackup();
}
