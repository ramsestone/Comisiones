require('dotenv').config();
const path = require('path');
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const ejsLayouts = require('express-ejs-layouts');
const { injectUserLocals } = require('./JWT/authCookies');

const app = express();

// ── Middlewares globales ──────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Vistas EJS ────────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, './views'));
// app.use(ejsLayouts);
// app.set('layout', 'partials/layout');
app.use(express.static(path.join(__dirname, 'public')));

// ── Inyección global de sesión en vistas ─────────────────────────────────────
app.use(injectUserLocals);

// ── Base de datos ─────────────────────────────────────────────────────────────
async function connectDatabase() {
  try {
    const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/nova_db';
    const mongoClient = new MongoClient(uri, { retryWrites: false });
    await mongoClient.connect();
    console.log('✅ MongoDB conectado');
    app.locals.mongoClient = mongoClient;
  } catch (err) {
    console.error('❌ Error al conectar a MongoDB:', err);
    process.exit(1);
  }
}

// ── Rutas ─────────────────────────────────────────────────────────────────────
app.use('/', require('./routes/views'));
app.use('/api/auth', require('./routes/authRouter'));
app.use('/api/comisiones', require('./routes/comisionesRouter'));
// app.use('/api/roles',          require('./routes/rolesRoutes'));
// app.use('/api/comisiones',     require('./routes/comisiones'));
// app.use('/api/notifications',  require('./routes/notifications'));
app.use('/api/percentages', require('./routes/percentagesRouter'));
app.use('/api/notificaciones', require('./routes/notificationsRouter'));
app.use('/v10', require('./routes/v10Router'));
app.use('/api/users', require('./routes/userRouter'));
app.use('/api/roles', require('./routes/rolesRouter'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/kpis', require('./routes/kpiRouter'));

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'server_errors', '404.html'));
});

// ── Manejador global de errores ───────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).sendFile(path.join(__dirname, 'server_errors', '500.html'));
});

// ── Cierre graceful ───────────────────────────────────────────────────────────
process.on('SIGINT', async () => {
  if (app.locals.mongoClient) {
    await app.locals.mongoClient.close();
    console.log('🔌 Conexión cerrada');
  }
  process.exit(0);
});

// ── Iniciar ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

connectDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  });
});