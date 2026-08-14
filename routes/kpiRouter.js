const express = require('express');
const router  = express.Router();
const { authenticate } = require('../JWT/authCookies');
const { ObjectId } = require('mongodb');

const DB_NAME = 'roles_usuarios';

// Helper for date filtering (sin despasamiento por zona horaria UTC)
const getDateFilter = (range, startDate, endDate) => {
  const now = new Date();
  if (range === 'mensual') {
    return {
      $gte: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
      $lte: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
    };
  } else if (range === 'personalizado' && startDate && endDate) {
    const s = startDate.split('-').map(Number);
    const e = endDate.split('-').map(Number);
    return {
      $gte: new Date(s[0], s[1] - 1, s[2], 0, 0, 0, 0),
      $lte: new Date(e[0], e[1] - 1, e[2], 23, 59, 59, 999)
    };
  }
  // historical (no filter)
  return null;
};

// Condición unificada para identificar cancelaciones
const isCancelCond = {
  $or: [
    { $eq: ['$ubicacion.concept.id', '3'] },
    { $eq: ['$ubicacion.concept.id', 3] },
    { $eq: ['$ubicacion.is_cancellation', true] },
    { $eq: ['$ubicacion.is_cancellation', 1] }
  ]
};

const isSaleCond = {
  $or: [
    { $eq: ['$ubicacion.concept.id', '2'] },
    { $eq: ['$ubicacion.concept.id', 2] }
  ]
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
          $lookup: {
            from: 'estatus',
            localField: 'ubicacion.status',
            foreignField: '_id',
            as: 'statusObj'
          }
        },
        { $unwind: { path: '$statusObj', preserveNullAndEmptyArrays: true } },
        {
          $match: {
            role_in_comision: roleInComision,
            'statusObj.order': { $ne: 5 }, // Excluir Rechazadas
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
          $lookup: {
            from: 'comisiones-ubicaciones',
            let: { locId: '$ubicacion.location.id', myId: '$ubicacion._id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$location.id', '$$locId'] },
                      { $ne: ['$_id', '$$myId'] },
                      { $not: { $or: [ { $eq: ['$concept.id', 3] }, { $eq: ['$concept.id', '3'] }, { $eq: ['$is_cancellation', true] } ] } }
                    ]
                  }
                }
              },
              { $limit: 1 }
            ],
            as: 'related_positive'
          }
        },
        {
          $group: {
            _id: '$user',
            name: { $first: '$usuario.name' },
            volume: { 
              $sum: {
                $cond: [
                  isCancelCond,
                  {
                    $cond: [
                      { $gt: [{ $size: '$related_positive' }, 0] },
                      { $multiply: ['$ubicacion.sale_price', -1] },
                      0
                    ]
                  },
                  '$ubicacion.sale_price'
                ]
              } 
            },
            count: { 
              $sum: {
                $cond: [
                  isSaleCond,
                  1, 
                  0
                ]
              } 
            },
            commission: { 
              $sum: {
                $cond: [
                  isCancelCond,
                  {
                    $cond: [
                      { $gt: [{ $size: '$related_positive' }, 0] },
                      '$commission_amount',
                      0
                    ]
                  },
                  '$commission_amount'
                ]
              }
            },
            cancelledVolume: {
              $sum: {
                $cond: [
                  isCancelCond,
                  '$ubicacion.sale_price',
                  0
                ]
              }
            }
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

    // GENERAL STATS (Total volume, total commissions for the allowed users or all registered locations)
    const generalStatsPipeline = [
      {
        $lookup: {
          from: 'estatus',
          localField: 'status',
          foreignField: '_id',
          as: 'statusObj'
        }
      },
      { $unwind: { path: '$statusObj', preserveNullAndEmptyArrays: true } },
      {
        $match: {
          'statusObj.order': { $ne: 5 }, // Excluir Rechazadas
          ...(dateFilter ? { register_date: dateFilter } : {})
        }
      },
      ...(allowedUsers ? [
        {
          $lookup: {
            from: 'comisiones-participantes',
            localField: '_id',
            foreignField: 'comision_id',
            as: 'part_check'
          }
        },
        {
          $match: {
            'part_check.user': { $in: allowedUsers }
          }
        }
      ] : []),
      {
        $lookup: {
          from: 'comisiones-participantes',
          localField: '_id',
          foreignField: 'comision_id',
          as: 'participantes'
        }
      },
      {
        $lookup: {
          from: 'comisiones-ubicaciones',
          let: { locId: '$location.id', myId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$location.id', '$$locId'] },
                    { $ne: ['$_id', '$$myId'] },
                    { $not: { $or: [ { $eq: ['$concept.id', 3] }, { $eq: ['$concept.id', '3'] }, { $eq: ['$is_cancellation', true] } ] } }
                  ]
                }
              }
            },
            { $limit: 1 }
          ],
          as: 'related_positive'
        }
      },
      {
        $project: {
          sale_price: 1,
          conceptId: '$concept.id',
          isCancellation: '$is_cancellation',
          commissionSum: { $sum: '$participantes.commission_amount' },
          related_positive: 1
        }
      },
      {
        $group: {
          _id: null,
          totalVolume: { 
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ['$conceptId', '3'] },
                    { $eq: ['$conceptId', 3] },
                    { $eq: ['$isCancellation', true] },
                    { $eq: ['$isCancellation', 1] }
                  ]
                },
                {
                  $cond: [
                    { $gt: [{ $size: '$related_positive' }, 0] },
                    { $multiply: ['$sale_price', -1] },
                    0
                  ]
                },
                '$sale_price'
              ]
            } 
          },
          totalCommissions: { $sum: '$commissionSum' },
          totalSalesSet: {
            $addToSet: {
              $cond: [
                { $or: [ { $eq: ['$conceptId', '2'] }, { $eq: ['$conceptId', 2] } ] },
                '$_id', 
                null
              ]
            }
          },
          totalCancelacionesSet: {
            $addToSet: {
              $cond: [
                {
                  $or: [
                    { $eq: ['$conceptId', '3'] },
                    { $eq: ['$conceptId', 3] },
                    { $eq: ['$isCancellation', true] },
                    { $eq: ['$isCancellation', 1] }
                  ]
                },
                '$_id', 
                null
              ]
            }
          }
        }
      }
    ];

    // BY DEVELOPMENT PIPELINE (Querying directly from comisiones-ubicaciones)
    const developmentPipeline = [
      {
        $lookup: {
          from: 'estatus',
          localField: 'status',
          foreignField: '_id',
          as: 'statusObj'
        }
      },
      { $unwind: { path: '$statusObj', preserveNullAndEmptyArrays: true } },
      {
        $match: {
          'statusObj.order': { $ne: 5 }, // Excluir Rechazadas
          ...(dateFilter ? { register_date: dateFilter } : {})
        }
      },
      ...(allowedUsers ? [
        {
          $lookup: {
            from: 'comisiones-participantes',
            localField: '_id',
            foreignField: 'comision_id',
            as: 'part_check'
          }
        },
        {
          $match: {
            'part_check.user': { $in: allowedUsers }
          }
        }
      ] : []),
      {
        $lookup: {
          from: 'comisiones-participantes',
          localField: '_id',
          foreignField: 'comision_id',
          as: 'participantes'
        }
      },
      {
        $lookup: {
          from: 'comisiones-ubicaciones',
          let: { locId: '$location.id', myId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$location.id', '$$locId'] },
                    { $ne: ['$_id', '$$myId'] },
                    { $not: { $or: [ { $eq: ['$concept.id', 3] }, { $eq: ['$concept.id', '3'] }, { $eq: ['$is_cancellation', true] } ] } }
                  ]
                }
              }
            },
            { $limit: 1 }
          ],
          as: 'related_positive'
        }
      },
      {
        $project: {
          devName: { $ifNull: ['$development.text', { $ifNull: ['$development', 'Sin Desarrollo'] }] },
          sale_price: '$sale_price',
          conceptId: '$concept.id',
          isCancellation: '$is_cancellation',
          commissionSum: { $sum: '$participantes.commission_amount' },
          related_positive: '$related_positive'
        }
      },
      {
        $group: {
          _id: '$devName',
          name: { $first: '$devName' },
          totalRegistered: { $sum: 1 },
          count: {
            $sum: {
              $cond: [
                { $or: [ { $eq: ['$conceptId', '2'] }, { $eq: ['$conceptId', 2] } ] },
                1,
                0
              ]
            }
          },
          volume: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ['$conceptId', '3'] },
                    { $eq: ['$conceptId', 3] },
                    { $eq: ['$isCancellation', true] },
                    { $eq: ['$isCancellation', 1] }
                  ]
                },
                {
                  $cond: [
                    { $gt: [{ $size: '$related_positive' }, 0] },
                    { $multiply: ['$sale_price', -1] },
                    0
                  ]
                },
                '$sale_price'
              ]
            }
          },
          commission: { $sum: '$commissionSum' },
          cancelledVolume: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ['$conceptId', '3'] },
                    { $eq: ['$conceptId', 3] },
                    { $eq: ['$isCancellation', true] },
                    { $eq: ['$isCancellation', 1] }
                  ]
                },
                '$sale_price',
                0
              ]
            }
          }
        }
      },
      { $sort: { count: -1, volume: -1 } }
    ];

    // MONTHLY TREND PIPELINE
    const monthlyTrendPipeline = [
      {
        $lookup: {
          from: 'estatus',
          localField: 'status',
          foreignField: '_id',
          as: 'statusObj'
        }
      },
      { $unwind: { path: '$statusObj', preserveNullAndEmptyArrays: true } },
      {
        $match: {
          'statusObj.order': { $ne: 5 }, // Excluir Rechazadas
          ...(dateFilter ? { register_date: dateFilter } : {})
        }
      },
      ...(allowedUsers ? [
        {
          $lookup: {
            from: 'comisiones-participantes',
            localField: '_id',
            foreignField: 'comision_id',
            as: 'part_check'
          }
        },
        {
          $match: {
            'part_check.user': { $in: allowedUsers }
          }
        }
      ] : []),
      {
        $lookup: {
          from: 'comisiones-participantes',
          localField: '_id',
          foreignField: 'comision_id',
          as: 'participantes'
        }
      },
      {
        $project: {
          year: { $year: '$register_date' },
          month: { $month: '$register_date' },
          sale_price: 1,
          commissionSum: { $sum: '$participantes.commission_amount' },
          isCancellation: '$is_cancellation',
          conceptId: '$concept.id'
        }
      },
      {
        $group: {
          _id: { year: '$year', month: '$month' },
          volume: {
            $sum: {
              $cond: [
                { $or: [ { $eq: ['$conceptId', '3'] }, { $eq: ['$conceptId', 3] }, { $eq: ['$isCancellation', true] } ] },
                0,
                '$sale_price'
              ]
            }
          },
          commission: { $sum: '$commissionSum' },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ];

    // CONCEPT DISTRIBUTION PIPELINE
    const conceptDistributionPipeline = [
      {
        $lookup: {
          from: 'estatus',
          localField: 'status',
          foreignField: '_id',
          as: 'statusObj'
        }
      },
      { $unwind: { path: '$statusObj', preserveNullAndEmptyArrays: true } },
      {
        $match: {
          'statusObj.order': { $ne: 5 },
          ...(dateFilter ? { register_date: dateFilter } : {})
        }
      },
      ...(allowedUsers ? [
        {
          $lookup: {
            from: 'comisiones-participantes',
            localField: '_id',
            foreignField: 'comision_id',
            as: 'part_check'
          }
        },
        {
          $match: {
            'part_check.user': { $in: allowedUsers }
          }
        }
      ] : []),
      {
        $group: {
          _id: { $ifNull: ['$concept.text', '$concept'] },
          label: { $first: { $ifNull: ['$concept.text', '$concept'] } },
          count: { $sum: 1 },
          volume: { $sum: '$sale_price' }
        }
      },
      { $sort: { count: -1 } }
    ];

    const [statsResult, byDevelopment, monthlyTrend, conceptDistribution] = await Promise.all([
      db.collection('comisiones-ubicaciones').aggregate(generalStatsPipeline).toArray(),
      db.collection('comisiones-ubicaciones').aggregate(developmentPipeline).toArray(),
      db.collection('comisiones-ubicaciones').aggregate(monthlyTrendPipeline).toArray(),
      db.collection('comisiones-ubicaciones').aggregate(conceptDistributionPipeline).toArray()
    ]);

    // Cross reference ek_ubicaciones and ek_desarrollos to populate totalUnits, v10Sold and absorption %
    try {
      const dbEK = req.app.locals.mongoClient ? req.app.locals.mongoClient.db('Commission-Management') : db;
      const ekDesarrollos = await dbEK.collection('ek_desarrollos').find({}).toArray();
      const ekUbicaciones = await dbEK.collection('ek_ubicaciones').find({}).toArray();
      
      const devTotalMap = {};
      const devSoldV10Map = {};
      ekDesarrollos.forEach(d => {
        const totalCount = ekUbicaciones.filter(u => String(u.desarrollo) === String(d.id)).length;
        const soldV10Count = ekUbicaciones.filter(u => String(u.desarrollo) === String(d.id) && u.estatus_venta === 'COMPLETADO').length;
        if (d.id !== undefined && d.id !== null) {
          devTotalMap[String(d.id)] = totalCount;
          devSoldV10Map[String(d.id)] = soldV10Count;
        }
        if (d.nombre) {
          devTotalMap[d.nombre.toUpperCase().trim()] = totalCount;
          devSoldV10Map[d.nombre.toUpperCase().trim()] = soldV10Count;
        }
      });

      byDevelopment.forEach(item => {
        const keyName = (item.name || '').toUpperCase().trim();
        const ekTotal = devTotalMap[keyName];
        const ekSold = devSoldV10Map[keyName];
        item.totalUnits = (ekTotal !== undefined && ekTotal > 0) ? ekTotal : (item.totalRegistered || item.count || 0);
        item.v10Sold = (ekSold !== undefined) ? ekSold : 0;
        item.absorption = item.totalUnits > 0 ? Number(((item.v10Sold / item.totalUnits) * 100).toFixed(1)) : 0;
      });
    } catch (e) {
      console.warn('[KPIs] Could not match ek_ubicaciones totals:', e.message);
      byDevelopment.forEach(item => {
        item.totalUnits = item.totalRegistered || item.count || 0;
        item.v10Sold = 0;
        item.absorption = item.totalUnits > 0 ? Number(((item.count / item.totalUnits) * 100).toFixed(1)) : 0;
      });
    }
    
    let totalSalesCount = 0;
    let totalCancelacionesCount = 0;
    if (statsResult.length > 0) {
      if (statsResult[0].totalSalesSet) {
        totalSalesCount = statsResult[0].totalSalesSet.filter(id => id !== null).length;
      }
      if (statsResult[0].totalCancelacionesSet) {
        totalCancelacionesCount = statsResult[0].totalCancelacionesSet.filter(id => id !== null).length;
      }
    }

    const totalDesarrollos = byDevelopment.filter(d => d.count > 0 || d.volume > 0).length;
    const totVolume = statsResult.length > 0 ? statsResult[0].totalVolume : 0;
    const totCommissions = statsResult.length > 0 ? statsResult[0].totalCommissions : 0;

    const ticketPromedio = totalSalesCount > 0 ? Number((totVolume / totalSalesCount).toFixed(2)) : 0;
    const tasaCancelacion = (totalSalesCount + totalCancelacionesCount) > 0 ? Number(((totalCancelacionesCount / (totalSalesCount + totalCancelacionesCount)) * 100).toFixed(1)) : 0;
    const comisionPromedio = totalSalesCount > 0 ? Number((totCommissions / totalSalesCount).toFixed(2)) : 0;

    const stats = {
      totalVolume: totVolume,
      totalCommissions: totCommissions,
      totalSales: totalSalesCount,
      totalCancelaciones: totalCancelacionesCount,
      totalDesarrollos: totalDesarrollos,
      ticketPromedio,
      tasaCancelacion,
      comisionPromedio
    };

    return res.status(200).json({
      success: true,
      data: {
        role: user.roleName,
        stats,
        topGerentes,
        topAsesores,
        byDevelopment,
        monthlyTrend,
        conceptDistribution
      }
    });

  } catch (error) {
    console.error('[GET /api/kpis/dashboard]', error);
    return res.status(500).json({ success: false, message: 'Error fetching KPIs', error: error.message });
  }
});

module.exports = router;
