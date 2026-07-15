const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const router  = express.Router();
const {
  setAuthCookie,
  clearAuthCookie,
  authenticate
} = require('../JWT/authCookies');

const DB_NAME = 'roles_usuarios';

/**
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Usuario y contraseña son requeridos',
        data:    null,
        error:   null,
      });
    }

    const db   = req.app.locals.mongoClient.db(DB_NAME);
    const user = await db.collection('usuarios').findOne(
      { username, active: true },
      { projection: { password: 1, username: 1, name: 1, picture: 1, role: 1 } }
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Usuario o contraseña incorrectos',
        data:    null,
        error:   null,
      });
    }

    if (password !== user.password) {
      return res.status(401).json({
        success: false,
        message: 'Usuario o contraseña incorrectos',
        data:    null,
        error:   null,
      });
    }

    // Populate manual del rol
    if (user.role) {
      const role = await db.collection('roles').findOne(
        { _id: new ObjectId(user.role) },
        { projection: { name: 1, description: 1 } }
      );
      user.role = role || null;
    }

    const payload = setAuthCookie(res, user);

    return res.status(200).json({
      success: true,
      message: 'Login correcto',
      data:    { user: payload },
      error:   null,
    });

  } catch (error) {
    console.error('[POST /api/auth/login]', error);
    return res.status(500).json({
      success: false,
      message: 'Error en el servidor',
      data:    null,
      error:   error.message,
    });
  }
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  return res.redirect('/');
});

/**
 * GET /api/auth/me
 */
router.get('/me', authenticate, (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Usuario autenticado',
    data:    { user: req.user },
    error:   null,
  });
});

module.exports = router;