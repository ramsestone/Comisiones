Viewed walkthrough.md:1-59

Aquí tienes el resumen ejecutivo de los cambios importantes implementados recientemente en el sistema:

---

### 1. 📊 **Rediseño y Potenciación del Dashboard de KPIs** ([kpiRouter.js](file:///d:/Documentos%20%28Disco%20D%29/Personal/Programacion/Javascript/Comisiones/routes/kpiRouter.js) y [kpis.ejs](file:///d:/Documentos%20%28Disco%20D%29/Personal/Programacion/Javascript/Comisiones/views/kpis.ejs))
- **Desglose de Viviendas Vendidas**:
  - **`Vendidas en V10`**: Muestra las viviendas que tienen estatus `COMPLETADO` en la base de datos maestra Enkontrol/V10 (ej. *LIV REFORMA*: 17 viviendas).
  - **`Vendidas en Sistema`**: Muestra las viviendas comisionadas dentro de la plataforma (ej. *LIV REFORMA*: 4 viviendas).
  - **`% Absorción`**: Calculado sobre la base maestra de V10 (`(v10Sold / totalUnits) * 100`).
- **Nuevas Métricas**: Se agregaron *Ticket Promedio*, *Tasa de Cancelación (%)*, *Comisión Promedio* y la tarjeta de *Desarrollos Activos* fue removida.
- **Gráficas Interactivas (Chart.js)**:
  1. *Tendencia Temporal de Ventas y Comisiones* (Líneas/Área comparativa mensual).
  2. *Distribución por Concepto de Venta* (Gráfica de Dona).
- **Orden de Secciones Reestructurado**:
  1. Filtros de Periodo.
  2. **Tarjetas Generales** (Resumen ejecutivo).
  3. 🏆 **Top Asesores y Gerentes** (Rankings comerciales).
  4. 🏢 **Ventas por Desarrollo** (Tabla con 9 columnas y sistema de ordenamiento de 3 clics: *Desc* $\rightarrow$ *Asc* $\rightarrow$ *Default*).
  5. 📈 **Gráficas**.
- **Fix Visual**: Corrección del solapamiento entre títulos e iconos, y ajuste dinámico en cifras numéricas grandes para evitar recortes.

---

### 2. 🔐 **Experiencia de Usuario en Autenticación** ([login.ejs](file:///d:/Documentos%20%28Disco%20D%29/Personal/Programacion/Javascript/Comisiones/views/login.ejs) y [registrar-usuario.ejs](file:///d:/Documentos%20%28Disco%20D%29/Personal/Programacion/Javascript/Comisiones/views/registrar-usuario.ejs))
- **Página de Login**: Se agregó el botón interactivo con icono de ojo FontAwesome para mostrar/ocultar la contraseña ingresada.
- **Registro de Usuarios**: Se corrigió el conflicto CSS (`pointer-events`) que bloqueaba los clics en los botones de "Ver Contraseña" y "Confirmar Contraseña".

---

### 3. 💳 **Cartera de Deudores y Control de Saldos** ([cartera-deudores.ejs](file:///d:/Documentos%20%28Disco%20D%29/Personal/Programacion/Javascript/Comisiones/views/cartera-deudores.ejs) y [wallet.js](file:///d:/Documentos%20%28Disco%20D%29/Personal/Programacion/Javascript/Comisiones/routes/wallet.js))
- **Separación Limpia de Cuentas**: El **Saldo Positivo** (créditos por comisiones ganadas) y la **Deuda Activa** (préstamos y penalizaciones a miembros) ya no se autodescuentan automáticamente en la base de datos.
- **Barra de Filtros Avanzada**: Permite filtrar la cartera por *Búsqueda*, *Rol* (Asesores/Gerentes) y *Estado de Cuenta* (con deuda, con saldo positivo, con saldo neto negativo, etc.), recalculando los totales al instante.
- **Cobros/Abonos**: Se implementaron modales de confirmación con recarga silenciosa que conservan la posición del scroll del usuario.

---

### 4. 📝 **Gestión de Cancelaciones y Exportaciones** ([comisiones.ejs](file:///d:/Documentos%20%28Disco%20D%29/Personal/Programacion/Javascript/Comisiones/views/comisiones.ejs) y [comisionesRouter.js](file:///d:/Documentos%20%28Disco%20D%29/Personal/Programacion/Javascript/Comisiones/routes/comisionesRouter.js))
- **Etiqueta Visual de Penalizaciones**: En cancelaciones donde la penalización aplica al cliente (`penalty_target === 'cliente'`), las comisiones individuales muestran la leyenda `(Penalización al cliente)` omitiendo los porcentajes desglosados en cero.
- **Modal de Correcciones**: Se reemplazó el `prompt()` nativo por un modal oscuro integrado.
- **Exportación CSV**: Se incluyó la columna dedicada `Penalización` para auditar rápidamente el tipo de penalización (*Cliente* vs *Miembros*).