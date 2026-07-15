const jwt = require('jsonwebtoken');

const JWT_SECRET      = process.env.JWT_SECRET || 'tu_secreto_seguro';
const COOKIE_NAME     = 'auth_token';
const COOKIE_MAX_AGE  = 1000 * 60 * 60 * 8; // 8 horas en ms
const JWT_EXPIRES_IN  = '8h';

// ─── Payload que se guarda en el token ───────────────────────────────────────
const buildPayload = (user) => ({
  id:       user._id.toString(),
  username: user.username,
  name:     user.name,
  picture:  user.picture  || '',
  roleId:   user.role?._id?.toString()  || null,
  roleName: user.role?.name || '',
});

// ─── Crea el JWT y lo guarda en cookie httpOnly ───────────────────────────────
const setAuthCookie = (res, user) => {
  const payload = buildPayload(user);
  const token   = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   COOKIE_MAX_AGE,
  });

  return payload; // por si el router lo necesita
};

// ─── Limpia la cookie ─────────────────────────────────────────────────────────
const clearAuthCookie = (res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  });
};


/**
 * injectUserLocals
 * Middleware GLOBAL (app.js, antes de las rutas).
 * Disponibiliza user y permissions en TODAS las vistas EJS sin pasar nada a mano.
 */
const injectUserLocals = (req, res, next) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      const decoded          = jwt.verify(token, JWT_SECRET);
      res.locals.user        = decoded;
    //   res.locals.permissions = decoded.permissions || [];
    } catch {
      res.locals.user        = null;
    //   res.locals.permissions = [];
    }
  } else {
    res.locals.user        = null;
    // res.locals.permissions = [];
  }
  next();
};

// ─── Middleware: verifica el token en cada request protegido ──────────────────
const authenticate = (req, res, next) => {
  const token = req.cookies?.[COOKIE_NAME];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'No autenticado',
      data:    null,
      error:   'Token no encontrado',
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // disponible en req.user para los siguientes handlers
    next();
  } catch (error) {
    clearAuthCookie(res); // limpia cookie inválida o expirada

    const isExpired = error.name === 'TokenExpiredError';
    return res.status(401).json({
      success: false,
      message: isExpired ? 'Sesión expirada' : 'Token inválido',
      data:    null,
      error:   error.message,
    });
  }
};



module.exports = { setAuthCookie, clearAuthCookie, authenticate, injectUserLocals, };