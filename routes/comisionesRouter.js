const express = require('express');
const { MongoClient, ObjectId, Decimal128 } = require('mongodb');
const router  = express.Router();
const {
  setAuthCookie,
  clearAuthCookie,
  authenticate,
  authorize
} = require('../JWT/authCookies');


const DB_NAME = 'roles_usuarios';

const toDecimal = (value) => Decimal128.fromString(value.toString());

// ── Helpers de permisos ───────────────────────────────────────────────────────
function hideDirectorData(comisiones, roleName) {
  if (['Director', 'Administrador'].includes(roleName)) return;
  const arr = Array.isArray(comisiones) ? comisiones : [comisiones];
  arr.forEach(c => {
    if (c.participantes && Array.isArray(c.participantes)) {
      c.participantes = c.participantes.filter(p => p.role_in_comision !== 'director');
      c.total_commission = c.participantes.reduce((sum, p) => sum + parseFloat((p.adjusted_commission ?? p.commission_amount ?? 0).toString()), 0);
    }
  });
}

// ── Helpers de notificaciones ─────────────────────────────────────────────────
async function notify(db, userIds, message, now = new Date()) {
  const ids = (Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean);
  if (!ids.length) return;
  await db.collection('notificaciones').insertMany(
    ids.map(uid => ({ user_id: uid, message, read: false, created_at: now }))
  );
}

async function getUserIdsByRole(db, roleName) {
  const users = await db.collection('usuarios').aggregate([
    { $lookup: { from: 'roles', localField: 'role', foreignField: '_id', as: 'r' } },
    { $unwind: '$r' },
    { $match: { 'r.name': roleName, active: true } },
    { $project: { _id: 1 } },
  ]).toArray();
  return users.map(u => u._id);
}

// GET /api/comisiones/mis-comisiones
router.get('/mis-comisiones', authenticate, async (req, res) => {
  const client = req.app.locals.mongoClient;
  const db     = client.db(DB_NAME);

  try {
    const userId = new ObjectId(req.user.id); // ← viene del JWT decodificado

    // ── 1. IDs de comisiones donde el usuario es participante ────────────────
    const participaciones = await db
      .collection('comisiones-participantes')
      .find({ user: userId })
      .project({ comision_id: 1 })
      .toArray();

    const comisionIdsComoParticipante = participaciones.map(p => p.comision_id);

    const { from, to } = req.query;
    const matchStage = {
      $or: [
        { created_by: userId },
        { _id: { $in: comisionIdsComoParticipante } },
      ],
    };

    if (from && to) {
      matchStage.register_date = {
        $gte: new Date(from),
        $lte: new Date(to)
      };
    } else if (from) {
      matchStage.register_date = { $gte: new Date(from) };
    } else if (to) {
      matchStage.register_date = { $lte: new Date(to) };
    }

    // ── 2. Buscar comisiones donde es creador O participante ─────────────────
    const comisiones = await db
      .collection('comisiones-ubicaciones')
      .aggregate([
        {
          $match: matchStage,
        },

        // ── Join estatus de la comisión ──────────────────────────────────────
        {
          $lookup: {
            from:         'estatus',
            localField:   'status',
            foreignField: '_id',
            as:           'status',
          },
        },
        { $unwind: { path: '$status', preserveNullAndEmptyArrays: true } },

        // ── Join participantes ───────────────────────────────────────────────
        {
          $lookup: {
            from:         'comisiones-participantes',
            localField:   '_id',
            foreignField: 'comision_id',
            as:           'participantes',
          },
        },

        // ── Join usuarios de los participantes ───────────────────────────────
        {
          $lookup: {
            from:         'usuarios',
            localField:   'participantes.user',
            foreignField: '_id',
            as:           'usuarios_info',
          },
        },

        // ── Mapear participantes con su usuario ──────────────────────────────
        {
          $addFields: {
            participantes: {
              $map: {
                input: '$participantes',
                as:    'p',
                in: {
                  _id:                 '$$p._id',
                  role_in_comision:    '$$p.role_in_comision',
                  percentage:          '$$p.percentage',
                  commission_amount:   '$$p.commission_amount',
                  adjusted_commission: '$$p.adjusted_commission',
                  verification:        '$$p.verification',
                  correction_comments: '$$p.correction_comments',
                  usuario: {
                    $arrayElemAt: [
                      {
                        $filter: {
                          input: '$usuarios_info',
                          as:    'u',
                          cond:  { $eq: ['$$u._id', '$$p.user'] },
                        },
                      },
                      0,
                    ],
                  },
                },
              },
            },
          },
        },

        // ── Proyección final ─────────────────────────────────────────────────
        {
          $project: {
            company:              1,
            development:          1,
            location:             1,
            concept:              1,
            commission_type:      1,
            sale_price:           1,
            total_commission:     1,
            client_name:          1,
            expediente_id:        1,
            operation_date:       1,
            register_date:        1,
            correction_comments:  1,
            created_at:           1,
            created_by:           1,
            is_cancellation:      1,
            penalty_target:       1,
            'status.name':        1,
            'status.order':       1,
            'status.description': 1,
            participantes: {
              $map: {
                input: '$participantes',
                as:    'p',
                in: {
                  _id:                 '$$p._id',
                  role_in_comision:    '$$p.role_in_comision',
                  percentage:          '$$p.percentage',
                  commission_amount:   '$$p.commission_amount',
                  adjusted_commission: '$$p.adjusted_commission',
                  verification:        '$$p.verification',
                  correction_comments: '$$p.correction_comments',
                  usuario: {
                    _id:      '$$p.usuario._id',
                    name:     '$$p.usuario.name',
                    username: '$$p.usuario.username',
                    email:    '$$p.usuario.email',
                    picture:  '$$p.usuario.picture',
                  },
                },
              },
            },
          },
        },

        { $sort: { created_at: -1 } },
      ])
      .toArray();

    hideDirectorData(comisiones, req.user.roleName);

    return res.status(200).json({
      success: true,
      data:    comisiones,
      message: `${comisiones.length} comisión(es) encontrada(s)`,
      error:   null,
    });

  } catch (error) {
    console.error('[GET /api/comisiones/mis-comisiones]', error);
    return res.status(500).json({
      success: false,
      data:    null,
      message: 'Error al obtener las comisiones',
      error:   error.message,
    });
  }
});


// ── GET /api/comisiones/historial ─────────────────────────────────────────────
// Comisiones pagadas agrupadas por ubicación (contrato + escritura ambas pagadas)
router.get('/historial', authenticate, async (req, res) => {
  const db = req.app.locals.mongoClient.db(DB_NAME);
  const isLimitado = ['Asesor', 'Gerente'].includes(req.user.roleName);
  const userId = new ObjectId(req.user.id);

  try {
    const statusPagada = await db.collection('estatus').findOne({ order: 6 });
    if (!statusPagada) return res.json({ success: true, data: [] });

    let matchBase = { status: statusPagada._id };
    if (isLimitado) {
      const targetUserIds = [userId];
      if (req.user.roleName === 'Gerente') {
        const subAdvisors = await db.collection('usuarios')
          .find({ manager_ids: userId })
          .project({ _id: 1 })
          .toArray();
        targetUserIds.push(...subAdvisors.map(a => a._id));
      }

      const participaciones = await db
        .collection('comisiones-participantes')
        .find({ user: { $in: targetUserIds } }, { projection: { comision_id: 1 } })
        .toArray();
      matchBase._id = { $in: participaciones.map(p => p.comision_id) };
    }

    const comisiones = await db.collection('comisiones-ubicaciones').aggregate([
      { $match: matchBase },
      {
        $lookup: {
          from: 'comisiones-participantes',
          localField: '_id',
          foreignField: 'comision_id',
          as: 'participantes',
        },
      },
      {
        $lookup: {
          from: 'usuarios',
          localField: 'participantes.user',
          foreignField: '_id',
          as: 'usuarios_info',
        },
      },
      {
        $addFields: {
          participantes: {
            $map: {
              input: '$participantes',
              as: 'p',
              in: {
                role_in_comision: '$$p.role_in_comision',
                percentage: '$$p.percentage',
                commission_amount: '$$p.commission_amount',
                usuario: {
                  $arrayElemAt: [
                    { $filter: { input: '$usuarios_info', as: 'u', cond: { $eq: ['$$u._id', '$$p.user'] } } },
                    0,
                  ],
                },
              },
            },
          },
        },
      },
      {
        $project: {
          company: 1, development: 1, location: 1, concept: 1,
          sale_price: 1, total_commission: 1, operation_date: 1, client_name: 1,
          'participantes.role_in_comision': 1,
          'participantes.percentage': 1,
          'participantes.commission_amount': 1,
          'participantes.usuario.name': 1,
        },
      },
      { $sort: { operation_date: -1 } },
    ]).toArray();

    hideDirectorData(comisiones, req.user.roleName);

    // Normalizar campo que puede ser string u objeto { id, text }
    const txt = v => {
      if (!v) return '';
      if (typeof v !== 'object') return String(v);
      const inner = v.text ?? v.nombre ?? v.name ?? v.value ?? '';
      return typeof inner === 'object' ? String(inner.text ?? inner.nombre ?? '') : String(inner);
    };

    // Agrupar por desarrollo + ubicación
    const groups = new Map();
    for (const c of comisiones) {
      const devText = txt(c.development);
      const locText = txt(c.location);
      const key = `${devText}||${locText}`;
      if (!groups.has(key)) {
        groups.set(key, {
          id:          c._id.toString(),
          company:     txt(c.company),
          development: devText,
          locationText: locText,
          client_name: c.client_name,
          contrato:    [],
          escritura:   [],
          bono:        [],
        });
      }
      const g = groups.get(key);
      const fase = { _id: c._id.toString(), operation_date: c.operation_date, sale_price: c.sale_price, total_commission: c.total_commission, participantes: c.participantes };
      const concept = String(c.concept?.text ?? c.concept ?? '').toLowerCase();
      if (concept.includes('escritura')) { g.escritura.push(fase); }
      else if (concept.includes('bono')) { g.bono.push(fase); }
      else                               { g.contrato.push(fase); }
    }

    // Grupos con al menos una fase pagada
    const result = [...groups.values()].filter(g => g.contrato.length > 0 || g.escritura.length > 0 || g.bono.length > 0);
    return res.json({ success: true, data: result });

  } catch (error) {
    console.error('[GET /api/comisiones/historial]', error);
    return res.status(500).json({ success: false, data: null, message: 'Error', error: error.message });
  }
});


// ── 1. PATCH /api/comisiones/:id/verificar ────────────────────────────────────
// El participante marca su verificación; si todos verificaron → sube estatus
// En modo DEV (process.env.NODE_ENV !== 'production'), Administrador puede verificar en nombre de cualquier participante o todos.
router.patch('/:id/verificar', authenticate, async (req, res) => {
  const client = req.app.locals.mongoClient;
  const db     = client.db(DB_NAME);

  try {
    const comisionId = new ObjectId(req.params.id);
    const userId     = new ObjectId(req.user.id);
    const now        = new Date();
    const isDev      = process.env.NODE_ENV === 'development' || process.env.ENABLE_DEV_MODE === 'true';
    const isAdmin    = req.user.roleName === 'Administrador';

    // ── Datos de la comisión (location + status) ──────────────────────────────
    const comision = await db
      .collection('comisiones-ubicaciones')
      .aggregate([
        { $match: { _id: comisionId } },
        { $lookup: { from: 'estatus', localField: 'status', foreignField: '_id', as: 'statusObj' } },
        { $unwind: { path: '$statusObj', preserveNullAndEmptyArrays: true } }
      ]).next();

    if (!comision) {
      return res.status(404).json({
        success: false,
        data:    null,
        message: 'Comisión no encontrada',
        error:   null,
      });
    }

    if (comision.statusObj && comision.statusObj.order !== 1 && comision.statusObj.order !== 7) {
      return res.status(400).json({
        success: false,
        data:    null,
        message: `Esta comisión ya ha sido verificada o procesada. Estatus actual: ${comision.statusObj.name}`,
        error:   null,
      });
    }

    const locationText = comision.location?.text || 'Sin ubicación';

    // ── Modo Dev: Administrador verificando todos los participantes ───────────
    if (isDev && isAdmin && req.body && req.body.verify_all) {
      const allParticipants = await db
        .collection('comisiones-participantes')
        .find({ comision_id: comisionId })
        .toArray();

      if (!allParticipants.length) {
        return res.status(400).json({
          success: false,
          data:    null,
          message: 'No hay participantes en esta comisión',
          error:   null,
        });
      }

      await db.collection('comisiones-participantes').updateMany(
        { comision_id: comisionId },
        { $set: { verification: true, updated_at: now } }
      );

      const [statusVerificada, statusPendienteAprobacion] = await Promise.all([
        db.collection('estatus').findOne({ order: 2 }),
        db.collection('estatus').findOne({ order: 3 }),
      ]);

      await Promise.all([
        db.collection('comisiones-ubicaciones').updateOne(
          { _id: comisionId },
          { $set: { status: statusPendienteAprobacion._id, updated_at: now } }
        ),
        db.collection('comisiones-participantes').updateMany(
          { comision_id: comisionId },
          { $set: { status: statusPendienteAprobacion._id, updated_at: now } }
        ),
      ]);

      await notify(db, allParticipants.map(p => p.user),
        `Todos los participantes fueron verificados por Administrador (Modo Dev) para la comisión de ${locationText}. Ahora está en Pendiente de Aprobación.`,
        now);

      const directorIds = await getUserIdsByRole(db, 'Director');
      if (directorIds.length > 0) {
        await notify(db, directorIds,
          `La comisión de ${locationText} fue verificada (Modo Dev) y está lista para aprobación.`,
          now);
      }

      return res.status(200).json({
        success: true,
        data:    { todos_verificaron: true, nuevo_status: statusPendienteAprobacion.name },
        message: 'Todos los participantes fueron verificados (Modo Dev). Comisión en Pendiente Aprobación',
        error:   null,
      });
    }

    // ── Determinar participante a verificar ──────────────────────────────────
    let participante = null;
    if (isDev && isAdmin && req.body && (req.body.participante_id || req.body.user_id)) {
      if (req.body.participante_id) {
        participante = await db
          .collection('comisiones-participantes')
          .findOne({ _id: new ObjectId(req.body.participante_id), comision_id: comisionId });
      } else if (req.body.user_id) {
        participante = await db
          .collection('comisiones-participantes')
          .findOne({ comision_id: comisionId, user: new ObjectId(req.body.user_id) });
      }

      if (!participante) {
        return res.status(404).json({
          success: false,
          data:    null,
          message: 'Participante no encontrado en esta comisión',
          error:   null,
        });
      }
    } else {
      participante = await db
        .collection('comisiones-participantes')
        .findOne({ comision_id: comisionId, user: userId });

      if (!participante) {
        return res.status(403).json({
          success: false,
          data:    null,
          message: 'No eres participante de esta comisión',
          error:   null,
        });
      }
    }

    if (participante.verification) {
      return res.status(400).json({
        success: false,
        data:    null,
        message: 'Este participante ya verificó esta comisión',
        error:   null,
      });
    }

    // ── Marcar verificación del participante ──────────────────────────────────
    await db.collection('comisiones-participantes').updateOne(
      { _id: participante._id },
      { $set: { verification: true, updated_at: now } }
    );

    // ── Revisar si todos los participantes ya verificaron ─────────────────────
    const pendientes = await db
      .collection('comisiones-participantes')
      .countDocuments({ comision_id: comisionId, verification: false });

    if (pendientes > 0) {
      // Notificar a los demás participantes que alguien ya verificó
      const otrosParticipantes = await db
        .collection('comisiones-participantes')
        .find({ comision_id: comisionId, user: { $ne: participante.user } })
        .project({ user: 1 })
        .toArray();

      const verifierName = (isDev && isAdmin && !participante.user.equals(userId))
        ? `Administrador (en nombre de participante)`
        : req.user.name;

      await notify(db, otrosParticipantes.map(p => p.user),
        `${verifierName} verificó su parte de la comisión de ${locationText}. Faltan ${pendientes} verificaciones.`,
        now);

      return res.status(200).json({
        success: true,
        data:    { todos_verificaron: false },
        message: 'Verificación registrada. Esperando a los demás participantes',
        error:   null,
      });
    }

    // ── Todos verificaron → subir a Pendiente Aprobación ─────────────────────
    const [statusVerificada, statusPendienteAprobacion] = await Promise.all([
      db.collection('estatus').findOne({ order: 2 }),
      db.collection('estatus').findOne({ order: 3 }),
    ]);

    await Promise.all([
      db.collection('comisiones-ubicaciones').updateOne(
        { _id: comisionId },
        { $set: { status: statusPendienteAprobacion._id, updated_at: now } }
      ),
      db.collection('comisiones-participantes').updateMany(
        { comision_id: comisionId },
        { $set: { status: statusPendienteAprobacion._id, updated_at: now } }
      ),
    ]);

    // ── Notificar a todos los participantes ───────────────────────────────────
    const todosParticipantes = await db
      .collection('comisiones-participantes')
      .find({ comision_id: comisionId })
      .project({ user: 1 })
      .toArray();

    await notify(db, todosParticipantes.map(p => p.user),
      `Todos verificaron la comisión de ${locationText}. Ahora está en Pendiente de Aprobación.`,
      now);

    // ── Notificar a Director ───────────────────────────────────────────────
    const directorIds = await getUserIdsByRole(db, 'Director');
    if (directorIds.length > 0) {
      await notify(db, directorIds,
        `La comisión de ${locationText} fue verificada y está lista para aprobación.`,
        now);
    }

    return res.status(200).json({
      success: true,
      data:    { todos_verificaron: true, nuevo_status: statusPendienteAprobacion.name },
      message: 'Todos verificaron. Comisión en Pendiente Aprobación',
      error:   null,
    });

  } catch (error) {
    console.error('[PATCH /api/comisiones/:id/verificar]', error);
    return res.status(500).json({
      success: false,
      data:    null,
      message: 'Error al verificar la comisión',
      error:   error.message,
    });
  }
});


// ── 2. PATCH /api/comisiones/:id/aprobar ─────────────────────────────────────
// La Director aprueba o manda a corrección
router.patch('/:id/aprobar', authenticate, authorize(['Administrador', 'Director']), async (req, res) => {
  const client = req.app.locals.mongoClient;
  const db     = client.db(DB_NAME);

  try {
    const comisionId = new ObjectId(req.params.id);
    const { accion, correction_comments } = req.body; // accion: "aprobar" | "correccion"
    const now = new Date();

    if (!['aprobar', 'correccion'].includes(accion)) {
      return res.status(400).json({
        success: false,
        data:    null,
        message: 'La acción debe ser "aprobar" o "correccion"',
        error:   null,
      });
    }

    if (accion === 'correccion' && !correction_comments) {
      return res.status(400).json({
        success: false,
        data:    null,
        message: 'Debes indicar los comentarios de corrección',
        error:   null,
      });
    }

    // ── Verificar que la comisión está en Pendiente Aprobacion (order 3) ──────
    const comision = await db
      .collection('comisiones-ubicaciones')
      .aggregate([
        { $match: { _id: comisionId } },
        { $lookup: { from: 'estatus', localField: 'status', foreignField: '_id', as: 'status' } },
        { $unwind: '$status' },
      ])
      .next();

    if (!comision) {
      return res.status(404).json({
        success: false,
        data:    null,
        message: 'Comisión no encontrada',
        error:   null,
      });
    }

    if (!(comision.status.order === 3 || comision.status.order === 5)) {
      return res.status(400).json({
        success: false,
        data:    null,
        message: `La comisión debe estar en "Pendiente Aprobación" o "Pendiente de Pago" para esta acción. Estado actual: ${comision.status.name}`,
        error:   null,
      });
    }

    // ── Obtener estatus destino ───────────────────────────────────────────────
    const targetOrder  = accion === 'aprobar' ? 5 : 7; // Pendiente Pago | Correccion
    const statusDestino = await db.collection('estatus').findOne({ order: targetOrder });

    const comisionLocation = comision?.location?.text || 'Sin ubicación';
    const eraCorreccion    = comision?.was_corrected || false;

    const updateFields = {
      status:              statusDestino._id,
      correction_comments: accion === 'correccion' ? correction_comments : null,
      updated_at:          now,
    };
    if (accion === 'correccion') updateFields.was_corrected = true;

    await Promise.all([
      db.collection('comisiones-ubicaciones').updateOne(
        { _id: comisionId },
        { $set: updateFields }
      ),
      db.collection('comisiones-participantes').updateMany(
        { comision_id: comisionId },
        {
          $set: {
            status:              statusDestino._id,
            correction_comments: accion === 'correccion' ? correction_comments : null,
            updated_at:          now,
          },
        }
      ),
    ]);

    // ── Notificar a los participantes ─────────────────────────────────────────
    const participantes = await db
      .collection('comisiones-participantes')
      .find({ comision_id: comisionId })
      .project({ user: 1, commission_amount: 1, adjusted_commission: 1 })
      .toArray();

    const msgParticipantes = accion === 'aprobar'
      ? `Tu comisión de ${comisionLocation} fue aprobada y está en Pendiente de Pago.`
      : `Tu comisión de ${comisionLocation} fue enviada a corrección: ${correction_comments}`;

    await notify(db, participantes.map(p => p.user), msgParticipantes, now);

    // ── Insertar crédito o deuda en wallet al aprobar ────────────────────────
    if (accion === 'aprobar') {
      if (!comision.is_cancellation) {
        const txs = participantes.map(p => {
          const monto = parseFloat((p.adjusted_commission ?? p.commission_amount ?? 0).toString());
          return {
            user_id: p.user,
            type: 'credit',
            amount: Decimal128.fromString(monto.toString()),
            concept: 'commission',
            description: `Comisión aprobada - ${comisionLocation}`,
            debt_id: null,
            comision_id: comisionId,
            reference_date: now,
            created_by: new ObjectId(req.user.id),
            created_at: now
          };
        }).filter(t => parseFloat(t.amount.toString()) !== 0);
        
        if (txs.length > 0) {
          await db.collection('walletTransactions').insertMany(txs);
        }
      } else if (comision.is_cancellation && comision.penalty_target === 'miembros') {
        const debtsToInsert = participantes
          .filter(p => parseFloat((p.adjusted_commission ?? p.commission_amount ?? 0).toString()) < 0)
          .map(p => {
            const commVal = parseFloat((p.adjusted_commission ?? p.commission_amount ?? 0).toString());
            const absAmount = Math.abs(commVal);
            return {
              user_id: p.user,
              comision_id: comisionId,
              type: 'penalty',
              description: `Penalización por cancelación - ${comisionLocation}`,
              total_amount: Decimal128.fromString(absAmount.toString()),
              remaining_balance: Decimal128.fromString(absAmount.toString()),
              status: 'active',
              created_by: new ObjectId(req.user.id),
              created_at: now,
              updated_at: now,
            };
          }).filter(d => parseFloat(d.total_amount.toString()) > 0);

        if (debtsToInsert.length > 0) {
          await db.collection('debts').insertMany(debtsToInsert);
        }
      }
    }

    // ── Notificar a Administrador ─────────────────────────────────────────────
    if (accion === 'aprobar') {
      const adminIds = await getUserIdsByRole(db, 'Administrador');
      await notify(db, adminIds,
        `La comisión de ${comisionLocation} fue aprobada y está lista para pago.`,
        now);
    }

    return res.status(200).json({
      success: true,
      data:    { nuevo_status: statusDestino.name },
      message: accion === 'aprobar'
        ? 'Comisión aprobada. Ahora está en Pendiente de Pago'
        : 'Comisión enviada a corrección',
      error:   null,
    });

  } catch (error) {
    console.error('[PATCH /api/comisiones/:id/aprobar]', error);
    return res.status(500).json({
      success: false,
      data:    null,
      message: 'Error al procesar la aprobación',
      error:   error.message,
    });
  }
});


// ── 3. PATCH /api/comisiones/:id/pagar ───────────────────────────────────────
// La Administrador marca la comisión como pagada
router.patch('/:id/pagar', authenticate, authorize(['Administrador']), async (req, res) => {
  const client = req.app.locals.mongoClient;
  const db     = client.db(DB_NAME);

  try {
    const comisionId = new ObjectId(req.params.id);
    const now        = new Date();

    // ── Verificar que la comisión está en Pendiente Pago (order 5) ────────────
    const comision = await db
      .collection('comisiones-ubicaciones')
      .aggregate([
        { $match: { _id: comisionId } },
        { $lookup: { from: 'estatus', localField: 'status', foreignField: '_id', as: 'status' } },
        { $unwind: '$status' },
      ])
      .next();

    if (!comision) {
      return res.status(404).json({
        success: false,
        data:    null,
        message: 'Comisión no encontrada',
        error:   null,
      });
    }

    if (comision.status.order !== 5) {
      return res.status(400).json({
        success: false,
        data:    null,
        message: `La comisión debe estar en "Pendiente Pago" para marcarla como pagada. Estado actual: ${comision.status.name}`,
        error:   null,
      });
    }

    const statusPagada = await db.collection('estatus').findOne({ order: 6 });

    await Promise.all([
      db.collection('comisiones-ubicaciones').updateOne(
        { _id: comisionId },
        { $set: { status: statusPagada._id, updated_at: now } }
      ),
      db.collection('comisiones-participantes').updateMany(
        { comision_id: comisionId },
        { $set: { status: statusPagada._id, updated_at: now } }
      ),
    ]);

    // ── Notificar a los participantes y Director ──────────────────────────────
    const participantes = await db
      .collection('comisiones-participantes')
      .find({ comision_id: comisionId })
      .project({ user: 1, commission_amount: 1, adjusted_commission: 1 })
      .toArray();

    const locationPago = comision?.location?.text || 'Sin ubicación';
    
    const directorIds = await getUserIdsByRole(db, 'Director');
    const usersToNotify = [...new Set([...participantes.map(p => p.user.toString()), ...directorIds.map(id => id.toString())])];

    await notify(db, usersToNotify.map(id => new ObjectId(id)),
      `¡Tu comisión de ${locationPago} ha sido pagada!`, now);

    // ── Insertar débito en wallet al pagar la comisión ────────────────────────
    if (!comision.is_cancellation) {
      const txs = participantes.map(p => {
        const monto = parseFloat((p.adjusted_commission ?? p.commission_amount ?? 0).toString());
        return {
          user_id: p.user,
          type: 'debit',
          amount: Decimal128.fromString(monto.toString()),
          concept: 'payment', // Retiro de la comisión de la wallet
          description: `Retiro por comisión pagada - ${locationPago}`,
          debt_id: null,
          comision_id: comisionId,
          reference_date: now,
          created_by: new ObjectId(req.user.id),
          created_at: now
        };
      }).filter(t => parseFloat(t.amount.toString()) !== 0);
      
      if (txs.length > 0) {
        await db.collection('walletTransactions').insertMany(txs);
      }
    }

    return res.status(200).json({
      success: true,
      data:    { nuevo_status: statusPagada.name },
      message: 'Comisión marcada como pagada',
      error:   null,
    });

  } catch (error) {
    console.error('[PATCH /api/comisiones/:id/pagar]', error);
    return res.status(500).json({
      success: false,
      data:    null,
      message: 'Error al marcar la comisión como pagada',
      error:   error.message,
    });
  }
});


// POST /api/comisiones
router.post('/', authenticate, async (req, res) => {
  const client = req.app.locals.mongoClient;
  const db     = client.db(DB_NAME);

  try {
    const {
      company,
      development,
      location,
      concept,
      commission_type,
      sale_price,
      operation_date,
      register_date,
      client_name,
      expediente_id,
      participants,
      is_cancellation,
      penalty_target,
    } = req.body;

    const created_by = new ObjectId(req.user.id); 
    // console.log(created_by);

    // ── 1. Validaciones ───────────────────────────────────────────────────────
    if (!company || !development || !location || !location.id || !concept || !concept.id || !expediente_id) {
      return res.status(400).json({
        success: false,
        data:    null,
        message: 'Faltan campos obligatorios de ubicación o expediente. location y concept deben contener un id.',
        error:   null,
      });
    }

    if (!commission_type || !sale_price || !operation_date || !register_date) {
      return res.status(400).json({
        success: false,
        data:    null,
        message: 'Faltan campos obligatorios de la comisión',
        error:   null,
      });
    }

    if (!participants?.advisors?.length || !participants?.managers?.length) {
      return res.status(400).json({
        success: false,
        data:    null,
        message: 'Debe incluir al menos un asesor y un gerente',
        error:   null,
      });
    }

    // ── 1.5 Validar duplicados ────────────────────────────────────────────────
    if (location && location.id && concept && concept.id) {
      if (!is_cancellation) {
        // Comisión normal: no puede existir otra con misma ubicación y concepto
        const existingComision = await db.collection('comisiones-ubicaciones').findOne({
          'location.id': location.id,
          'concept.id':  concept.id,
        });
        if (existingComision) {
          return res.status(400).json({
            success: false,
            data:    null,
            message: 'Ya existe una comisión registrada para esta ubicación y este concepto.',
            error:   null,
          });
        }
      } else {
        // Cancelación: no puede existir otra cancelación para el mismo expediente y ubicación
        const existingCancellation = await db.collection('comisiones-ubicaciones').findOne({
          'location.id':    location.id,
          expediente_id:    expediente_id,
          is_cancellation:  true,
        });
        if (existingCancellation) {
          return res.status(400).json({
            success: false,
            data:    null,
            message: 'Ya existe una cancelación registrada para este expediente y esta ubicación.',
            error:   null,
          });
        }
      }
    }

    // ── 1.8 (Eliminado) Ya no se cambian comisiones previas a 'Cancelada' ───────

    const typeMap = {
      Tradicional: 'traditional',
      Compartida:  'shared',
      Multipunto:  'multipoint',
    };
    const pKey = typeMap[commission_type];
    if (!pKey) {
      return res.status(400).json({
        success: false,
        data:    null,
        message: `Tipo de comisión no válido: ${commission_type}`,
        error:   null,
      });
    }

    // ── 2. Obtener estatus inicial y porcentajes desde la DB ──────────────────
    const [statusInicial, percentagesDoc] = await Promise.all([
      db.collection('estatus').findOne({ order: 1 }),
      db.collection('percentages').findOne({}),
    ]);

    if (!statusInicial) {
      return res.status(500).json({
        success: false,
        data:    null,
        message: 'No se encontró el estatus inicial en la base de datos',
        error:   null,
      });
    }

    const pType = percentagesDoc?.v1?.[pKey];
    if (!pType) {
      return res.status(500).json({
        success: false,
        data:    null,
        message: 'No se encontraron los porcentajes en la base de datos',
        error:   null,
      });
    }

    // ── 3. Construir documentos de participantes ──────────────────────────────
    const advisorKeys = ['advisor1', 'advisor2', 'advisor3'];
    const managerKeys = ['manager1', 'manager2', 'manager3'];
    const now         = new Date();

    const buildParticipante = (userId, percentageKey, roleInComision, inputPercentage) => {
      const parsedPct = parseFloat(inputPercentage);
      if (isNaN(parsedPct) || parsedPct < 0 || parsedPct > 1) {
        throw new Error(`El porcentaje ingresado para el usuario no es válido o no está permitido.`);
      }

      let commAmount = sale_price * parsedPct;
      if (is_cancellation) {
        if (penalty_target === 'miembros') {
          commAmount = -Math.abs(commAmount);
        } else {
          commAmount = 0;
        }
      }

      return {
        comision_id:         null, // se rellena después del insert de ubicación
        user:                new ObjectId(userId),
        role_in_comision:    roleInComision,
        percentage:          parsedPct,
        commission_amount:   commAmount,
        adjusted_commission: null,
        verification:        false,
        status:              statusInicial._id,
        correction_comments: null,
        created_at:          now,
        updated_at:          now,
      };
    };

    let participanteDocs;
    try {
      participanteDocs = [
        ...participants.advisors
          .map((a, i) => buildParticipante(a.user, advisorKeys[i], 'asesor', a.percentage))
          .filter(Boolean),
        ...participants.managers
          .map((m, i) => buildParticipante(m.user, managerKeys[i], 'gerente', m.percentage))
          .filter(Boolean),
      ];
    } catch (validationError) {
      return res.status(400).json({
        success: false,
        data:    null,
        message: validationError.message,
        error:   null,
      });
    }

    // ── 3.5 Asignar comisión al Director (0.10%) ──────────────────────────────
    if (participants.managers && participants.managers.length > 0) {
      const directorIds = await getUserIdsByRole(db, 'Director');
      for (const directorId of directorIds) {
        const pctDirector = 0.001; // 0.10%
        let commAmountDirector = sale_price * pctDirector;
        if (is_cancellation) {
          commAmountDirector = -Math.abs(commAmountDirector);
        } else {
          commAmountDirector = Math.abs(commAmountDirector);
        }
        
        participanteDocs.push({
          comision_id:         null,
          user:                directorId,
          role_in_comision:    'director',
          percentage:          pctDirector,
          commission_amount:   commAmountDirector,
          adjusted_commission: null,
          verification:        false,
          status:              statusInicial._id,
          correction_comments: null,
          created_at:          now,
          updated_at:          now,
        });
      }
    }

    // ── 4. Calcular comisión total ────────────────────────────────────────────
    const total_commission = participanteDocs.reduce(
      (sum, p) => sum + p.commission_amount, 0
    );

    // ── 5. Insertar en comisiones-ubicaciones ─────────────────────────────────
    const ubicacionDoc = {
      company,
      development,
      location,
      concept,
      commission_type,
      sale_price,
      total_commission,
      expediente_id:       expediente_id ?? null,
      client_name:         client_name ?? null,
      operation_date:      new Date(operation_date),
      register_date:       new Date(register_date),
      status:              statusInicial._id,
      correction_comments: null,
      created_by:          created_by,
      is_cancellation,
      penalty_target,
      created_at:          now,
      updated_at:          now,
    };

    console.log(ubicacionDoc);

    const { insertedId: comisionId } = await db
      .collection('comisiones-ubicaciones')
      .insertOne(ubicacionDoc);

    // ── 6. Asignar comision_id e insertar participantes ───────────────────────
    const participantesConId = participanteDocs.map((p) => ({
      ...p,
      comision_id: comisionId,
    }));

    await db
      .collection('comisiones-participantes')
      .insertMany(participantesConId);


    // ── 7. Notificar a cada participante ──────────────────────────────────────
    await notify(db, participantesConId.map(p => p.user),
      `Fuiste incluido en una nueva comisión de ${location.text}.`, now);

    // ── 8. Respuesta ──────────────────────────────────────────────────────────
    return res.status(201).json({
      success: true,
      data: {
        comision_id:      comisionId,
        total_commission,
        participantes:    participantesConId.length,
      },
      message: 'Comisión creada exitosamente',
      error:   null,
    });

  } catch (error) {
    console.error('[POST /api/comisiones]', error);
    return res.status(500).json({
      success: false,
      data:    null,
      message: 'Error al crear la comisión',
      error:   error.message,
    });
  }
});

// GET /api/comisiones
router.get('/', authenticate, authorize(['Administrador', 'Director']), async (req, res) => {
  const client = req.app.locals.mongoClient;
  const db     = client.db(DB_NAME);

  try {
    const { from, to } = req.query;
    const matchStage = {};

    if (from && to) {
      matchStage.register_date = {
        $gte: new Date(from),
        $lte: new Date(to)
      };
    } else if (from) {
      matchStage.register_date = { $gte: new Date(from) };
    } else if (to) {
      matchStage.register_date = { $lte: new Date(to) };
    }

    const aggregatePipeline = [];
    
    if (Object.keys(matchStage).length > 0) {
      aggregatePipeline.push({ $match: matchStage });
    }

    aggregatePipeline.push(
        // ── 1. Join estatus de la comisión ────────────────────────────────────
        {
          $lookup: {
            from:         'estatus',
            localField:   'status',
            foreignField: '_id',
            as:           'status',
          },
        },
        { $unwind: { path: '$status', preserveNullAndEmptyArrays: true } },

        // ── 2. Join participantes ─────────────────────────────────────────────
        {
          $lookup: {
            from:         'comisiones-participantes',
            localField:   '_id',
            foreignField: 'comision_id',
            as:           'participantes',
          },
        },

        // ── 3. Join usuarios de los participantes ─────────────────────────────
        {
          $lookup: {
            from:         'usuarios',
            localField:   'participantes.user',
            foreignField: '_id',
            as:           'usuarios_info',
          },
        },

        // ── 4. Mapear participantes con su usuario ────────────────────────────
        {
          $addFields: {
            participantes: {
              $map: {
                input: '$participantes',
                as:    'p',
                in: {
                  _id:                 '$$p._id',
                  role_in_comision:    '$$p.role_in_comision',
                  percentage:          '$$p.percentage',
                  commission_amount:   '$$p.commission_amount',
                  adjusted_commission: '$$p.adjusted_commission',
                  verification:        '$$p.verification',
                  correction_comments: '$$p.correction_comments',
                  usuario: {
                    $arrayElemAt: [
                      {
                        $filter: {
                          input: '$usuarios_info',
                          as:    'u',
                          cond:  { $eq: ['$$u._id', '$$p.user'] },
                        },
                      },
                      0,
                    ],
                  },
                },
              },
            },
          },
        },



        { $sort: { created_at: -1 } }
    );

    const comisiones = await db
      .collection('comisiones-ubicaciones')
      .aggregate(aggregatePipeline)
      .toArray();

    hideDirectorData(comisiones, req.user.roleName);

    return res.status(200).json({
      success: true,
      data:    comisiones,
      message: `${comisiones.length} comisión(es) encontrada(s)`,
      error:   null,
    });

  } catch (error) {
    console.error('[GET /api/comisiones]', error);
    return res.status(500).json({
      success: false,
      data:    null,
      message: 'Error al obtener las comisiones',
      error:   error.message,
    });
  }
});



// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/comisiones/:id
// Edita una comisión y resetea verificaciones + estatus a Pendiente Verificacion
// Solo el Gerente creador puede editar
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/editar/:id/', authenticate, async (req, res) => {
  const db     = req.app.locals.mongoClient.db(DB_NAME);
  const userId = new ObjectId(req.user.id);
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false, data: null,
      message: 'ID de comisión no válido', error: null,
    });
  }

  try {
    // ── 1. Verificar que existe y que el usuario es el creador ────────────────
    const comision = await db
      .collection('comisiones-ubicaciones')
      .aggregate([
        { $match: { _id: new ObjectId(id) } },
        {
          $lookup: {
            from: 'estatus',
            localField: 'status',
            foreignField: '_id',
            as: 'statusObj',
          },
        },
        { $unwind: { path: '$statusObj', preserveNullAndEmptyArrays: true } },
      ])
      .next();

    if (!comision) {
      return res.status(404).json({
        success: false, data: null,
        message: 'Comisión no encontrada', error: null,
      });
    }

    if (comision.statusObj && comision.statusObj.order === 6) {
      return res.status(400).json({
        success: false,
        data: null,
        message: 'No se puede editar una comisión que ya ha sido Pagada.',
        error: null,
      });
    }

    const isAdmin = req.user.roleName === 'Administrador';
    if (!isAdmin && comision.created_by.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false, data: null,
        message: 'Solo el creador o un Administrador pueden editar esta comisión', error: null,
      });
    }

    const {
      company, development, location, concept,
      commission_type, sale_price, operation_date,
      register_date, client_name, participants, is_cancellation,
      penalty_target
    } = req.body;

    if (!location || !location.id || !concept || !concept.id) {
      return res.status(400).json({
        success: false,
        data:    null,
        message: 'location y concept son obligatorios y deben contener un id.',
        error:   null,
      });
    }

    // ── 1.5 Validar duplicados ────────────────────────────────────────────────
    if (!is_cancellation) {
      // Comisión normal: no puede existir otra con misma ubicación y concepto
      const existingComision = await db.collection('comisiones-ubicaciones').findOne({
        'location.id': location.id,
        'concept.id':  concept.id,
        _id: { $ne: new ObjectId(id) }, // Excluir la comisión actual
      });
      if (existingComision) {
        return res.status(400).json({
          success: false,
          data:    null,
          message: 'Ya existe una comisión registrada para esta ubicación y este concepto.',
          error:   null,
        });
      }
    } else {
      // Cancelación: no puede existir otra cancelación para el mismo expediente y ubicación
      const expediente_id = req.body.expediente_id;
      const existingCancellation = await db.collection('comisiones-ubicaciones').findOne({
        'location.id':   location.id,
        expediente_id:   expediente_id,
        is_cancellation: true,
        _id: { $ne: new ObjectId(id) }, // Excluir la comisión actual
      });
      if (existingCancellation) {
        return res.status(400).json({
          success: false,
          data:    null,
          message: 'Ya existe una cancelación registrada para este expediente y esta ubicación.',
          error:   null,
        });
      }
    }

    // ── 2. Obtener estatus "Pendiente Verificacion" (order: 1) ────────────────
    const [statusInicial, percentagesDoc] = await Promise.all([
      db.collection('estatus').findOne({ order: 1 }),
      db.collection('percentages').findOne({}),
    ]);

    const typeMap = {
      Tradicional: 'traditional',
      Compartida:  'shared',
      Multipunto:  'multipoint',
    };
    const pKey  = typeMap[commission_type];
    const pType = percentagesDoc?.v1?.[pKey];

    if (!pType) {
      return res.status(400).json({
        success: false, data: null,
        message: `Tipo de comisión no válido: ${commission_type}`, error: null,
      });
    }

    const now = new Date();
    const advisorKeys = ['advisor1', 'advisor2', 'advisor3'];
    const managerKeys = ['manager1', 'manager2', 'manager3'];

    // ── 3. Recalcular participantes con porcentajes frescos ───────────────────
    const buildParticipante = (userId, percentageKey, roleInComision, inputPercentage) => {
      const parsedPct = parseFloat(inputPercentage);
      if (isNaN(parsedPct) || parsedPct < 0 || parsedPct > 1) {
        throw new Error(`El porcentaje ingresado para el usuario no es válido o no está permitido.`);
      }

      let commAmount = sale_price * parsedPct;
      if (is_cancellation) {
        if (penalty_target === 'miembros') {
          commAmount = -Math.abs(commAmount);
        } else {
          commAmount = 0;
        }
      }

      return {
        comision_id:         new ObjectId(id),
        user:                new ObjectId(userId),
        role_in_comision:    roleInComision,
        percentage:          parsedPct,
        commission_amount:   commAmount,
        adjusted_commission: null,
        verification:        false,          // ← reset
        status:              statusInicial._id, // ← reset
        correction_comments: null,
        created_at:          now,
        updated_at:          now,
      };
    };

    let participanteDocs;
    try {
      participanteDocs = [
        ...(participants.advisors || [])
          .map((a, i) => buildParticipante(a.user, advisorKeys[i], 'asesor', a.percentage))
          .filter(Boolean),
        ...(participants.managers || [])
          .map((m, i) => buildParticipante(m.user, managerKeys[i], 'gerente', m.percentage))
          .filter(Boolean),
      ];
    } catch (validationError) {
      return res.status(400).json({
        success: false, data: null,
        message: validationError.message, error: null,
      });
    }

    // ── 3.5 Asignar comisión al Director (0.10%) ──────────────────────────────
    if (participants.managers && participants.managers.length > 0) {
      const directorIds = await getUserIdsByRole(db, 'Director');
      for (const directorId of directorIds) {
        const pctDirector = 0.001; // 0.10%
        let commAmountDirector = sale_price * pctDirector;
        if (is_cancellation) {
          commAmountDirector = -Math.abs(commAmountDirector);
        } else {
          commAmountDirector = Math.abs(commAmountDirector);
        }
        
        participanteDocs.push({
          comision_id:         new ObjectId(id),
          user:                directorId,
          role_in_comision:    'director',
          percentage:          pctDirector,
          commission_amount:   commAmountDirector,
          adjusted_commission: null,
          verification:        false,
          status:              statusInicial._id,
          correction_comments: null,
          created_at:          now,
          updated_at:          now,
        });
      }
    }

    const total_commission = participanteDocs.reduce(
      (sum, p) => sum + p.commission_amount, 0
    );

    // ── 4. Actualizar comisiones-ubicaciones ──────────────────────────────────
    await db.collection('comisiones-ubicaciones').updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          company, development, location, concept,
          commission_type, sale_price, total_commission,
          client_name:         client_name ?? null,
          operation_date:      new Date(operation_date),
          register_date:       new Date(register_date),
          status:              statusInicial._id,   // ← reset
          correction_comments: null,
          is_cancellation,
          penalty_target,
          updated_at:          now,
        },
      }
    );

    // ── 5. Borrar participantes anteriores y reinsertar ───────────────────────
    await db.collection('comisiones-participantes')
      .deleteMany({ comision_id: new ObjectId(id) });

    await db.collection('comisiones-participantes')
      .insertMany(participanteDocs);

    // ── 5.5 Sincronizar Cartera y Billetera ───────────────────────────────────
    // 1. Obtener deudas previas para respaldar pagos ya hechos
    const oldDebts = await db.collection('debts').find({
      $or: [
        { comision_id: new ObjectId(id) },
        { description: `Penalización por cancelación - ${comision.location?.text || comision.location?.id}` }
      ]
    }).toArray();

    const userPaymentsMap = new Map();
    for (const debt of oldDebts) {
      const payments = await db.collection('walletTransactions').find({ debt_id: debt._id }).toArray();
      const totalPaid = payments.reduce((sum, p) => sum + parseFloat(p.amount.toString()), 0);
      userPaymentsMap.set(debt.user_id.toString(), {
        totalPaid,
        transactions: payments
      });
    }

    // 2. Borrar todas las transacciones de pago (walletTransactions) directas de esta comisión,
    // pero no los abonos a las deudas (que tienen comision_id = null y se re-asociarán).
    await db.collection('walletTransactions').deleteMany({ comision_id: new ObjectId(id) });

    // 3. Borrar deudas viejas
    await db.collection('debts').deleteMany({
      $or: [
        { comision_id: new ObjectId(id) },
        { description: `Penalización por cancelación - ${comision.location?.text || comision.location?.id}` }
      ]
    });

    // 4. Si sigue siendo cancelación a miembros, regenerar las deudas con los nuevos montos y re-asociar pagos
    if (is_cancellation && penalty_target === 'miembros') {
      for (const p of participanteDocs) {
        if (p.commission_amount < 0) {
          const absAmount = Math.abs(p.commission_amount);
          const userIdStr = p.user.toString();
          const paymentData = userPaymentsMap.get(userIdStr) || { totalPaid: 0, transactions: [] };
          const alreadyPaid = paymentData.totalPaid;

          const remaining = Math.max(0, absAmount - alreadyPaid);
          const status = remaining === 0 ? 'paid' : 'active';

          const newDebtDoc = {
            user_id: p.user,
            comision_id: new ObjectId(id),
            type: 'penalty',
            description: `Penalización por cancelación - ${location.text}`,
            total_amount: toDecimal(absAmount),
            remaining_balance: toDecimal(remaining),
            status: status,
            created_by: new ObjectId(req.user.id),
            created_at: now,
            updated_at: now,
          };

          const { insertedId: newDebtId } = await db.collection('debts').insertOne(newDebtDoc);

          // Re-asociar transacciones de pago existentes a la nueva deuda
          if (paymentData.transactions.length > 0) {
            const txIds = paymentData.transactions.map(t => t._id);
            await db.collection('walletTransactions').updateMany(
              { _id: { $in: txIds } },
              {
                $set: {
                  debt_id: newDebtId,
                  description: `Pago a deuda — Penalización por cancelación - ${location.text}`
                }
              }
            );
          }

          // Si el asesor pagó de más, le reembolsamos la diferencia como crédito en su wallet
          if (alreadyPaid > absAmount) {
            const refundAmount = parseFloat((alreadyPaid - absAmount).toFixed(2));
            await db.collection('walletTransactions').insertOne({
              user_id: p.user,
              type: 'credit',
              amount: toDecimal(refundAmount),
              concept: 'payment',
              description: `Ajuste por saldo a favor - Penalización por cancelación - ${location.text}`,
              debt_id: newDebtId,
              comision_id: null,
              reference_date: now,
              created_by: new ObjectId(req.user.id),
              created_at: now
            });
          }
        }
      }
    }

    // ── 6. Notificar a cada participante ──────────────────────────────────────
    await notify(db, participanteDocs.map(p => p.user),
      `La comisión de ${location.text} fue editada y requiere nueva verificación.`, now);

    return res.status(200).json({
      success: true,
      data:    { comision_id: id, total_commission, participantes: participanteDocs.length },
      message: 'Comisión actualizada. Estatus y verificaciones han sido reiniciados.',
      error:   null,
    });

  } catch (error) {
    console.error('[PATCH /api/comisiones/:id]', error);
    return res.status(500).json({
      success: false, data: null,
      message: 'Error al actualizar la comisión', error: error.message,
    });
  }
});

/**
 * GET /api/comisiones/:id
 */
router.get('/obtener/:id', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.mongoClient.db(DB_NAME);
    const { id } = req.params;

    // ── Validar ObjectId ──────────────────────────────────────────────────
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'El parámetro id no es un ObjectId válido',
        data:    null,
        error:   null,
      });
    }

    // ── 1. Traer la ubicación ─────────────────────────────────────────────
    const ubicacion = await db.collection('comisiones-ubicaciones').aggregate([
      {
        $match: { _id: new ObjectId(id) },
      },

      // Populate status
      {
        $lookup: {
          from:         'estatus',
          localField:   'status',
          foreignField: '_id',
          as:           'status',
        },
      },
      { $unwind: { path: '$status', preserveNullAndEmptyArrays: true } },

      // Populate created_by
      {
        $lookup: {
          from:         'usuarios',
          localField:   'created_by',
          foreignField: '_id',
          as:           'created_by',
          pipeline: [
            { $project: { password: 0 } },
          ],
        },
      },
      { $unwind: { path: '$created_by', preserveNullAndEmptyArrays: true } },

    ]).next();

    if (!ubicacion) {
      return res.status(404).json({
        success: false,
        message: 'Comisión no encontrada',
        data:    null,
        error:   null,
      });
    }

    // ── 2. Traer participantes ────────────────────────────────────────────
    const participantes = await db.collection('comisiones-participantes').aggregate([
      {
        $match: { comision_id: new ObjectId(id) },
      },

      // Populate user
      {
        $lookup: {
          from:         'usuarios',
          localField:   'user',
          foreignField: '_id',
          as:           'user',
          pipeline: [
            { $project: { name: 1, username: 1, picture: 1 } },
          ],
        },
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },

      // Populate status
      {
        $lookup: {
          from:         'estatus',
          localField:   'status',
          foreignField: '_id',
          as:           'status',
        },
      },
      { $unwind: { path: '$status', preserveNullAndEmptyArrays: true } },

    ]).toArray();

    // ── 3. Separar asesores y gerentes (mismo formato que al crear) ───────
    const participants = {
      advisors: participantes
        .filter(p => p.role_in_comision === 'asesor')
        .map(({ role_in_comision, ...p }) => p),
      managers: participantes
        .filter(p => p.role_in_comision === 'gerente')
        .map(({ role_in_comision, ...p }) => p),
    };

    return res.status(200).json({
      success: true,
      message: 'Comisión encontrada',
      data: {
        comision: {
          ...ubicacion,
          participants,
        },
      },
      error: null,
    });

  } catch (error) {
    console.error('[GET /api/comisiones/:id]', error);
    return res.status(500).json({
      success: false,
      message: 'Error en el servidor',
      data:    null,
      error:   error.message,
    });
  }
});

// DELETE /api/comisiones/eliminar/:id
router.delete('/eliminar/:id', authenticate, async (req, res) => {
  const db     = req.app.locals.mongoClient.db(DB_NAME);
  const userId = new ObjectId(req.user.id);
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false, data: null,
      message: 'ID de comisión no válido', error: null,
    });
  }

  try {
    // ── 1. Verificar que existe y que el usuario es el creador ────────────────
    const comision = await db
      .collection('comisiones-ubicaciones')
      .findOne({ _id: new ObjectId(id) });

    if (!comision) {
      return res.status(404).json({
        success: false, data: null,
        message: 'Comisión no encontrada', error: null,
      });
    }

    if (comision.created_by.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false, data: null,
        message: 'Solo el creador puede eliminar esta comisión', error: null,
      });
    }

    // ── 2. Solo se puede eliminar si está en Pendiente Verificacion ───────────
    const statusActual = await db
      .collection('estatus')
      .findOne({ _id: comision.status });

    if (statusActual?.order !== 1 && statusActual?.name !== 'Cancelada') {
      return res.status(400).json({
        success: false, data: null,
        message: `No se puede eliminar una comisión en estatus "${statusActual?.name}"`,
        error: null,
      });
    }

    // ── 3. Eliminar participantes y ubicación ─────────────────────────────────
    await db.collection('comisiones-participantes')
      .deleteMany({ comision_id: new ObjectId(id) });

    await db.collection('comisiones-ubicaciones')
      .deleteOne({ _id: new ObjectId(id) });

    return res.status(200).json({
      success: true,
      data:    { comision_id: id },
      message: 'Comisión eliminada correctamente',
      error:   null,
    });

  } catch (error) {
    console.error('[DELETE /api/comisiones/eliminar/:id]', error);
    return res.status(500).json({
      success: false, data: null,
      message: 'Error al eliminar la comisión', error: error.message,
    });
  }
});

/**
 * DELETE /api/comisiones/:id
 */
// router.delete('/:id', authenticate, async (req, res) => {
//   const client = req.app.locals.mongoClient;
//   const db     = client.db(DB_NAME);
//   const { id } = req.params;

//   // ── Validar ObjectId ────────────────────────────────────────────────────
//   if (!ObjectId.isValid(id)) {
//     return res.status(400).json({
//       success: false,
//       message: 'El parámetro id no es un ObjectId válido',
//       data:    null,
//       error:   null,
//     });
//   }

//   // ── Iniciar sesión para transacción ────────────────────────────────────
//   const session = client.startSession();

//   try {
//     const comisionId = new ObjectId(id);

//     // ── Verificar que la comisión existe ────────────────────────────────
//     const ubicacion = await db
//       .collection('comisiones-ubicaciones')
//       .findOne({ _id: comisionId }, { session });

//     if (!ubicacion) {
//       return res.status(404).json({
//         success: false,
//         message: 'Comisión no encontrada',
//         data:    null,
//         error:   null,
//       });
//     }

//     // ── Obtener participantes para borrar sus notificaciones ────────────
//     const participantes = await db
//       .collection('comisiones-participantes')
//       .find({ comision_id: comisionId }, { session })
//       .toArray();

//     const userIds = [...new Set(participantes.map(p => p.user.toString()))]
//       .map(uid => new ObjectId(uid));

//     // ── Ejecutar borrado en transacción ─────────────────────────────────
//     await session.withTransaction(async () => {

//       // 1. Eliminar participantes
//       const { deletedCount: participantesEliminados } = await db
//         .collection('comisiones-participantes')
//         .deleteMany({ comision_id: comisionId }, { session });

//       // 2. Eliminar notificaciones relacionadas
//       // Notificaciones que mencionen la ubicación de esta comisión
//       const { deletedCount: notificacionesEliminadas } = await db
//         .collection('notificaciones')
//         .deleteMany({
//           usuario_id: { $in: userIds },
//           descripcion: { $regex: ubicacion.location.text, $options: 'i' },
//         }, { session });

//       // 3. Eliminar la ubicación
//       await db
//         .collection('comisiones-ubicaciones')
//         .deleteOne({ _id: comisionId }, { session });

//     });

//     return res.status(200).json({
//       success: true,
//       message: `Comisión '${ubicacion.location.text}' eliminada correctamente`,
//       data: {
//         comision_id:   comisionId,
//         location:      ubicacion.location.text,
//         commission_type: ubicacion.commission_type,
//       },
//       error: null,
//     });

//   } catch (error) {
//     console.error('[DELETE /api/comisiones/:id]', error);
//     return res.status(500).json({
//       success: false,
//       message: 'Error al eliminar la comisión',
//       data:    null,
//       error:   error.message,
//     });
//   } finally {
//     await session.endSession();
//   }
// });







// // ─────────────────────────────────────────────────────────────────────────────
// // GET /api/comisiones
// // Retorna participantes con datos de ubicación aplanados
// // ─────────────────────────────────────────────────────────────────────────────
// router.get('/', authenticate, async (req, res) => {
//   const db = req.app.locals.mongoClient.db(DB_NAME);

//   try {
//     const filas = await db
//       .collection('comisiones-participantes')
//       .aggregate([
//         // ── Datos de la ubicación ────────────────────────────────────────────
//         {
//           $lookup: {
//             from:         'comisiones-ubicaciones',
//             localField:   'comision_id',
//             foreignField: '_id',
//             as:           'ubicacion',
//           },
//         },
//         { $unwind: '$ubicacion' },

//         // ── Datos del participante (usuario) ─────────────────────────────────
//         {
//           $lookup: {
//             from:         'usuarios',
//             localField:   'user',
//             foreignField: '_id',
//             as:           'usuario',
//             pipeline: [
//               { $project: { name: 1, username: 1, picture: 1 } },
//             ],
//           },
//         },
//         { $unwind: '$usuario' },

//         // ── Estatus del participante ──────────────────────────────────────────
//         {
//           $lookup: {
//             from:         'estatus',
//             localField:   'status',
//             foreignField: '_id',
//             as:           'status',
//           },
//         },
//         { $unwind: { path: '$status', preserveNullAndEmptyArrays: true } },

//         // ── Aplanar todo en un solo documento ────────────────────────────────
//         {
//           $project: {
//             // — identificadores clave —
//             _id:                 1,          // ID del participante (para PATCH de estatus)
//             comision_id:         1,

//             // — datos de ubicación —
//             company:             '$ubicacion.company',
//             development:         '$ubicacion.development',
//             location:            '$ubicacion.location',
//             concept:             '$ubicacion.concept',
//             commission_type:     '$ubicacion.commission_type',
//             sale_price:          '$ubicacion.sale_price',
//             total_commission:    '$ubicacion.total_commission',
//             client_name:         '$ubicacion.client_name',
//             operation_date:      '$ubicacion.operation_date',
//             register_date:       '$ubicacion.register_date',

//             // — datos del participante —
//             usuario:             1,
//             role_in_comision:    1,
//             percentage:          1,
//             commission_amount:   1,
//             adjusted_commission: 1,
//             verification:        1,
//             correction_comments: 1,

//             // — estatus del participante (el que se modifica) —
//             status:              1,

//             created_at:          1,
//             updated_at:          1,
//           },
//         },

//         { $sort: { 'ubicacion.created_at': -1, role_in_comision: 1 } },
//       ])
//       .toArray();

//     return res.status(200).json({
//       success: true,
//       data:    { filas, total: filas.length },
//       message: 'Comisiones obtenidas correctamente',
//       error:   null,
//     });

//   } catch (error) {
//     console.error('[GET /api/comisiones]', error);
//     return res.status(500).json({
//       success: false,
//       data:    null,
//       message: 'Error al obtener las comisiones',
//       error:   error.message,
//     });
//   }
// });


// // ─────────────────────────────────────────────────────────────────────────────
// // GET /api/comisiones/mis-comisiones
// // Mismo formato pero solo filas donde el usuario es participante
// // ─────────────────────────────────────────────────────────────────────────────
// router.get('/mis-comisiones', authenticate, async (req, res) => {
//   const db     = req.app.locals.mongoClient.db(DB_NAME);
//   const userId = new ObjectId(req.user.id);

//   try {
//     const filas = await db
//       .collection('comisiones-participantes')
//       .aggregate([
//         // ── Solo filas del usuario autenticado ───────────────────────────────
//         { $match: { user: userId } },

//         // ── Datos de la ubicación ────────────────────────────────────────────
//         {
//           $lookup: {
//             from:         'comisiones-ubicaciones',
//             localField:   'comision_id',
//             foreignField: '_id',
//             as:           'ubicacion',
//           },
//         },
//         { $unwind: '$ubicacion' },

//         // ── Datos del participante (usuario) ─────────────────────────────────
//         {
//           $lookup: {
//             from:         'usuarios',
//             localField:   'user',
//             foreignField: '_id',
//             as:           'usuario',
//             pipeline: [
//               { $project: { name: 1, username: 1, picture: 1 } },
//             ],
//           },
//         },
//         { $unwind: '$usuario' },

//         // ── Estatus del participante ──────────────────────────────────────────
//         {
//           $lookup: {
//             from:         'estatus',
//             localField:   'status',
//             foreignField: '_id',
//             as:           'status',
//           },
//         },
//         { $unwind: { path: '$status', preserveNullAndEmptyArrays: true } },

//         // ── Aplanar ───────────────────────────────────────────────────────────
//         {
//           $project: {
//             _id:                 1,
//             comision_id:         1,
//             company:             '$ubicacion.company',
//             development:         '$ubicacion.development',
//             location:            '$ubicacion.location',
//             concept:             '$ubicacion.concept',
//             commission_type:     '$ubicacion.commission_type',
//             sale_price:          '$ubicacion.sale_price',
//             total_commission:    '$ubicacion.total_commission',
//             client_name:         '$ubicacion.client_name',
//             operation_date:      '$ubicacion.operation_date',
//             register_date:       '$ubicacion.register_date',
//             usuario:             1,
//             role_in_comision:    1,
//             percentage:          1,
//             commission_amount:   1,
//             adjusted_commission: 1,
//             verification:        1,
//             correction_comments: 1,
//             status:              1,
//             created_at:          1,
//             updated_at:          1,
//           },
//         },

//         { $sort: { created_at: -1 } },
//       ])
//       .toArray();

//     return res.status(200).json({
//       success: true,
//       data:    { filas, total: filas.length },
//       message: 'Mis comisiones obtenidas correctamente',
//       error:   null,
//     });

//   } catch (error) {
//     console.error('[GET /api/comisiones/mis-comisiones]', error);
//     return res.status(500).json({
//       success: false,
//       data:    null,
//       message: 'Error al obtener mis comisiones',
//       error:   error.message,
//     });
//   }
// });

// // ─────────────────────────────────────────────────────────────────────────────
// // PATCH /api/comisiones/participantes/:id
// // Actualiza el estatus de un participante
// // ─────────────────────────────────────────────────────────────────────────────
// router.patch('/participantes/:id', authenticate, async (req, res) => {
//   const db  = req.app.locals.mongoClient.db(DB_NAME);
//   const { id } = req.params;
//   const { statusOrder } = req.body;

//   // ── 1. Validaciones ─────────────────────────────────────────────────────────
//   if (!ObjectId.isValid(id)) {
//     return res.status(400).json({
//       success: false,
//       data:    null,
//       message: 'ID de participante no válido',
//       error:   null,
//     });
//   }

//   if (statusOrder === undefined || statusOrder === null) {
//     return res.status(400).json({
//       success: false,
//       data:    null,
//       message: 'El campo statusOrder es requerido',
//       error:   null,
//     });
//   }

//   try {
//     // ── 2. Resolver ObjectId del estatus desde su order ──────────────────────
//     const estatus = await db.collection('estatus').findOne({ order: Number(statusOrder) });

//     if (!estatus) {
//       return res.status(404).json({
//         success: false,
//         data:    null,
//         message: `No existe un estatus con order: ${statusOrder}`,
//         error:   null,
//       });
//     }

//     // ── 3. Verificar que el participante existe ───────────────────────────────
//     const participante = await db
//       .collection('comisiones-participantes')
//       .findOne({ _id: new ObjectId(id) });

//     if (!participante) {
//       return res.status(404).json({
//         success: false,
//         data:    null,
//         message: 'Participante no encontrado',
//         error:   null,
//       });
//     }

//     // ── 4. Validar transición de estatus permitida ───────────────────────────
//     const statusActual = await db
//       .collection('estatus')
//       .findOne({ _id: participante.status });

//     const transicionesPermitidas = {
//       Director:       { desde: [1, 2], hacia: [2, 4] },  // Verifica y Aprueba
//       Administrador:  { desde: [5],    hacia: [6] },      // Marca pagada
//     };

//     const roleName = req.user.roleName;
//     const reglas   = transicionesPermitidas[roleName];

//     if (reglas) {
//       const desdeOk = reglas.desde.includes(statusActual?.order);
//       const haciaOk = reglas.hacia.includes(Number(statusOrder));

//       if (!desdeOk || !haciaOk) {
//         return res.status(403).json({
//           success: false,
//           data:    null,
//           message: `El rol ${roleName} no puede cambiar de "${statusActual?.name}" a "${estatus.name}"`,
//           error:   null,
//         });
//       }
//     }

//     // ── 5. Actualizar ─────────────────────────────────────────────────────────
//     await db.collection('comisiones-participantes').updateOne(
//       { _id: new ObjectId(id) },
//       {
//         $set: {
//           status:     estatus._id,
//           updated_at: new Date(),
//         },
//       }
//     );

//     // ── 6. Notificar al participante ──────────────────────────────────────────
//     await db.collection('notificaciones').insertOne({
//       usuario_id:  participante.user,
//       titulo:      `Comisión ${estatus.name}`,
//       descripcion: `Tu comisión ha sido actualizada al estatus: ${estatus.name}`,
//       fecha:       new Date(),
//     });

//     // ── 7. Respuesta ──────────────────────────────────────────────────────────
//     return res.status(200).json({
//       success: true,
//       data: {
//         participante_id: id,
//         status: {
//           _id:   estatus._id,
//           order: estatus.order,
//           name:  estatus.name,
//         },
//       },
//       message: `Estatus actualizado a "${estatus.name}"`,
//       error:   null,
//     });

//   } catch (error) {
//     console.error('[PATCH /api/comisiones/participantes/:id]', error);
//     return res.status(500).json({
//       success: false,
//       data:    null,
//       message: 'Error al actualizar el estatus',
//       error:   error.message,
//     });
//   }
// });


module.exports = router;