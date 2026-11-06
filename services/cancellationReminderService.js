const { ObjectId, Decimal128 } = require('mongodb');

const DB_NAME = 'roles_usuarios';

/**
 * Notifica periódicamente (cada 10 días) a los gerentes que tienen
 * cancelaciones con penalizaciones a miembros pendientes de saldar (status Pendiente Pago),
 * tanto de ellos como de sus asesores.
 */
async function checkAndNotifyCancellationReminders(mongoClient) {
  if (!mongoClient) return;
  const db = mongoClient.db(DB_NAME);
  const now = new Date();

  try {
    // 1. Obtener el estatus de Pendiente Pago (order: 5)
    const statusPendientePago = await db.collection('estatus').findOne({ order: 5 });
    if (!statusPendientePago) return;

    // 2. Buscar comisiones de cancelación activas en Pendiente Pago con penalización a miembros
    const cancelaciones = await db.collection('comisiones-ubicaciones').find({
      is_cancellation: true,
      penalty_target: 'miembros',
      status: statusPendientePago._id
    }).toArray();

    if (!cancelaciones.length) return;

    // 3. Deudas asociadas a estas cancelaciones que aún tengan saldo pendiente
    const comisionIds = cancelaciones.map(c => c._id);
    const debts = await db.collection('debts').find({
      comision_id: { $in: comisionIds },
      status: 'active'
    }).toArray();

    const debtsByComision = {};
    for (const d of debts) {
      const rem = parseFloat(d.remaining_balance?.toString() || 0);
      if (rem > 0) {
        const cKey = d.comision_id.toString();
        if (!debtsByComision[cKey]) debtsByComision[cKey] = [];
        debtsByComision[cKey].push(d);
      }
    }

    // 4. Mapear cada cancelación a los gerentes involucrados (creador o participantes con rol 'gerente')
    const managerNotifs = new Map(); // managerId -> { count, locs: [] }

    for (const c of cancelaciones) {
      const cKey = c._id.toString();
      const activeDebts = debtsByComision[cKey] || [];
      if (!activeDebts.length) continue; // Si no tiene deudas pendientes activas, omitir

      const locText = c.location?.text || 'Sin ubicación';

      // Buscar participantes con rol gerente o creador de la comisión
      const participantes = await db.collection('comisiones-participantes').find({ comision_id: c._id }).toArray();
      const gerenteUserIds = new Set();

      if (c.created_by) {
        gerenteUserIds.add(c.created_by.toString());
      }
      participantes.forEach(p => {
        if (p.role_in_comision === 'gerente' && p.user) {
          gerenteUserIds.add(p.user.toString());
        }
      });

      for (const mId of gerenteUserIds) {
        if (!managerNotifs.has(mId)) {
          managerNotifs.set(mId, { count: 0, locs: [] });
        }
        const data = managerNotifs.get(mId);
        data.count++;
        if (!data.locs.includes(locText)) data.locs.push(locText);
      }
    }

    // 5. Enviar notificaciones a cada gerente
    for (const [mIdStr, info] of managerNotifs.entries()) {
      let managerId;
      try { managerId = new ObjectId(mIdStr); } catch (e) { continue; }

      // Verificar que sea usuario con rol Gerente (o Administrador)
      const u = await db.collection('usuarios').findOne({ _id: managerId });
      if (!u) continue;

      const locList = info.locs.slice(0, 2).join(', ') + (info.locs.length > 2 ? ` y ${info.locs.length - 2} más` : '');
      const message = `🔔 Recordatorio de Descomisiones: Tienes ${info.count} comisión(es) por cancelación pendiente(s) de saldar (${locList}). Recuerda registrar o actualizar tu sugerencia de descuento.`;

      // Evitar duplicar el mismo recordatorio si ya se envió en las últimas 48 horas
      const recentNotif = await db.collection('notificaciones').findOne({
        user_id: managerId,
        message: { $regex: 'Recordatorio de Descomisiones', $options: 'i' },
        created_at: { $gte: new Date(now.getTime() - 48 * 60 * 60 * 1000) }
      });

      if (!recentNotif) {
        await db.collection('notificaciones').insertOne({
          user_id: managerId,
          message,
          link: '/comisiones',
          read: false,
          created_at: now
        });
      }
    }

  } catch (err) {
    console.error('[checkAndNotifyCancellationReminders] Error:', err);
  }
}

module.exports = {
  checkAndNotifyCancellationReminders
};

