const express = require('express');
const router  = express.Router();
const {
    setAuthCookie,
    clearAuthCookie,
    authenticate
} = require('../JWT/authCookies');

// Middleware manual para chequear roles en las vistas
const checkRole = (allowedRoles) => {
  return (req, res, next) => {
    // Si no hay user, se redirige al login
    if (!res.locals.user) {
      return res.redirect('/');
    }
    // Si hay un arreglo de roles y el rol actual no está, lo redirige
    if (allowedRoles && !allowedRoles.includes(res.locals.user.roleName)) {
      return res.redirect('/comisiones');
    }
    next();
  };
};

// Login — sin layout (no header)
router.get('/', (req, res) => {
  const originalStatus = res.status.bind(res);
  let intercepted = false;

  res.status = (code) => {
    if (code === 401) {
      intercepted = true;
      return { json: () => res.render('login', { layout: false }) };
    }
    return originalStatus(code);
  };
  authenticate(req, res, () => {
    if (!intercepted) {
      return res.redirect('/login-successfully');
    }
  });
});

router.get('/login-successfully', (req, res) => {
  res.redirect('/comisiones');
});

// Solo Gerente, Director, Administrador
router.get('/registrar-comision', checkRole(['Gerente', 'Director', 'Administrador']), (req, res) => {
  res.render('registrar-comision', { title: 'Registro de Comisión', currentPage: 'registrar-comision' });
});

// Todos pueden ver comisiones e historial
router.get('/comisiones', checkRole(), (req, res) => {
  res.render('comisiones', { title: 'Comisiones', currentPage: 'comisiones' });
});

router.get('/historial-comisiones', checkRole(), (req, res) => {
  res.render('historial-comisiones', { title: 'Historial de Comisiones', currentPage: 'historial' });
});

// Solo Gerente, Director, Administrador
router.get('/cartera-deudores', checkRole(['Gerente', 'Director', 'Administrador']), (req, res) => {
  res.render('cartera-deudores', { title: 'Cartera de Deudores', currentPage: 'cartera-deudores' });
});

// KPIs Dashboard
router.get('/kpis', checkRole(['Gerente', 'Director', 'Administrador']), (req, res) => {
  res.render('kpis', { title: 'KPI Dashboard', currentPage: 'kpis' });
});

// Solo Administrador
router.get('/usuarios', checkRole(['Administrador']), (req, res) => {
  res.render('usuarios', { title: 'Gestión de Usuarios', currentPage: 'usuarios' });
});

// Solo Administrador
router.get('/registrar-usuario', checkRole(['Administrador']), (req, res) => {
  res.render('registrar-usuario', { title: 'Registrar Usuario', currentPage: 'registrar-usuario' });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.redirect('/');
});

module.exports = router;