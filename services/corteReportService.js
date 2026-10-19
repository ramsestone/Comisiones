const { ObjectId } = require('mongodb');

/**
 * Formats numbers as currency ($1,234,567.89)
 */
function formatCurrency(amount) {
  if (amount === undefined || amount === null || isNaN(amount)) return '$0.00';
  const val = Number(amount);
  return (val < 0 ? '-$' : '$') + Math.abs(val).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Formats date as Mexican Spanish readable string
 */
function formatSpanishDate(date) {
  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  const d = new Date(date);
  return `${d.getUTCDate()} de ${months[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

/**
 * Get Spanish day of the week
 */
function getSpanishDayName(date) {
  const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const d = new Date(date);
  return days[d.getUTCDay()];
}

/**
 * Formats cut period cleanly like:
 * "28 y 29 de Septiembre de 2026" / "(Lunes y Martes)"
 */
function formatCutPeriod(startDateStr, endDateStr) {
  const sParts = startDateStr.split('-').map(Number);
  const eParts = endDateStr.split('-').map(Number);

  const sDate = new Date(Date.UTC(sParts[0], sParts[1] - 1, sParts[2]));
  const eDate = new Date(Date.UTC(eParts[0], eParts[1] - 1, eParts[2]));

  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  let periodoTexto = '';
  let diasTexto = '';

  const sDay = sDate.getUTCDate();
  const eDay = eDate.getUTCDate();
  const sMonth = sDate.getUTCMonth();
  const eMonth = eDate.getUTCMonth();
  const sYear = sDate.getUTCFullYear();
  const eYear = eDate.getUTCFullYear();

  const sDayName = getSpanishDayName(sDate);
  const eDayName = getSpanishDayName(eDate);

  if (startDateStr === endDateStr) {
    periodoTexto = `${sDay} de ${months[sMonth]} de ${sYear}`;
    diasTexto = `(${sDayName})`;
  } else if (sMonth === eMonth && sYear === eYear) {
    if (eDay === sDay + 1) {
      periodoTexto = `${sDay} y ${eDay} de ${months[sMonth]} de ${sYear}`;
      diasTexto = `(${sDayName} y ${eDayName})`;
    } else {
      periodoTexto = `${sDay} al ${eDay} de ${months[sMonth]} de ${sYear}`;
      diasTexto = `(${sDayName} a ${eDayName})`;
    }
  } else if (sYear === eYear) {
    periodoTexto = `${sDay} de ${months[sMonth]} al ${eDay} de ${months[eMonth]} de ${sYear}`;
    diasTexto = `(${sDayName} a ${eDayName})`;
  } else {
    periodoTexto = `${sDay} de ${months[sMonth]} de ${sYear} al ${eDay} de ${months[eMonth]} de ${eYear}`;
    diasTexto = `(${sDayName} a ${eDayName})`;
  }

  return { periodoTexto, diasTexto };
}

/**
 * Retrieves and computes all data for Corte Report
 */
async function getReporteCorteData(db, startDateStr, endDateStr) {
  const sParts = startDateStr.split('-').map(Number);
  const eParts = endDateStr.split('-').map(Number);

  // UTC boundaries covering the whole days
  const dStart = new Date(Date.UTC(sParts[0], sParts[1] - 1, sParts[2], 0, 0, 0, 0));
  const dEnd = new Date(Date.UTC(eParts[0], eParts[1] - 1, eParts[2], 23, 59, 59, 999));

  // 1. Transaction records in walletTransactions (credits for approved commissions or payments)
  const walletComisionIds = await db.collection('walletTransactions').distinct('comision_id', {
    created_at: { $gte: dStart, $lte: dEnd }
  });

  // 2. Cancellation penalty debts
  const debtComisionIds = await db.collection('debts').distinct('comision_id', {
    created_at: { $gte: dStart, $lte: dEnd }
  });

  // 3. Status updated_at in range (for commissions in Pendiente Pago / Pagada)
  const ubiUpdated = await db.collection('comisiones-ubicaciones').find({
    updated_at: { $gte: dStart, $lte: dEnd },
    status: {
      $in: [
        new ObjectId('6a1896a7af04e9763c7526c6'), // Pendiente Pago
        new ObjectId('6a1896a7af04e9763c7526c7')  // Pagada
      ]
    }
  }).toArray();

  const idSet = new Set([
    ...walletComisionIds.map(id => id?.toString()),
    ...debtComisionIds.map(id => id?.toString()),
    ...ubiUpdated.map(u => u._id.toString())
  ]);

  // Exclude legacy/test items outside corte
  idSet.delete('6aa89ef91858cee60474d293');
  idSet.delete('6aa89f671858cee60474d29a');

  const comisionObjectIds = [...idSet].filter(Boolean).map(id => new ObjectId(id));
  const rawComisiones = await db.collection('comisiones-ubicaciones').find({
    _id: { $in: comisionObjectIds }
  }).toArray();

  // If no comisiones matched via transactions/updated_at, fallback to register_date for safety
  let comisiones = rawComisiones;
  if (comisiones.length === 0) {
    comisiones = await db.collection('comisiones-ubicaciones').find({
      register_date: { $gte: dStart, $lte: dEnd }
    }).toArray();
  }

  // --- 1. RESUMEN MACRO ---
  const totalComisiones = comisiones.length;
  const uniqueLocationsSet = new Set();
  let valorTotalVentas = 0;
  let totalComisionado = 0;

  comisiones.forEach(c => {
    const locName = c.location?.text || c.location || '';
    if (locName) uniqueLocationsSet.add(locName.trim());
    valorTotalVentas += Number(c.sale_price) || 0;
    totalComisionado += Number(c.total_commission) || 0;
  });

  const ubicacionesUnicas = uniqueLocationsSet.size;

  // --- 2. DISTRIBUCIÓN POR CONCEPTO DE OPERACIÓN ---
  const conceptDescriptions = {
    'Escritura': 'Comisiones por escrituración de inmueble',
    'Contrato': 'Comisiones por firma de contrato compraventa',
    'Bono': 'Bonos de productividad y cumplimiento',
    'Cancelación': 'Penalización por cancelación (Descomisión)'
  };

  const conceptImpact = {
    'Escritura': 'Pendiente Pago / Aprobado',
    'Contrato': 'Pendiente Pago / Aprobado',
    'Bono': 'Pendiente Pago / Aprobado',
    'Cancelación': 'Ajuste / Descuento Wallet'
  };

  const conceptMap = {};
  comisiones.forEach(c => {
    let cName = c.concept?.text || 'Otro';
    if (c.is_cancellation) cName = 'Cancelación';
    if (!conceptMap[cName]) {
      conceptMap[cName] = {
        concepto: cName,
        descripcion: conceptDescriptions[cName] || `Comisiones por concepto ${cName}`,
        cantidad: 0,
        volumenPct: 0,
        estatusImpacto: conceptImpact[cName] || 'Pendiente Pago / Aprobado'
      };
    }
    conceptMap[cName].cantidad += 1;
  });

  // Expected fixed order: Escritura, Contrato, Bono, Cancelación
  const preferredConceptOrder = ['Escritura', 'Contrato', 'Bono', 'Cancelación'];
  const distribucionConcepto = [];

  preferredConceptOrder.forEach(key => {
    if (conceptMap[key]) {
      const row = conceptMap[key];
      row.volumenPct = totalComisiones > 0 ? ((row.cantidad / totalComisiones) * 100).toFixed(1) : '0.0';
      distribucionConcepto.push(row);
      delete conceptMap[key];
    }
  });

  // Any other concept
  Object.values(conceptMap).forEach(row => {
    row.volumenPct = totalComisiones > 0 ? ((row.cantidad / totalComisiones) * 100).toFixed(1) : '0.0';
    distribucionConcepto.push(row);
  });

  // --- 3. IMPORTE COMISIONADO POR EMPRESA ---
  const companyMap = {};
  comisiones.forEach(c => {
    const compName = c.company?.text || 'Sin Empresa';
    if (!companyMap[compName]) {
      companyMap[compName] = {
        empresa: compName,
        operaciones: 0,
        operacionesPct: '0.0',
        importe: 0,
        importeFormateado: '$0.00',
        importePct: '0.0'
      };
    }
    companyMap[compName].operaciones += 1;
    companyMap[compName].importe += Number(c.total_commission) || 0;
  });

  const empresas = Object.values(companyMap).map(e => {
    e.operacionesPct = totalComisiones > 0 ? ((e.operaciones / totalComisiones) * 100).toFixed(1) : '0.0';
    e.importePct = totalComisionado > 0 ? ((e.importe / totalComisionado) * 100).toFixed(1) : '0.0';
    e.importeFormateado = formatCurrency(e.importe);
    return e;
  }).sort((a, b) => b.importe - a.importe);

  // --- 4. IMPORTE COMISIONADO POR DESARROLLO ---
  const devMap = {};
  comisiones.forEach(c => {
    const dName = c.development?.text || 'Sin Desarrollo';
    const compName = c.company?.text || '';
    if (!devMap[dName]) {
      devMap[dName] = {
        desarrollo: dName,
        empresa: compName,
        operaciones: 0,
        importe: 0,
        importeFormateado: '$0.00',
        importePct: '0.0'
      };
    }
    devMap[dName].operaciones += 1;
    devMap[dName].importe += Number(c.total_commission) || 0;
  });

  const desarrollos = Object.values(devMap).map(d => {
    d.importePct = totalComisionado > 0 ? ((d.importe / totalComisionado) * 100).toFixed(1) : '0.0';
    d.importeFormateado = formatCurrency(d.importe);
    return d;
  }).sort((a, b) => b.importe - a.importe);

  // --- 5. ACTIVIDAD E IMPORTE POR GERENTE COORDINADOR ---
  const participants = await db.collection('comisiones-participantes').find({
    comision_id: { $in: comisiones.map(c => c._id) }
  }).toArray();

  const users = await db.collection('usuarios').find().toArray();
  const userMap = {};
  users.forEach(u => userMap[u._id.toString()] = u);

  const gerenteStats = {};
  participants.forEach(p => {
    if (p.role_in_comision === 'gerente') {
      const u = userMap[p.user?.toString()];
      const gName = u?.name || 'Desconocido';
      const commAmount = Number(p.commission_amount) || 0;
      if (!gerenteStats[gName]) {
        gerenteStats[gName] = {
          gerente: gName,
          opsSet: new Set(),
          propia: 0,
          equipo: 0
        };
      }
      gerenteStats[gName].opsSet.add(p.comision_id.toString());
      gerenteStats[gName].propia += commAmount;
    }
  });

  // Calculate team total for each gerente
  for (const gName in gerenteStats) {
    const g = gerenteStats[gName];
    const comIds = [...g.opsSet];
    const teamParts = participants.filter(p => comIds.includes(p.comision_id?.toString()));
    g.equipo = teamParts.reduce((sum, p) => sum + (Number(p.commission_amount) || 0), 0);
  }

  const gerentes = Object.values(gerenteStats).map(g => ({
    gerente: g.gerente,
    operaciones: `${g.opsSet.size} operaciones`,
    propia: g.propia,
    propiaFormateada: formatCurrency(g.propia),
    equipoFormateado: formatCurrency(g.equipo)
  })).sort((a, b) => b.propia - a.propia);

  const totalGerenciaPropia = gerentes.reduce((sum, g) => sum + g.propia, 0);

  // --- 6. ANEXO: PADRÓN DETALLADO DE COMISIONES EN CORTE ---
  const cancellationIds = comisiones.filter(c => c.is_cancellation).map(c => c._id);
  const cancellationDebts = cancellationIds.length > 0
    ? await db.collection('debts').find({ comision_id: { $in: cancellationIds } }).toArray()
    : [];
  const debtsByComision = {};
  for (const d of cancellationDebts) {
    const cid = d.comision_id?.toString();
    if (!debtsByComision[cid]) debtsByComision[cid] = [];
    debtsByComision[cid].push(d);
  }

  // Sorted alphabetically by Desarrollo then Ubicación
  const padron = [...comisiones].sort((a, b) => {
    const devA = (a.development?.text || '').toUpperCase();
    const devB = (b.development?.text || '').toUpperCase();
    if (devA !== devB) return devA.localeCompare(devB);
    const locA = (a.location?.text || '').toUpperCase();
    const locB = (b.location?.text || '').toUpperCase();
    return locA.localeCompare(locB);
  }).map((c, idx) => {
    let cancellationDetail = null;
    if (c.is_cancellation) {
      const cDebts = debtsByComision[c._id.toString()] || [];
      const totalPenalty = cDebts.reduce((sum, d) => sum + parseFloat(d.total_amount?.toString() || 0), 0) || Math.abs(Number(c.total_commission) || 0);
      const remainingBalance = cDebts.reduce((sum, d) => sum + parseFloat(d.remaining_balance?.toString() || 0), 0);
      const deductedAmount = Math.max(0, parseFloat((totalPenalty - remainingBalance).toFixed(2)));
      cancellationDetail = {
        totalPenalty,
        totalPenaltyFormateada: formatCurrency(totalPenalty),
        deductedAmount,
        deductedFormateada: formatCurrency(deductedAmount),
        remainingBalance,
        remainingFormateada: formatCurrency(remainingBalance),
        allPaid: remainingBalance <= 0,
        isPartial: deductedAmount > 0 && remainingBalance > 0
      };
    }

    return {
      index: idx + 1,
      ubicacion: c.location?.text || c.location || 'N/A',
      desarrollo: c.development?.text || c.development || 'N/A',
      concepto: c.is_cancellation ? 'Cancelación' : (c.concept?.text || c.concept || 'N/A'),
      cliente: (c.client_name || '').toUpperCase().trim(),
      precioVenta: formatCurrency(c.sale_price),
      comisionTotal: formatCurrency(c.total_commission),
      isNegative: Number(c.total_commission) < 0,
      cancellationDetail
    };
  });

  // Headers metadata
  const { periodoTexto, diasTexto } = formatCutPeriod(startDateStr, endDateStr);
  const now = new Date();
  const nowMexico = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
  const fechaEmision = formatSpanishDate(nowMexico);
  const horaEmision = `${String(nowMexico.getHours()).padStart(2, '0')}:${String(nowMexico.getMinutes()).padStart(2, '0')} hrs`;

  return {
    meta: {
      periodoTexto,
      diasTexto,
      fechaEmision,
      horaEmision,
      destinatarioPrincipal: 'Dirección General / Comercial',
      destinatarioSub: 'Corte para Dispersión de Pago',
      startDateStr,
      endDateStr
    },
    resumenMacro: {
      totalComisiones,
      ubicacionesUnicas,
      valorTotalVentas: formatCurrency(valorTotalVentas),
      totalComisionado: formatCurrency(totalComisionado)
    },
    distribucionConcepto,
    empresas,
    desarrollos,
    gerentes,
    totales: {
      totalOperaciones: totalComisiones,
      totalComisionadoFormateado: formatCurrency(totalComisionado),
      totalDesarrollosActivos: desarrollos.length,
      totalGerentes: gerentes.length,
      totalGerenciaPropiaFormateada: formatCurrency(totalGerenciaPropia)
    },
    padron
  };
}

module.exports = {
  getReporteCorteData,
  formatCurrency,
  formatSpanishDate,
  formatCutPeriod
};
