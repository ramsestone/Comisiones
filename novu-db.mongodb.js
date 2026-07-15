  use("roles_usuarios");

  db.createCollection("roles");

  db.roles.insertMany([
    { name: "Asesor", description: "Puede consultar sus comisiones activas", created_at: new Date() },
    { name: "Gerente", description: "Puede registrar y ver comisiones activas", created_at: new Date() },
    { name: "Director", description: "Puede aprobar comisiones y ajustar los montos", created_at: new Date() },
    { name: "Administrador", description: "Recibe las comisiones a pagar e indica cuando ya fueron pagadas", created_at: new Date() }
  ]);

  const asesorId = db.roles.findOne({ name: "Asesor" })._id;
  const gerenteId = db.roles.findOne({ name: "Gerente" })._id;
  const directorId = db.roles.findOne({ name: "Director" })._id;
  const administradorId = db.roles.findOne({ name: "Administrador" })._id;

  db.createCollection("usuarios");

  db.usuarios.insertMany([
    {
      name: "Hendrick Martinez Perez", email: "hendrick@gmail.com", phone: "5589543342",
      blood_type: "O+", birth_date: new Date("1990-08-24"),
      emergency_contact_name: "Ramses Moral Rosado", emergency_contact_phone: "5557358978",
      picture: "./static/hendrick.jpg", role: asesorId,
      username: "HENDMART", password: "12345", active: true, created_at: new Date()
    },
    {
      name: "Roberto Sanchez Lopez", email: "roberto.sanchez@gmail.com", phone: "5534567890",
      blood_type: "O-", birth_date: new Date("1985-05-10"),
      emergency_contact_name: "Patricia Sanchez", emergency_contact_phone: "5534567891",
      picture: "./static/roberto.jpg", role: gerenteId,
      username: "ROBSAN", password: "gerente123", active: true, created_at: new Date()
    },
    {
      name: "Elena Montero Ruiz", email: "elena.montero@gmail.com", phone: "5545678901",
      blood_type: "AB+", birth_date: new Date("1980-12-01"),
      emergency_contact_name: "Javier Montero", emergency_contact_phone: "5545678902",
      picture: "./static/elena.jpg", role: directorId,
      username: "ELENMON", password: "director123", active: true, created_at: new Date()
    },
    {
      name: "Carmen Jimenez Diaz", email: "carmen.jimenez@gmail.com", phone: "5556789012",
      blood_type: "A-", birth_date: new Date("1983-07-19"),
      emergency_contact_name: "Luis Jimenez", emergency_contact_phone: "5556789013",
      picture: "./static/carmen.jpg", role: administradorId,
      username: "CARJIM", password: "admin123", active: true, created_at: new Date()
    }
  ]);



  db.createCollection("percentages");

  db.percentages.insertOne({
    v1: {
      traditional: {
        manager1: 0.0025,
        advisor1: 0.006
      },
      shared: {
        manager1: 0.0015,
        manager2: 0.0015,
        advisor1: 0.0042,
        advisor2: 0.0028
      },
      multipoint: {
        manager1: 0.0025,
        manager2: 0.0015,
        advisor1: 0.005,
        advisor2: 0.0028
      }
    }
  });


  db.createCollection("notificaciones");

  // Obtener IDs de los usuarios
  const hendrickId = db.usuarios.findOne({ username: "HENDMART" })._id;
  const robertoId = db.usuarios.findOne({ username: "ROBSAN" })._id;
  const elenaId = db.usuarios.findOne({ username: "ELENMON" })._id;
  const carmenId = db.usuarios.findOne({ username: "CARJIM" })._id;

  db.notificaciones.insertMany([
    {
      usuario_id: hendrickId,
      titulo: "Bienvenido al sistema",
      descripcion: "Tu cuenta ha sido creada exitosamente.",
      fecha: new Date()
    },
    {
      usuario_id: robertoId,
      titulo: "Comisión registrada",
      descripcion: "Se ha registrado una nueva comisión en el sistema.",
      fecha: new Date()
    },
    {
      usuario_id: elenaId,
      titulo: "Comisión pendiente de aprobación",
      descripcion: "Hay una comisión esperando tu aprobación.",
      fecha: new Date()
    },
    {
      usuario_id: carmenId,
      titulo: "Comisión lista para pago",
      descripcion: "Hay una comisión aprobada pendiente de pago.",
      fecha: new Date()
    }
  ]);

  db.createCollection("estatus");

  db.estatus.insertMany([
    { order: 1, name: "Pendiente Verificacion", description: "La comisión está esperando verificación de los participantes", created_at: new Date() },
    { order: 2, name: "Verificada",             description: "Todos los participantes han verificado la comisión", created_at: new Date() },
    { order: 3, name: "Pendiente Aprobacion",   description: "La comisión está esperando aprobación de la Director", created_at: new Date() },
    { order: 4, name: "Aprobada",               description: "La comisión ha sido aprobada por la Director", created_at: new Date() },
    { order: 5, name: "Pendiente Pago",         description: "La comisión está aprobada y esperando ser pagada", created_at: new Date() },
    { order: 6, name: "Pagada",                 description: "La comisión ha sido pagada por la Administrador", created_at: new Date() },
    { order: 7, name: "Correccion",             description: "Se necesita corregir información", created_at: new Date() }
  ]);

  console.log("✓ Estatus creados: " + db.estatus.countDocuments());



  // Obtener IDs de usuarios
  // const hendrickId = db.usuarios.findOne({ username: "HENDMART" })._id;
  // const robertoId = db.usuarios.findOne({ username: "ROBSAN" })._id;

  // Obtener IDs de estatus
  const statusPendienteVerificacion = db.estatus.findOne({ order: 1 })._id;
  const statusAprobada = db.estatus.findOne({ order: 4 })._id;
  const statusPendientePago = db.estatus.findOne({ order: 5 })._id;

  // Obtener porcentajes
  const p = db.percentages.findOne().v1;



  // use("roles_usuarios");

  // ─── comisiones-ubicaciones ───────────────────────────────────────────────────
  db.createCollection("comisiones-ubicaciones");

  db["comisiones-ubicaciones"].insertMany([
    {
      company:         { id: "1", text: "DESARROLLADORA TOKIO, S.A. DE C.V." },
      development:     { id: "1", text: "TOKIO 616" },
      location:        { id: "1", text: "TOKIO-PB-A001" },
      concept:         { id: "1", text: "Contratado" },
      commission_type: "Tradicional",
      sale_price:      2000000,
      total_commission: 2000000 * (p.traditional.advisor1 + p.traditional.manager1),
      client_name:     "Juan Pérez García",
      operation_date:  new Date("2026-04-02"),
      register_date:   new Date("2026-03-03"),
      status:          statusPendienteVerificacion,
      correction_comments: null,
      created_by:      robertoId,
      created_at:      new Date(),
      updated_at:      new Date()
    },
    // ... resto de comisiones
  ]);

  // ─── comisiones-participantes ─────────────────────────────────────────────────
  db.createCollection("comisiones-participantes");

  const com1Id = db["comisiones-ubicaciones"].findOne({ "location.id": "1" })._id;

  db["comisiones-participantes"].insertMany([
    // Participantes de la comisión 1 — Tradicional
    {
      comision_id:          com1Id,
      user:                 hendrickId,
      role_in_comision:     "asesor",          // "asesor" | "gerente"
      percentage:           p.traditional.advisor1,
      commission_amount:    2000000 * p.traditional.advisor1,
      adjusted_commission:  null,
      verification:         false,
      status:               statusPendienteVerificacion,
      correction_comments:  null,
      created_at:           new Date(),
      updated_at:           new Date()
    },
    {
      comision_id:          com1Id,
      user:                 robertoId,
      role_in_comision:     "gerente",
      percentage:           p.traditional.manager1,
      commission_amount:    2000000 * p.traditional.manager1,
      adjusted_commission:  null,
      verification:         false,
      status:               statusPendienteVerificacion,
      correction_comments:  null,
      created_at:           new Date(),
      updated_at:           new Date()
    }
  ]);





  console.log("✓ Roles creados: " + db.roles.countDocuments());
  console.log("✓ Usuarios creados: " + db.usuarios.countDocuments());
  console.log("✓ Percentages creados: " + db.percentages.countDocuments());
  console.log("✓ Notificaciones creadas: " + db.notificaciones.countDocuments());
  // console.log("✓ Comisiones creadas: " + db.comisiones.countDocuments());
