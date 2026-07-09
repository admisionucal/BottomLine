// DASHBOARD ==================================================

let currentLeadsRaw = [];
let currentLeads = [];
let currentPage = 1;
const PAGE_SIZE = 15;
const PAGES_PER_BLOCK = 20;
let lastUpdateTimeout = null;
let solicitudesPendientesDashboard = [];

// ===== Búsqueda por texto libre (ID PROMETEO / NOMBRE / TELÉFONO) =====
let terminoBusqueda = '';
let busquedaTimeout = null;

function onBusquedaInput() {
    if (busquedaTimeout) clearTimeout(busquedaTimeout);
    busquedaTimeout = setTimeout(() => {
        const input = document.getElementById('filterBusqueda');
        terminoBusqueda = input ? input.value.trim().toLowerCase() : '';
        aplicarFiltros();
    }, 250); // pequeño debounce para no re-renderizar en cada tecla
}

// ===== Estado de los filtros multi-selección =====
// Array vacío = "Todos/Todas" (sin filtrar por ese campo)
let filtrosMultiSelect = {
    carrera: [],
    ingreso: [],
    beneficio: [],
    modalidad: [],
    asesor: [],
    status: []
};

// Configuración de cada filtro multi-selección
const MS_CONFIG = {
    carrera:   { label: 'Todas' },
    ingreso:   { label: 'Todos' },
    beneficio: { label: 'Todos' },
    modalidad: { label: 'Todas' },
    asesor:    { label: 'Todos' },
    status:    { label: 'Todos', mapaLabels: (typeof STATUS_LABELS !== 'undefined' ? STATUS_LABELS : null) }
};

function initDashboard() {
    const user = requireAuth();
    if (!user) return;

    document.getElementById('userBadge').innerHTML =
        '👤 ' + user.nombre + ' <span class="rol ' + (user.rol === 'ADMIN' ? 'admin' : '') + '">' + user.rol + '</span>';

    if (user.rol === 'ADMIN') {
        const btnUnificar = document.getElementById('btnUnificar');
        if (btnUnificar) btnUnificar.style.display = 'inline-block';

        const filtersContainer = document.getElementById('filtersContainer');
        if (filtersContainer) filtersContainer.classList.add('cols-4');

        crearCampanaNotificaciones();
    } else {
        // ASESOR: los filtros de ASESOR y STATUS DE GESTIÓN no aplican
        const statusGroup = document.getElementById('filterStatusGroup');
        if (statusGroup) statusGroup.style.display = 'none';
        const asesorGroup = document.getElementById('filterAsesorGroup');
        if (asesorGroup) asesorGroup.style.display = 'none';
    }

    cargarCampanas();
}

function cargarCampanas() {
    const select = document.getElementById('selectCampana');
    if (!select) return;

    const campanas = getUserCampanas();
    select.innerHTML = '';

    if (campanas.length === 0) {
        select.innerHTML = '<option value="">Sin campañas asignadas</option>';
        return;
    }

    campanas.forEach(c => {
        const option = document.createElement('option');
        option.value = c;
        option.textContent = c;
        select.appendChild(option);
    });

    cargarLeads();
}

async function cargarLeads(forceRefresh = false) {
    const container = document.getElementById('tableContainer');
    const user = getCurrentUser();
    const campana = document.getElementById('selectCampana').value;

    if (!campana) {
        container.innerHTML = '<div class="loading">No hay campaña seleccionada</div>';
        return;
    }

    // Al cambiar de campaña, reseteamos la selección de todos los filtros
    resetearFiltrosMultiSelect();

    if (user.rol === 'ADMIN') cargarNotificacionesSolicitudes(campana);

    const cacheKey = `bl_leads_raw_${user.email}_${user.rol}_${campana}`;

    if (!forceRefresh) {
        const cachedRaw = sessionStorage.getItem(cacheKey);
        if (cachedRaw) {
            const cached = JSON.parse(cachedRaw);
            currentLeadsRaw = cached.data;
            poblarFiltros();
            aplicarFiltros();
            actualizarUltimaActualizacion(cached.timestamp);
            return;
        }
    }

    container.innerHTML = '<div class="loading">Cargando leads...</div>';

    try {
        // Ya NO se envían filtros al backend: se trae todo una vez y se filtra localmente
        const result = await getLeads(user.email, user.rol, campana, {});
        //if (result.timings) console.table(result.timings);

        if (result.success) {
            currentLeadsRaw = result.data || [];
            const timestamp = Date.now();
            sessionStorage.setItem(cacheKey, JSON.stringify({ data: currentLeadsRaw, timestamp }));
            poblarFiltros();
            aplicarFiltros();
            actualizarUltimaActualizacion(timestamp);
        } else {
            container.innerHTML = '<div class="loading">Error: ' + (result.error || 'No se pudieron cargar los leads') + '</div>';
        }
    } catch (error) {
        container.innerHTML = '<div class="loading">Error de conexión: ' + error.message + '</div>';
    }
}

function resetearFiltrosMultiSelect() {
    filtrosMultiSelect = { carrera: [], ingreso: [], beneficio: [], modalidad: [], asesor: [], status: [] };
    terminoBusqueda = '';
    const inputBusqueda = document.getElementById('filterBusqueda');
    if (inputBusqueda) inputBusqueda.value = '';
}

// escapeHtml ahora vive en config.js (compartido entre dashboard.js, lead-detail.js y unificar-ids.js)

// ===== FILTROS MULTI-SELECCIÓN (dropdown con checkboxes) =====

function crearMultiSelect(filtroKey, containerId, valores) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const config = MS_CONFIG[filtroKey];

    const unicos = [...new Set(
        valores.filter(v => v !== undefined && v !== null && String(v).trim() !== '')
               .map(v => String(v).trim())
    )].sort();

    // Conserva la selección previa, descartando valores que ya no existan (p.ej. tras cambiar de campaña)
    filtrosMultiSelect[filtroKey] = filtrosMultiSelect[filtroKey].filter(v => unicos.includes(v));

    if (unicos.length === 0) {
        container.innerHTML = '<button type="button" class="multiselect-btn" disabled>Sin datos</button>';
        return;
    }

    const necesitaBusqueda = unicos.length > 6;

    container.innerHTML = `
        <button type="button" class="multiselect-btn" data-filtro="${filtroKey}"></button>
        <div class="multiselect-panel">
            ${necesitaBusqueda ? '<div class="multiselect-search"><input type="text" placeholder="Buscar..."></div>' : ''}
            <div class="multiselect-actions">
                <button type="button" class="ms-link ms-select-all">Seleccionar todos</button>
                <button type="button" class="ms-link ms-clear">Limpiar</button>
            </div>
            <div class="multiselect-options">
                ${unicos.map(v => {
                    const checked = filtrosMultiSelect[filtroKey].includes(v) ? 'checked' : '';
                    const labelText = config.mapaLabels && config.mapaLabels[v] ? config.mapaLabels[v] : v;
                    return `<label class="multiselect-option"><input type="checkbox" value="${escapeHtml(v)}" ${checked}><span>${escapeHtml(labelText)}</span></label>`;
                }).join('')}
            </div>
        </div>
    `;

    actualizarBotonMultiSelect(filtroKey, containerId);

    // Toggle del panel
    const btn = container.querySelector('.multiselect-btn');
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePanelMultiSelect(containerId);
    });

    // Checkboxes individuales
    container.querySelectorAll('.multiselect-options input[type=checkbox]').forEach(chk => {
        chk.addEventListener('change', () => {
            const valor = chk.value;
            const arr = filtrosMultiSelect[filtroKey];
            if (chk.checked) {
                if (!arr.includes(valor)) arr.push(valor);
            } else {
                const idx = arr.indexOf(valor);
                if (idx > -1) arr.splice(idx, 1);
            }
            actualizarBotonMultiSelect(filtroKey, containerId);
            aplicarFiltros();
        });
    });

    // Seleccionar todos
    const selectAllBtn = container.querySelector('.ms-select-all');
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            filtrosMultiSelect[filtroKey] = [...unicos];
            container.querySelectorAll('.multiselect-options input[type=checkbox]').forEach(c => c.checked = true);
            actualizarBotonMultiSelect(filtroKey, containerId);
            aplicarFiltros();
        });
    }

    // Limpiar selección
    const clearBtn = container.querySelector('.ms-clear');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            filtrosMultiSelect[filtroKey] = [];
            container.querySelectorAll('.multiselect-options input[type=checkbox]').forEach(c => c.checked = false);
            actualizarBotonMultiSelect(filtroKey, containerId);
            aplicarFiltros();
        });
    }

    // Buscador dentro del panel (solo si hay muchas opciones)
    const searchInput = container.querySelector('.multiselect-search input');
    if (searchInput) {
        searchInput.addEventListener('click', (e) => e.stopPropagation());
        searchInput.addEventListener('input', () => {
            const term = searchInput.value.toLowerCase();
            container.querySelectorAll('.multiselect-option').forEach(opt => {
                const texto = opt.textContent.toLowerCase();
                opt.style.display = texto.includes(term) ? 'flex' : 'none';
            });
        });
    }
}

function actualizarBotonMultiSelect(filtroKey, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const btn = container.querySelector('.multiselect-btn');
    if (!btn) return;

    const seleccion = filtrosMultiSelect[filtroKey];
    const config = MS_CONFIG[filtroKey];

    if (seleccion.length === 0) {
        btn.textContent = config.label;
        btn.classList.remove('has-selection');
    } else if (seleccion.length === 1) {
        const labelText = config.mapaLabels && config.mapaLabels[seleccion[0]] ? config.mapaLabels[seleccion[0]] : seleccion[0];
        btn.textContent = labelText;
        btn.classList.add('has-selection');
    } else {
        btn.textContent = `${seleccion.length} seleccionados`;
        btn.classList.add('has-selection');
    }
}

function togglePanelMultiSelect(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const panel = container.querySelector('.multiselect-panel');
    if (!panel) return;
    const estaAbierto = panel.classList.contains('open');

    // Cierra cualquier otro panel abierto antes de abrir este
    document.querySelectorAll('.multiselect-panel.open').forEach(p => {
        if (p !== panel) p.classList.remove('open');
    });

    panel.classList.toggle('open', !estaAbierto);

    if (!estaAbierto) {
        setTimeout(() => document.addEventListener('click', cerrarMultiSelectFuera), 0);
    }
}

function cerrarMultiSelectFuera(e) {
    const abiertos = document.querySelectorAll('.multiselect-panel.open');
    if (abiertos.length === 0) {
        document.removeEventListener('click', cerrarMultiSelectFuera);
        return;
    }
    let clickDentro = false;
    abiertos.forEach(panel => {
        const wrapper = panel.closest('.multiselect');
        if (panel.contains(e.target) || (wrapper && wrapper.contains(e.target))) {
            clickDentro = true;
        }
    });
    if (!clickDentro) {
        abiertos.forEach(p => p.classList.remove('open'));
        document.removeEventListener('click', cerrarMultiSelectFuera);
    }
}

function poblarFiltros() {
    const user = getCurrentUser();

    crearMultiSelect('carrera', 'filterCarrera', currentLeadsRaw.map(l => l['CARRERA'] || l['PROGRAMA']));
    crearMultiSelect('ingreso', 'filterIngreso', currentLeadsRaw.map(l => l['MODALIDAD INGRESO']));
    crearMultiSelect('beneficio', 'filterBeneficio', currentLeadsRaw.map(l => l['BENEFICIO']));
    crearMultiSelect('modalidad', 'filterModalidad', currentLeadsRaw.map(l => l['MODALIDAD']));

    if (user.rol === 'ADMIN') {
        crearMultiSelect('asesor', 'filterAsesor', currentLeadsRaw.map(l => l['ASESOR ULT TIP DF SN CONTC']));
        crearMultiSelect('status', 'filterStatus', currentLeadsRaw.map(l => l['STATUS DE GESTION']));
    }
}

function aplicarFiltros() {
    const user = getCurrentUser();

    const filtros = {
        carrera: filtrosMultiSelect.carrera,
        ingreso: filtrosMultiSelect.ingreso,
        beneficio: filtrosMultiSelect.beneficio,
        modalidad: filtrosMultiSelect.modalidad,
        asesor: user.rol === 'ADMIN' ? filtrosMultiSelect.asesor : [],
        status: user.rol === 'ADMIN' ? filtrosMultiSelect.status : []
    };

    currentLeads = currentLeadsRaw.filter(lead => {
        const carreraValue = String(lead['CARRERA'] || lead['PROGRAMA'] || '').trim();
        const ingresoValue = String(lead['MODALIDAD INGRESO'] || '').trim();
        const modalidadValue = String(lead['MODALIDAD'] || '').trim();
        const statusValue = String(lead['STATUS DE GESTION'] || '').trim();
        const beneficioValue = String(lead['BENEFICIO'] || '').trim();
        const asesorValue = String(lead['ASESOR ULT TIP DF SN CONTC'] || '').trim();

        // Array vacío = sin filtro aplicado para ese campo (equivalente al "Todos" anterior)
        if (filtros.carrera.length > 0 && !filtros.carrera.includes(carreraValue)) return false;
        if (filtros.ingreso.length > 0 && !filtros.ingreso.includes(ingresoValue)) return false;
        if (filtros.modalidad.length > 0 && !filtros.modalidad.includes(modalidadValue)) return false;
        if (filtros.beneficio.length > 0 && !filtros.beneficio.includes(beneficioValue)) return false;
        if (user.rol === 'ADMIN' && filtros.asesor.length > 0 && !filtros.asesor.includes(asesorValue)) return false;
        if (user.rol === 'ADMIN' && filtros.status.length > 0 && !filtros.status.includes(statusValue)) return false;

        // Búsqueda por texto libre: ID PROMETEO, NOMBRE o TELÉFONO
        if (terminoBusqueda) {
            const idValue = String(lead['ID PROMETEO'] || '').toLowerCase();
            const nombreValue = String(lead['NOMBRES'] || '').toLowerCase();

            const coincide = idValue.includes(terminoBusqueda)
                || nombreValue.includes(terminoBusqueda)

            if (!coincide) return false;
        }

        return true;
    });

    currentPage = 1;
    renderTabla();
}

function renderTabla() {
    const user = getCurrentUser();
    const container = document.getElementById('tableContainer');
    if (!container) return;

    if (currentLeads.length === 0) {
        container.innerHTML = '<p style="padding:20px;color:#888;">No se encontraron registros para esta campaña.</p>';
        actualizarContadores(0, 0, 0);
        return;
    }

    const total = currentLeads.length;
    const totalPages = Math.ceil(total / PAGE_SIZE);
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, total);
    const paginatedLeads = currentLeads.slice(start, end);

    actualizarContadores(start + 1, end, total);

    const esAdmin = user.rol === 'ADMIN';
    const headers = esAdmin
        ? ['BOTTOM', 'ID PROMETEO', 'ASESOR', 'NOMBRE', 'CARRERA', 'BENEFICIO', 'BENEFICIO ADICIONAL']
        : ['BOTTOM', 'ID PROMETEO', 'NOMBRE', 'CARRERA', 'BENEFICIO', 'BENEFICIO ADICIONAL'];

    let html = '<div class="table-responsive"><table class="data-table"><thead><tr>';
    headers.forEach(h => html += `<th>${h}</th>`);
    html += '</tr></thead><tbody>';

    paginatedLeads.forEach(lead => {
        const id = lead['ID PROMETEO'] || '-';
        const nombre = lead['NOMBRES'] || lead['NOMBRE'] || 'Sin Nombre';
        const asesor = lead['ASESOR ULT TIP DF SN CONTC'] || 'Sin Nombre';
        const carrera = lead['CARRERA'] || lead['PROGRAMA'] || '-';
        const beneficio = lead['BENEFICIO'] || 'NO';
        const beneficioAdicional = lead['BENEFICIO ADICIONAL'] || 'NO';

        const perfil = lead['PERFILAMIENTO_COMPLETO'] || { respondidas: 0, total: 0, completo: false };
        const bottomLabel = perfil.completo
            ? '<span class="bottom-check completo">Check</span>'
            : (perfil.respondidas > 0
                ? `<span class="bottom-check parcial">${perfil.respondidas}/${perfil.total}</span>`
                : '<span class="bottom-check vacio">-</span>');

        html += `
            <tr>
                <td>${bottomLabel}</td>
                <td><a href="#" class="id-link" onclick="verDetalle('${escapeHtml(id)}'); return false;"><strong>${escapeHtml(id)}</strong></a></td>
                ${esAdmin ? `<td>${escapeHtml(asesor)}</td>` : ''}
                <td>${escapeHtml(nombre)}</td>
                <td>${escapeHtml(carrera)}</td>
                <td>${escapeHtml(beneficio)}</td>
                <td>${escapeHtml(beneficioAdicional)}</td>
            </tr>`;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
    renderPaginacion(totalPages);
}

function verDetalle(id) {
    const campana = document.getElementById('selectCampana')?.value || '26.2';
    const lead = currentLeads.find(l => String(l['ID PROMETEO']) === String(id));
    if (lead) {
        sessionStorage.setItem(`bl_selected_${id}_${campana}`, JSON.stringify(lead));
    }
    window.location.href = `lead-detail.html?id=${encodeURIComponent(id)}&campana=${encodeURIComponent(campana)}`;
}

function actualizarContadores(inicio, fin, total) {
    const leadCount = document.getElementById('leadCount');

    if (leadCount) leadCount.textContent = `${total} leads`;
}

function renderPaginacion(totalPages) {
    const container = document.getElementById('paginationPages');
    if (!container) return;
    container.innerHTML = '';

    if (totalPages <= 1) return;

    const bloqueActual = Math.floor((currentPage - 1) / PAGES_PER_BLOCK);
    const inicioBloque = bloqueActual * PAGES_PER_BLOCK + 1;
    const finBloque = Math.min(inicioBloque + PAGES_PER_BLOCK - 1, totalPages);

    // « Ir a la página anterior
    const btnPrev = document.createElement('button');
    btnPrev.textContent = '‹';
    btnPrev.disabled = currentPage === 1;
    btnPrev.onclick = () => cambiarPagina(currentPage - 1);
    container.appendChild(btnPrev);

    // ‹‹ Saltar al bloque de 20 páginas anterior
    if (inicioBloque > 1) {
        const btnBloqueAnterior = document.createElement('button');
        btnBloqueAnterior.textContent = '‹‹';
        btnBloqueAnterior.title = 'Páginas ' + (inicioBloque - PAGES_PER_BLOCK) + '-' + (inicioBloque - 1);
        btnBloqueAnterior.onclick = () => cambiarPagina(inicioBloque - 1);
        container.appendChild(btnBloqueAnterior);
    }

    // Botones de página dentro del bloque actual (máximo 20)
    for (let i = inicioBloque; i <= finBloque; i++) {
        const btn = document.createElement('button');
        btn.textContent = i;
        if (i === currentPage) btn.classList.add('active');
        btn.onclick = () => cambiarPagina(i);
        container.appendChild(btn);
    }

    // ›› Saltar al bloque de 20 páginas siguiente
    if (finBloque < totalPages) {
        const btnBloqueSiguiente = document.createElement('button');
        btnBloqueSiguiente.textContent = '››';
        btnBloqueSiguiente.title = 'Páginas ' + (finBloque + 1) + '-' + Math.min(finBloque + PAGES_PER_BLOCK, totalPages);
        btnBloqueSiguiente.onclick = () => cambiarPagina(finBloque + 1);
        container.appendChild(btnBloqueSiguiente);
    }

    // » Ir a la página siguiente
    const btnNext = document.createElement('button');
    btnNext.textContent = '›';
    btnNext.disabled = currentPage === totalPages;
    btnNext.onclick = () => cambiarPagina(currentPage + 1);
    container.appendChild(btnNext);
}

function cambiarPagina(nuevaPagina) {
    currentPage = nuevaPagina;
    renderTabla();
}

function irAUnificar() {
    window.location.href = 'unificar-ids.html';
}

function exportarCSV() {
    if (currentLeads.length === 0) {
        alert('No hay datos para exportar');
        return;
    }
    const headers = Object.keys(currentLeads[0]);
    let csvContent = headers.join(',') + '\n';

    currentLeads.forEach(row => {
        const values = headers.map(header => {
            const val = row[header] !== undefined && row[header] !== null ? String(row[header]) : '';
            return `"${val.replace(/"/g, '""')}"`;
        });
        csvContent += values.join(',') + '\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `Leads_${document.getElementById('selectCampana')?.value || 'Export'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function actualizarUltimaActualizacion(timestamp) {
    const el = document.getElementById('lastUpdate');
    if (!el || !timestamp) return;

    const fecha = new Date(timestamp);
    const texto = fecha.toLocaleString('es-PE', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });
    el.textContent = `Última actualización: ${texto}`;
    el.style.opacity = '1';

    if (lastUpdateTimeout) clearTimeout(lastUpdateTimeout);
    lastUpdateTimeout = setTimeout(() => {
        el.style.opacity = '0';
    }, 4000);
}

// ===== NOTIFICACIONES: SOLICITUDES DE ESCALA MENOR PENDIENTES (solo ADMIN) =====

async function cargarNotificacionesSolicitudes(campana) {
    try {
        const result = await getSolicitudesPendientesCampana(campana);
        solicitudesPendientesDashboard = (result && result.success) ? (result.data || []) : [];
    } catch (err) {
        console.error('Error cargando notificaciones de solicitudes:', err);
        solicitudesPendientesDashboard = [];
    }
    renderCampanaNotificaciones();
}

// Crea la campanita en el header (idempotente: no la duplica si ya existe)
function crearCampanaNotificaciones() {
    if (document.getElementById('campanaNotificaciones')) return;
    const headerRight = document.querySelector('.header-right');
    if (!headerRight) return;

    const wrapper = document.createElement('div');
    wrapper.id = 'campanaNotificaciones';
    wrapper.style.cssText = 'position:relative; cursor:pointer; display:flex; align-items:center;';
    wrapper.title = 'Solicitudes pendientes';
    wrapper.innerHTML = `
        <span style="font-size:20px;">🔔</span>
        <span id="campanaBadge" style="display:none; position:absolute; top:-6px; right:-8px; background:#d32f2f; color:white; border-radius:10px; font-size:11px; font-weight:700; padding:1px 6px; line-height:1.4; min-width:16px; text-align:center;">0</span>
    `;
    wrapper.addEventListener('click', toggleListaNotificaciones);

    const logoutBtn = headerRight.querySelector('.btn-logout');
    if (logoutBtn) headerRight.insertBefore(wrapper, logoutBtn);
    else headerRight.appendChild(wrapper);

    const panel = document.createElement('div');
    panel.id = 'panelNotificaciones';
    panel.style.cssText = 'display:none; position:fixed; width:340px; max-height:420px; overflow-y:auto; background:white; border-radius:10px; box-shadow:0 4px 20px rgba(0,0,0,0.18); z-index:1000;';
    document.body.appendChild(panel);
}

function toggleListaNotificaciones(e) {
    e.stopPropagation();
    const panel = document.getElementById('panelNotificaciones');
    const bell = document.getElementById('campanaNotificaciones');
    if (!panel || !bell) return;

    if (panel.style.display === 'block') {
        panel.style.display = 'none';
        document.removeEventListener('click', cerrarPanelNotificacionesFuera);
        return;
    }

    renderPanelNotificaciones();

    const rect = bell.getBoundingClientRect();
    panel.style.top = (rect.bottom + 8) + 'px';
    panel.style.right = (window.innerWidth - rect.right) + 'px';
    panel.style.display = 'block';

    setTimeout(() => document.addEventListener('click', cerrarPanelNotificacionesFuera), 0);
}

function cerrarPanelNotificacionesFuera(e) {
    const panel = document.getElementById('panelNotificaciones');
    const bell = document.getElementById('campanaNotificaciones');
    if (!panel) return;
    if (panel.contains(e.target) || (bell && bell.contains(e.target))) return;
    panel.style.display = 'none';
    document.removeEventListener('click', cerrarPanelNotificacionesFuera);
}

function renderPanelNotificaciones() {
    const panel = document.getElementById('panelNotificaciones');
    if (!panel) return;

    if (solicitudesPendientesDashboard.length === 0) {
        panel.innerHTML = '<div style="padding:24px 16px; color:#888; font-size:13px; text-align:center;">No hay solicitudes pendientes.</div>';
        return;
    }

    let html = '<div style="padding:12px 16px; border-bottom:1px solid #eee; font-weight:600; color:#1a237e; font-size:14px;">🔔 Solicitudes pendientes</div>';
    solicitudesPendientesDashboard.forEach(sol => {
        const asesor = sol.ASESOR_NOMBRE || sol.ASESOR_EMAIL || 'Asesor';
        html += `
            <div class="item-notificacion" data-id="${escapeHtml(sol.ID_PROMETEO)}" style="padding:12px 16px; border-bottom:1px solid #f0f0f0; cursor:pointer;">
                <div style="font-size:13px; color:#333;"><strong>${escapeHtml(asesor)}</strong> pidió cambiar boleta</div>
                <div style="font-size:12px; color:#666; margin-top:2px;">ID ${escapeHtml(sol.ID_PROMETEO)}: S/ ${escapeHtml(sol.BOLETA_ACTUAL)} → S/ ${escapeHtml(sol.BOLETA_SOLICITADA)}</div>
            </div>`;
    });
    panel.innerHTML = html;

    panel.querySelectorAll('.item-notificacion').forEach(item => {
        item.addEventListener('mouseover', () => item.style.background = '#fafbff');
        item.addEventListener('mouseout', () => item.style.background = 'white');
        item.addEventListener('click', () => irASolicitud(item.dataset.id));
    });
}

function irASolicitud(idPrometeo) {
    const campana = document.getElementById('selectCampana')?.value || '26.2';
    window.location.href = `lead-detail.html?id=${encodeURIComponent(idPrometeo)}&campana=${encodeURIComponent(campana)}`;
}

function renderCampanaNotificaciones() {
    crearCampanaNotificaciones();
    const badge = document.getElementById('campanaBadge');
    if (!badge) return;

    const count = solicitudesPendientesDashboard.length;
    if (count > 0) {
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }

    const panel = document.getElementById('panelNotificaciones');
    if (panel && panel.style.display === 'block') renderPanelNotificaciones();
}