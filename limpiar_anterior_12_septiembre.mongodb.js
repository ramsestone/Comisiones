// MongoDB Playground - Limpieza de registros anteriores al 12 de septiembre de 2026
// Instrucciones: Abre este archivo en VS Code con la extensión de MongoDB y presiona "Play" ▶ o Alt+Cmd+R / Ctrl+Alt+R.

use("roles_usuarios");

// 1. Configuración de Fecha Límite: 12 de Septiembre de 2026 00:00:00 UTC
const cutoffDate = new Date("2026-09-12T00:00:00.000Z");
const cutoffISO = cutoffDate.toISOString();

// Generar ObjectId compatible con todas las versiones del Playground de VS Code
const timestampSeconds = Math.floor(cutoffDate.getTime() / 1000);
const cutoffObjectId = ObjectId(timestampSeconds.toString(16).padStart(8, "0") + "0000000000000000");

console.log("==========================================================");
console.log("🧹 INICIANDO ELIMINACIÓN DE REGISTROS ANTERIORES AL 12 DE SEPTIEMBRE DE 2026");
console.log("📅 Fecha límite:", cutoffDate.toLocaleString());
console.log("==========================================================");

// Filtro universal para detectar fechas anteriores al 12-Sep-2026 (objeto Date, ISO string, o ObjectId)
function createCutoffFilter(customDateField) {
  const conditions = [
    { _id: { $lt: cutoffObjectId } },
    { created_at: { $lt: cutoffDate } },
    { created_at: { $lt: cutoffISO } }
  ];
  
  if (customDateField) {
    const fieldObj1 = {}; fieldObj1[customDateField] = { $lt: cutoffDate };
    const fieldObj2 = {}; fieldObj2[customDateField] = { $lt: cutoffISO };
    conditions.push(fieldObj1, fieldObj2);
  }

  return { $or: conditions };
}

// Colecciones transaccionales a limpiar
const targetCollections = [
  { name: "comisiones-ubicaciones", dateField: "register_date" },
  { name: "comisiones-participantes", dateField: "created_at" },
  { name: "debts", dateField: "created_at" },
  { name: "walletTransactions", dateField: "reference_date" },
  { name: "notificaciones", dateField: "fecha" }
];

let totalBorrados = 0;

targetCollections.forEach(target => {
  const colName = target.name;
  const col = db.getCollection(colName);
  
  if (!col) {
    console.log(`⚠️ Colección '${colName}' no existe.`);
    return;
  }

  const filter = createCutoffFilter(target.dateField);
  const countBefore = col.countDocuments();
  const countToDelete = col.countDocuments(filter);

  console.log(`\n🔍 Colección: [${colName}]`);
  console.log(`   - Total documentos actuales: ${countBefore}`);
  console.log(`   - Documentos anteriores al 12-Sep: ${countToDelete}`);

  if (countToDelete > 0) {
    const result = col.deleteMany(filter);
    const countAfter = col.countDocuments();
    totalBorrados += result.deletedCount;
    console.log(`   ✅ Eliminados: ${result.deletedCount} | Restantes: ${countAfter}`);
  } else {
    console.log(`   ℹ️ No se encontraron registros anteriores al 12 de septiembre.`);
  }
});

console.log("\n==========================================================");
console.log("🎉 RESUMEN DE LIMPIEZA");
console.log("==========================================================");
console.log(`🗑️ Total general de registros eliminados: ${totalBorrados}`);
console.log("==========================================================");
console.log("ℹ️ Colecciones de catálogo conservadas intactas:");
console.log("   - usuarios: " + (db.usuarios ? db.usuarios.countDocuments() : 0));
console.log("   - roles: " + (db.roles ? db.roles.countDocuments() : 0));
console.log("   - estatus: " + (db.estatus ? db.estatus.countDocuments() : 0));
console.log("   - percentages: " + (db.percentages ? db.percentages.countDocuments() : 0));
console.log("==========================================================");
