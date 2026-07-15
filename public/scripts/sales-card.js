// sales-card.js

// Función principal para rellenar la tarjeta con datos de una comisión
function renderizarTarjeta(comision, index) {
    const cardId = `card-${comision._id || index}`;
    const statusClass = getStatusClass(comision.status?.name || 'Pendiente');
    const statusDotClass = getStatusDotClass(comision.status?.name || 'Pendiente');
    
    // Calcular porcentaje de verificación
    const participantes = comision.participantes || [];
    const verificados = participantes.filter(p => p.verification === true).length;
    const totalParticipantes = participantes.length;
    const verifPorcentaje = totalParticipantes > 0 ? (verificados / totalParticipantes) * 100 : 0;
    
    // Separar gerentes y asesores
    const gerentes = participantes.filter(p => p.role_in_comision === 'gerente');
    const asesores = participantes.filter(p => p.role_in_comision === 'asesor');
    
    // Obtener iniciales para avatar
    const getInitials = (nombre) => {
        if (!nombre) return '??';
        return nombre.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    };
    
    // Formatear fecha
    const formatDate = (fecha) => {
        if (!fecha) return 'N/A';
        return new Date(fecha).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
    };
    
    // Template HTML
    return `
        <div class="sale-card" id="${cardId}" data-status="${comision.status?.name?.toLowerCase() || 'pendiente'}">
            <div class="sale-header" onclick="toggleCard('${cardId}')">
                <div class="sale-status-dot ${statusDotClass}"></div>
                <div class="sale-info">
                    <div class="sale-empresa">${comision.company?.text || 'N/A'}</div>
                    <div class="sale-dev">${comision.development?.text || 'N/A'}</div>
                    <div class="sale-meta">
                        <span class="tag blue">${comision.location?.text || 'N/A'}</span>
                        <span class="tag">${comision.concept?.text || 'N/A'}</span>
                        <span class="tag">${comision.commission_type || 'N/A'}</span>
                        <span class="tag ref">ID: ${comision._id?.slice(-6) || 'N/A'}</span>
                        <span class="tag ref">${formatDate(comision.operation_date)}</span>
                        <span class="tag ${statusClass}">${comision.status?.name || 'Pendiente'}</span>
                    </div>
                </div>
                <div class="sale-amount">
                    <div class="sale-price">$${formatNumber(comision.sale_price || 0)}</div>
                    <div class="sale-commission">Comisión $${formatNumber(comision.total_commission || 0)}</div>
                </div>
                <div class="chevron">▾</div>
            </div>
            
            <div class="sale-body" id="body-${cardId}">
                <div class="sale-body-inner">
                    <!-- Workflow -->
                    <div class="workflow-bar">
                        ${getWorkflowSteps(comision.status?.name)}
                    </div>
                    
                    <!-- Progreso verificaciones -->
                    <div class="verif-progress-row">
                        <span class="verif-progress-label">Verificaciones</span>
                        <div class="verif-bar-wrap">
                            <div class="verif-bar-fill" style="width:${verifPorcentaje}%"></div>
                        </div>
                        <span class="verif-count">${verificados}/${totalParticipantes}</span>
                    </div>
                    
                    <!-- Gerentes -->
                    ${gerentes.length > 0 ? `
                    <div class="team-group">
                        <div class="team-group-label gl-blue">Gerentes <span>${gerentes.length}</span></div>
                        <div class="participants-grid">
                            ${gerentes.map(g => `
                                <div class="participant">
                                    <div class="p-avatar av-green">${getInitials(g.usuario?.name)}</div>
                                    <div class="p-info">
                                        <div class="p-name">${g.usuario?.name || 'N/A'}</div>
                                        <div class="p-role-label">Gerente</div>
                                    </div>
                                    <div class="p-earnings">
                                        <div class="p-pct">${(g.percentage * 100).toFixed(2)}%</div>
                                        <div class="p-amt">$${formatNumber(g.commission_amount || 0)}</div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    ` : ''}
                    
                    <!-- Asesores -->
                    ${asesores.length > 0 ? `
                    <div class="team-group">
                        <div class="team-group-label gl-green">Asesores <span>${asesores.length}</span></div>
                        <div class="participants-grid">
                            ${asesores.map(a => `
                                <div class="participant">
                                    <div class="p-avatar av-teal">${getInitials(a.usuario?.name)}</div>
                                    <div class="p-info">
                                        <div class="p-name">${a.usuario?.name || 'N/A'}</div>
                                        <div class="p-role-label">Asesor</div>
                                    </div>
                                    <div class="p-earnings">
                                        <div class="p-pct">${(a.percentage * 100).toFixed(2)}%</div>
                                        <div class="p-amt">$${formatNumber(a.commission_amount || 0)}</div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    ` : ''}
                    
                    <!-- Totales -->
                    <div class="totals-row">
                        <div class="total-pill"><span>Precio de venta</span><strong>$${formatNumber(comision.sale_price || 0)}</strong></div>
                        <div class="total-pill"><span>Comisión total</span><strong>$${formatNumber(comision.total_commission || 0)}</strong></div>
                        <div class="total-pill"><span>Participantes</span><strong>${totalParticipantes}</strong></div>
                        <div class="total-pill"><span>Fecha</span><strong>${formatDate(comision.operation_date)}</strong></div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Función auxiliar para formatear números
function formatNumber(num) {
    return num.toLocaleString('es-MX');
}

// Función para obtener clase del estado
function getStatusClass(status) {
    const map = {
        'Pendiente': 'status-tag-pendiente',
        'Verificada': 'status-tag-verificada',
        'Aprobada': 'status-tag-aprobada',
        'Pagada': 'status-tag-pagada'
    };
    return map[status] || 'status-tag-pendiente';
}

// Función para obtener clase del dot
function getStatusDotClass(status) {
    const map = {
        'Pendiente': 'status-pendiente',
        'Verificada': 'status-verificada',
        'Aprobada': 'status-aprobada',
        'Pagada': 'status-pagada'
    };
    return map[status] || 'status-pendiente';
}

// Función para obtener los pasos del workflow
function getWorkflowSteps(currentStatus) {
    const steps = [
        { name: 'Registrada', icon: 'fa-file-alt' },
        { name: 'Verificada', icon: 'fa-users' },
        { name: 'Aprobada', icon: 'fa-check-circle' },
        { name: 'Pagada', icon: 'fa-money-bill-wave' }
    ];
    
    const statusOrder = {
        'Pendiente': 0,
        'Verificada': 1,
        'Aprobada': 2,
        'Pagada': 3
    };
    
    const currentIndex = statusOrder[currentStatus] || 0;
    
    return steps.map((step, idx) => {
        let stepClass = '';
        if (idx < currentIndex) stepClass = 'completed';
        if (idx === currentIndex) stepClass = 'current';
        
        return `
            <div class="wf-step">
                <div class="wf-step-inner">
                    <div class="wf-dot ${stepClass}"><i class="fas ${step.icon}"></i></div>
                    <div class="wf-label ${stepClass}">${step.name}</div>
                </div>
            </div>
            ${idx < steps.length - 1 ? '<div class="wf-line"></div>' : ''}
        `;
    }).join('');
}

// Función para toggle de la tarjeta (global)
window.toggleCard = function(cardId) {
    const card = document.getElementById(cardId);
    if (card) {
        card.classList.toggle('open');
    }
};

// Función principal para rellenar el contenedor con múltiples comisiones
function rellenarListaComisiones(contenedorId, comisiones) {
    const contenedor = document.getElementById(contenedorId);
    if (!contenedor) return;
    
    if (!comisiones || comisiones.length === 0) {
        contenedor.innerHTML = '<p style="text-align:center; padding:40px;">No hay comisiones para mostrar</p>';
        return;
    }
    
    const tarjetas = comisiones.map((comision, idx) => renderizarTarjeta(comision, idx)).join('');
    contenedor.innerHTML = tarjetas;
}

// Función para agregar UNA tarjeta al final
function agregarTarjeta(contenedorId, comision) {
    const contenedor = document.getElementById(contenedorId);
    if (!contenedor) return;
    
    const nuevaTarjeta = renderizarTarjeta(comision, Date.now());
    contenedor.insertAdjacentHTML('beforeend', nuevaTarjeta);
}