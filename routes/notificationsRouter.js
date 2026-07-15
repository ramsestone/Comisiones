const express  = require('express');
const { ObjectId } = require('mongodb');
const router   = express.Router();
const { authenticate } = require('../JWT/authCookies');

const DB_NAME = 'roles_usuarios';
const COL     = 'notificaciones';

// GET /api/notificaciones — últimas 30 notificaciones del usuario autenticado
router.get('/', authenticate, async (req, res) => {
  const db = req.app.locals.mongoClient.db(DB_NAME);
  try {
    const notifs = await db
      .collection(COL)
      .find({ user_id: new ObjectId(req.user.id) })
      .sort({ created_at: -1 })
      .limit(30)
      .toArray();

    res.json({ success: true, data: notifs });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Error al obtener notificaciones', data: [] });
  }
});

// PATCH /api/notificaciones/read-all — marcar todas como leídas
router.patch('/read-all', authenticate, async (req, res) => {
  const db = req.app.locals.mongoClient.db(DB_NAME);
  try {
    await db.collection(COL).updateMany(
      { user_id: new ObjectId(req.user.id), read: false },
      { $set: { read: true } }
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

// PATCH /api/notificaciones/:id/read — marcar una notificación como leída
router.patch('/:id/read', authenticate, async (req, res) => {
  const db = req.app.locals.mongoClient.db(DB_NAME);
  try {
    await db.collection(COL).updateOne(
      { _id: new ObjectId(req.params.id), user_id: new ObjectId(req.user.id) },
      { $set: { read: true } }
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

module.exports = router;
