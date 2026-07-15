use("roles_usuarios");
// ─── IDs de referencia ────────────────────────────────────────────────────────
const userId = ObjectId("69fbe8db12bb3c1781861288");
const adminId = ObjectId("69fbe8db12bb3c1781861289"); // created_by (administradora)
const com1Id = ObjectId("69fbe8db12bb3c178186128a"); // comision ref 1
const com2Id = ObjectId("69fbe8db12bb3c178186128b"); // comision ref 2

// ─── 1. DEBTS ─────────────────────────────────────────────────────────────────
db.createCollection("debts");

db.debts.insertMany([
    {
        user_id: userId,
        type: "loan",
        description: "Préstamo personal solicitado",
        total_amount: Decimal128("8000.00"),
        remaining_balance: Decimal128("3000.00"),  // ya pagó 5000
        status: "active",
        created_by: adminId,
        created_at: new Date("2026-01-15"),
        updated_at: new Date("2026-03-20"),
    },
    {
        user_id: userId,
        type: "penalty",
        description: "Penalización por cancelación de operación TOKIO-PB-A003",
        total_amount: Decimal128("2000.00"),
        remaining_balance: Decimal128("0.00"),     // ya liquidada
        status: "paid",
        created_by: adminId,
        created_at: new Date("2026-02-01"),
        updated_at: new Date("2026-02-15"),
    },
    {
        user_id: userId,
        type: "loan",
        description: "Préstamo para gastos de capacitación",
        total_amount: Decimal128("3500.00"),
        remaining_balance: Decimal128("3500.00"),  // sin pagos aún
        status: "active",
        created_by: adminId,
        created_at: new Date("2026-04-01"),
        updated_at: new Date("2026-04-01"),
    },
]);

const debtLoan1 = db.debts.findOne({ description: "Préstamo personal solicitado" })._id;
const debtPenalty1 = db.debts.findOne({ type: "penalty" })._id;
const debtLoan2 = db.debts.findOne({ description: "Préstamo para gastos de capacitación" })._id;

console.log("✓ Debts creadas: " + db.debts.countDocuments());

// ─── 2. WALLET TRANSACTIONS ───────────────────────────────────────────────────
db.createCollection("walletTransactions");

db.walletTransactions.insertMany([

    // ── Deudas (débitos que originan las debs) ───────────────────────────────
    {
        user_id: userId,
        type: "debit",
        amount: Decimal128("8000.00"),
        concept: "loan",
        description: "Préstamo personal solicitado",
        debt_id: debtLoan1,
        comision_id: null,
        reference_date: new Date("2026-01-15"),
        created_by: adminId,
        created_at: new Date("2026-01-15"),
    },
    {
        user_id: userId,
        type: "debit",
        amount: Decimal128("2000.00"),
        concept: "penalty",
        description: "Penalización por cancelación de operación TOKIO-PB-A003",
        debt_id: debtPenalty1,
        comision_id: com1Id,
        reference_date: new Date("2026-02-01"),
        created_by: adminId,
        created_at: new Date("2026-02-01"),
    },
    {
        user_id: userId,
        type: "debit",
        amount: Decimal128("3500.00"),
        concept: "loan",
        description: "Préstamo para gastos de capacitación",
        debt_id: debtLoan2,
        comision_id: null,
        reference_date: new Date("2026-04-01"),
        created_by: adminId,
        created_at: new Date("2026-04-01"),
    },

    // ── Pagos de deudas (débitos de cuotas) ──────────────────────────────────
    {
        user_id: userId,
        type: "debit",
        amount: Decimal128("2000.00"),
        concept: "payment",
        description: "Pago parcial — Préstamo personal",
        debt_id: debtLoan1,
        comision_id: null,
        reference_date: new Date("2026-02-20"),
        created_by: adminId,
        created_at: new Date("2026-02-20"),
    },
    {
        user_id: userId,
        type: "debit",
        amount: Decimal128("2000.00"),
        concept: "payment",
        description: "Pago parcial — Penalización TOKIO-PB-A003",
        debt_id: debtPenalty1,
        comision_id: null,
        reference_date: new Date("2026-02-10"),
        created_by: adminId,
        created_at: new Date("2026-02-10"),
    },
    {
        user_id: userId,
        type: "debit",
        amount: Decimal128("2000.00"),
        concept: "payment",
        description: "Liquidación — Penalización TOKIO-PB-A003",
        debt_id: debtPenalty1,
        comision_id: null,
        reference_date: new Date("2026-02-15"),
        created_by: adminId,
        created_at: new Date("2026-02-15"),
    },
    {
        user_id: userId,
        type: "debit",
        amount: Decimal128("3000.00"),
        concept: "payment",
        description: "Pago parcial — Préstamo personal",
        debt_id: debtLoan1,
        comision_id: null,
        reference_date: new Date("2026-03-20"),
        created_by: adminId,
        created_at: new Date("2026-03-20"),
    },

    // ── Créditos por comisiones pagadas ─────────────────────────────────────
    {
        user_id: userId,
        type: "credit",
        amount: Decimal128("12000.00"),
        concept: "commission",
        description: "Comisión pagada — TOKIO-PB-A001",
        debt_id: null,
        comision_id: com1Id,
        reference_date: new Date("2026-03-05"),
        created_by: adminId,
        created_at: new Date("2026-03-05"),
    },
    {
        user_id: userId,
        type: "credit",
        amount: Decimal128("25200.00"),
        concept: "commission",
        description: "Comisión pagada — TOKIO-PB-A002",
        debt_id: null,
        comision_id: com2Id,
        reference_date: new Date("2026-04-10"),
        created_by: adminId,
        created_at: new Date("2026-04-10"),
    },

]);

console.log("✓ WalletTransactions creadas: " + db.walletTransactions.countDocuments());

// ─── 3. VERIFICACIÓN — Saldo neto ─────────────────────────────────────────────
const resultado = db.walletTransactions.aggregate([
    { $match: { user_id: userId } },
    {
        $group: {
            _id: "$type",
            total: { $sum: { $toDouble: "$amount" } },
        },
    },
]).toArray();

const credits = resultado.find(r => r._id === "credit")?.total ?? 0;
const debits = resultado.find(r => r._id === "debit")?.total ?? 0;

console.log(`✓ Total créditos : $${credits}`);
console.log(`✓ Total débitos  : $${debits}`);
console.log(`✓ Saldo neto     : $${credits - debits}`);