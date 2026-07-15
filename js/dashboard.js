// DASHBOARD ==================================================

let currentLeadsRaw = [];
let currentLeads = [];
let currentPage = 1;
const PAGE_SIZE = 15;
const PAGES_PER_BLOCK = 20;
let lastUpdateTimeout = null;
let solicitudesPendientesDashboard = [];
let mapaPPVivas = {};
let calendarioMesActual = new Date();
let diaCalendarioSeleccionado = null;
let vistaCalendarioActual = 'mes'; // 'mes' | 'ano'

// ===== Búsqueda por texto libre (ID PROMETEO / NOMBRE / TELÉFONO) =====
let terminoBusqueda = '';
let busquedaTimeout = null;

function onBusquedaInput() {
    if (busquedaTimeout) clearTimeout(busquedaTimeout);
    busquedaTimeout = setTimeout(() => {
        const input = document.getElementById('filterBusqueda');
        terminoBusqueda = input ? input.value.trim().toLowerCase() : '';
        aplicarFiltros();
        poblarFiltros(); // la búsqueda libre también acota qué opciones tiene sentido mostrar en los dropdowns
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
            actualizarCalendarioPP();
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
            actualizarCalendarioPP();
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

// Fuerza traer los leads frescos del backend (ignora el caché de sessionStorage),
// con feedback visual en el botón mientras dura la recarga.
async function actualizarManual() {
    const btn = document.getElementById('btnActualizar');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Actualizando...';
    }
    try {
        await cargarLeads(true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '🔄 Actualizar';
        }
    }
}

// escapeHtml ahora vive en config.js (compartido entre dashboard.js, lead-detail.js y unificar-ids.js)

// ===== FILTROS INTERDEPENDIENTES =====
// Un lead "pasa" un set de filtros si cumple con TODAS las condiciones activas
// en ese set. Esta función es la ÚNICA fuente de verdad para decidir si un lead
// matchea — la usan tanto aplicarFiltros() (con TODOS los filtros activos, para
// la tabla) como poblarFiltros() (con "todos menos uno", para calcular qué
// opciones tienen sentido mostrar en cada dropdown).
function leadPasaFiltros(lead, filtrosActivos, esAdmin) {
    const carreraValue = String(lead['CARRERA'] || lead['PROGRAMA'] || '').trim();
    const ingresoValue = String(lead['MODALIDAD INGRESO'] || '').trim();
    const modalidadValue = String(lead['MODALIDAD'] || '').trim();
    const statusValue = String(lead['STATUS DE GESTION'] || '').trim();
    const beneficioValue = String(lead['BENEFICIO'] || '').trim();
    const asesorValue = String(lead['ASESOR ULT TIP DF SN CONTC'] || '').trim();

    if (filtrosActivos.carrera && filtrosActivos.carrera.length > 0 && !filtrosActivos.carrera.includes(carreraValue)) return false;
    if (filtrosActivos.ingreso && filtrosActivos.ingreso.length > 0 && !filtrosActivos.ingreso.includes(ingresoValue)) return false;
    if (filtrosActivos.modalidad && filtrosActivos.modalidad.length > 0 && !filtrosActivos.modalidad.includes(modalidadValue)) return false;
    if (filtrosActivos.beneficio && filtrosActivos.beneficio.length > 0 && !filtrosActivos.beneficio.includes(beneficioValue)) return false;
    if (esAdmin && filtrosActivos.asesor && filtrosActivos.asesor.length > 0 && !filtrosActivos.asesor.includes(asesorValue)) return false;
    if (esAdmin && filtrosActivos.status && filtrosActivos.status.length > 0 && !filtrosActivos.status.includes(statusValue)) return false;

    // Búsqueda por texto libre: ID PROMETEO o NOMBRE (aplica siempre, no es "excluible" por filtro)
    if (terminoBusqueda) {
        const idValue = String(lead['ID PROMETEO'] || '').toLowerCase();
        const nombreValue = String(lead['NOMBRES'] || '').toLowerCase();
        if (!idValue.includes(terminoBusqueda) && !nombreValue.includes(terminoBusqueda)) return false;
    }

    return true;
}

// Devuelve una copia de filtrosMultiSelect con la clave "filtroKeyExcluido" vacía
// (sin restringir por ese campo), y con asesor/status vacíos si el usuario no es
// ADMIN (esos filtros no aplican para ASESOR). Se usa para calcular, por cada
// dropdown, qué valores tienen sentido mostrar dado el resto de filtros activos.
function filtrosExcluyendo(filtroKeyExcluido, esAdmin) {
    const resultado = {};
    Object.keys(filtrosMultiSelect).forEach(key => {
        if (key === filtroKeyExcluido) {
            resultado[key] = [];
        } else if ((key === 'asesor' || key === 'status') && !esAdmin) {
            resultado[key] = [];
        } else {
            resultado[key] = filtrosMultiSelect[key];
        }
    });
    return resultado;
}

// ===== FILTROS MULTI-SELECCIÓN (dropdown con checkboxes) =====

function crearMultiSelect(filtroKey, containerId, valores) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const config = MS_CONFIG[filtroKey];

    // Preserva el estado visual del panel (abierto + término de búsqueda interno)
    // antes de reconstruir el HTML, porque poblarFiltros() puede llamar a esta
    // función mientras el usuario sigue interactuando con ESTE mismo dropdown
    // (por ejemplo, marcando varios checkboxes seguidos).
    const panelPrevio = container.querySelector('.multiselect-panel');
    const estabaAbierto = !!(panelPrevio && panelPrevio.classList.contains('open'));
    const searchInputPrevio = container.querySelector('.multiselect-search input');
    const terminoBusquedaPanelPrevio = searchInputPrevio ? searchInputPrevio.value : '';

    const unicos = [...new Set(
        valores.filter(v => v !== undefined && v !== null && String(v).trim() !== '')
               .map(v => String(v).trim())
    )].sort();

    // Conserva la selección previa, descartando valores que ya no existan (p.ej. tras
    // cambiar de campaña, o porque otro filtro ya los dejó fuera de combinación posible)
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
            poblarFiltros(); // recalcula qué opciones tienen sentido en los DEMÁS dropdowns
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
            poblarFiltros();
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
            poblarFiltros();
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

    // Restaura el estado que tenía este panel antes de la reconstrucción
    if (estabaAbierto) {
        const panelNuevo = container.querySelector('.multiselect-panel');
        if (panelNuevo) panelNuevo.classList.add('open');
        // El listener de "click afuera" es sobre document y es idempotente
        // (mismo callback ya registrado no se duplica), pero lo re-afirmamos
        // por si el panel se abrió recién al restaurar este estado.
        setTimeout(() => document.addEventListener('click', cerrarMultiSelectFuera), 0);

        if (searchInput && terminoBusquedaPanelPrevio) {
            searchInput.value = terminoBusquedaPanelPrevio;
            searchInput.dispatchEvent(new Event('input'));
        }
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

// Recalcula y repinta las opciones de CADA dropdown en base a los leads que
// pasan todos los DEMÁS filtros activos (excluyendo el propio filtro del
// dropdown que se está poblando). Esto es lo que hace que los filtros se
// afecten entre sí: si ya no hay leads que combinen con la selección actual,
// esa opción simplemente no aparece en el dropdown correspondiente.
function poblarFiltros() {
    const user = getCurrentUser();
    const esAdmin = user.rol === 'ADMIN';

    function valoresDisponibles(filtroKey, extractor) {
        const filtrosSinEste = filtrosExcluyendo(filtroKey, esAdmin);
        return currentLeadsRaw
            .filter(lead => leadPasaFiltros(lead, filtrosSinEste, esAdmin))
            .map(extractor);
    }

    crearMultiSelect('carrera', 'filterCarrera', valoresDisponibles('carrera', l => l['CARRERA'] || l['PROGRAMA']));
    crearMultiSelect('ingreso', 'filterIngreso', valoresDisponibles('ingreso', l => l['MODALIDAD INGRESO']));
    crearMultiSelect('beneficio', 'filterBeneficio', valoresDisponibles('beneficio', l => l['BENEFICIO']));
    crearMultiSelect('modalidad', 'filterModalidad', valoresDisponibles('modalidad', l => l['MODALIDAD']));

    if (esAdmin) {
        crearMultiSelect('asesor', 'filterAsesor', valoresDisponibles('asesor', l => l['ASESOR ULT TIP DF SN CONTC']));
        crearMultiSelect('status', 'filterStatus', valoresDisponibles('status', l => l['STATUS DE GESTION']));
    }
}

function aplicarFiltros() {
    const user = getCurrentUser();
    const esAdmin = user.rol === 'ADMIN';

    const filtrosActivos = {
        carrera: filtrosMultiSelect.carrera,
        ingreso: filtrosMultiSelect.ingreso,
        beneficio: filtrosMultiSelect.beneficio,
        modalidad: filtrosMultiSelect.modalidad,
        asesor: esAdmin ? filtrosMultiSelect.asesor : [],
        status: esAdmin ? filtrosMultiSelect.status : []
    };

    currentLeads = currentLeadsRaw.filter(lead => leadPasaFiltros(lead, filtrosActivos, esAdmin));

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

// ===== CALENDARIO DE PPs (PP Viva, PP Muerta, Pago Completo, Pago Fraccionado) =====
// Solo ADMIN ve las 4 categorías (Pago Completo/Fraccionado son exclusivas de
// ADMIN, ya vienen "chanceadas" desde el backend contra la hoja de pagos).
// El ASESOR sigue viendo únicamente PP Viva, sin cambios de comportamiento.

// Config de categorías: color, label, de qué status viene, y qué campo de fecha usar.
const CATEGORIAS_CALENDARIO = {
    viva: {
        label: 'PP Viva',
        color: '#1a237e',
        status: 'VALORES_PROMESA_DE_PAGO_VIVA',
        campoFecha: 'FECHA COMPROMISO DE PAGO'
    },
    muerta: {
        label: 'PP Muerta',
        color: '#5e35b1',
        status: 'VALORES_PROMESA_DE_PAGO_MUERTA',
        campoFecha: 'FECHA COMPROMISO DE PAGO'
    },
    pagoCompleto: {
        label: 'Pago Completo',
        color: '#2e7d32',
        status: 'PAGO COMPLETO',
        campoFecha: 'FECHA DE PAGO COMPLETO'
    },
    pagoFraccionado: {
        label: 'Pago Fraccionado',
        color: '#f9a825',
        status: 'PAGO FRACCIONADO',
        campoFecha: 'FECHA DE PROMESA DE PAGO'
    }
};

// Qué categorías están visibles ahora mismo (togglea desde la leyenda del popup).
// Por defecto solo "PP Viva" viene marcada; el admin activa las demás si lo necesita.
// Se resetea a este mismo default cada vez que se recarga la campaña.
let categoriasVisibles = { viva: true, muerta: false, pagoCompleto: false, pagoFraccionado: false };

function actualizarCalendarioPP() {
    const user = getCurrentUser();
    const esAdmin = user && user.rol === 'ADMIN';

    categoriasVisibles = { viva: true, muerta: false, pagoCompleto: false, pagoFraccionado: false };
    vistaCalendarioActual = 'mes';
    mapaPPVivas = esAdmin ? construirMapaCalendarioAdmin() : construirMapaPPVivasAsesor();
    calendarioMesActual = new Date(); // vuelve al mes actual cada vez que se recarga la campaña
    actualizarBadgeCalendarioTrigger();
    renderCalendarioPP(); // no-op si el popup del calendario está cerrado (el contenedor no existe)
}

// Badge sobre el botón "Calendario de PPs" con el total del MES ACTUAL,
// contando solo las categorías visibles ahora mismo.
function actualizarBadgeCalendarioTrigger() {
    const badge = document.getElementById('calTriggerBadge');
    if (!badge) return;
    const hoy = new Date();
    const prefijoMesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    let total = 0;
    Object.keys(mapaPPVivas).forEach(clave => {
        if (!clave.startsWith(prefijoMesActual)) return;
        total += itemsVisiblesDelDia(clave).length;
    });
    if (total > 0) {
        badge.textContent = total > 99 ? '99+' : String(total);
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}

// Abre el calendario como popup (no se mantiene fijo en el layout)
function abrirCalendarioPopup() {
    if (document.getElementById('calCalendarioPopupOverlay')) return; // ya está abierto

    const user = getCurrentUser();
    const esAdmin = user && user.rol === 'ADMIN';

    vistaCalendarioActual = 'mes'; // siempre arranca en vista mensual

    const modalHtml = `
        <div class="cal-modal-overlay" id="calCalendarioPopupOverlay" onclick="cerrarCalendarioPopup(event)">
            <div class="cal-modal cal-modal-calendario ${esAdmin ? 'con-leyenda' : ''}" onclick="event.stopPropagation()">
                <div class="cal-modal-header">
                    <strong>📅 Calendario de PPs</strong>
                    <div class="cal-view-toggle">
                        <button data-vista="mes" class="activo" onclick="cambiarVistaCalendario('mes')">Mes</button>
                        <button data-vista="ano" onclick="cambiarVistaCalendario('ano')">Año</button>
                    </div>
                    <button class="cal-modal-close" onclick="cerrarCalendarioPopup()">✕</button>
                </div>
                <div class="cal-modal-content">
                    <div class="cal-modal-body" id="calendarioPPContainer"></div>
                    ${esAdmin ? '<div class="cal-leyenda" id="calLeyenda"></div>' : ''}
                </div>
            </div>
        </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    if (esAdmin) renderLeyendaCalendario();
    renderCalendarioPP();
}

// Cambia entre la vista mensual y la vista de los 12 meses del año a la vez.
function cambiarVistaCalendario(vista) {
    vistaCalendarioActual = vista;
    const modal = document.querySelector('.cal-modal-calendario');
    if (modal) modal.classList.toggle('vista-anio', vista === 'ano');
    document.querySelectorAll('.cal-view-toggle button').forEach(btn => {
        btn.classList.toggle('activo', btn.dataset.vista === vista);
    });
    renderCalendarioPP();
}

function cerrarCalendarioPopup(e) {
    if (e && e.target && e.target.id !== 'calCalendarioPopupOverlay') return;
    const overlay = document.getElementById('calCalendarioPopupOverlay');
    if (overlay) overlay.remove();
}

// Leyenda con checkboxes: togglea qué categorías se ven en el grid, en el
// detalle del día, y en el Excel exportado (todo lee categoriasVisibles).
function renderLeyendaCalendario() {
    const cont = document.getElementById('calLeyenda');
    if (!cont) return;

    let html = '<div class="cal-leyenda-items">';
    Object.keys(CATEGORIAS_CALENDARIO).forEach(key => {
        const cat = CATEGORIAS_CALENDARIO[key];
        const checked = categoriasVisibles[key] ? 'checked' : '';
        // El label se parte en 2 líneas ("Pago" / "Fraccionado") para que entre
        // cómodo en la columna angosta sin recortarse ni verse apretado.
        const [linea1, ...resto] = cat.label.split(' ');
        const linea2 = resto.join(' ');
        html += `
            <label class="cal-leyenda-item ${checked ? 'activo' : ''}" data-categoria="${key}" style="--cat-color:${cat.color};">
                <input type="checkbox" data-categoria="${key}" ${checked} onchange="toggleCategoriaCalendario('${key}', this.checked)">
                <span class="cal-leyenda-badge">
                    <span class="cal-leyenda-badge-linea">${escapeHtml(linea1)}</span>
                    ${linea2 ? `<span class="cal-leyenda-badge-linea">${escapeHtml(linea2)}</span>` : ''}
                </span>
            </label>`;
    });
    html += '</div>';
    cont.innerHTML = html;
}

function toggleCategoriaCalendario(key, visible) {
    categoriasVisibles[key] = visible;
    renderCalendarioPP();
    renderLeyendaCalendario();
    actualizarBadgeCalendarioTrigger();
    // Si el popup de detalle del día está abierto, se refresca respetando la nueva selección
    if (diaCalendarioSeleccionado && document.getElementById('calModalOverlay')) {
        abrirDetalleDia(diaCalendarioSeleccionado);
    }
}

// Intenta parsear fechas en varios formatos posibles (ISO, DD/MM/YYYY, etc.)
function parsearFechaFlexible(valor) {
    if (!valor) return null;
    if (valor instanceof Date) return isNaN(valor.getTime()) ? null : valor;
    const str = String(valor).trim();
    if (!str) return null;

    let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        return isNaN(d.getTime()) ? null : d;
    }

    m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (m) {
        const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        return isNaN(d.getTime()) ? null : d;
    }

    const fallback = new Date(str);
    return isNaN(fallback.getTime()) ? null : fallback;
}

function fechaAClaveISO(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// Arma el "background" inline de una celda con datos: si hay una sola
// categoría ese día, la celda entera se pinta de su color; si hay varias,
// se reparte el ancho en partes iguales para que compartan el color.
function construirFondoCelda(categorias) {
    if (!categorias || categorias.length === 0) return '';
    const colores = categorias.map(key => (CATEGORIAS_CALENDARIO[key] ? CATEGORIAS_CALENDARIO[key].color : '#1a237e'));
    if (colores.length === 1) return `background:${colores[0]};`;

    const paso = 100 / colores.length;
    const stops = colores.map((color, i) =>
        `${color} ${(i * paso).toFixed(2)}%, ${color} ${((i + 1) * paso).toFixed(2)}%`
    ).join(', ');
    return `background: linear-gradient(to right, ${stops});`;
}

// ASESOR: mismo comportamiento de siempre — solo PP Viva, un array plano por día.
function construirMapaPPVivasAsesor() {
    const mapa = {};
    currentLeadsRaw.forEach(lead => {
        const status = String(lead['STATUS DE GESTION'] || '').trim();
        if (status !== 'VALORES_PROMESA_DE_PAGO_VIVA') return;

        const fecha = parsearFechaFlexible(lead['FECHA COMPROMISO DE PAGO']);
        if (!fecha) return;

        const clave = fechaAClaveISO(fecha);
        if (!mapa[clave]) mapa[clave] = [];
        mapa[clave].push(lead);
    });
    return mapa;
}

// ADMIN: 4 categorías por día. Cada día guarda { viva: [...], muerta: [...],
// pagoCompleto: [...], pagoFraccionado: [...] } — cada lead se clasifica según
// su STATUS DE GESTION (ya viene "chanceado" desde el backend) y se grafica
// en la fecha correspondiente a esa categoría (ver CATEGORIAS_CALENDARIO).
function construirMapaCalendarioAdmin() {
    const mapa = {};
    currentLeadsRaw.forEach(lead => {
        const status = String(lead['STATUS DE GESTION'] || '').trim();
        const catKey = Object.keys(CATEGORIAS_CALENDARIO).find(k => CATEGORIAS_CALENDARIO[k].status === status);
        if (!catKey) return;

        const campoFecha = CATEGORIAS_CALENDARIO[catKey].campoFecha;
        const fecha = parsearFechaFlexible(lead[campoFecha]);
        if (!fecha) return;

        const clave = fechaAClaveISO(fecha);
        if (!mapa[clave]) mapa[clave] = { viva: [], muerta: [], pagoCompleto: [], pagoFraccionado: [] };
        mapa[clave][catKey].push(lead);
    });
    return mapa;
}

// Devuelve los leads de un día respetando categoriasVisibles, cada uno con
// su categoría anotada (para poder colorear/etiquetar en el detalle del día).
// Funciona tanto para el formato de ADMIN (objeto por categoría) como el
// formato plano de ASESOR (array simple, siempre categoría "viva").
function itemsVisiblesDelDia(claveDia) {
    const datosDia = mapaPPVivas[claveDia];
    if (!datosDia) return [];

    if (Array.isArray(datosDia)) {
        // Formato ASESOR: siempre PP Viva, siempre visible (no hay leyenda para asesor)
        return datosDia.map(lead => ({ lead, categoria: 'viva' }));
    }

    // Formato ADMIN: objeto con las 4 categorías
    let items = [];
    Object.keys(CATEGORIAS_CALENDARIO).forEach(key => {
        if (!categoriasVisibles[key]) return;
        (datosDia[key] || []).forEach(lead => items.push({ lead, categoria: key }));
    });
    return items;
}

function renderCalendarioPP() {
    const cont = document.getElementById('calendarioPPContainer');
    if (!cont) return;

    if (vistaCalendarioActual === 'ano') {
        renderCalendarioAnio(cont);
        return;
    }

    const year = calendarioMesActual.getFullYear();
    const month = calendarioMesActual.getMonth();

    const nombreMes = calendarioMesActual.toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });
    const primerDiaSemana = new Date(year, month, 1).getDay();
    const diasEnMes = new Date(year, month + 1, 0).getDate();
    const prefijoMes = `${year}-${String(month + 1).padStart(2, '0')}`;

    let totalMes = 0;
    Object.keys(mapaPPVivas).forEach(clave => {
        if (clave.startsWith(prefijoMes)) totalMes += itemsVisiblesDelDia(clave).length;
    });

    const hoyClave = fechaAClaveISO(new Date());

    let celdas = '';
    for (let i = 0; i < primerDiaSemana; i++) celdas += `<div class="cal-celda vacia"></div>`;

    for (let dia = 1; dia <= diasEnMes; dia++) {
        const claveDia = `${prefijoMes}-${String(dia).padStart(2, '0')}`;
        const items = itemsVisiblesDelDia(claveDia);
        const cantidad = items.length;
        const esHoy = claveDia === hoyClave;

        // El día entero se pinta del color de su categoría (o repartido entre
        // colores si hay más de una categoría ese día) — cada filtro "es" su color.
        const categoriasDelDia = [...new Set(items.map(it => it.categoria))];
        const estiloFondo = cantidad > 0 ? construirFondoCelda(categoriasDelDia) : '';

        celdas += `
            <div class="cal-celda ${cantidad > 0 ? 'con-datos' : ''} ${esHoy ? 'hoy' : ''}"
                 style="${estiloFondo}"
                 ${cantidad > 0 ? `onclick="abrirDetalleDia('${claveDia}')"` : ''}
                 title="${cantidad > 0 ? cantidad + ' registro(s)' : ''}">
                <span class="cal-numero">${dia}</span>
                ${cantidad > 0 ? `<span class="cal-badge">${cantidad}</span>` : ''}
            </div>`;
    }

    cont.innerHTML = `
        <div class="cal-header">
            <button class="cal-nav" onclick="cambiarMesCalendario(-1)">‹</button>
            <div class="cal-titulo">
                <strong style="text-transform:capitalize;">${nombreMes}</strong>
                <span class="cal-total">${totalMes} registro${totalMes === 1 ? '' : 's'}</span>
            </div>
            <button class="cal-nav" onclick="cambiarMesCalendario(1)">›</button>
        </div>
        <div class="cal-dias-semana"><span>D</span><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span></div>
        <div class="cal-grid">${celdas}</div>
    `;
}

function cambiarMesCalendario(delta) {
    calendarioMesActual = new Date(calendarioMesActual.getFullYear(), calendarioMesActual.getMonth() + delta, 1);
    renderCalendarioPP();
}

// Vista de año: 12 mini-calendarios a la vez, para ver toda la campaña de un
// vistazo en vez de navegar mes a mes. Cada mini-día con datos abre el mismo
// popup de detalle del día que la vista mensual.
function renderCalendarioAnio(cont) {
    const year = calendarioMesActual.getFullYear();
    const hoyClave = fechaAClaveISO(new Date());

    let totalAnio = 0;
    Object.keys(mapaPPVivas).forEach(clave => {
        if (clave.startsWith(String(year))) totalAnio += itemsVisiblesDelDia(clave).length;
    });

    let mesesHtml = '';
    for (let m = 0; m < 12; m++) {
        const nombreMes = new Date(year, m, 1).toLocaleDateString('es-PE', { month: 'long' });
        const primerDiaSemana = new Date(year, m, 1).getDay();
        const diasEnMes = new Date(year, m + 1, 0).getDate();
        const prefijoMes = `${year}-${String(m + 1).padStart(2, '0')}`;

        let totalMes = 0;
        let celdas = '';
        for (let i = 0; i < primerDiaSemana; i++) celdas += `<div class="cal-mini-celda vacia"></div>`;

        for (let dia = 1; dia <= diasEnMes; dia++) {
            const claveDia = `${prefijoMes}-${String(dia).padStart(2, '0')}`;
            const itemsDia = itemsVisiblesDelDia(claveDia);
            const cantidad = itemsDia.length;
            totalMes += cantidad;
            const esHoy = claveDia === hoyClave;
            const categoriasDia = [...new Set(itemsDia.map(it => it.categoria))];
            const estiloFondo = cantidad > 0 ? construirFondoCelda(categoriasDia) : '';

            celdas += `
                <div class="cal-mini-celda ${cantidad > 0 ? 'con-datos' : ''} ${esHoy ? 'hoy' : ''}"
                     style="${estiloFondo}"
                     ${cantidad > 0 ? `onclick="abrirDetalleDia('${claveDia}')"` : ''}
                     title="${cantidad > 0 ? cantidad + ' registro(s)' : ''}">${dia}</div>`;
        }

        mesesHtml += `
            <div class="cal-mini-mes">
                <div class="cal-mini-header" onclick="irAMes(${year}, ${m})" title="Ver ${nombreMes} en detalle" style="text-transform:capitalize;">${nombreMes}</div>
                <div class="cal-mini-dias-semana"><span>D</span><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span></div>
                <div class="cal-mini-grid">${celdas}</div>
                <div class="cal-mini-total">${totalMes > 0 ? totalMes + ' reg.' : '—'}</div>
            </div>`;
    }

    cont.innerHTML = `
        <div class="cal-header">
            <button class="cal-nav" onclick="cambiarAnioCalendario(-1)">‹</button>
            <div class="cal-titulo">
                <strong>${year}</strong>
                <span class="cal-total">${totalAnio} registro${totalAnio === 1 ? '' : 's'}</span>
            </div>
            <button class="cal-nav" onclick="cambiarAnioCalendario(1)">›</button>
        </div>
        <div class="cal-anio-grid">${mesesHtml}</div>
    `;
}

function cambiarAnioCalendario(delta) {
    calendarioMesActual = new Date(calendarioMesActual.getFullYear() + delta, calendarioMesActual.getMonth(), 1);
    renderCalendarioPP();
}

// Salta de la vista de año a la vista mensual, ya ubicado en el mes elegido.
function irAMes(year, month) {
    calendarioMesActual = new Date(year, month, 1);
    cambiarVistaCalendario('mes');
}

function abrirDetalleDia(claveDia) {
    diaCalendarioSeleccionado = claveDia;
    const items = itemsVisiblesDelDia(claveDia);
    const [yyyy, mm, dd] = claveDia.split('-');
    const fechaLegible = `${dd}/${mm}/${yyyy}`;

    const user = getCurrentUser();
    const esAdmin = user && user.rol === 'ADMIN';

    let filas = '';
    items.forEach(({ lead, categoria }) => {
        const id = lead['ID PROMETEO'] || '-';
        const carrera = lead['CARRERA'] || lead['PROGRAMA'] || '-';
        const modalidadIngreso = lead['MODALIDAD INGRESO'] || '-';
        const modalidad = lead['MODALIDAD'] || '-';
        const boletaFinal = lead['BOLETA_FINAL'] || lead['BOLETA FINAL'] || '-';
        const asesor = lead['ASESOR ULT TIP DF SN CONTC'] || '-';
        const cat = CATEGORIAS_CALENDARIO[categoria];
        filas += `
            <tr>
                ${esAdmin ? `<td><span class="cal-dot" style="background:${cat.color};"></span> ${escapeHtml(cat.label)}</td>` : ''}
                <td><a href="#" class="id-link" onclick="verDetalleDesdeCalendario('${escapeHtml(id)}'); return false;">${escapeHtml(id)}</a></td>
                <td>${escapeHtml(carrera)}</td>
                <td>${escapeHtml(modalidadIngreso)}</td>
                <td>${escapeHtml(modalidad)}</td>
                <td>S/ ${escapeHtml(boletaFinal)}</td>
                ${esAdmin ? `<td>${escapeHtml(asesor)}</td>` : ''}
            </tr>`;
    });

    const colspan = esAdmin ? 7 : 5;

    const modalHtml = `
        <div class="cal-modal-overlay cal-modal-overlay-top" id="calModalOverlay" onclick="cerrarDetalleDia(event)">
            <div class="cal-modal" onclick="event.stopPropagation()">
                <div class="cal-modal-header">
                    <strong>📅 ${fechaLegible}</strong>
                    <button class="cal-modal-close" onclick="cerrarDetalleDia()">✕</button>
                </div>
                <div class="cal-modal-toolbar">
                    <span>${items.length} registro${items.length === 1 ? '' : 's'}</span>
                    <button class="btn-export" onclick="exportarDiaExcel()">📥 Exportar Excel</button>
                </div>
                <div class="cal-modal-body">
                    <table>
                        <thead><tr>
                            ${esAdmin ? '<th>CATEGORÍA</th>' : ''}<th>ID</th><th>CARRERA</th><th>MODALIDAD INGRESO</th><th>MODALIDAD</th><th>BOLETA FINAL</th>${esAdmin ? '<th>ASESOR</th>' : ''}
                        </tr></thead>
                        <tbody>${filas || `<tr><td colspan="${colspan}" style="text-align:center;color:#888;padding:20px;">Sin registros</td></tr>`}</tbody>
                    </table>
                </div>
            </div>
        </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function cerrarDetalleDia(e) {
    if (e && e.target && e.target.id !== 'calModalOverlay') return;
    const overlay = document.getElementById('calModalOverlay');
    if (overlay) overlay.remove();
    diaCalendarioSeleccionado = null;
}

function verDetalleDesdeCalendario(id) {
    const campana = document.getElementById('selectCampana')?.value || '26.2';
    const lead = currentLeadsRaw.find(l => String(l['ID PROMETEO']) === String(id));
    if (lead) sessionStorage.setItem(`bl_selected_${id}_${campana}`, JSON.stringify(lead));
    window.location.href = `lead-detail.html?id=${encodeURIComponent(id)}&campana=${encodeURIComponent(campana)}`;
}

// El export respeta exactamente lo que está visible en el detalle del día
// (mismas categorías toggleadas en la leyenda).
function exportarDiaExcel() {
    if (!diaCalendarioSeleccionado) return;
    const items = itemsVisiblesDelDia(diaCalendarioSeleccionado);
    if (items.length === 0) {
        alert('No hay datos para exportar');
        return;
    }

    const user = getCurrentUser();
    const esAdmin = user && user.rol === 'ADMIN';

    const filasExport = items.map(({ lead, categoria }) => {
        const fila = {};
        if (esAdmin) fila['CATEGORÍA'] = CATEGORIAS_CALENDARIO[categoria].label;
        fila['ID PROMETEO'] = lead['ID PROMETEO'] || '';
        fila['CARRERA'] = lead['CARRERA'] || lead['PROGRAMA'] || '';
        fila['MODALIDAD INGRESO'] = lead['MODALIDAD INGRESO'] || '';
        fila['MODALIDAD'] = lead['MODALIDAD'] || '';
        fila['BOLETA FINAL'] = lead['BOLETA_FINAL'] || lead['BOLETA FINAL'] || '';
        if (esAdmin) fila['ASESOR'] = lead['ASESOR ULT TIP DF SN CONTC'] || '';
        return fila;
    });

    const ws = XLSX.utils.json_to_sheet(filasExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Calendario');

    const campana = document.getElementById('selectCampana')?.value || 'Campana';
    XLSX.writeFile(wb, `Calendario_${diaCalendarioSeleccionado}_${campana}.xlsx`);
}