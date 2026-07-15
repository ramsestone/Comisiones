const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const router = express.Router();
const {
    setAuthCookie,
    clearAuthCookie,
    authenticate
} = require('../JWT/authCookies');

const DB_NAME = 'roles_usuarios';

/**
 * GET /api/roles
 */
router.get('/', authenticate, async (req, res) => {
    try {
        const db = req.app.locals.mongoClient.db(DB_NAME);

        const roles = await db.collection('roles').find({}).toArray();

        return res.status(200).json({
            success: true,
            message: `Se encontraron ${roles.length} roles`,
            data: { roles },
            error: null,
        });

    } catch (error) {
        console.error('[GET /api/roles]', error);
        return res.status(500).json({
            success: false,
            message: 'Error en el servidor',
            data: null,
            error: error.message,
        });
    }
});

module.exports = router;