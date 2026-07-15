const express = require('express');
const router  = express.Router();
const { authenticate } = require('../JWT/authCookies');
const { ObjectId } = require('mongodb');

const DB_NAME = 'roles_usuarios';

// Helper for date filtering
const getDateFilter = (range, startDate, endDate) => {
  const now = new Date();
  if (range === 'mensual') {
    return {
      $gte: new Date(now.getFullYear(), now.getMonth(), 1),
      $lte: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
    };
  } else if (range === 'personalizado' && startDate && endDate) {
    return {
      $gte: new Date(startDate),
      $lte: new Date(new Date(endDate).setHours(23, 59, 59))
    };
  }
  // historical (no filter)
  return null;
};

router.get('/dashboard', authenticate, async (req, res) => {
  const db = req.app.locals.mongoClient.db(DB_NAME);
  const user = req.user; // Set by authentication middleware
  
  if (!['Gerente', 'Director', 'Administrador'].includes(user.roleName)) {
    return res.status(403).json({ success: false, message: 'Acceso denegado' });
  }

  const { range, startDate, endDate } = req.query;
  const dateFilter = getDateFilter(range, startDate, endDate);

  try {
    // 1. Get valid locations based on date
    const ubicacionesMatch = {};
    if (dateFilter) {
      ubicacionesMatch.register_date = dateFilter;
    }

    // Determine the managers the user can see.
    // Directors/Admins see all managers and asesores.
    // Gerentes see themselves and their asesores.
    let allowedUsers = null;
    let allowedManagers = null;
    let allowedAsesores = null;

    if (user.roleName === 'Gerente') {
      const myAsesores = await db.collection('usuarios').find({ manager_ids: new ObjectId(user.id) }).toArray();
      const myAsesoresIds = myAsesores.map(a => a._id);
      
      allowedManagers = [new ObjectId(user.id)];
      allowedAsesores = myAsesoresIds;
      allowedUsers = [...allowedManagers, ...allowedAsesores];
    }

    // Common Pipeline for Participants
    const getParticipantsPipeline = (roleInComision, extraMatch = {}) => {
      const pipeline = [
        {
          $lookup: {
            from: 'comisiones-ubicaciones',
            localField: 'comision_id',
            foreignField: '_id',
            as: 'ubicacion'
          }
        },
        { $unwind: '$ubicacion' },
        {
          $match: {
            role_in_comision: roleInComision,
            ...(dateFilter ? { 'ubicacion.register_date': dateFilter } : {}),
            ...extraMatch
          }
        },
        {
          $lookup: {
            from: 'usuarios',
            localField: 'user',
            foreignField: '_id',
            as: 'usuario'
          }
        },
        { $unwind: '$usuario' },
        {
          $group: {
            _id: '$user',
            name: { $first: '$usuario.name' },
            volume: { $sum: '$ubicacion.sale_price' },
            count: { 
              $sum: {
                $cond: [
                  { $or: [ { $eq: ['$ubicacion.concept.id', '2'] }, { $eq: ['$ubicacion.concept.id', 2] } ] },
                  1, 
                  0
                ]
              } 
            },
            commission: { $sum: '$commission_amount' }
          }
        },
        { $sort: { volume: -1 } }
      ];
      return pipeline;
    };

    // TOP GERENTES (Admin/Director only, or just themselves if Gerente)
    let topGerentes = [];
    if (user.roleName === 'Administrador' || user.roleName === 'Director') {
      topGerentes = await db.collection('comisiones-participantes').aggregate(getParticipantsPipeline('gerente')).toArray();
    } else if (user.roleName === 'Gerente') {
      topGerentes = await db.collection('comisiones-participantes').aggregate(getParticipantsPipeline('gerente', { user: new ObjectId(user.id) })).toArray();
    }

    // TOP ASESORES (Admin/Director see all, Gerente sees their own)
    let asesorMatch = {};
    if (allowedAsesores) {
      asesorMatch = { user: { $in: allowedAsesores } };
    }
    const topAsesores = await db.collection('comisiones-participantes').aggregate(getParticipantsPipeline('asesor', asesorMatch)).toArray();

    // GENERAL STATS (Total volume, total commissions for the allowed users)
    let statsMatch = {};
    if (allowedUsers) {
      statsMatch = { user: { $in: allowedUsers } };
    }

    const generalStatsPipeline = [
      {
        $lookup: {
          from: 'comisiones-ubicaciones',
          localField: 'comision_id',
          foreignField: '_id',
          as: 'ubicacion'
        }
      },
      { $unwind: '$ubicacion' },
      {
        $match: {
          ...(dateFilter ? { 'ubicacion.register_date': dateFilter } : {}),
          ...statsMatch
        }
      },
      {
        $group: {
          _id: null,
          totalVolume: { $sum: '$ubicacion.sale_price' },
          totalCommissions: { $sum: '$commission_amount' },
          totalSalesSet: {
            $addToSet: {
              $cond: [
                { $or: [ { $eq: ['$ubicacion.concept.id', '2'] }, { $eq: ['$ubicacion.concept.id', 2] } ] },
                '$comision_id', 
                null
              ]
            }
          }
        }
      }
    ];

    const statsResult = await db.collection('comisiones-participantes').aggregate(generalStatsPipeline).toArray();
    
    let totalSalesCount = 0;
    if (statsResult.length > 0 && statsResult[0].totalSalesSet) {
      totalSalesCount = statsResult[0].totalSalesSet.filter(id => id !== null).length;
    }

    const stats = statsResult.length > 0 ? {
      totalVolume: statsResult[0].totalVolume,
      totalCommissions: statsResult[0].totalCommissions,
      totalSales: totalSalesCount
    } : { totalVolume: 0, totalCommissions: 0, totalSales: 0 };


    return res.status(200).json({
      success: true,
      data: {
        role: user.roleName,
        stats,
        topGerentes,
        topAsesores
      }
    });

  } catch (error) {
    console.error('[GET /api/kpis/dashboard]', error);
    return res.status(500).json({ success: false, message: 'Error fetching KPIs', error: error.message });
  }
});

module.exports = router;
