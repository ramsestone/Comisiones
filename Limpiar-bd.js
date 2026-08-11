// MongoDB Playground
// Usar la base de datos de comisiones
use("roles_usuarios");

// 1. Mostrar estado actual antes de limpiar
console.log("=== Estado antes de la limpieza ===");
console.log("Comisiones (ubicaciones): " + db["comisiones-ubicaciones"].countDocuments());
console.log("Comisiones (participantes): " + db["comisiones-participantes"].countDocuments());
console.log("Deudas/Préstamos: " + db.debts.countDocuments());
console.log("Transacciones de Cartera: " + db.walletTransactions.countDocuments());
console.log("Notificaciones: " + db.notificaciones.countDocuments());

// 2. Limpieza de colecciones transaccionales
db["comisiones-ubicaciones"].deleteMany({});
db["comisiones-participantes"].deleteMany({});
db.debts.deleteMany({});
db.walletTransactions.deleteMany({});
db.notificaciones.deleteMany({});

// 3. Mostrar estado actual después de limpiar
console.log("=== Estado después de la limpieza ===");
console.log("Comisiones (ubicaciones): " + db["comisiones-ubicaciones"].countDocuments());
console.log("Comisiones (participantes): " + db["comisiones-participantes"].countDocuments());
console.log("Deudas/Préstamos: " + db.debts.countDocuments());
console.log("Transacciones de Cartera: " + db.walletTransactions.countDocuments());
console.log("Notificaciones: " + db.notificaciones.countDocuments());

console.log("=====================================");
console.log("Colecciones de configuración conservadas intactas:");
console.log("- Usuarios: " + db.usuarios.countDocuments());
console.log("- Roles: " + db.roles.countDocuments());
console.log("- Estatus: " + db.estatus.countDocuments());
console.log("- Porcentajes: " + db.percentages.countDocuments());
