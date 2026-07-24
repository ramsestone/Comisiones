const sql = require('mssql');

async function syncEKData(pool, db) {
  if (!pool || !db) {
    throw new Error('Faltan conexiones de SQL o MongoDB para la sincronización.');
  }

  console.log('🔄 Iniciando sincronización de EK hacia MongoDB...');
  const startTime = Date.now();

  try {
    const promises = [
      (async () => {
        const res = await pool.request().query('SELECT Id as id, Nombre as nombre FROM Companias');
        await upsertToMongo(db, 'ek_companias', res.recordset);
        console.log(`✅ Compañías sincronizadas: ${res.recordset.length}`);
      })(),
      (async () => {
        const res = await pool.request().query('SELECT Id as id, Descripcion as nombre, IdCompania as compania FROM scv_Desarrollos');
        await upsertToMongo(db, 'ek_desarrollos', res.recordset);
        console.log(`✅ Desarrollos sincronizados: ${res.recordset.length}`);
      })(),
      (async () => {
        const res = await pool.request().query(`
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
        `);
        await upsertToMongo(db, 'ek_ubicaciones', res.recordset);
        console.log(`✅ Ubicaciones sincronizadas: ${res.recordset.length}`);
      })(),
      (async () => {
        const res = await pool.request().query("SELECT IdExpediente as id, CONCAT(IdExpediente, ' - ', [Cliente.Nombre]) as nombre, [Cliente.Nombre] as cliente_nombre FROM uvw_SCV_Ventas WHERE IdExpediente IS NOT NULL AND [Cliente.Nombre] IS NOT NULL");
        await upsertToMongo(db, 'ek_expedientes', res.recordset);
        console.log(`✅ Expedientes sincronizados: ${res.recordset.length}`);
      })()
    ];

    await Promise.all(promises);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`🎉 Sincronización en paralelo completada en ${duration}s.`);
    return { success: true, message: `Sincronización paralela exitosa en ${duration}s` };

  } catch (error) {
    console.error('❌ Error crítico en la sincronización de EK:', error.message);
    throw error;
  }
}

async function upsertToMongo(db, collectionName, data) {
  if (!data || data.length === 0) return;

  const bulkOps = data.map(doc => ({
    updateOne: {
      filter: { id: doc.id },
      update: { $set: doc },
      upsert: true
    }
  }));

  const collection = db.collection(collectionName);
  await collection.bulkWrite(bulkOps, { ordered: false });
}

module.exports = {
  syncEKData
};
