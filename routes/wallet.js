const express = require('express');
const { ObjectId, Decimal128 } = require('mongodb');
const router = express.Router();
const { authenticate } = require('../JWT/authCookies');

const DB_NAME = 'roles_usuarios';

// ─── Resumen ──────────────────────────────────────────────────────────────────
// +--------+---------------------------------------------+-----------------------+-------------+
// | Método | Ruta                                        | Acción                | Transacción |
// +--------+---------------------------------------------+-----------------------+-------------+
// | POST   | /api/wallet/debts                           | Registrar deuda       |      ✓     |
// +--------+---------------------------------------------+-----------------------+-------------+
// | GET    | /api/wallet/debts/:user_id                  | Deudas de un usuario  |      —      |
// +--------+---------------------------------------------+-----------------------+-------------+
// | POST   | /api/wallet/debts/:debt_id/payment          | Pagar cuota           |      ✓     |
// +--------+---------------------------------------------+-----------------------+-------------+
// | PATCH  | /api/wallet/debts/:debt_id/cancel           | Cancelar deuda        |      —      |
// +--------+---------------------------------------------+-----------------------+-------------+
// | GET    | /api/wallet/:user_id/transactions           | Historial + Saldo     |      —      |
// +--------+---------------------------------------------+-----------------------+-------------+
// | POST   | /api/wallet/:user_id/transactions/credit    | Crédito manual        |      —      |
// +--------+---------------------------------------------+-----------------------+-------------+

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toDecimal = (value) => Decimal128.fromString(value.toString());

const netBalance = async (db, userId) => {
    const resultado = await db.collection('walletTransactions').aggregate([
        { $match: { user_id: new ObjectId(userId) } },
        {
            $group: {
                _id: '$type',
                total: { $sum: { $toDouble: '$amount' } },
            },
        },
    ]).toArray();

    const credits = resultado.find(r => r._id === 'credit')?.total ?? 0;
    const debits = resultado.find(r => r._id === 'debit')?.total ?? 0;
    return parseFloat((credits - debits).toFixed(2));
};

// =============================================================================
// DEBTS
// =============================================================================

/**
 * POST /api/wallet/debts
 * Registrar una deuda nueva (loan | penalty)
 */
router.post('/debts', authenticate, async (req, res) => {
    const client = req.app.locals.mongoClient;
    const db = client.db(DB_NAME);

    try {
        const { user_id, type, description, total_amount } = req.body;
        const created_by = req.user.id;

        // ── Validaciones ────────────────────────────────────────────────────────
        if (!user_id || !type || !description || !total_amount) {
            return res.status(400).json({
                success: false,
                message: 'Faltan campos requeridos: user_id, type, description, total_amount',
                data: null,
                error: null,
            });
        }

        if (!['loan', 'penalty'].includes(type)) {
            return res.status(400).json({
                success: false,
                message: "El campo type debe ser 'loan' o 'penalty'",
                data: null,
                error: null,
            });
        }

        // Corrección de decimales al recibir
        const parsedAmount = parseFloat(parseFloat(total_amount).toFixed(2));

        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'El monto debe ser un número mayor a 0',
                data: null,
                error: null,
            });
        }

        const userDoc = await db.collection('usuarios').findOne({ _id: new ObjectId(user_id) });
        if (!userDoc) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado',
                data: null,
                error: null,
            });
        }

        const remainingBalance = parsedAmount;
        const status = 'active';

        let debtId;
        const now = new Date();

        // 1. Insertar deuda
        const debtDoc = {
            user_id: new ObjectId(user_id),
            type,
            description,
            total_amount: toDecimal(parsedAmount),
            remaining_balance: toDecimal(remainingBalance),
            status: status,
            created_by: new ObjectId(created_by),
            created_at: now,
            updated_at: now,
        };

        const { insertedId } = await db.collection('debts').insertOne(debtDoc);
        debtId = insertedId;

        // 2. Transacciones
        // Ya no insertaremos el debit automáticamente aquí, porque el usuario ha solicitado
        // que las deudas no se cobren de las comisiones hasta que él lo indique explícitamente.

        return res.status(201).json({
            success: true,
            message: 'Deuda registrada correctamente',
            data: { debt_id: debtId, user_id, type, total_amount: parsedAmount, remaining_balance: remainingBalance, status },
            error: null,
        });

    } catch (error) {
        console.error('[POST /api/wallet/debts]', error);
        return res.status(500).json({
            success: false,
            message: 'Error al registrar la deuda',
            data: null,
            error: error.message,
        });
    }
});

// -----------------------------------------------------------------------------

/**
 * GET /api/wallet/debts/:user_id
 * Deudas activas de un asesor
 */
router.get('/debts/:user_id', authenticate, async (req, res) => {
    try {
        const db = req.app.locals.mongoClient.db(DB_NAME);
        const { user_id } = req.params;
        const { status } = req.query; // ?status=active | paid | cancelled

        if (!ObjectId.isValid(user_id)) {
            return res.status(400).json({
                success: false,
                message: 'El parámetro user_id no es un ObjectId válido',
                data: null,
                error: null,
            });
        }

        const match = { user_id: new ObjectId(user_id) };
        if (status) match.status = status;

        const debts = await db.collection('debts').aggregate([
            { $match: match },

            // Populate created_by
            {
                $lookup: {
                    from: 'usuarios',
                    localField: 'created_by',
                    foreignField: '_id',
                    as: 'created_by',
                    pipeline: [{ $project: { name: 1, username: 1 } }],
                },
            },
            { $unwind: { path: '$created_by', preserveNullAndEmptyArrays: true } },

            { $sort: { created_at: -1 } },
        ]).toArray();

        return res.status(200).json({
            success: true,
            message: `Se encontraron ${debts.length} deudas`,
            data: { debts },
            error: null,
        });

    } catch (error) {
        console.error('[GET /api/wallet/debts/:user_id]', error);
        return res.status(500).json({
            success: false,
            message: 'Error al consultar las deudas',
            data: null,
            error: error.message,
        });
    }
});

// -----------------------------------------------------------------------------

/**
 * POST /api/wallet/debts/:debt_id/payment
 * Aplicar un pago parcial o total a una deuda
 */
router.post('/debts/:debt_id/payment', authenticate, async (req, res) => {
    const client = req.app.locals.mongoClient;
    const db = client.db(DB_NAME);

    try {
        const { debt_id } = req.params;
        const { amount, description } = req.body;
        const created_by = req.user.id;

        // ── Validaciones ────────────────────────────────────────────────────────
        if (!ObjectId.isValid(debt_id)) {
            return res.status(400).json({
                success: false,
                message: 'El parámetro debt_id no es un ObjectId válido',
                data: null,
                error: null,
            });
        }

        if (!amount || isNaN(amount) || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'El monto debe ser un número mayor a 0',
                data: null,
                error: null,
            });
        }

        const debt = await db.collection('debts').findOne({ _id: new ObjectId(debt_id) });

        if (!debt) {
            return res.status(404).json({
                success: false,
                message: 'Deuda no encontrada',
                data: null,
                error: null,
            });
        }

        if (debt.status !== 'active') {
            return res.status(400).json({
                success: false,
                message: `No se puede abonar a una deuda con estatus '${debt.status}'`,
                data: null,
                error: null,
            });
        }

        const remaining = parseFloat(debt.remaining_balance.toString());

        if (amount > remaining) {
            return res.status(400).json({
                success: false,
                message: `El monto ($${amount}) excede el saldo restante ($${remaining})`,
                data: null,
                error: null,
            });
        }

        const newBalance = parseFloat((remaining - amount).toFixed(2));
        const newStatus = newBalance === 0 ? 'paid' : 'active';
        const now = new Date();

        // 1. Actualizar deuda
        await db.collection('debts').updateOne(
            { _id: new ObjectId(debt_id) },
            {
                $set: {
                    remaining_balance: toDecimal(newBalance),
                    status: newStatus,
                    updated_at: now,
                },
            }
        );

        // 2. Registrar transacción de pago
        await db.collection('walletTransactions').insertOne({
            user_id: debt.user_id,
            type: 'debit',
            amount: toDecimal(amount),
            concept: 'payment',
            description: description ?? `Pago a deuda — ${debt.description}`,
            debt_id: new ObjectId(debt_id),
            comision_id: null,
            reference_date: now,
            created_by: new ObjectId(created_by),
            created_at: now,
        });

        return res.status(200).json({
            success: true,
            message: newStatus === 'paid'
                ? 'Deuda liquidada correctamente'
                : `Pago aplicado. Saldo restante: $${newBalance}`,
            data: {
                debt_id,
                amount_paid: amount,
                remaining_balance: newBalance,
                status: newStatus,
            },
            error: null,
        });

    } catch (error) {
        console.error('[POST /api/wallet/debts/:debt_id/payment]', error);
        return res.status(500).json({
            success: false,
            message: 'Error al aplicar el pago',
            data: null,
            error: error.message,
        });
    }
});

// -----------------------------------------------------------------------------

/**
 * PATCH /api/wallet/debts/:debt_id/cancel
 * Cancelar una deuda activa
 */
router.patch('/debts/:debt_id/cancel', authenticate, async (req, res) => {
    try {
        const db = req.app.locals.mongoClient.db(DB_NAME);
        const { debt_id } = req.params;

        if (!ObjectId.isValid(debt_id)) {
            return res.status(400).json({
                success: false,
                message: 'El parámetro debt_id no es un ObjectId válido',
                data: null,
                error: null,
            });
        }

        const debt = await db.collection('debts').findOne({ _id: new ObjectId(debt_id) });

        if (!debt) {
            return res.status(404).json({
                success: false,
                message: 'Deuda no encontrada',
                data: null,
                error: null,
            });
        }

        if (debt.status !== 'active') {
            return res.status(400).json({
                success: false,
                message: `Solo se pueden cancelar deudas activas. Estatus actual: '${debt.status}'`,
                data: null,
                error: null,
            });
        }

        await db.collection('debts').updateOne(
            { _id: new ObjectId(debt_id) },
            { $set: { status: 'cancelled', updated_at: new Date() } }
        );

        return res.status(200).json({
            success: true,
            message: 'Deuda cancelada correctamente',
            data: { debt_id, status: 'cancelled' },
            error: null,
        });

    } catch (error) {
        console.error('[PATCH /api/wallet/debts/:debt_id/cancel]', error);
        return res.status(500).json({
            success: false,
            message: 'Error al cancelar la deuda',
            data: null,
            error: error.message,
        });
    }
});

// =============================================================================
// wallet TRANSACTIONS
// =============================================================================

/**
 * GET /api/wallet/:user_id/transactions
 * Historial de transacciones + saldo neto
 */
router.get('/:user_id/transactions', authenticate, async (req, res) => {
    try {
        const db = req.app.locals.mongoClient.db(DB_NAME);
        const { user_id } = req.params;
        const page = parseInt(req.query.page ?? 1);
        const limit = parseInt(req.query.limit ?? 20);
        const concept = req.query.concept; // ?concept=commission|loan|penalty|payment
        const type = req.query.type;    // ?type=credit|debit
        const skip = (page - 1) * limit;

        if (!ObjectId.isValid(user_id)) {
            return res.status(400).json({
                success: false,
                message: 'El parámetro user_id no es un ObjectId válido',
                data: null,
                error: null,
            });
        }

        const match = { user_id: new ObjectId(user_id) };
        if (concept) match.concept = concept;
        if (type) match.type = type;

        const [transactions, total, balance] = await Promise.all([

            // Transacciones paginadas
            db.collection('walletTransactions').aggregate([
                { $match: match },

                // Populate debt_id
                {
                    $lookup: {
                        from: 'debts',
                        localField: 'debt_id',
                        foreignField: '_id',
                        as: 'debt',
                        pipeline: [{ $project: { type: 1, description: 1, status: 1 } }],
                    },
                },
                { $unwind: { path: '$debt', preserveNullAndEmptyArrays: true } },

                // Populate comision_id
                {
                    $lookup: {
                        from: 'comisiones-ubicaciones',
                        localField: 'comision_id',
                        foreignField: '_id',
                        as: 'comision',
                        pipeline: [{ $project: { location: 1, commission_type: 1, sale_price: 1 } }],
                    },
                },
                { $unwind: { path: '$comision', preserveNullAndEmptyArrays: true } },

                { $sort: { created_at: -1 } },
                { $skip: skip },
                { $limit: limit },
            ]).toArray(),

            // Total de documentos para paginación
            db.collection('walletTransactions').countDocuments(match),

            // Saldo neto (siempre sobre todas las transacciones, sin filtros)
            netBalance(db, user_id),
        ]);

        return res.status(200).json({
            success: true,
            message: `Se encontraron ${total} transacciones`,
            data: {
                net_balance: balance,
                pagination: {
                    total,
                    page,
                    limit,
                    total_pages: Math.ceil(total / limit),
                },
                transactions,
            },
            error: null,
        });

    } catch (error) {
        console.error('[GET /api/wallet/:user_id/transactions]', error);
        return res.status(500).json({
            success: false,
            message: 'Error al consultar las transacciones',
            data: null,
            error: error.message,
        });
    }
});

// -----------------------------------------------------------------------------

/**
 * POST /api/wallet/:user_id/transactions/credit
 * Registrar un crédito manual (ej: comisión pagada)
 */
router.post('/:user_id/transactions/credit', authenticate, async (req, res) => {
    try {
        const db = req.app.locals.mongoClient.db(DB_NAME);
        const { user_id } = req.params;
        const { amount, concept, description, comision_id } = req.body;
        const created_by = req.user._id;

        if (!ObjectId.isValid(user_id)) {
            return res.status(400).json({
                success: false,
                message: 'El parámetro user_id no es un ObjectId válido',
                data: null,
                error: null,
            });
        }

        if (!amount || isNaN(amount) || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'El monto debe ser un número mayor a 0',
                data: null,
                error: null,
            });
        }

        if (!['commission', 'loan', 'penalty', 'payment'].includes(concept)) {
            return res.status(400).json({
                success: false,
                message: "El campo concept debe ser: commission | loan | penalty | payment",
                data: null,
                error: null,
            });
        }

        const now = new Date();

        const { insertedId } = await db.collection('walletTransactions').insertOne({
            user_id: new ObjectId(user_id),
            type: 'credit',
            amount: toDecimal(amount),
            concept,
            description: description ?? 'Crédito manual',
            debt_id: null,
            comision_id: comision_id ? new ObjectId(comision_id) : null,
            reference_date: now,
            created_by: new ObjectId(created_by),
            created_at: now,
        });

        const balance = await netBalance(db, user_id);

        return res.status(201).json({
            success: true,
            message: 'Crédito registrado correctamente',
            data: {
                transaction_id: insertedId,
                amount,
                concept,
                net_balance: balance,
            },
            error: null,
        });

    } catch (error) {
        console.error('[POST /api/wallet/:user_id/transactions/credit]', error);
        return res.status(500).json({
            success: false,
            message: 'Error al registrar el crédito',
            data: null,
            error: error.message,
        });
    }
});

// =============================================================================
// CARTERA AGGREGATION
// =============================================================================

/**
 * GET /api/wallet/cartera
 * Devuelve el resumen agregado para todos los asesores y gerentes.
 */
router.get('/cartera', authenticate, async (req, res) => {
    try {
        const db = req.app.locals.mongoClient.db(DB_NAME);

        const cartera = await db.collection('usuarios').aggregate([
            { $match: { active: true } },
            {
                $lookup: {
                    from: 'roles',
                    localField: 'role',
                    foreignField: '_id',
                    as: 'roleInfo',
                }
            },
            { $unwind: { path: '$roleInfo', preserveNullAndEmptyArrays: true } },
            {
                $match: {
                    'roleInfo.name': { $regex: /Asesor|Gerent/i }
                }
            },
            {
                $lookup: {
                    from: 'debts',
                    let: { userId: '$_id' },
                    pipeline: [
                        { $match: { $expr: { $eq: ['$user_id', '$$userId'] } } }
                    ],
                    as: 'all_debts'
                }
            },
            {
                $lookup: {
                    from: 'walletTransactions',
                    let: { userId: '$_id' },
                    pipeline: [
                        { $match: { $expr: { $eq: ['$user_id', '$$userId'] } } },
                        { $sort: { created_at: -1 } }
                    ],
                    as: 'transactions'
                }
            }
        ]).toArray();

        const formatted = cartera.map(user => {
            let deuda = 0;
            let comision = 0;
            let saldo = 0;

            const active_debts = user.all_debts.filter(d => d.status === 'active');

            active_debts.forEach(d => {
                deuda += parseFloat(d.remaining_balance?.toString() || 0);
            });

            let totalDebits = 0;
            user.transactions.forEach(t => {
                const amount = parseFloat(t.amount?.toString() || 0);
                if (t.type === 'credit') {
                    if (t.concept === 'commission') comision += amount;
                    else saldo += amount;
                } else if (t.type === 'debit') {
                    totalDebits += amount;
                }
            });

            let remainingDebits = totalDebits;
            if (remainingDebits > 0) {
                if (comision >= remainingDebits) {
                    comision -= remainingDebits;
                    remainingDebits = 0;
                } else {
                    remainingDebits -= comision;
                    comision = 0;
                }
            }
            if (remainingDebits > 0) {
                if (saldo >= remainingDebits) {
                    saldo -= remainingDebits;
                    remainingDebits = 0;
                } else {
                    saldo = 0;
                }
            }

            let allLogs = [
                ...user.transactions.map(t => ({
                    id: t._id,
                    t: t.description || t.concept,
                    tipo: t.type === 'debit' ? 'deu' : (t.concept === 'commission' ? 'com' : 'sal'),
                    monto: parseFloat(t.amount?.toString() || 0),
                    fecha: t.created_at
                })),
                ...user.all_debts.map(d => ({
                    id: d._id,
                    t: d.description || (d.type === 'loan' ? 'Préstamo' : 'Penalización'),
                    tipo: 'pen',
                    monto: parseFloat(d.total_amount?.toString() || 0),
                    fecha: d.created_at
                }))
            ];

            allLogs.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

            const log = allLogs.slice(0, 10).map(l => ({
                id: l.id,
                t: l.t,
                tipo: l.tipo,
                monto: l.monto,
                fecha: new Date(l.fecha).toISOString().slice(0, 10),
            }));

            const av = (user.name || '').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();

            return {
                id: user._id,
                name: user.name,
                role: user.roleInfo?.name || 'Asesor',
                av: av,
                avc: 'av-a',
                picture: user.picture || null,
                deuda,
                comision,
                saldo,
                active_debts: active_debts.map(d => ({ id: d._id, balance: parseFloat(d.remaining_balance?.toString() || 0) })),
                log
            };
        });

        // Ordenar por nombre
        formatted.sort((a, b) => a.name.localeCompare(b.name));

        const colors = ['av-a', 'av-b', 'av-c', 'av-d', 'av-e'];
        formatted.forEach((f, i) => { f.avc = colors[i % colors.length]; });

        return res.status(200).json({
            success: true,
            data: formatted
        });

    } catch (error) {
        console.error('[GET /api/wallet/cartera]', error);
        return res.status(500).json({ success: false, message: 'Error interno' });
    }
});

module.exports = router;