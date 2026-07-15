const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const router = express.Router();
const {
    setAuthCookie,
    clearAuthCookie,
    authenticate
} = require('../JWT/authCookies');

const DB_NAME = 'roles_usuarios';

const path = require('path');
const fs = require('fs');
const multer = require('multer');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../public/uploads/avatars');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

function toTitleCase(str) {
    if (!str || typeof str !== 'string') return str;
    return str.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/**
 * POST /api/users
 */
router.post('/', authenticate, upload.single('picture'), async (req, res) => {
    if (req.user.roleName !== 'Administrador') {
        return res.status(403).json({ success: false, message: 'No tienes permiso para realizar esta acción' });
    }

    try {
        const db = req.app.locals.mongoClient.db(DB_NAME);

        let {
            name,
            email,
            phone,
            blood_type,
            birth_date,
            emergency_contact_name,
            emergency_contact_phone,
            role,
            username,
            password,
            permissions,
            manager_ids,
        } = req.body;

        name = toTitleCase(name);
        emergency_contact_name = toTitleCase(emergency_contact_name);

        const picture = req.file ? `/uploads/avatars/${req.file.filename}` : null;

        // ── Validaciones requeridas ──────────────────────────────────────────
        const requiredFields = { name, email, phone, role, username, password };
        const missing = Object.entries(requiredFields)
            .filter(([_, v]) => !v)
            .map(([k]) => k);

        if (missing.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Faltan campos requeridos: ${missing.join(', ')}`,
                data: null,
                error: null,
            });
        }

        // ── Validar que el role exista ───────────────────────────────────────
        const roleDoc = await db.collection('roles').findOne({ _id: new ObjectId(role) });
        if (!roleDoc) {
            return res.status(400).json({
                success: false,
                message: 'El rol especificado no existe',
                data: null,
                error: null,
            });
        }

        // ── Validar username único ───────────────────────────────────────────
        const existingUser = await db.collection('usuarios').findOne({ username });
        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: `El username '${username}' ya está en uso`,
                data: null,
                error: null,
            });
        }

        // ── Validar email único ──────────────────────────────────────────────
        const existingEmail = await db.collection('usuarios').findOne({ email });
        if (existingEmail) {
            return res.status(409).json({
                success: false,
                message: `El email '${email}' ya está en uso`,
                data: null,
                error: null,
            });
        }

        // ── Construir permissions ────────────────────────────────────────────
        // Si vienen custom_add o custom_remove, convertir a ObjectId
        const buildPermissions = {
            from_role: [],
            custom_add: (permissions?.custom_add ?? []).map(id => new ObjectId(id)),
            custom_remove: (permissions?.custom_remove ?? []).map(id => new ObjectId(id)),
        };

        // ── Construir documento ──────────────────────────────────────────────
        const newUser = {
            name,
            email,
            phone,
            blood_type,
            birth_date: birth_date ? new Date(birth_date) : null,
            emergency_contact_name: emergency_contact_name ?? null,
            emergency_contact_phone: emergency_contact_phone ?? null,
            picture: picture ?? null,
            role: new ObjectId(role),
            username,
            password,
            permissions: buildPermissions,
            active: true,
            created_at: new Date(),
        };

        if (manager_ids && manager_ids.length > 0) {
            let ids = Array.isArray(manager_ids) ? manager_ids : [manager_ids];
            newUser.manager_ids = ids.map(id => new ObjectId(id));
        } else {
            newUser.manager_ids = [];
        }

        const result = await db.collection('usuarios').insertOne(newUser);

        return res.status(201).json({
            success: true,
            message: 'Usuario creado correctamente',
            data: { _id: result.insertedId, username, name },
            error: null,
        });

    } catch (error) {
        console.error('[POST /api/usuarios]', error);
        return res.status(500).json({
            success: false,
            message: 'Error en el servidor',
            data: null,
            error: error.message,
        });
    }
});

// GET /api/users
router.get('/', authenticate, async (req, res) => {
  const db = req.app.locals.mongoClient.db(DB_NAME);

  try {
    const usuarios = await db.collection('usuarios')
      .aggregate([
        // ── Join con roles ──────────────────────────────────────────────────
        {
          $lookup: {
            from:         'roles',
            localField:   'role',
            foreignField: '_id',
            as:           'role',
          },
        },
        { $unwind: { path: '$role', preserveNullAndEmptyArrays: true } },

        // ── Proyección (sin password) ───────────────────────────────────────
        {
          $project: {
            password: 0,
          },
        },

        { $sort: { created_at: -1 } },
      ])
      .toArray();

    return res.status(200).json({
      success: true,
      data:    usuarios,
      message: `${usuarios.length} usuario(s) encontrado(s)`,
      error:   null,
    });

  } catch (error) {
    console.error('[GET /api/users]', error);
    return res.status(500).json({
      success: false,
      data:    null,
      message: 'Error al obtener los usuarios',
      error:   error.message,
    });
  }
});

/**
 * GET /api/roles
 */
router.get('/roles', authenticate, async (req, res) => {
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

/**
 * GET /api/users/by-role/:role
 */
// router.get('/by-role/:role', authenticate, async (req, res) => {
//     try {
//         const db = req.app.locals.mongoClient.db(DB_NAME);
//         const { role } = req.params;

//         // ── Validar que el role sea un ObjectId válido ────────────────────────
//         if (!ObjectId.isValid(role)) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'El parámetro role no es un ObjectId válido',
//                 data: null,
//                 error: null,
//             });
//         }

//         // ── Validar que el rol exista ─────────────────────────────────────────
//         const roleDoc = await db.collection('roles').findOne({ _id: new ObjectId(role) });
//         if (!roleDoc) {
//             return res.status(404).json({
//                 success: false,
//                 message: 'El rol especificado no existe',
//                 data: null,
//                 error: null,
//             });
//         }

//         // ── Traer usuarios con populate del rol ──────────────────────────────
//         const usuarios = await db.collection('usuarios').aggregate([
//             {
//                 $match: {
//                     role: new ObjectId(role),
//                     active: true,
//                 },
//             },

//             // Populate del rol
//             {
//                 $lookup: {
//                     from: 'roles',
//                     localField: 'role',
//                     foreignField: '_id',
//                     as: 'role',
//                 },
//             },
//             { $unwind: { path: '$role', preserveNullAndEmptyArrays: true } },

//             // Excluir password
//             {
//                 $project: {
//                     password: 0,
//                 },
//             },

//             { $sort: { name: 1 } },

//         ]).toArray();

//         return res.status(200).json({
//             success: true,
//             message: `Se encontraron ${usuarios.length} usuarios con el rol '${roleDoc.name}'`,
//             data: { role: roleDoc, usuarios },
//             error: null,
//         });

//     } catch (error) {
//         console.error('[GET /api/usuarios/by-role/:role]', error);
//         return res.status(500).json({
//             success: false,
//             message: 'Error en el servidor',
//             data: null,
//             error: error.message,
//         });
//     }
// });

router.get('/by-role/:roleName', authenticate, async (req, res) => {
  const client = req.app.locals.mongoClient;
  const db     = client.db(DB_NAME);

  try {
    // ── 1. Buscar el rol por nombre (case-insensitive) ────────────────────────
    const role = await db.collection('roles').findOne({
      name: { $regex: new RegExp(`^${req.params.roleName}$`, 'i') }
    });

    if (!role) {
      return res.status(404).json({
        success: false,
        data:    null,
        message: `Rol "${req.params.roleName}" no encontrado`,
        error:   null,
      });
    }

    // ── 2. Buscar usuarios con ese rol ────────────────────────────────────────
    const users = await db.collection('usuarios')
      .find({ role: role._id, active: true })
      .project({ _id: 1, name: 1, username: 1, picture: 1, manager_ids: 1 })
      .toArray();

    return res.status(200).json({
      success: true,
      data:    users,
      message: `${users.length} usuario(s) con rol "${role.name}"`,
      error:   null,
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      data:    null,
      message: 'Error al obtener usuarios por rol',
      error:   err.message,
    });
  }
});
router.put('/:id', authenticate, upload.single('picture'), async (req, res) => {
    if (req.user.roleName !== 'Administrador') {
        return res.status(403).json({ success: false, message: 'No tienes permiso para realizar esta acción' });
    }
    const client = req.app.locals.mongoClient;
    const db = client.db(DB_NAME);
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'ID inválido' });

        const { email, role, password, active, phone, blood_type, birth_date, emergency_contact_phone, username, removePicture, manager_ids } = req.body;
        let { name, emergency_contact_name } = req.body;

        name = name !== undefined ? toTitleCase(name) : undefined;
        emergency_contact_name = emergency_contact_name !== undefined ? toTitleCase(emergency_contact_name) : undefined;

        const updateData = { updated_at: new Date() };

        if (name !== undefined) updateData.name = name;
        if (email !== undefined) updateData.email = email;
        if (phone !== undefined) updateData.phone = phone;
        if (blood_type !== undefined) updateData.blood_type = blood_type;
        if (birth_date !== undefined) updateData.birth_date = birth_date ? new Date(birth_date) : null;
        if (emergency_contact_name !== undefined) updateData.emergency_contact_name = emergency_contact_name;
        if (emergency_contact_phone !== undefined) updateData.emergency_contact_phone = emergency_contact_phone;
        if (username !== undefined) updateData.username = username;
        
        if (role) updateData.role = new ObjectId(role);
        if (password && password.trim() !== '') updateData.password = password;
        if (active !== undefined) updateData.active = (active === 'true' || active === true);
        
        if (manager_ids !== undefined) {
            if (!manager_ids || manager_ids === '') {
                updateData.manager_ids = [];
            } else {
                let ids = Array.isArray(manager_ids) ? manager_ids : [manager_ids];
                // Formdata might send empty strings if no checkboxes are checked, filter them out
                ids = ids.filter(id => id.trim() !== '');
                updateData.manager_ids = ids.map(id => new ObjectId(id));
            }
        }

        // Manage Picture
        const currentUser = await db.collection('usuarios').findOne({ _id: new ObjectId(id) });
        if (!currentUser) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

        const oldPicturePath = currentUser.picture ? path.join(__dirname, '../public', currentUser.picture) : null;

        if (req.file) {
            updateData.picture = `/uploads/avatars/${req.file.filename}`;
            if (oldPicturePath && fs.existsSync(oldPicturePath)) {
                fs.unlinkSync(oldPicturePath);
            }
        } else if (removePicture === 'true') {
            updateData.picture = null;
            if (oldPicturePath && fs.existsSync(oldPicturePath)) {
                fs.unlinkSync(oldPicturePath);
            }
        }

        const result = await db.collection('usuarios').updateOne({ _id: new ObjectId(id) }, { $set: updateData });

        let isSelf = false;
        let finalPicture = updateData.picture !== undefined ? updateData.picture : currentUser.picture;
        let finalName = updateData.name !== undefined ? updateData.name : currentUser.name;

        if (req.user.id === id) {
            isSelf = true;
            const updatedUser = await db.collection('usuarios').aggregate([
                { $match: { _id: new ObjectId(id) } },
                { $lookup: { from: 'roles', localField: 'role', foreignField: '_id', as: 'roleObj' } },
                { $unwind: { path: '$roleObj', preserveNullAndEmptyArrays: true } }
            ]).toArray();
            
            if (updatedUser.length > 0) {
                const userForCookie = updatedUser[0];
                userForCookie.role = userForCookie.roleObj;
                setAuthCookie(res, userForCookie);
            }
        }

        return res.json({ success: true, message: 'Usuario actualizado correctamente', data: { isSelf, picture: finalPicture, name: finalName } });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Error al actualizar usuario', error: err.message });
    }
});

router.delete('/:id/picture', authenticate, async (req, res) => {
    if (req.user.roleName !== 'Administrador') {
        return res.status(403).json({ success: false, message: 'No tienes permiso para realizar esta acción' });
    }
    const client = req.app.locals.mongoClient;
    const db = client.db(DB_NAME);
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'ID inválido' });

        const currentUser = await db.collection('usuarios').findOne({ _id: new ObjectId(id) });
        if (!currentUser) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

        if (currentUser.picture) {
            const oldPicturePath = path.join(__dirname, '../public', currentUser.picture);
            if (fs.existsSync(oldPicturePath)) {
                fs.unlinkSync(oldPicturePath);
            }
            await db.collection('usuarios').updateOne({ _id: new ObjectId(id) }, { $set: { picture: null, updated_at: new Date() } });
        }

        let isSelf = false;
        if (req.user.id === id) {
            isSelf = true;
            const updatedUser = await db.collection('usuarios').aggregate([
                { $match: { _id: new ObjectId(id) } },
                { $lookup: { from: 'roles', localField: 'role', foreignField: '_id', as: 'roleObj' } },
                { $unwind: { path: '$roleObj', preserveNullAndEmptyArrays: true } }
            ]).toArray();
            
            if (updatedUser.length > 0) {
                const userForCookie = updatedUser[0];
                userForCookie.role = userForCookie.roleObj;
                setAuthCookie(res, userForCookie);
            }
        }

        return res.json({ success: true, message: 'Foto eliminada correctamente', data: { isSelf, picture: null, name: currentUser.name } });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Error al eliminar foto', error: err.message });
    }
});

router.delete('/:id', authenticate, async (req, res) => {
    if (req.user.roleName !== 'Administrador') {
        return res.status(403).json({ success: false, message: 'No tienes permiso para realizar esta acción' });
    }
    const client = req.app.locals.mongoClient;
    const db = client.db(DB_NAME);
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'ID inválido' });

        // Eliminación lógica
        const result = await db.collection('usuarios').updateOne({ _id: new ObjectId(id) }, { $set: { active: false, updated_at: new Date() } });
        if (result.matchedCount === 0) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

        return res.json({ success: true, message: 'Usuario desactivado correctamente' });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Error al eliminar usuario', error: err.message });
    }
});

module.exports = router;