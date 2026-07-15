const express = require('express');
const router  = express.Router();
const { authenticate } = require('../JWT/authCookies');

const DB_NAME = 'roles_usuarios';

// Helper: obtiene el bloque v1 del documento de porcentajes
const getLatestRates = async (db) => {
  const doc = await db.collection('percentages').findOne({});
  if (!doc) return null;
  return doc.v1; // { traditional, shared, multipoint }
};

// ── GET /api/percentages ──────────────────────────────────────────────────────
// Retorna todos los porcentajes
router.get('/', authenticate, async (req, res) => {
  const db = req.app.locals.mongoClient.db(DB_NAME);

  try {
    const rates = await getLatestRates(db);
    if (!rates) {
      return res.status(404).json({
        success: false,
        data:    null,
        message: 'No hay porcentajes registrados',
        error:   null,
      });
    }

    return res.status(200).json({
      success: true,
      data:    rates,
      message: 'Porcentajes obtenidos correctamente',
      error:   null,
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      data:    null,
      message: 'Error al obtener los porcentajes',
      error:   err.message,
    });
  }
});

// ── GET /api/percentages/:type ────────────────────────────────────────────────
// Ej: /api/percentages/traditional  →  { manager1, advisor1 }
//     /api/percentages/shared       →  { manager1, manager2, advisor1, advisor2 }
router.get('/:type', authenticate, async (req, res) => {
  const db   = req.app.locals.mongoClient.db(DB_NAME);
  const { type } = req.params;

  try {
    const rates = await getLatestRates(db);

    if (!rates) {
      return res.status(404).json({
        success: false,
        data:    null,
        message: 'No hay porcentajes registrados',
        error:   null,
      });
    }

    if (!rates[type]) {
      return res.status(404).json({
        success: false,
        data:    null,
        message: `Tipo '${type}' no encontrado. Tipos válidos: traditional, shared, multipoint`,
        error:   null,
      });
    }

    return res.status(200).json({
      success: true,
      data:    { type, rates: rates[type] },
      message: `Porcentajes de tipo '${type}' obtenidos correctamente`,
      error:   null,
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      data:    null,
      message: 'Error al obtener los porcentajes',
      error:   err.message,
    });
  }
});

// ── GET /api/percentages/:type/:role ─────────────────────────────────────────
// Ej: /api/percentages/traditional/advisor1  →  0.006
//     /api/percentages/shared/manager2       →  0.0015
router.get('/:type/:role', authenticate, async (req, res) => {
  const db   = req.app.locals.mongoClient.db(DB_NAME);
  const { type, role } = req.params;

  try {
    const rates = await getLatestRates(db);

    if (!rates) {
      return res.status(404).json({
        success: false,
        data:    null,
        message: 'No hay porcentajes registrados',
        error:   null,
      });
    }

    if (!rates[type]) {
      return res.status(404).json({
        success: false,
        data:    null,
        message: `Tipo '${type}' no encontrado. Tipos válidos: traditional, shared, multipoint`,
        error:   null,
      });
    }

    if (rates[type][role] === undefined) {
      return res.status(404).json({
        success: false,
        data:    null,
        message: `Rol '${role}' no encontrado en tipo '${type}'`,
        error:   null,
      });
    }

    return res.status(200).json({
      success: true,
      data:    { type, role, rate: rates[type][role] },
      message: `Porcentaje obtenido correctamente`,
      error:   null,
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      data:    null,
      message: 'Error al obtener el porcentaje',
      error:   err.message,
    });
  }
});

module.exports = router;