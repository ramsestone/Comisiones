// MongoDB Playground - Copia de Seguridad de Base de Datos
// Instrucciones: Abre este archivo en VS Code con la extensión de MongoDB y presiona "Play" ▶ o Alt+Cmd+R / Ctrl+Alt+R.

// 1. Base de datos origen y prefijo de respaldo
const sourceDbName = "roles_usuarios";
const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

use(sourceDbName);

console.log(`====================================================`);
console.log(`🚀 INICIANDO COPIA DE SEGURIDAD PARA DE DB: [${sourceDbName}]`);
console.log(`📅 Timestamp: ${timestamp}`);
console.log(`====================================================`);

// 2. Obtener todas las colecciones de la base de datos origen
const collections = db.getCollectionNames().filter(col => !col.startsWith("system."));

console.log(`📂 Colecciones encontradas (${collections.length}):`, collections);

let totalDocsOriginales = 0;
let totalDocsRespaldados = 0;

collections.forEach(colName => {
  const count = db.getCollection(colName).countDocuments();
  totalDocsOriginales += count;

  // Nombre de la colección de respaldo dentro de la misma DB o clona a una colección _backup
  const backupColName = `${colName}_backup_${timestamp}`;
  
  console.log(`\n⏳ Respaldando '${colName}' (${count} docs) -> '${backupColName}'...`);
  
  if (count > 0) {
    // Duplicar colección hacia la nueva colección de respaldo
    db.getCollection(colName).aggregate([
      { $match: {} },
      { $out: backupColName }
    ]);
    
    const backupCount = db.getCollection(backupColName).countDocuments();
    totalDocsRespaldados += backupCount;
    console.log(`  ✅ Respaldo de '${colName}' completado: ${backupCount} documentos guardados.`);
  } else {
    // Si está vacía, la creamos
    db.createCollection(backupColName);
    console.log(`  ℹ️ Colección '${colName}' estaba vacía. Creada colección de respaldo vacía.`);
  }
});

console.log(`\n====================================================`);
console.log(`🎉 RESUMEN DE LA COPIA DE SEGURIDAD`);
console.log(`====================================================`);
console.log(`✔️ Total Colecciones procesadas : ${collections.length}`);
console.log(`✔️ Total Documentos respaldados: ${totalDocsRespaldados} / ${totalDocsOriginales}`);
console.log(`🏷️ Sufijo de tablas creadas     : _backup_${timestamp}`);
console.log(`====================================================`);
