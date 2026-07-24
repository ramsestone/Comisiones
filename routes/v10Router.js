const sql = require('mssql');
require('dotenv').config();

const express = require('express');
const router = express.Router();

// Config conexión
const port = parseInt(process.env.EK_PORT, 10);
const { syncEKData } = require('../services/ekSyncService');

async function queryWithFallback(sqlQuery, mongoCollection, timeoutMs, req) {
  return new Promise(async (resolve, reject) => {
    let timer = setTimeout(() => {
      reject(new Error('SQL Timeout'));
    }, timeoutMs);

    try {
      if (!pool) throw new Error('SQL Pool no conectado');
      const result = await pool.request().query(sqlQuery);
      clearTimeout(timer);
      resolve(result.recordset);
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  }).catch(async (err) => {
    console.error(`[Fallback] SQL Falló para ${mongoCollection}: ${err.message}. Usando caché local.`);
    const db = req.app.locals.mongoClient.db('Commission-Management');
    const cachedData = await db.collection(mongoCollection).find({}).toArray();
    return cachedData.map(doc => {
      const { _id, ...rest } = doc;
      return rest;
    });
  });
}

const config = {
  user: process.env.EK_USER,
  password: process.env.EK_PASS,
  server: process.env.EK_SERVER,
  database: process.env.EK_DATABASE,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    connectTimeout: 60000 // Aumentado a 60 segundos por inestabilidad de VPN
  },
  connectionTimeout: 60000,
  requestTimeout: 60000,
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  },
  port: port
};

let pool;

// Crear pool UNA sola vez
async function connectDB() {
  try {
    pool = await sql.connect(config);
    console.log('V10 SQL conectado');
  } catch (err) {
    console.error('V10 Error DB:', err.message);
    console.log('Reintentando conexión a SQL en 30 segundos...');
    setTimeout(connectDB, 30000); // Reintentar en caso de fallo por VPN
  }
}

connectDB();


// ---------- ENDPOINTS ----------

// Probar conexión
router.get('/version', async (req, res) => {
  try {
    const result = await pool.request().query('SELECT @@VERSION AS version');
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sincronización manual de EK a Mongo
router.post('/sync', async (req, res) => {
  try {
    const db = req.app.locals.mongoClient.db('Commission-Management');
    const result = await syncEKData(pool, db);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error en sincronización manual', error: err.message });
  }
});

router.get('/companias', async (req, res) => {
  try {
    const recordset = await queryWithFallback('SELECT Id as id, Nombre as nombre FROM Companias', 'ek_companias', 15000, req);

    res.status(200).json({
      success: true,
      message: "Compañías obtenidas correctamente",
      data: {
        companias: recordset
      }
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Error al obtener las compañías",
      data: null,
      error: err.message
    });
  }
});

// Consulta genérica
router.get('/desarrollos', async (req, res) => {
  try {
    const recordset = await queryWithFallback('SELECT Id as id, Descripcion as nombre, IdCompania as compania FROM scv_Desarrollos', 'ek_desarrollos', 15000, req);

    res.status(200).json({
      success: true,
      message: "Desarrollos obtenidos correctamente",
      data: {
        desarrollos: recordset
      }
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Error al obtener los desarrollos",
      data: null,
      error: err.message
    });
  }
});



router.get('/ubicaciones', async (req, res) => {

  try {
    const query = `
      SELECT ubi.Nombre as nombre, ubi.IdDesarrollo as desarrollo, ubi.Id as id, vta.importe as importe_venta, vta.[EstatusVenta.Nombre] as estatus_venta 
      FROM scv_ubicaciones ubi 
      INNER JOIN scv_Ventas_Ubicaciones vta_ubi ON ubi.Id = vta_ubi.IdUbicacion 
      INNER JOIN uvw_SCV_Ventas vta ON vta_ubi.IdVenta = vta.ID 
      WHERE vta.[Estatus.Nombre] = 'Activo'
      UNION ALL
      SELECT ubi.Nombre as nombre, ubi.IdDesarrollo as desarrollo, ubi.Id as id, TRY_CAST(REPLACE(monto.Valor, ',', '') AS DECIMAL(18,2)) as importe_venta, vta.[EstatusVenta.Nombre] as estatus_venta 
      FROM scv_ubicaciones ubi 
      INNER JOIN PersonalizarCampos_Valores pcv_nombre ON pcv_nombre.Valor = ubi.Nombre 
      OUTER APPLY (
        SELECT TOP 1 pcv_monto.Valor
        FROM PersonalizarCampos_Valores pcv_monto
        WHERE pcv_monto.IdRegistro = pcv_nombre.IdRegistro 
          AND pcv_monto.IdCampoOpcion > pcv_nombre.IdCampoOpcion
          AND TRY_CAST(REPLACE(pcv_monto.Valor, ',', '') AS DECIMAL(18,2)) IS NOT NULL
          AND pcv_monto.Valor NOT LIKE '%{%'
        ORDER BY pcv_monto.IdCampoOpcion ASC
      ) monto
      INNER JOIN uvw_SCV_Ventas vta ON vta.IdExpediente = pcv_nombre.IdRegistro 
      WHERE vta.[Estatus.Nombre] = 'Activo' 
        AND (pcv_nombre.Valor LIKE 'BOG-%' OR pcv_nombre.Valor LIKE 'BOD-%' OR pcv_nombre.Valor LIKE 'BODEGA-%' OR pcv_nombre.Valor LIKE 'ME-%' OR pcv_nombre.Valor LIKE 'GR-%' OR pcv_nombre.Valor LIKE 'CH-%' OR pcv_nombre.Valor LIKE 'M-%')
    `;
    const recordset = await queryWithFallback(query, 'ek_ubicaciones', 30000, req);

    res.status(200).json({
      success: true,
      message: "Ubicaciones obtenidas correctamente",
      data: {
        ubicaciones: recordset
      }
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Error al obtener las ubicaciones",
      data: null,
      error: err.message
    });
  }
});
router.get('/expedientes', async (req, res) => {
  try {
    const recordset = await queryWithFallback("SELECT IdExpediente as id, CONCAT(IdExpediente, ' - ', [Cliente.Nombre]) as nombre, [Cliente.Nombre] as cliente_nombre FROM uvw_SCV_Ventas WHERE IdExpediente IS NOT NULL AND [Cliente.Nombre] IS NOT NULL", 'ek_expedientes', 30000, req);

    res.status(200).json({
      success: true,
      message: "Expedientes obtenidos correctamente",
      data: {
        expedientes: recordset
      }
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Error al obtener los expedientes",
      data: null,
      error: err.message
    });
  }
});

module.exports = router;
module.exports.getPool = () => pool;
