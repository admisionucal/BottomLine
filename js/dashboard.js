// ================================================================
// DASHBOARD - Módulo principal de leads
// ================================================================

import { 
    API_URL, COLUMNAS, STATUS, STATUS_LABELS, STATUS_CLASES,
    CACHE_KEYS, SELECT_OPTIONS, PRECIOS_BASE,
    esRolSupervisorOAdmision, ROLES
} from '../core/constants.js';

import {
    getCurrentUser, getUserCampanas, getSessionToken,
    cacheGet, cacheSet, cacheRemove,
    escapeHtml, normalizarTexto, parseNumero,
    horaAMinutos, minutosAHora, diffHoras, horasLabel,
    parsearFechaFlexible, fechaAClaveISO, fechaDDMMYYYY, hoyDDMMYYYY,
    nowPeru, formato12h, parsearHistorial
} from '../core/utils.js';

import { Sidebar, Toast, Modal, createMultiSelect, sortTable, toggleMultiSelect, renderTable } from '../core/components.js';

// ===== ESTADO =====
let state = {
    leadsRaw: [],
    leadsFiltered: [],
    currentPage: 1,
    pageSize: 11,
    pagesPerBlock: 20,
    terminoBusqueda: '',
    filtros: {
        carrera: [], ingreso: [], beneficio: [], modalidad: [], asesor: [], perfil: [], dolorNecesidad: [],
        status: [STATUS.VP_VIVA, STATUS.PP_VIVA]
    },
    campana: '',
    calCampanas: [],
    calLeadsPorCampana: {},
    mapaCalendario: {},
    categoriasVisibles: { viva: true, muerta: false, pagoCompleto: false, pagoFraccionado: false },
    calendarioMes: new Date(),
    vistaCalendario: 'mes',
    diaSeleccionado: null,
    ultimaActualizacion: null
};

// Config de categorías del calendario: color, label, de qué status viene, y qué campo de fecha usar.
// Solo SUPERVISOR/ADMISION ven las 4 categorías; el ASESOR solo ve PP Viva.
const CATEGORIAS_CALENDARIO = {
    viva: { label: 'PP Viva', color: '#0040A1', status: STATUS.PP_VIVA, campoFecha: COLUMNAS.FECHA_COMPROMISO_PAGO },
    muerta: { label: 'PP Muerta', color: '#5e35b1', status: STATUS.PP_MUERTA, campoFecha: COLUMNAS.FECHA_COMPROMISO_PAGO },
    pagoCompleto: { label: 'Pago Completo', color: '#2e7d32', status: STATUS.PAGO_COMPLETO, campoFecha: COLUMNAS.FECHA_PAGO_COMPLETO },
    pagoFraccionado: { label: 'Pago Fraccionado', color: '#f9a825', status: STATUS.PAGO_FRACCIONADO, campoFecha: COLUMNAS.FECHA_PROMESA_PAGO }
};

// ===== INICIALIZACIÓN =====
document.addEventListener('DOMContentLoaded', async () => {
    const user = getCurrentUser();
    if (!user) {
        window.location.href = 'index.html';
        return;
    }

    // Vista inicial: por defecto "Usuario", pero si venimos de otra página
    // (ej. al volver desde Lead Detail / Unificar IDs / Condiciones
    // Comerciales vía dashboard.html?view=bottomline) respetamos esa vista.
    const vistaInicial = new URLSearchParams(window.location.search).get('view') || 'usuario';
    const gruposBottomLine = ['bottomline', 'calendario', 'unificar', 'cc'];
    const activaInicial = gruposBottomLine.includes(vistaInicial) ? 'bottomline' : vistaInicial;
    const subitemPorVista = { bottomline: 'navDashboardBL' };

    // Inyectar Sidebar y Header
    const sidebar = new Sidebar({ active: activaInicial });

    // Configurar UI
    setupUI(user);
    if (esRolSupervisorOAdmision(user.rol)) actualizarBadgeCC();
    await loadCampanas(user);
    setupCalendarioCampanaFiltro(user);
    setupBuscador();
    await loadLeads();
    await cargarLeadsCalendario();

    // Eventos
    document.getElementById('btnActualizar')?.addEventListener('click', () => loadLeads(true));
    document.getElementById('btnExportar')?.addEventListener('click', exportarExcel);
    document.getElementById('filtrosToggleBtn')?.addEventListener('click', toggleFiltrosPanel);
    setupAutoHideToolbar();

    // Mostrar la vista embebida correspondiente
    if (vistaInicial === 'bottomline' && typeof window.mostrarBottomLine === 'function') {
        window.mostrarBottomLine();
    } else if (vistaInicial === 'calendario' && typeof window.mostrarCalendario === 'function') {
        window.mostrarCalendario();
    } else if (vistaInicial === 'unificar' && typeof window.mostrarUnificar === 'function') {
        window.mostrarUnificar();
    } else if (vistaInicial === 'cc' && typeof window.mostrarCC === 'function') {
        window.mostrarCC();
    } else if (vistaInicial === 'asistencia' && typeof window.mostrarAsistencia === 'function') {
        window.mostrarAsistencia();
    } else if (typeof window.mostrarUsuario === 'function') {
        window.mostrarUsuario();
    }
});

// La barra de "Filtros / N leads" (+ el panel de filtros si está abierto) se
// oculta al bajar y reaparece al subir, para maximizar el espacio de la
// tabla — igual que un navbar que se auto-esconde. No hace nada si el
// usuario está en otra vista (el elemento solo importa cuando existe y es
// visible dentro de Bottom Line).
function setupAutoHideToolbar() {
    const barra = document.getElementById('tableControlsSticky');
    const filtros = document.getElementById('navFiltrosPanel');
    if (!barra) return;

    let ultimoScrollY = window.scrollY;
    let ticking = false;
    const UMBRAL = 8; // px mínimos de movimiento para no titilar con scrolls minúsculos

    window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            // Con el panel de Filtros abierto no se auto-oculta la barra: evita que
            // la barra (con transform) y el panel (en flujo normal, debajo) se
            // disputen el mismo espacio visual mientras el usuario está filtrando.
            if (filtros && filtros.classList.contains('open')) {
                barra.classList.remove('oculto');
                ultimoScrollY = window.scrollY;
                ticking = false;
                return;
            }

            const actual = window.scrollY;
            const delta = actual - ultimoScrollY;

            if (Math.abs(delta) > UMBRAL) {
                if (delta > 0 && actual > barra.offsetHeight) {
                    barra.classList.add('oculto'); // bajando: se esconde
                } else {
                    barra.classList.remove('oculto'); // subiendo: reaparece
                }
                ultimoScrollY = actual;
            }
            ticking = false;
        });
    }, { passive: true });
}

// ===== CONFIGURACIÓN UI =====
function setupUI(user) {
    // Mostrar/ocultar filtros según rol
    const esAdmin = esRolSupervisorOAdmision(user.rol);
    const asesorGroup = document.getElementById('filterAsesorGroup');
    if (!esAdmin && asesorGroup) asesorGroup.style.display = 'none';

    if (esAdmin) {

        const filtersContainer = document.getElementById('filtersContainer');
        if (filtersContainer) filtersContainer.classList.add('cols-4');

        // Asistencia > Marcación: EXCLUSIVA de ASESOR
        const navMarcacion = document.getElementById('navAsistenciaMarcacion');
        if (navMarcacion) navMarcacion.style.display = 'none';
    }
}

// ===== BUSCADOR (toolbar de Bottom Line) =====
// Precarga el término restaurado desde caché (ver loadCampanas) y filtra
// en vivo con un pequeño debounce mientras el usuario escribe.
function setupBuscador() {
    const input = document.getElementById('dashboardSearchInput');
    if (!input) return;

    input.value = state.terminoBusqueda || '';

    let debounceId = null;
    input.addEventListener('input', () => {
        clearTimeout(debounceId);
        debounceId = setTimeout(() => {
            state.terminoBusqueda = input.value.trim().toLowerCase();
            applyFilters();
        }, 200);
    });
}

// ===== CAMPANAS =====
async function loadCampanas(user) {
    const campanas = getUserCampanas();
    const select = document.getElementById('selectCampana');
    if (!select) return;

    select.innerHTML = '';
    if (campanas.length === 0) {
        select.innerHTML = '<option value="">Sin campañas asignadas</option>';
        return;
    }

    campanas.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        select.appendChild(opt);
    });

    // Restaurar campaña guardada
    const saved = cacheGet(CACHE_KEYS.FILTROS_ESTADO);
    if (saved && saved.campana && campanas.includes(saved.campana)) {
        select.value = saved.campana;
        // Merge (no overwrite) por si el caché quedó de una versión anterior
        // que todavía no tenía la key "dolorNecesidad" (u otra futura).
        if (saved.filtros) state.filtros = { ...state.filtros, ...saved.filtros };
        if (saved.busqueda) state.terminoBusqueda = saved.busqueda;
    }

    state.campana = select.value || campanas[0];
    renderCampanaOptions(campanas);
}

function renderCampanaOptions(campanas) {
    const container = document.getElementById('campanaOptions');
    const select = document.getElementById('selectCampana');
    if (!container || !select || campanas.length === 0) return;

    const seleccionActual = select.value || campanas[0];
    const panelPrevio = container.querySelector('.multiselect-panel');
    const estabaAbierto = panelPrevio?.classList.contains('open') || false;

    container.innerHTML = `
        <button type="button" class="multiselect-btn" onclick="window.toggleMultiSelect && window.toggleMultiSelect('campanaOptions')">
            ${escapeHtml(seleccionActual)}
        </button>
        <div class="multiselect-panel">
            <div class="multiselect-options">
                ${campanas.map(c => `
                    <label class="multiselect-option">
                        <input type="radio" name="campanaRadio" value="${escapeHtml(c)}" ${seleccionActual === c ? 'checked' : ''}>
                        <span>${escapeHtml(c)}</span>
                    </label>
                `).join('')}
            </div>
        </div>
    `;

    container.querySelectorAll('input[type=radio]').forEach(radio => {
        radio.addEventListener('change', () => {
            select.value = radio.value;
            const btn = container.querySelector('.multiselect-btn');
            if (btn) btn.textContent = radio.value;
            const panel = container.querySelector('.multiselect-panel');
            if (panel) panel.classList.remove('open');
            state.campana = radio.value;
            loadLeads();
        });
    });

    if (estabaAbierto) {
        const panel = container.querySelector('.multiselect-panel');
        if (panel) panel.classList.add('open');
    }
}

// ===== FILTRO DE CAMPAÑA DEL CALENDARIO =====
function setupCalendarioCampanaFiltro(user) {
    const campanas = getUserCampanas();
    const grupo = document.getElementById('calCampanaFilterGroup');
    if (!grupo) return;

    // Si el usuario solo tiene una campaña, no hay nada que filtrar.
    if (campanas.length <= 1) {
        grupo.style.display = 'none';
        state.calCampanas = campanas.slice();
        return;
    }
    grupo.style.display = '';

    const saved = cacheGet(CACHE_KEYS.CAL_CAMPANAS);
    const seleccionGuardada = Array.isArray(saved) ? saved.filter(c => campanas.includes(c)) : [];
    state.calCampanas = seleccionGuardada.length > 0 ? seleccionGuardada : [state.campana].filter(Boolean);

    createMultiSelect('calFilterCampana', campanas, state.calCampanas, 'Todas');
}

window.addEventListener('multiselect-change', (e) => {
    if (e.detail.containerId !== 'calFilterCampana') return;
    state.calCampanas = e.detail.values;
    cacheSet(CACHE_KEYS.CAL_CAMPANAS, state.calCampanas);
    cargarLeadsCalendario();
});

function getCalCampanasEfectivas() {
    const todas = getUserCampanas();
    if (!state.calCampanas || state.calCampanas.length === 0) return todas;
    return state.calCampanas.filter(c => todas.includes(c));
}

async function cargarLeadsCalendario(forceRefresh = false) {
    const user = getCurrentUser();
    if (!user) return;
    const campanasActivas = getCalCampanasEfectivas();

    if (campanasActivas.length === 0) {
        state.calLeadsPorCampana = {};
        actualizarCalendario();
        renderCalendarioPP();
        renderLeyendaCalendario();
        return;
    }

    const resultados = await Promise.all(campanasActivas.map(async (campana) => {
        const cacheKey = CACHE_KEYS.LEADS_RAW(user.email, user.rol, campana);
        if (!forceRefresh) {
            const cached = cacheGet(cacheKey);
            if (cached && cached.data) return { campana, leads: cached.data };
        }
        try {
            const result = await callAPI('getLeads', {
                email: user.email,
                rol: user.rol,
                campana,
                nombreAsesor: user.nombre_completo || user.nombre_asesor || user.nombre || ''
            });
            if (result.success) {
                const data = result.data || [];
                cacheSet(cacheKey, { data, timestamp: Date.now() });
                return { campana, leads: data };
            }
        } catch (error) {
            // Se ignora
        }
        return { campana, leads: [] };
    }));

    state.calLeadsPorCampana = {};
    resultados.forEach(({ campana, leads }) => { state.calLeadsPorCampana[campana] = leads; });

    actualizarCalendario();
    renderCalendarioPP();
    renderLeyendaCalendario();
}

// ===== LEADS =====
async function loadLeads(forceRefresh = false) {
    const user = getCurrentUser();
    const campana = document.getElementById('selectCampana')?.value || state.campana;
    if (!campana) return;

    state.campana = campana;

    // Intentar caché
    const cacheKey = CACHE_KEYS.LEADS_RAW(user.email, user.rol, campana);
    if (!forceRefresh) {
        const cached = cacheGet(cacheKey);
        if (cached && cached.data) {
            state.leadsRaw = cached.data;
            state.ultimaActualizacion = cached.timestamp;
            applyFilters();
            actualizarCalendario();
            return;
        }
    }

    // Cargar desde API
    const container = document.getElementById('tableContainer');
    if (container) container.innerHTML = '<div class="loading">Cargando leads...</div>';

    try {
        const result = await callAPI('getLeads', {
            email: user.email,
            rol: user.rol,
            campana: campana,
            nombreAsesor: user.nombre_completo || user.nombre_asesor || user.nombre || ''
        });

        if (result.success) {
            state.leadsRaw = result.data || [];
            state.ultimaActualizacion = Date.now();
            cacheSet(cacheKey, { data: state.leadsRaw, timestamp: state.ultimaActualizacion });
            applyFilters();
            actualizarCalendario();
            mostrarUltimaActualizacion();
        } else {
            if (container) container.innerHTML = `<div class="loading">Error: ${result.error || 'No se pudieron cargar los leads'}</div>`;
        }
    } catch (error) {
        if (container) container.innerHTML = `<div class="loading">Error de conexión: ${error.message}</div>`;
    }
}

// ===== FILTROS =====
// createMultiSelect() (en core/components.js) dispara este evento cada vez que
// se marca/desmarca una opción o "Todos". Sin este listener, los checkboxes
// se veían y se podían marcar, pero no pasaba nada: no hay a quién más
// escucharlo en toda la app.
window.addEventListener('multiselect-change', (e) => {
    const { key, values } = e.detail;
    if (Object.prototype.hasOwnProperty.call(state.filtros, key)) {
        state.filtros[key] = values;
        applyFilters();
    }
});

function applyFilters() {
    const user = getCurrentUser();
    const esAdmin = esRolSupervisorOAdmision(user.rol);
    const { carrera, ingreso, beneficio, modalidad, asesor, status, perfil, dolorNecesidad } = state.filtros;

    state.leadsFiltered = state.leadsRaw.filter(lead => {
        // Filtros multi-select
        if (carrera.length > 0 && !carrera.includes(lead[COLUMNAS.CARRERA] || lead[COLUMNAS.PROGRAMA] || '')) return false;
        if (ingreso.length > 0 && !ingreso.includes(lead[COLUMNAS.MODALIDAD_INGRESO] || '')) return false;
        if (beneficio.length > 0 && !beneficio.includes(lead[COLUMNAS.BENEFICIO] || '')) return false;
        if (modalidad.length > 0 && !modalidad.includes(lead[COLUMNAS.MODALIDAD] || '')) return false;
        // Asesor: se filtra/compara por el Nombre crudo (ASESOR_NOMBRE_RAW),
        // nunca por el Nombre_Aux que se muestra en la tabla.
        if (esAdmin && asesor.length > 0 && !asesor.includes(lead[COLUMNAS.ASESOR_NOMBRE_RAW] || '')) return false;
        if (status.length > 0 && !status.includes(lead[COLUMNAS.STATUS_GESTION] || '')) return false;
        if (perfil.length > 0 && !perfil.includes((lead.PERFILAMIENTO_COMPLETO || {}).estado || '')) return false;
        if (dolorNecesidad.length > 0 && !dolorNecesidad.includes(lead[COLUMNAS.DOLOR_NECESIDAD] || '')) return false;

        // Búsqueda por texto
        if (state.terminoBusqueda) {
            const id = String(lead[COLUMNAS.ID_PROMETEO] || '').toLowerCase();
            const nombre = String(lead[COLUMNAS.NOMBRES] || '').toLowerCase();
            const celular1 = String(lead[COLUMNAS.TELEFONO_2] || '').toLowerCase();
            const celular2 = String(lead[COLUMNAS.TELEFONO_3] || '').toLowerCase();
            if (!id.includes(state.terminoBusqueda) &&
                !nombre.includes(state.terminoBusqueda) &&
                !celular1.includes(state.terminoBusqueda) &&
                !celular2.includes(state.terminoBusqueda)) return false;
        }

        return true;
    });

    state.currentPage = 1;
    renderTabla();
    guardarEstadoFiltros();

    setTimeout(populateFilters, 0);
}

function populateFilters() {
    const user = getCurrentUser();
    const esAdmin = esRolSupervisorOAdmision(user.rol);
    const panelAbierto = document.querySelector('.multiselect-panel.open');
    const idAbierto = panelAbierto ? panelAbierto.closest('.multiselect')?.id : null;

    const getValues = (columna, filtroKey) => {
        return state.leadsRaw
            .filter(lead => leadPasaFiltrosSin(lead, filtroKey, esAdmin))
            .map(lead => lead[columna] || '')
            .filter(v => v && String(v).trim() !== '')
            .map(v => String(v).trim());
    };

    createMultiSelect('filterCarrera', getValues(COLUMNAS.CARRERA, 'carrera'), state.filtros.carrera, 'Todas');
    createMultiSelect('filterIngreso', getValues(COLUMNAS.MODALIDAD_INGRESO, 'ingreso'), state.filtros.ingreso, 'Todos');
    createMultiSelect('filterBeneficio', getValues(COLUMNAS.BENEFICIO, 'beneficio'), state.filtros.beneficio, 'Todos');
    createMultiSelect('filterModalidad', getValues(COLUMNAS.MODALIDAD, 'modalidad'), state.filtros.modalidad, 'Todas');
    createMultiSelect('filterStatus', getValues(COLUMNAS.STATUS_GESTION, 'status'), state.filtros.status, 'Todos', STATUS_LABELS);
    createMultiSelect('filterPerfil', ['Pendiente Asesor', 'Pendiente Supervisor', 'Completo'], state.filtros.perfil, 'Todos');
    createMultiSelect('filterDolorNecesidad', getValues(COLUMNAS.DOLOR_NECESIDAD, 'dolorNecesidad'), state.filtros.dolorNecesidad, 'Todos');

    if (esAdmin) {
        // Value = Nombre crudo (identifica al asesor sin ambigüedad).
        // Label = Nombre_Aux (lo único que debe verse en pantalla).
        const nombresRaw = getValues(COLUMNAS.ASESOR_NOMBRE_RAW, 'asesor');
        const labelsAsesor = {};
        state.leadsRaw
            .filter(lead => leadPasaFiltrosSin(lead, 'asesor', esAdmin))
            .forEach(lead => {
                const raw = String(lead[COLUMNAS.ASESOR_NOMBRE_RAW] || '').trim();
                if (raw && !labelsAsesor[raw]) {
                    labelsAsesor[raw] = lead[COLUMNAS.ASESOR_ULTIMO_CONTACTO] || raw;
                }
            });
        createMultiSelect('filterAsesor', nombresRaw, state.filtros.asesor, 'Todos', labelsAsesor);
    }

    if (idAbierto) {
        toggleMultiSelect(idAbierto);
    }
}

function leadPasaFiltrosSin(lead, filtroExcluido, esAdmin) {
    const filtros = { ...state.filtros };
    filtros[filtroExcluido] = [];
    if (!esAdmin) filtros.asesor = [];

    const { carrera, ingreso, beneficio, modalidad, asesor, status, perfil, dolorNecesidad } = filtros;

    if (carrera.length > 0 && !carrera.includes(lead[COLUMNAS.CARRERA] || lead[COLUMNAS.PROGRAMA] || '')) return false;
    if (ingreso.length > 0 && !ingreso.includes(lead[COLUMNAS.MODALIDAD_INGRESO] || '')) return false;
    if (beneficio.length > 0 && !beneficio.includes(lead[COLUMNAS.BENEFICIO] || '')) return false;
    if (modalidad.length > 0 && !modalidad.includes(lead[COLUMNAS.MODALIDAD] || '')) return false;
    if (esAdmin && asesor.length > 0 && !asesor.includes(lead[COLUMNAS.ASESOR_NOMBRE_RAW] || '')) return false;
    if (status.length > 0 && !status.includes(lead[COLUMNAS.STATUS_GESTION] || '')) return false;
    if (perfil.length > 0 && !perfil.includes((lead.PERFILAMIENTO_COMPLETO || {}).estado || '')) return false;
    if (dolorNecesidad.length > 0 && !dolorNecesidad.includes(lead[COLUMNAS.DOLOR_NECESIDAD] || '')) return false;

    return true;
}

function guardarEstadoFiltros() {
    const campana = document.getElementById('selectCampana')?.value || state.campana;
    cacheSet(CACHE_KEYS.FILTROS_ESTADO, {
        campana,
        filtros: state.filtros,
        busqueda: state.terminoBusqueda
    });
}

// ===== TABLA =====
function renderTabla() {
    const container = document.getElementById('tableContainer');
    if (!container) return;

    const user = getCurrentUser();
    const esAdmin = esRolSupervisorOAdmision(user.rol);
    const total = state.leadsFiltered.length;
    const totalPages = Math.ceil(total / state.pageSize);
    if (state.currentPage > totalPages) state.currentPage = Math.max(1, totalPages);

    const start = (state.currentPage - 1) * state.pageSize;
    const end = Math.min(start + state.pageSize, total);
    const pageLeads = state.leadsFiltered.slice(start, end);

    // Actualizar contador
    document.getElementById('leadCount').textContent = `${total} leads`;

    if (total === 0) {
        container.innerHTML = '<p style="padding:20px;color:#888;">No se encontraron registros para esta campaña.</p>';
        renderPaginacion(totalPages);
        return;
    }

    const headers = esAdmin
        ? ['BOTTOM', 'ID PROMETEO', 'ASESOR', 'NOMBRE', 'CARRERA', 'BENEFICIO', 'BENEFICIO ADICIONAL']
        : ['BOTTOM', 'ID PROMETEO', 'NOMBRE', 'CARRERA', 'BENEFICIO', 'BENEFICIO ADICIONAL'];

    const rows = pageLeads.map(lead => {
        const id = lead[COLUMNAS.ID_PROMETEO] || '-';
        const nombre = lead[COLUMNAS.NOMBRES] || 'Sin Nombre';
        const asesor = lead[COLUMNAS.ASESOR_ULTIMO_CONTACTO] || '-';
        const carrera = lead[COLUMNAS.CARRERA] || lead[COLUMNAS.PROGRAMA] || '-';
        const beneficio = lead[COLUMNAS.BENEFICIO] || 'NO';
        const beneficioAdicional = lead[COLUMNAS.BENEFICIO_ADICIONAL] || 'NO';

        const perfil = lead.PERFILAMIENTO_COMPLETO || { estado: 'Pendiente Asesor' };
        const perfilClases = { 'Completo': 'completo', 'Pendiente Supervisor': 'parcial', 'Pendiente Asesor': 'vacio' };
        const bottomLabel = `<span class="bottom-check ${perfilClases[perfil.estado] || 'vacio'}">${perfil.estado}</span>`;

        const row = [
            bottomLabel,
            `<a href="#" class="id-link" onclick="window.verDetalle('${escapeHtml(id)}')"><strong>${escapeHtml(id)}</strong></a>`
        ];
        if (esAdmin) row.push(escapeHtml(asesor));
        row.push(escapeHtml(nombre), escapeHtml(carrera), escapeHtml(beneficio), escapeHtml(beneficioAdicional));
        return row;
    });

    renderTable('tableContainer', headers, rows);

    // Sobrescribir evento de clic en ID para usar nuestra función
    container.querySelectorAll('.id-link').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            verDetalle(el.textContent.trim());
        });
    });

    renderPaginacion(totalPages);
}

function verDetalle(id) {
    const campana = document.getElementById('selectCampana')?.value || state.campana;
    const lead = state.leadsFiltered.find(l => String(l[COLUMNAS.ID_PROMETEO]) === String(id));
    if (lead) {
        cacheSet(CACHE_KEYS.LEAD_SELECTED(id, campana), lead);
    }
    window.location.href = `lead-detail.html?id=${encodeURIComponent(id)}&campana=${encodeURIComponent(campana)}`;
}

window.verDetalle = verDetalle;

function renderPaginacion(totalPages) {
    const container = document.getElementById('paginationPages');
    if (!container) return;
    container.innerHTML = '';

    if (totalPages <= 1) return;

    const bloqueActual = Math.floor((state.currentPage - 1) / state.pagesPerBlock);
    const inicioBloque = bloqueActual * state.pagesPerBlock + 1;
    const finBloque = Math.min(inicioBloque + state.pagesPerBlock - 1, totalPages);

    const addBtn = (text, page, disabled = false, cls = '') => {
        const btn = document.createElement('button');
        btn.textContent = text;
        if (disabled) btn.disabled = true;
        if (cls) btn.className = cls;
        if (!disabled && page) btn.onclick = () => { state.currentPage = page; renderTabla(); };
        container.appendChild(btn);
        return btn;
    };

    addBtn('‹', state.currentPage - 1, state.currentPage === 1);

    if (inicioBloque > 1) {
        addBtn('‹‹', inicioBloque - 1);
    }

    for (let i = inicioBloque; i <= finBloque; i++) {
        addBtn(String(i), i, false, i === state.currentPage ? 'active' : '');
    }

    if (finBloque < totalPages) {
        addBtn('››', finBloque + 1);
    }

    addBtn('›', state.currentPage + 1, state.currentPage === totalPages);
}

// ===== EXPORTAR =====
function exportarExcel() {
    if (state.leadsFiltered.length === 0) {
        alert('No hay datos para exportar');
        return;
    }
    const ws = XLSX.utils.json_to_sheet(state.leadsFiltered);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Leads');
    XLSX.writeFile(wb, `Leads_${state.campana || 'Export'}.xlsx`);
}

// ===== BADGE CONDICIONES COMERCIALES =====
async function actualizarBadgeCC() {
    const badge = document.getElementById('ccTriggerBadge');
    if (!badge) return;
    const user = getCurrentUser();
    try {
        const result = await callAPI('getSolicitudesCCCount', {
            rol: user.rol,
            campanas: getUserCampanas()
        });
        const total = (result && result.success) ? (result.count || 0) : 0;
        badge.style.display = total > 0 ? 'inline-block' : 'none';
        badge.textContent = total > 99 ? '99+' : String(total);
    } catch (e) {
        badge.style.display = 'none';
    }
}

// ===== CALENDARIO =====
function actualizarCalendario() {
    const user = getCurrentUser();
    const esAdmin = esRolSupervisorOAdmision(user.rol);
    state.mapaCalendario = esAdmin ? construirMapaAdmin() : construirMapaAsesor();
    actualizarBadgeCalendario();
}

function construirMapaAsesor() {
    const mapa = {};
    Object.keys(state.calLeadsPorCampana).forEach(campana => {
        (state.calLeadsPorCampana[campana] || []).forEach(lead => {
            const status = lead[COLUMNAS.STATUS_GESTION] || '';
            if (status !== STATUS.PP_VIVA) return;
            const fecha = parsearFechaFlexible(lead[COLUMNAS.FECHA_COMPROMISO_PAGO]);
            if (!fecha) return;
            const clave = fechaAClaveISO(fecha);
            if (!mapa[clave]) mapa[clave] = [];
            mapa[clave].push({ lead, campana });
        });
    });
    return mapa;
}

function construirMapaAdmin() {
    const mapa = {};
    const categorias = {
        viva: { status: STATUS.PP_VIVA, campo: COLUMNAS.FECHA_COMPROMISO_PAGO },
        muerta: { status: STATUS.PP_MUERTA, campo: COLUMNAS.FECHA_COMPROMISO_PAGO },
        pagoCompleto: { status: STATUS.PAGO_COMPLETO, campo: COLUMNAS.FECHA_PAGO_COMPLETO },
        pagoFraccionado: { status: STATUS.PAGO_FRACCIONADO, campo: COLUMNAS.FECHA_PROMESA_PAGO }
    };

    Object.keys(state.calLeadsPorCampana).forEach(campana => {
        (state.calLeadsPorCampana[campana] || []).forEach(lead => {
            const status = lead[COLUMNAS.STATUS_GESTION] || '';
            const catKey = Object.keys(categorias).find(k => categorias[k].status === status);
            if (!catKey) return;
            const fecha = parsearFechaFlexible(lead[categorias[catKey].campo]);
            if (!fecha) return;
            const clave = fechaAClaveISO(fecha);
            if (!mapa[clave]) mapa[clave] = { viva: [], muerta: [], pagoCompleto: [], pagoFraccionado: [] };
            mapa[clave][catKey].push({ lead, campana });
        });
    });
    return mapa;
}

function actualizarBadgeCalendario() {
    const badge = document.getElementById('calTriggerBadge');
    if (!badge) return;
    const hoy = new Date();
    const prefijoMes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    let total = 0;
    Object.keys(state.mapaCalendario).forEach(clave => {
        if (!clave.startsWith(prefijoMes)) return;
        total += itemsVisiblesDelDia(clave).length;
    });
    badge.style.display = total > 0 ? 'inline-block' : 'none';
    badge.textContent = total > 99 ? '99+' : String(total);
}

function itemsVisiblesDelDia(clave) {
    const datos = state.mapaCalendario[clave];
    if (!datos) return [];
    if (Array.isArray(datos)) {
        return datos.map(({ lead, campana }) => ({ lead, categoria: 'viva', campana }));
    }
    let items = [];
    Object.keys(state.categoriasVisibles).forEach(key => {
        if (state.categoriasVisibles[key] && datos[key]) {
            datos[key].forEach(({ lead, campana }) => items.push({ lead, categoria: key, campana }));
        }
    });
    return items;
}

// ===== RENDER DEL CALENDARIO =====
function cambiarVistaCalendario(vista) {
    state.vistaCalendario = vista;
    const contenido = document.querySelector('#view-calendario .cal-page-content');
    if (contenido) contenido.classList.toggle('vista-anio', vista === 'ano');
    document.querySelectorAll('#calViewToggle button').forEach(btn => {
        btn.classList.toggle('activo', btn.dataset.vista === vista);
    });
    renderCalendarioPP();
}

// Leyenda con checkboxes: togglea qué categorías se ven en el grid, en el
// detalle del día, y en el Excel exportado (todo lee state.categoriasVisibles).
function renderLeyendaCalendario() {
    const cont = document.getElementById('calLeyenda');
    if (!cont) return;

    let html = '<div class="cal-leyenda-items">';
    Object.keys(CATEGORIAS_CALENDARIO).forEach(key => {
        const cat = CATEGORIAS_CALENDARIO[key];
        const checked = state.categoriasVisibles[key] ? 'checked' : '';
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

    // NUEVO: si hay más de una campaña activa a la vez, se explica el tono claro/normal.
    const activas = getCalCampanasEfectivas();
    if (activas.length > 1) {
        html += '<div class="cal-leyenda-campanas">';
        activas.forEach((campana, idx) => {
            const color = idx === 0 ? '#0040A1' : aclararColor('#0040A1', Math.min(0.45, 0.22 * idx));
            html += `
                <div class="cal-leyenda-campana-item">
                    <span class="cal-dot-campana" style="background:${color};"></span>
                    <span>${escapeHtml(campana)}${idx === 0 ? ' (tono normal)' : ' (tono más claro)'}</span>
                </div>`;
        });
        html += '</div>';
    }

    cont.innerHTML = html;
}

function toggleCategoriaCalendario(key, visible) {
    state.categoriasVisibles[key] = visible;
    renderCalendarioPP();
    renderLeyendaCalendario();
    actualizarBadgeCalendario();
    if (state.diaSeleccionado && document.getElementById('calModalOverlay')) {
        abrirDetalleDia(state.diaSeleccionado);
    }
}

function aclararColor(hex, porcentaje) {
    const num = parseInt(hex.replace('#', ''), 16);
    let r = (num >> 16) & 0xFF;
    let g = (num >> 8) & 0xFF;
    let b = num & 0xFF;
    r = Math.round(r + (255 - r) * porcentaje);
    g = Math.round(g + (255 - g) * porcentaje);
    b = Math.round(b + (255 - b) * porcentaje);
    return '#' + [r, g, b].map(v => Math.min(255, Math.max(0, v)).toString(16).padStart(2, '0')).join('');
}

function colorParaItem(categoria, campana) {
    const base = CATEGORIAS_CALENDARIO[categoria] ? CATEGORIAS_CALENDARIO[categoria].color : '#0040A1';
    const activas = getCalCampanasEfectivas();
    if (activas.length <= 1) return base;
    const idx = activas.indexOf(campana);
    if (idx <= 0) return base;
    return aclararColor(base, Math.min(0.45, 0.22 * idx));
}

function construirFondoCelda(items) {
    if (!items || items.length === 0) return '';
    const colores = [];
    items.forEach(it => {
        const color = colorParaItem(it.categoria, it.campana);
        if (!colores.includes(color)) colores.push(color);
    });
    if (colores.length === 1) return `background:${colores[0]};`;

    const paso = 100 / colores.length;
    const stops = colores.map((color, i) =>
        `${color} ${(i * paso).toFixed(2)}%, ${color} ${((i + 1) * paso).toFixed(2)}%`
    ).join(', ');
    return `background: linear-gradient(to right, ${stops});`;
}

function renderCalendarioPP() {
    const cont = document.getElementById('calendarioPPContainer');
    if (!cont) return;

    if (state.vistaCalendario === 'ano') {
        renderCalendarioAnio(cont);
        return;
    }

    const year = state.calendarioMes.getFullYear();
    const month = state.calendarioMes.getMonth();

    const nombreMes = state.calendarioMes.toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });
    const primerDiaSemana = new Date(year, month, 1).getDay();
    const diasEnMes = new Date(year, month + 1, 0).getDate();
    const prefijoMes = `${year}-${String(month + 1).padStart(2, '0')}`;

    let totalMes = 0;
    Object.keys(state.mapaCalendario).forEach(clave => {
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

        const estiloFondo = cantidad > 0 ? construirFondoCelda(items) : '';

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
    state.calendarioMes = new Date(state.calendarioMes.getFullYear(), state.calendarioMes.getMonth() + delta, 1);
    renderCalendarioPP();
}

// Vista de año: 12 mini-calendarios a la vez.
function renderCalendarioAnio(cont) {
    const year = state.calendarioMes.getFullYear();
    const hoyClave = fechaAClaveISO(new Date());

    let totalAnio = 0;
    Object.keys(state.mapaCalendario).forEach(clave => {
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
            const estiloFondo = cantidad > 0 ? construirFondoCelda(itemsDia) : '';

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
    state.calendarioMes = new Date(state.calendarioMes.getFullYear() + delta, state.calendarioMes.getMonth(), 1);
    renderCalendarioPP();
}

function irAMes(year, month) {
    state.calendarioMes = new Date(year, month, 1);
    cambiarVistaCalendario('mes');
}

function abrirDetalleDia(claveDia) {
    state.diaSeleccionado = claveDia;
    const items = itemsVisiblesDelDia(claveDia);
    const [yyyy, mm, dd] = claveDia.split('-');
    const fechaLegible = `${dd}/${mm}/${yyyy}`;

    const user = getCurrentUser();
    const esAdmin = user && esRolSupervisorOAdmision(user.rol);
    const mostrarCampana = getCalCampanasEfectivas().length > 1;

    let filas = '';
    items.forEach(({ lead, categoria, campana }) => {
        const id = lead[COLUMNAS.ID_PROMETEO] || '-';
        const carrera = lead['CARRERA'] || lead['PROGRAMA'] || '-';
        const modalidadIngreso = lead['MODALIDAD INGRESO'] || '-';
        const modalidad = lead['MODALIDAD'] || '-';
        const boletaFinal = lead['BOLETA_FINAL'] || lead['BOLETA FINAL'] || '-';
        const asesor = lead[COLUMNAS.ASESOR_ULTIMO_CONTACTO] || '-';
        const cat = CATEGORIAS_CALENDARIO[categoria];
        filas += `
            <tr>
                ${esAdmin ? `<td><span class="cal-dot" style="background:${colorParaItem(categoria, campana)};"></span> ${escapeHtml(cat.label)}</td>` : ''}
                ${mostrarCampana ? `<td>${escapeHtml(campana)}</td>` : ''}
                <td><a href="#" class="id-link" onclick="verDetalleDesdeCalendario('${escapeHtml(id)}'); return false;">${escapeHtml(id)}</a></td>
                <td>${escapeHtml(carrera)}</td>
                <td>${escapeHtml(modalidadIngreso)}</td>
                <td>${escapeHtml(modalidad)}</td>
                <td>S/ ${escapeHtml(boletaFinal)}</td>
                ${esAdmin ? `<td>${escapeHtml(asesor)}</td>` : ''}
            </tr>`;
    });

    const colspan = (esAdmin ? 7 : 5) + (mostrarCampana ? 1 : 0);

    const modalHtml = `
        <div class="cal-modal-overlay cal-modal-overlay-top" id="calModalOverlay" onclick="cerrarDetalleDia(event)">
            <div class="cal-modal" onclick="event.stopPropagation()">
                <div class="cal-modal-header">
                    <strong><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">calendar_today</span> ${fechaLegible}</strong>
                    <button class="cal-modal-close" onclick="cerrarDetalleDia()"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">close</span></button>
                </div>
                <div class="cal-modal-toolbar">
                    <span>${items.length} registro${items.length === 1 ? '' : 's'}</span>
                    <button class="btn-export" onclick="exportarDiaExcel()"><span class="material-symbols-outlined" style="font-size:16px;">download</span> Exportar</button>
                </div>
                <div class="cal-modal-body">
                    <table>
                        <thead><tr>
                            ${esAdmin ? '<th>CATEGORÍA</th>' : ''}${mostrarCampana ? '<th>CAMPAÑA</th>' : ''}<th>ID</th><th>CARRERA</th><th>MODALIDAD INGRESO</th><th>MODALIDAD</th><th>BOLETA FINAL</th>${esAdmin ? '<th>ASESOR</th>' : ''}
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
    state.diaSeleccionado = null;
}

function verDetalleDesdeCalendario(id) {
    verDetalle(id);
}

// ===== EXPORTAR CALENDARIO =====
function construirFilasExportCalendario(items, esAdmin, incluirFecha) {
    const mostrarCampana = getCalCampanasEfectivas().length > 1;
    return items.map(({ lead, categoria, campana, fecha }) => {
        const fila = {};
        if (incluirFecha && fecha) fila['FECHA'] = fecha.split('-').reverse().join('/');
        if (esAdmin) fila['CATEGORÍA'] = CATEGORIAS_CALENDARIO[categoria].label;
        if (mostrarCampana) fila['CAMPAÑA'] = campana || '';
        fila['ID PROMETEO'] = lead[COLUMNAS.ID_PROMETEO] || '';
        fila['CARRERA'] = lead['CARRERA'] || lead['PROGRAMA'] || '';
        fila['MODALIDAD INGRESO'] = lead['MODALIDAD INGRESO'] || '';
        fila['MODALIDAD'] = lead['MODALIDAD'] || '';
        fila['BOLETA FINAL'] = lead['BOLETA_FINAL'] || lead['BOLETA FINAL'] || '';
        if (esAdmin) fila['ASESOR'] = lead[COLUMNAS.ASESOR_ULTIMO_CONTACTO] || '';
        return fila;
    });
}

function descargarExcelCalendario(filasExport, nombreArchivo) {
    const ws = XLSX.utils.json_to_sheet(filasExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Calendario');
    XLSX.writeFile(wb, nombreArchivo);
}

function recolectarItemsPorPrefijo(prefijo) {
    let items = [];
    Object.keys(state.mapaCalendario).forEach(clave => {
        if (!clave.startsWith(prefijo)) return;
        itemsVisiblesDelDia(clave).forEach(item => items.push(Object.assign({ fecha: clave }, item)));
    });
    items.sort((a, b) => a.fecha.localeCompare(b.fecha));
    return items;
}

function nombreCampanaExport() {
    const activas = getCalCampanasEfectivas();
    return activas.length > 0 ? activas.join('-') : 'Campana';
}

function exportarDiaExcel() {
    if (!state.diaSeleccionado) return;
    const items = itemsVisiblesDelDia(state.diaSeleccionado);
    if (items.length === 0) {
        alert('No hay datos para exportar');
        return;
    }
    const user = getCurrentUser();
    const esAdmin = user && esRolSupervisorOAdmision(user.rol);
    const filasExport = construirFilasExportCalendario(items, esAdmin, false);
    descargarExcelCalendario(filasExport, `Calendario_${state.diaSeleccionado}_${nombreCampanaExport()}.xlsx`);
}

function exportarMesExcel() {
    const year = state.calendarioMes.getFullYear();
    const month = state.calendarioMes.getMonth();
    const prefijoMes = `${year}-${String(month + 1).padStart(2, '0')}`;
    const items = recolectarItemsPorPrefijo(prefijoMes);
    if (items.length === 0) {
        alert('No hay datos para exportar en este mes');
        return;
    }
    const user = getCurrentUser();
    const esAdmin = user && esRolSupervisorOAdmision(user.rol);
    const filasExport = construirFilasExportCalendario(items, esAdmin, true);
    const nombreMes = state.calendarioMes
        .toLocaleDateString('es-PE', { month: 'long', year: 'numeric' })
        .replace(/\s+/g, '_');
    descargarExcelCalendario(filasExport, `Calendario_${nombreMes}_${nombreCampanaExport()}.xlsx`);
}

function exportarAnioExcel() {
    const year = state.calendarioMes.getFullYear();
    const items = recolectarItemsPorPrefijo(String(year));
    if (items.length === 0) {
        alert('No hay datos para exportar en este año');
        return;
    }
    const user = getCurrentUser();
    const esAdmin = user && esRolSupervisorOAdmision(user.rol);
    const filasExport = construirFilasExportCalendario(items, esAdmin, true);
    descargarExcelCalendario(filasExport, `Calendario_${year}_${nombreCampanaExport()}.xlsx`);
}

function exportarCalendarioActual() {
    if (state.vistaCalendario === 'ano') {
        exportarAnioExcel();
    } else {
        exportarMesExcel();
    }
}

window.cambiarVistaCalendario = cambiarVistaCalendario;
window.toggleCategoriaCalendario = toggleCategoriaCalendario;
window.cambiarMesCalendario = cambiarMesCalendario;
window.cambiarAnioCalendario = cambiarAnioCalendario;
window.irAMes = irAMes;
window.abrirDetalleDia = abrirDetalleDia;
window.cerrarDetalleDia = cerrarDetalleDia;
window.verDetalleDesdeCalendario = verDetalleDesdeCalendario;
window.exportarDiaExcel = exportarDiaExcel;
window.exportarCalendarioActual = exportarCalendarioActual;
window.renderCalendarioPP = renderCalendarioPP;
window.renderLeyendaCalendario = renderLeyendaCalendario;

// ===== FILTROS PANEL =====
function toggleFiltrosPanel() {
    const panel = document.getElementById('navFiltrosPanel');
    const btn = document.getElementById('filtrosToggleBtn');
    if (!panel) return;
    const abierto = panel.classList.toggle('open');
    if (btn) btn.classList.toggle('active', abierto);
}

// ===== UTILITIES =====
function mostrarUltimaActualizacion() {
    const el = document.getElementById('lastUpdate');
    if (!el || !state.ultimaActualizacion) return;
    const fecha = new Date(state.ultimaActualizacion);
    el.textContent = `Última actualización: ${fecha.toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
    el.style.opacity = '1';
    setTimeout(() => el.style.opacity = '0', 4000);
}

// ===== API =====
async function callAPI(action, data = {}) {
    const payload = { action, sessionToken: getSessionToken(), ...data };
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload)
        });
        const raw = await response.text();
        return JSON.parse(raw);
    } catch (error) {
        return { success: false, error: error.message };
    }
}