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
    nowPeru, formato12h, parsearHistorial,
    limpiarEspacios, sumarCategoria
} from '../core/utils.js';

import { Sidebar, Toast, Modal, createMultiSelect, sortTable, toggleMultiSelect, renderTable } from '../core/components.js';
import { buscarDuplicados, limpiarCacheDuplicados } from './duplicados-sugeridos.js';
import { unificarLeads } from './unificar-core.js';

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
        fechaPrimVpPp: [],
        status: [STATUS.VP_VIVA, STATUS.PP_VIVA]
    },
    campana: '',
    calCampanas: [],
    calLeadsPorCampana: {},
    mapaCalendario: {},
    categoriasVisibles: { viva: true, muerta: false, pagoCompleto: false, pagoFraccionado: false, visitaGuiada: true },
    calendarioMes: new Date(),
    vistaCalendario: 'mes',
    diaSeleccionado: null,
    ultimaActualizacion: null,
    calVpPpMes: new Date(),
    indicadores: {
        filtros: { campana: [], programa: [], modalidad: [], ingreso: [], asesor: [], canal: [], fechaCalendario: [] },
        expandido: {},
        calMes: new Date(),
        cargado: false,
        leadsPorCampana: {}
    }
};

// Config de categorías del calendario: color, label, de qué status viene, y qué campo de fecha usar.
// Solo SUPERVISOR/ADMISION ven las 4 categorías; el ASESOR solo ve PP Viva.
const CATEGORIAS_CALENDARIO = {
    viva: { label: 'PP Viva', color: '#0040A1', status: STATUS.PP_VIVA, campoFecha: COLUMNAS.FECHA_COMPROMISO_PAGO },
    muerta: { label: 'PP Muerta', color: '#5e35b1', status: STATUS.PP_MUERTA, campoFecha: COLUMNAS.FECHA_COMPROMISO_PAGO },
    pagoCompleto: { label: 'Pago Completo', color: '#2e7d32', status: STATUS.PAGO_COMPLETO, campoFecha: COLUMNAS.FECHA_PAGO_COMPLETO },
    pagoFraccionado: { label: 'Pago Fraccionado', color: '#f9a825', status: STATUS.PAGO_FRACCIONADO, campoFecha: COLUMNAS.FECHA_PROMESA_PAGO },
    visitaGuiada: { label: 'Visita Guiada', color: '#00897b', campoFecha: COLUMNAS.FECHA_VISITA_GUIADA }
};

// Categorías visibles/editables según rol. El asesor solo ve PP Viva + Visita
// Guiada; las otras 3 son admin-only (igual que antes, pero ahora también
// filtrado en la leyenda, no solo en el mapa).
const CATEGORIAS_POR_ROL = {
    admin: ['viva', 'muerta', 'pagoCompleto', 'pagoFraccionado', 'visitaGuiada'],
    asesor: ['viva', 'visitaGuiada']
};

function categoriasVisiblesParaRol(esAdmin) {
    return esAdmin ? CATEGORIAS_POR_ROL.admin : CATEGORIAS_POR_ROL.asesor;
}

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
    document.getElementById('calVpPpToggleBtn')?.addEventListener('click', toggleCalVpPpPanel);
    setupAutoHideToolbar();

    // Mostrar la vista embebida correspondiente
    if (vistaInicial === 'bottomline' && typeof window.mostrarBottomLine === 'function') {
        window.mostrarBottomLine();
    } else if (vistaInicial === 'indicadores' && typeof window.mostrarIndicadores === 'function') {
        window.mostrarIndicadores();
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
    // Comparación case-insensitive: el key llega como
    // containerId.replace('filter','').toLowerCase() (ej. "filterDolorNecesidad"
    // -> "dolornecesidad"), pero las claves de state.filtros son camelCase
    // (ej. "dolorNecesidad"). Sin esto, cualquier filtro con más de una
    // palabra en su nombre nunca hace match y se queda sin efecto.
    const filtroKey = Object.keys(state.filtros).find(k => k.toLowerCase() === key.toLowerCase());
    if (filtroKey) {
        state.filtros[filtroKey] = values;
        applyFilters();
    }
});

function applyFilters() {
    const user = getCurrentUser();
    const esAdmin = esRolSupervisorOAdmision(user.rol);
    const { carrera, ingreso, beneficio, modalidad, asesor, status, perfil, dolorNecesidad, fechaPrimVpPp } = state.filtros;

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
        if (fechaPrimVpPp.length > 0 && !fechaPrimVpPp.includes(lead[COLUMNAS.FECHA_PRIM_VP_PP] || '')) return false;

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
    setTimeout(renderCalendarioFiltroVpPp, 0);
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

    const { carrera, ingreso, beneficio, modalidad, asesor, status, perfil, dolorNecesidad, fechaPrimVpPp } = filtros;

    if (carrera.length > 0 && !carrera.includes(lead[COLUMNAS.CARRERA] || lead[COLUMNAS.PROGRAMA] || '')) return false;
    if (ingreso.length > 0 && !ingreso.includes(lead[COLUMNAS.MODALIDAD_INGRESO] || '')) return false;
    if (beneficio.length > 0 && !beneficio.includes(lead[COLUMNAS.BENEFICIO] || '')) return false;
    if (modalidad.length > 0 && !modalidad.includes(lead[COLUMNAS.MODALIDAD] || '')) return false;
    if (esAdmin && asesor.length > 0 && !asesor.includes(lead[COLUMNAS.ASESOR_NOMBRE_RAW] || '')) return false;
    if (status.length > 0 && !status.includes(lead[COLUMNAS.STATUS_GESTION] || '')) return false;
    if (perfil.length > 0 && !perfil.includes((lead.PERFILAMIENTO_COMPLETO || {}).estado || '')) return false;
    if (dolorNecesidad.length > 0 && !dolorNecesidad.includes(lead[COLUMNAS.DOLOR_NECESIDAD] || '')) return false;
    if (fechaPrimVpPp.length > 0 && !fechaPrimVpPp.includes(lead[COLUMNAS.FECHA_PRIM_VP_PP] || '')) return false;

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
            `<a href="#" class="id-link" onclick="window.verDetalle('${escapeHtml(id)}')"><strong>${escapeHtml(id)}</strong></a>
            <span class="dup-icon" id="dupIcon_${escapeHtml(id)}" title="Posibles duplicados">
                <span class="material-symbols-outlined">warning</span>
            </span>`
        ];
        if (esAdmin) row.push(escapeHtml(asesor));
        row.push(escapeHtml(nombre), escapeHtml(carrera), escapeHtml(beneficio), escapeHtml(beneficioAdicional));
        return row;
    });

    renderTable('tableContainer', headers, rows);
    revisarDuplicadosVisibles(pageLeads);

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

async function revisarDuplicadosVisibles(leads) {
    await Promise.all(leads.map(async lead => {
        const id = lead[COLUMNAS.ID_PROMETEO];
        if (!id) return;
        const dups = await buscarDuplicados({
            idPrometeo: id,
            dni: lead[COLUMNAS.DNI],
            celular: lead[COLUMNAS.TELEFONO_2],
            nombre: lead[COLUMNAS.NOMBRES]
        });
        if (dups.length === 0) return;
        const icon = document.getElementById(`dupIcon_${id}`);
        if (!icon) return;
        icon.style.display = 'inline-flex';
        icon.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            abrirPopupDuplicadosDashboard(lead, dups);
        });
    }));
}

function abrirPopupDuplicadosDashboard(sol, dups) {
    const candidatos = [
        { id: sol.ID_PROMETEO, campana: sol.CAMPANA, nombre: sol.NOMBRE_LEAD, activo: true, motivos: [] },
        ...dups.map(d => ({
            id: d[COLUMNAS.ID_PROMETEO], campana: d.CAMPANA || '',
            nombre: d[COLUMNAS.NOMBRES] || 'Sin Nombre', activo: !!d.activo,
            motivos: d._motivos || []
        }))
    ];
    const filas = candidatos.map((c, i) => `
        <tr>
            <td class="dup-select-cell">
                <button type="button" class="dup-sel-btn dup-sel-principal ${c.activo ? 'is-active' : ''}" data-idx="${i}" title="Marcar como principal">
                    <span class="material-symbols-outlined">check_circle</span>
                </button>
                <button type="button" class="dup-sel-btn dup-sel-secundario ${!c.activo ? 'is-active' : ''}" data-idx="${i}" title="Marcar para fusionar">
                    <span class="material-symbols-outlined">cancel</span>
                </button>
            </td>
            <td><strong>${escapeHtml(c.id)}</strong></td>
            <td>${escapeHtml(c.campana)}</td>
            <td>${escapeHtml(c.nombre)}</td>
            <td><span class="badge-estado ${c.activo ? 'activo' : 'huerfano'}">${c.activo ? 'Activo (base)' : 'Huérfano'}</span></td>
            <td>${c.motivos.length ? escapeHtml(c.motivos.join(', ')) : '<span style="color:#bbb;">—</span>'}</td>
        </tr>`).join('');

    document.body.insertAdjacentHTML('beforeend', `
        <div class="cal-modal-overlay cal-modal-overlay-top" id="dupModal">
            <div class="cal-modal" onclick="event.stopPropagation()" style="max-width:700px;">
                <div class="cal-modal-header">
                    <strong>Unificar posibles duplicados de ${escapeHtml(sol.ID_PROMETEO)}</strong>
                    <button class="cal-modal-close" id="dupModalCloseBtn"><span class="material-symbols-outlined">close</span></button>
                </div>
                <div class="cal-modal-body">
                    <table class="dup-table">
                        <thead><tr><th></th><th>ID</th><th>Campaña</th><th>Nombre</th><th>Estado</th><th>Motivo</th></tr></thead>
                        <tbody>${filas}</tbody>
                    </table>
                    <div id="dupModalError"></div>
                    <div class="dup-modal-actions">
                        <button class="btn-filtros" id="dupModalConfirmarBtn">
                            <span class="material-symbols-outlined" style="font-size:16px;">link</span> Unificar seleccionados
                        </button>
                    </div>
                </div>
            </div>
        </div>`);

    const overlay = document.getElementById('dupModal');
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.getElementById('dupModalCloseBtn').addEventListener('click', () => overlay.remove());

    overlay.querySelectorAll('.dup-sel-principal').forEach(btn => {
        btn.addEventListener('click', () => {
            overlay.querySelectorAll('.dup-sel-principal').forEach(b => b.classList.remove('is-active'));
            btn.classList.add('is-active');
            overlay.querySelector(`.dup-sel-secundario[data-idx="${btn.dataset.idx}"]`)?.classList.remove('is-active');
        });
    });
    overlay.querySelectorAll('.dup-sel-secundario').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.classList.toggle('is-active');
            if (btn.classList.contains('is-active')) {
                overlay.querySelector(`.dup-sel-principal[data-idx="${btn.dataset.idx}"]`)?.classList.remove('is-active');
            }
        });
    });

    document.getElementById('dupModalConfirmarBtn').addEventListener('click', () => confirmarUnificacionDashboard(candidatos));
}

async function confirmarUnificacionDashboard(candidatos) {
    const overlay = document.getElementById('dupModal');
    const errorDiv = document.getElementById('dupModalError');
    const idxPrincipal = Number(overlay.querySelector('.dup-sel-principal.is-active')?.dataset.idx);
    const secundarios = Array.from(overlay.querySelectorAll('.dup-sel-secundario.is-active'))
        .map(b => Number(b.dataset.idx));

    if (isNaN(idxPrincipal)) { errorDiv.innerHTML = '<div class="error-validacion">Selecciona un Principal.</div>'; return; }
    if (secundarios.length === 0) { errorDiv.innerHTML = '<div class="error-validacion">Selecciona al menos uno para fusionar.</div>'; return; }

    const principal = candidatos[idxPrincipal];
    const listaSecundarios = secundarios.map(i => candidatos[i]);
    if (!confirm(`¿Unificar?\n\nPrincipal: ${principal.id} (${principal.campana})\nSe fusionará: ${listaSecundarios.map(s => s.id).join(', ')}`)) return;

    const btn = document.getElementById('dupModalConfirmarBtn');
    btn.disabled = true;
    const result = await unificarLeads({
        idPrincipal: principal.id,
        campanaPrincipal: principal.campana,
        idsSecundarios: listaSecundarios.map(s => ({ id: s.id, campana: s.campana })),
        datosPredominantes: { historial: 'ambos' },
        adminEmail: getCurrentUser().email
    });

    if (result.success) {
        new Toast().show('Unificación completada', 'ok');
        limpiarCacheDuplicados();
        overlay.remove();
        loadLeads(true);
    } else if (!result.cancelado) {
        errorDiv.innerHTML = `<div class="error-validacion">${escapeHtml(result.error || 'Error al unificar')}</div>`;
        btn.disabled = false;
    } else {
        btn.disabled = false;
    }
}

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
    const agregar = (clave, catKey, lead, campana) => {
        if (!mapa[clave]) mapa[clave] = { viva: [], visitaGuiada: [] };
        mapa[clave][catKey].push({ lead, campana });
    };

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    Object.keys(state.calLeadsPorCampana).forEach(campana => {
        (state.calLeadsPorCampana[campana] || []).forEach(lead => {
            const status = lead[COLUMNAS.STATUS_GESTION] || '';
            if (status === STATUS.PP_VIVA) {
                const fecha = parsearFechaFlexible(lead[COLUMNAS.FECHA_COMPROMISO_PAGO]);
                if (fecha) agregar(fechaAClaveISO(fecha), 'viva', lead, campana);
            }

            // Visita Guiada: solo si el lead sigue como VP Viva y la fecha es hoy o futura.
            if (status === STATUS.VP_VIVA) {
                const fechaVisita = parsearFechaFlexible(lead[COLUMNAS.FECHA_VISITA_GUIADA]);
                if (fechaVisita && fechaVisita >= hoy) {
                    agregar(fechaAClaveISO(fechaVisita), 'visitaGuiada', lead, campana);
                }
            }
        });
    });
    return mapa;
}

function construirMapaAdmin() {
    const mapa = {};
    const categoriasEstado = {
        viva: { status: STATUS.PP_VIVA, campo: COLUMNAS.FECHA_COMPROMISO_PAGO },
        muerta: { status: STATUS.PP_MUERTA, campo: COLUMNAS.FECHA_COMPROMISO_PAGO },
        pagoCompleto: { status: STATUS.PAGO_COMPLETO, campo: COLUMNAS.FECHA_PAGO_COMPLETO },
        pagoFraccionado: { status: STATUS.PAGO_FRACCIONADO, campo: COLUMNAS.FECHA_PROMESA_PAGO }
    };

    const agregar = (clave, catKey, lead, campana) => {
        if (!mapa[clave]) mapa[clave] = { viva: [], muerta: [], pagoCompleto: [], pagoFraccionado: [], visitaGuiada: [] };
        mapa[clave][catKey].push({ lead, campana });
    };

    Object.keys(state.calLeadsPorCampana).forEach(campana => {
        (state.calLeadsPorCampana[campana] || []).forEach(lead => {
            const status = lead[COLUMNAS.STATUS_GESTION] || '';

            // Categorías por status: siguen siendo excluyentes entre sí, como antes.
            const catKey = Object.keys(categoriasEstado).find(k => categoriasEstado[k].status === status);
            if (catKey) {
                const fecha = parsearFechaFlexible(lead[categoriasEstado[catKey].campo]);
                if (fecha) agregar(fechaAClaveISO(fecha), catKey, lead, campana);
            }

            // Visita Guiada: solo si el lead sigue como VP Viva.
            if (status === STATUS.VP_VIVA) {
                const fechaVisita = parsearFechaFlexible(lead[COLUMNAS.FECHA_VISITA_GUIADA]);
                if (fechaVisita) agregar(fechaAClaveISO(fechaVisita), 'visitaGuiada', lead, campana);
            }
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

    const user = getCurrentUser();
    const esAdmin = user && esRolSupervisorOAdmision(user.rol);
    const claves = categoriasVisiblesParaRol(esAdmin);

    let html = '<div class="cal-leyenda-items">';
    claves.forEach(key => {
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
                <td><span class="cal-dot" style="background:${colorParaItem(categoria, campana)};"></span> ${escapeHtml(cat.label)}</td>
                ${mostrarCampana ? `<td>${escapeHtml(campana)}</td>` : ''}
                <td><a href="#" class="id-link" onclick="verDetalleDesdeCalendario('${escapeHtml(id)}'); return false;">${escapeHtml(id)}</a></td>
                <td>${escapeHtml(carrera)}</td>
                <td>${escapeHtml(modalidadIngreso)}</td>
                <td>${escapeHtml(modalidad)}</td>
                <td>S/ ${escapeHtml(boletaFinal)}</td>
                ${esAdmin ? `<td>${escapeHtml(asesor)}</td>` : ''}
            </tr>`;
    });

    const colspan = (esAdmin ? 7 : 6) + (mostrarCampana ? 1 : 0);

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
                            <th>CATEGORÍA</th>${mostrarCampana ? '<th>CAMPAÑA</th>' : ''}<th>ID</th><th>CARRERA</th><th>MODALIDAD INGRESO</th><th>MODALIDAD</th><th>BOLETA FINAL</th>${esAdmin ? '<th>ASESOR</th>' : ''}
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
        fila['CATEGORÍA'] = CATEGORIAS_CALENDARIO[categoria].label;
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

// ===== CALENDARIO FILTRO: FECHA PRIM VP/PP =====
function toggleCalVpPpPanel() {
    const panel = document.getElementById('calVpPpPanel');
    const btn = document.getElementById('calVpPpToggleBtn');
    if (!panel) return;
    const abierto = panel.classList.toggle('open');
    if (btn) btn.classList.toggle('active', abierto);
    if (abierto) {
        renderCalendarioFiltroVpPp();
        setTimeout(() => document.addEventListener('click', cerrarCalVpPpFuera), 0);
    }
}
window.toggleCalVpPpPanel = toggleCalVpPpPanel;

function cerrarCalVpPpFuera(e) {
    const panel = document.getElementById('calVpPpPanel');
    if (!panel || !panel.classList.contains('open')) {
        document.removeEventListener('click', cerrarCalVpPpFuera);
        return;
    }
    if (e.target.closest('#calVpPpDropdown')) return;
    panel.classList.remove('open');
    document.getElementById('calVpPpToggleBtn')?.classList.remove('active');
    document.removeEventListener('click', cerrarCalVpPpFuera);
}

function cambiarMesCalVpPp(delta) {
    state.calVpPpMes.setMonth(state.calVpPpMes.getMonth() + delta);
    renderCalendarioFiltroVpPp();
}
window.cambiarMesCalVpPp = cambiarMesCalVpPp;

// Cuenta leads por fecha (YYYY-MM-DD), excluyendo el propio filtro
// fechaPrimVpPp — mismo patrón en cascada que getValues() en populateFilters().
function mapaFechasVpPp() {
    const user = getCurrentUser();
    const esAdmin = esRolSupervisorOAdmision(user.rol);
    const mapa = {};
    state.leadsRaw
        .filter(lead => leadPasaFiltrosSin(lead, 'fechaPrimVpPp', esAdmin))
        .forEach(lead => {
            const d = parsearFechaFlexible(lead[COLUMNAS.FECHA_PRIM_VP_PP]);
            if (!d) return;
            const clave = fechaAClaveISO(d);
            mapa[clave] = (mapa[clave] || 0) + 1;
        });
    return mapa;
}

function renderCalendarioFiltroVpPp() {
    const panel = document.getElementById('calVpPpPanel');
    if (!panel || !panel.classList.contains('open')) return; // no perder tiempo si está cerrado

    const grid = document.getElementById('calVpPpGrid');
    const label = document.getElementById('calVpPpMesLabel');
    if (!grid || !label) return;

    const mes = state.calVpPpMes;
    const labelMes = mes.toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });
    label.textContent = labelMes.charAt(0).toUpperCase() + labelMes.slice(1);

    const mapa = mapaFechasVpPp();
    const seleccionadas = state.filtros.fechaPrimVpPp;

    const primerDia = new Date(mes.getFullYear(), mes.getMonth(), 1);
    const ultimoDia = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);
    const offset = (primerDia.getDay() + 6) % 7; // semana empieza en lunes

    let html = '';
    for (let i = 0; i < offset; i++) html += '<div class="cal-vpp-day vacio"></div>';
    for (let d = 1; d <= ultimoDia.getDate(); d++) {
        const clave = `${mes.getFullYear()}-${String(mes.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const count = mapa[clave] || 0;
        const activo = seleccionadas.includes(clave);
        html += `
            <div class="cal-vpp-day ${count ? 'tiene-datos' : ''} ${activo ? 'seleccionado' : ''}"
                 onclick="${count ? `window.toggleFechaVpPp('${clave}')` : ''}">
                ${d}
                ${count ? `<span class="cal-vpp-count">${count}</span>` : ''}
            </div>`;
    }
    grid.innerHTML = html;

    const btn = document.getElementById('calVpPpToggleBtn');
    if (btn) btn.classList.toggle('has-selection', seleccionadas.length > 0);
}
window.renderCalendarioFiltroVpPp = renderCalendarioFiltroVpPp;

function toggleFechaVpPp(clave) {
    const idx = state.filtros.fechaPrimVpPp.indexOf(clave);
    if (idx >= 0) state.filtros.fechaPrimVpPp.splice(idx, 1);
    else state.filtros.fechaPrimVpPp.push(clave);
    applyFilters();
    renderCalendarioFiltroVpPp();
}
window.toggleFechaVpPp = toggleFechaVpPp;

function limpiarFiltroCalVpPp() {
    state.filtros.fechaPrimVpPp = [];
    applyFilters();
    renderCalendarioFiltroVpPp();
}
window.limpiarFiltroCalVpPp = limpiarFiltroCalVpPp;

// ================================================================
// INDICADORES
// ================================================================

// Orden fijo pedido para la tabla de Status de Gestión (y reutilizado en
// Cantidad de días para conversión, que también agrupa por status):
// Blacklist, Perdido, Sin Contacto, Volver a llamar, VP Muerta, VP Viva,
// PP Muerta, PP Viva, Pago Fraccionado, Pago Completo.
const ORDEN_STATUS_IND = [
    STATUS.BLACK_LIST,
    STATUS.PERDIDO,
    STATUS.SIN_CONTACTO,
    STATUS.VOLVER_A_LLAMAR,
    STATUS.VP_MUERTA,
    STATUS.VP_VIVA,
    STATUS.PP_MUERTA,
    STATUS.PP_VIVA,
    STATUS.PAGO_FRACCIONADO,
    STATUS.PAGO_COMPLETO,
];

function ordenarStatusInd(statuses) {
    return [...statuses].sort((a, b) => {
        const ia = ORDEN_STATUS_IND.indexOf(a), ib = ORDEN_STATUS_IND.indexOf(b);
        if (ia === -1 && ib === -1) return a.localeCompare(b);
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
    });
}

// Inserta la celda de Campaña con rowspan SOLO en la primera fila del grupo
// (las demás filas del mismo grupo no llevan esa celda — el rowspan de la
// primera fila ya cubre esa columna). Cada fila de `filasDeEstaCamp` debe
// incluir el marcador {{CAMP_TD}} justo después de la apertura de <tr>.
function emitirFilasConCampana(filasDeEstaCamp, campana) {
    return filasDeEstaCamp.map((tr, i) => {
        const celda = i === 0
            ? `<td class="ind-td-campana" rowspan="${filasDeEstaCamp.length}">${escapeHtml(campana)}</td>`
            : '';
        return tr.replace('{{CAMP_TD}}', celda);
    }).join('');
}

// Formatea un % SIN decimales (pedido explícito: "los porcentajes de todas
// las tablas no deben tener decimales"). Devuelve algo como "37%".
function pctInd(n, total) {
    if (!total) return '0%';
    return `${Math.round((n / total) * 100)}%`;
}

async function inicializarIndicadores() {
    // A diferencia del calendario del Dashboard (que solo trae las campañas
    // "efectivas" según su propio selector), Indicadores siempre debe
    // mostrar TODAS las campañas activas del usuario — por eso usa su
    // propio loader (cargarLeadsIndicadores), independiente del filtro de
    // campaña del calendario del Dashboard.
    if (!state.indicadores.leadsPorCampana || Object.keys(state.indicadores.leadsPorCampana).length === 0) {
        await cargarLeadsIndicadores();
    }
    // El módulo de Condiciones Comerciales guarda su data en su PROPIO
    // `state` (cada módulo ES tiene el suyo, no se comparten entre sí), así
    // que para cruzar Condiciones Comerciales con Ventas se llama la misma
    // API acá y se guarda en el `state.solicitudesCC` de este módulo.
    if (!state.solicitudesCC) {
        try {
            const result = await callAPI('getSolicitudesCC', { campanas: getUserCampanas(), incluirResueltas: true });
            state.solicitudesCC = result.success ? (result.data || []) : [];
        } catch (e) {
            state.solicitudesCC = [];
        }
    }

    poblarFiltrosIndicadores();
    renderIndicadores();
}
window.inicializarIndicadores = inicializarIndicadores;

// Carga los leads de TODAS las campañas activas del usuario (no depende del
// filtro de campaña del calendario del Dashboard). Reutiliza la misma
// caché (CACHE_KEYS.LEADS_RAW) que cargarLeadsCalendario, así que si el
// Dashboard ya trajo esa data no se vuelve a pedir por red.
async function cargarLeadsIndicadores(forceRefresh = false) {
    const user = getCurrentUser();
    if (!user) return;
    const campanas = getUserCampanas();

    if (campanas.length === 0) {
        state.indicadores.leadsPorCampana = {};
        return;
    }

    const resultados = await Promise.all(campanas.map(async (campana) => {
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

    state.indicadores.leadsPorCampana = {};
    resultados.forEach(({ campana, leads }) => { state.indicadores.leadsPorCampana[campana] = leads; });
}

// Aplana state.indicadores.leadsPorCampana (TODAS las campañas activas del
// usuario) en un solo array. Cada lead ya trae COLUMNAS.CAMPANA (agregada a
// constants.js).
function todosLosLeadsIndicadores() {
    return Object.values(state.indicadores.leadsPorCampana || {}).flat();
}

// Mismo estilo/orden que los Filtros del Dashboard (grid de 3 en 3):
// Programa (≈Carrera), Modalidad de Ingreso, Modalidad, Asesor, Campaña, Canal.
//
// Filtros interdependientes: las opciones que se ofrecen en CADA filtro se
// calculan sobre los leads que ya pasan TODOS LOS DEMÁS filtros (nunca sobre
// el propio, para no auto-restringirse a lo ya marcado). Así, al elegir un
// valor en un filtro, el resto de los filtros solo muestra opciones que
// realmente existen dentro de ese contexto — y createMultiSelect ya poda
// automáticamente cualquier selección previa que haya dejado de existir.
function poblarFiltrosIndicadores() {
    const valoresUnicos = (columna, excluirClave) => [...new Set(
        leadsIndicadoresFiltradosExcluyendo(excluirClave)
            .map(l => String(l[columna] || '').trim()).filter(Boolean)
    )].sort();

    createMultiSelect('indFilterPrograma', valoresUnicos(COLUMNAS.PROGRAMA, 'programa'), state.indicadores.filtros.programa, 'Todos');
    createMultiSelect('indFilterIngreso', valoresUnicos(COLUMNAS.MODALIDAD_INGRESO, 'ingreso'), state.indicadores.filtros.ingreso, 'Todos');
    createMultiSelect('indFilterModalidad', valoresUnicos(COLUMNAS.MODALIDAD, 'modalidad'), state.indicadores.filtros.modalidad, 'Todas');

    // Asesor: igual que en el Dashboard — value = Nombre crudo (identifica
    // sin ambigüedad al asesor), label = Nombre corto (ASESOR ULT TIP DF SN
    // CONTC), que es lo único que debe verse en pantalla.
    const leadsParaAsesor = leadsIndicadoresFiltradosExcluyendo('asesor');
    const nombresRawAsesor = [...new Set(leadsParaAsesor.map(l => String(l[COLUMNAS.ASESOR_NOMBRE_RAW] || '').trim()).filter(Boolean))].sort();
    const labelsAsesor = {};
    leadsParaAsesor.forEach(l => {
        const raw = String(l[COLUMNAS.ASESOR_NOMBRE_RAW] || '').trim();
        if (raw && !labelsAsesor[raw]) labelsAsesor[raw] = l[COLUMNAS.ASESOR_ULTIMO_CONTACTO] || raw;
    });
    createMultiSelect('indFilterAsesor', nombresRawAsesor, state.indicadores.filtros.asesor, 'Todos', labelsAsesor);

    // Campaña: siempre con TODAS las campañas efectivas del usuario (no se
    // recorta por los demás filtros, para no perder de vista campañas
    // completas). No se permite la opción "Todas" (catch-all) — el usuario
    // debe ver siempre las campañas activas marcadas explícitamente, con al
    // menos una seleccionada en todo momento.
    const camposCampana = [...new Set(todosLosLeadsIndicadores().map(l => String(l[COLUMNAS.CAMPANA] || '').trim()).filter(Boolean))].sort();
    createMultiSelect('indFilterCampana', camposCampana, state.indicadores.filtros.campana, 'Todas', null, { permitirTodos: false });
    // Si todavía no había selección (primera carga), createMultiSelect ya
    // marcó todas las opciones por defecto — reflejamos eso en el state
    // para que el resto de la lógica (filtro, calendario, etc.) lo sepa.
    if (state.indicadores.filtros.campana.length === 0 && camposCampana.length > 0) {
        state.indicadores.filtros.campana = camposCampana.slice();
    }

    createMultiSelect('indFilterCanal', valoresUnicos(COLUMNAS.CANAL, 'canal'), state.indicadores.filtros.canal, 'Todos');

    if (!state.indicadores.filtrosListenerListo) {
        window.addEventListener('multiselect-change', (e) => {
            const map = {
                indFilterPrograma: 'programa', indFilterIngreso: 'ingreso', indFilterModalidad: 'modalidad',
                indFilterAsesor: 'asesor', indFilterCampana: 'campana', indFilterCanal: 'canal'
            };
            const filtroKey = map[e.detail.containerId];
            if (!filtroKey) return;
            state.indicadores.filtros[filtroKey] = e.detail.values;
            // Recalcula las opciones de TODOS los filtros (cascada — cada
            // uno se recalcula sobre el contexto que dejan los demás) y
            // luego recalcula todos los indicadores/tablas/gráficos.
            poblarFiltrosIndicadores();
            // poblarFiltrosIndicadores reconstruye el HTML de los 6
            // dropdowns (createMultiSelect), lo que cierra el panel que el
            // usuario tenía abierto — lo reabrimos para que pueda seguir
            // marcando varias opciones sin interrupciones.
            const contActivo = document.getElementById(e.detail.containerId);
            contActivo?.querySelector('.multiselect-panel')?.classList.add('open');
            contActivo?.closest('.filter-group')?.classList.add('open');
            renderIndicadores();
            renderIndCalendarioFiltro();
        });
        state.indicadores.filtrosListenerListo = true;
    }
}

// El filtro "Calendario" reemplaza al viejo rango de fechas: mismo estilo y
// comportamiento que el calendario "Fecha VP/PP" del Dashboard (selección
// de días puntuales, con conteo de leads por día), pero sobre FECHA HORA DE
// REGISTRO — el único campo de fecha común a todos los leads sin importar
// en qué sección de Indicadores caigan.
// `excluirClave` deja de aplicar ese filtro puntual — se usa para calcular
// las opciones disponibles de un filtro en función de TODOS LOS DEMÁS
// (filtros interdependientes/cascada), sin que un filtro se autolimite a lo
// que ya tiene marcado. Con excluirClave = null se aplican los 6 filtros +
// el calendario tal como están, que es lo que necesitan las tablas/gráficos.
function leadsIndicadoresFiltradosExcluyendo(excluirClave) {
    const f = state.indicadores.filtros;
    return todosLosLeadsIndicadores().filter(lead => {
        if (excluirClave !== 'campana' && f.campana.length && !f.campana.includes(lead[COLUMNAS.CAMPANA] || '')) return false;
        if (excluirClave !== 'programa' && f.programa.length && !f.programa.includes(lead[COLUMNAS.PROGRAMA] || '')) return false;
        if (excluirClave !== 'modalidad' && f.modalidad.length && !f.modalidad.includes(lead[COLUMNAS.MODALIDAD] || '')) return false;
        if (excluirClave !== 'ingreso' && f.ingreso.length && !f.ingreso.includes(lead[COLUMNAS.MODALIDAD_INGRESO] || '')) return false;
        if (excluirClave !== 'asesor' && f.asesor.length && !f.asesor.includes(lead[COLUMNAS.ASESOR_NOMBRE_RAW] || '')) return false;
        if (excluirClave !== 'canal' && f.canal.length && !f.canal.includes(lead[COLUMNAS.CANAL] || '')) return false;
        if (excluirClave !== 'fechaCalendario' && f.fechaCalendario.length) {
            const d = parsearFechaFlexible(lead[COLUMNAS.FECHA_HORA_REGISTRO]);
            if (!d) return false;
            if (!f.fechaCalendario.includes(fechaAClaveISO(d))) return false;
        }
        return true;
    });
}

function leadsIndicadoresFiltrados() {
    return leadsIndicadoresFiltradosExcluyendo(null);
}

// ---- Filtro Calendario (mismo patrón que calVpPp del Dashboard) ----
function toggleIndCalPanel() {
    const panel = document.getElementById('indCalPanel');
    const btn = document.getElementById('indCalToggleBtn');
    if (!panel) return;
    const abierto = panel.classList.toggle('open');
    if (btn) btn.classList.toggle('active', abierto);
    if (abierto) {
        renderIndCalendarioFiltro();
        setTimeout(() => document.addEventListener('click', cerrarIndCalFuera), 0);
    }
}
window.toggleIndCalPanel = toggleIndCalPanel;

function cerrarIndCalFuera(e) {
    const panel = document.getElementById('indCalPanel');
    if (!panel || !panel.classList.contains('open')) {
        document.removeEventListener('click', cerrarIndCalFuera);
        return;
    }
    if (e.target.closest('#indCalDropdown')) return;
    panel.classList.remove('open');
    document.getElementById('indCalToggleBtn')?.classList.remove('active');
    document.removeEventListener('click', cerrarIndCalFuera);
}

function cambiarMesIndCal(delta) {
    state.indicadores.calMes.setMonth(state.indicadores.calMes.getMonth() + delta);
    renderIndCalendarioFiltro();
}
window.cambiarMesIndCal = cambiarMesIndCal;

function mapaFechasIndCal() {
    const mapa = {};
    leadsIndicadoresFiltradosExcluyendo('fechaCalendario').forEach(lead => {
        const d = parsearFechaFlexible(lead[COLUMNAS.FECHA_HORA_REGISTRO]);
        if (!d) return;
        const clave = fechaAClaveISO(d);
        mapa[clave] = (mapa[clave] || 0) + 1;
    });
    return mapa;
}

function renderIndCalendarioFiltro() {
    const panel = document.getElementById('indCalPanel');
    if (!panel || !panel.classList.contains('open')) return; // no perder tiempo si está cerrado

    const grid = document.getElementById('indCalGrid');
    const label = document.getElementById('indCalMesLabel');
    if (!grid || !label) return;

    const mes = state.indicadores.calMes;
    const labelMes = mes.toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });
    label.textContent = labelMes.charAt(0).toUpperCase() + labelMes.slice(1);

    const mapa = mapaFechasIndCal();
    const seleccionadas = state.indicadores.filtros.fechaCalendario;

    const primerDia = new Date(mes.getFullYear(), mes.getMonth(), 1);
    const ultimoDia = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);
    const offset = (primerDia.getDay() + 6) % 7; // semana empieza en lunes

    let html = '';
    for (let i = 0; i < offset; i++) html += '<div class="cal-vpp-day vacio"></div>';
    for (let d = 1; d <= ultimoDia.getDate(); d++) {
        const clave = `${mes.getFullYear()}-${String(mes.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const count = mapa[clave] || 0;
        const activo = seleccionadas.includes(clave);
        html += `
            <div class="cal-vpp-day ${count ? 'tiene-datos' : ''} ${activo ? 'seleccionado' : ''}"
                 onclick="${count ? `window.toggleFechaIndCal('${clave}')` : ''}">
                ${d}
                ${count ? `<span class="cal-vpp-count">${count}</span>` : ''}
            </div>`;
    }
    grid.innerHTML = html;

    const btn = document.getElementById('indCalToggleBtn');
    if (btn) btn.classList.toggle('has-selection', seleccionadas.length > 0);
}
window.renderIndCalendarioFiltro = renderIndCalendarioFiltro;

function toggleFechaIndCal(clave) {
    const idx = state.indicadores.filtros.fechaCalendario.indexOf(clave);
    if (idx >= 0) state.indicadores.filtros.fechaCalendario.splice(idx, 1);
    else state.indicadores.filtros.fechaCalendario.push(clave);
    poblarFiltrosIndicadores(); // cascada: el resto de filtros se recalcula
    renderIndicadores();
    renderIndCalendarioFiltro();
}
window.toggleFechaIndCal = toggleFechaIndCal;

function limpiarFiltroIndCal() {
    state.indicadores.filtros.fechaCalendario = [];
    poblarFiltrosIndicadores();
    renderIndicadores();
    renderIndCalendarioFiltro();
}
window.limpiarFiltroIndCal = limpiarFiltroIndCal;

// ---- Utilidades de agrupación jerárquica de fechas (Mes → Semana → Día) ----
function claveMesInd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function labelMesInd(d) {
    const s = d.toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
}
function claveSemanaISOInd(d) {
    const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = (dt.getUTCDay() + 6) % 7;
    dt.setUTCDate(dt.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
    const weekNum = 1 + Math.round(((dt - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    return `${dt.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}
function labelSemanaInd(d) {
    const lunes = new Date(d);
    lunes.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const domingo = new Date(lunes);
    domingo.setDate(lunes.getDate() + 6);
    const fmt = (x) => x.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit' });
    return `Semana ${fmt(lunes)} – ${fmt(domingo)}`;
}
function labelDiaInd(d) { return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }); }

// Arma el árbol Mes > Semana > Día para un conjunto de items ya filtrados.
function construirArbolFechasInd(items, getFecha) {
    const raiz = {};
    items.forEach(item => {
        const d = getFecha(item);
        if (!d) return;
        const mk = claveMesInd(d), sk = claveSemanaISOInd(d), dk = fechaAClaveISO(d);
        raiz[mk] = raiz[mk] || { label: labelMesInd(d), items: [], semanas: {} };
        raiz[mk].items.push(item);
        raiz[mk].semanas[sk] = raiz[mk].semanas[sk] || { label: labelSemanaInd(d), items: [], dias: {} };
        raiz[mk].semanas[sk].items.push(item);
        raiz[mk].semanas[sk].dias[dk] = raiz[mk].semanas[sk].dias[dk] || { label: labelDiaInd(d), items: [] };
        raiz[mk].semanas[sk].dias[dk].items.push(item);
    });
    return raiz;
}

function toggleIndRow(tablaId, clave) {
    const set = state.indicadores.expandido[tablaId] = state.indicadores.expandido[tablaId] || new Set();
    if (set.has(clave)) set.delete(clave); else set.add(clave);
    renderIndicadores();
}
window.toggleIndRow = toggleIndRow;

// ---- Sección: Status de Gestión ----
// "Fecha de status actual" = FECHA_ULT_MODIFICACION (columna real de
// leads_bottom, expuesta en cada lead vía bottomToUpper en getLeads).
function fechaStatusActual(lead) {
    return lead[COLUMNAS.FECHA_ULT_MODIFICACION];
}

function render1_1StatusGestion(leads) {
    const porCampana = {};
    leads.forEach(l => {
        const camp = l[COLUMNAS.CAMPANA] || '-';
        const status = l[COLUMNAS.STATUS_GESTION] || '-';
        porCampana[camp] = porCampana[camp] || { total: 0, porStatus: {} };
        porCampana[camp].total++;
        porCampana[camp].porStatus[status] = (porCampana[camp].porStatus[status] || 0) + 1;
    });

    let filas = '';
    Object.keys(porCampana).sort().forEach(camp => {
        const info = porCampana[camp];
        const statusesOrdenados = ordenarStatusInd(Object.keys(info.porStatus));
        const filasDeEstaCamp = statusesOrdenados.map(status => {
            const n = info.porStatus[status];
            return `
                <tr>{{CAMP_TD}}
                    <td>${escapeHtml(STATUS_LABELS[status] || status)}</td>
                    <td>${n}</td>
                    <td>${pctInd(n, info.total)}</td>
                </tr>`;
        });
        filasDeEstaCamp.push(`
            <tr class="ind-row-subtotal">{{CAMP_TD}}
                <td>Total</td>
                <td>${info.total}</td>
                <td>100%</td>
            </tr>`);
        filas += emitirFilasConCampana(filasDeEstaCamp, camp);
    });
    if (!filas) filas = `<tr><td colspan="4" style="text-align:center;color:#888;">Sin datos</td></tr>`;

    return `
        <div class="card ind-card">
            <h3>Status de Gestión</h3>
            <table class="ind-table">
                <thead><tr><th>Campaña</th><th>Status</th><th># Leads</th><th>%</th></tr></thead>
                <tbody>${filas}</tbody>
            </table>
        </div>`;
}

function render1_2DiasConversion(leads) {
    const porCampana = {};
    leads.forEach(l => {
        const fPrim = parsearFechaFlexible(l[COLUMNAS.FECHA_PRIM_VP_PP]);
        const fStatus = parsearFechaFlexible(fechaStatusActual(l));
        if (!fPrim || !fStatus) return; // solo cuenta si ambas fechas existen
        const dias = Math.round((fStatus - fPrim) / 86400000);
        if (dias < 0) return;

        const camp = l[COLUMNAS.CAMPANA] || '-';
        const status = l[COLUMNAS.STATUS_GESTION] || '-';
        porCampana[camp] = porCampana[camp] || { total: 0, porStatus: {} };
        porCampana[camp].total++;
        porCampana[camp].porStatus[status] = porCampana[camp].porStatus[status] || { suma: 0, n: 0 };
        porCampana[camp].porStatus[status].suma += dias;
        porCampana[camp].porStatus[status].n++;
    });

    let filas = '';
    Object.keys(porCampana).sort().forEach(camp => {
        const info = porCampana[camp];
        const statusesOrdenados = ordenarStatusInd(Object.keys(info.porStatus));
        const filasDeEstaCamp = statusesOrdenados.map(status => {
            const { suma, n } = info.porStatus[status];
            const promedio = (suma / n).toFixed(1);
            return `
                <tr>{{CAMP_TD}}
                    <td>${escapeHtml(STATUS_LABELS[status] || status)}</td>
                    <td>${promedio}</td>
                    <td>${n}</td>
                    <td>${pctInd(n, info.total)}</td>
                </tr>`;
        });
        filasDeEstaCamp.push(`
            <tr class="ind-row-subtotal">{{CAMP_TD}}
                <td>Total</td>
                <td>—</td>
                <td>${info.total}</td>
                <td>100%</td>
            </tr>`);
        filas += emitirFilasConCampana(filasDeEstaCamp, camp);
    });
    if (!filas) filas = `<tr><td colspan="5" style="text-align:center;color:#888;">Sin datos</td></tr>`;

    return `
        <div class="card ind-card">
            <h3>Cantidad de días para conversión</h3>
            <table class="ind-table">
                <thead><tr><th>Campaña</th><th>Status</th><th>Días (promedio)</th><th># Leads</th><th>%</th></tr></thead>
                <tbody>${filas}</tbody>
            </table>
        </div>`;
}

// ---- Sección: Ventas ----
// Ventas = pagos reales (Pago Completo + Pago Fraccionado). Columnas
// pedidas: Campaña, Fecha, # de Pagos, % (sobre el total de pagos de la
// campaña). Agrupación Mes > Semana > Día, igual que el resto de tablas.
const STATUS_PAGOS = [STATUS.PAGO_COMPLETO, STATUS.PAGO_FRACCIONADO];

// Fecha relevante por lead: Pago Completo usa su fecha de pago, Pago
// Fraccionado usa su fecha de promesa de pago; si falta, cae a la fecha del
// status actual.
function fechaVentaLead(lead) {
    if (lead[COLUMNAS.STATUS_GESTION] === STATUS.PAGO_COMPLETO) {
        return parsearFechaFlexible(lead[COLUMNAS.FECHA_PAGO_COMPLETO]) || parsearFechaFlexible(fechaStatusActual(lead));
    }
    if (lead[COLUMNAS.STATUS_GESTION] === STATUS.PAGO_FRACCIONADO) {
        return parsearFechaFlexible(lead[COLUMNAS.FECHA_PROMESA_PAGO]) || parsearFechaFlexible(fechaStatusActual(lead));
    }
    return parsearFechaFlexible(fechaStatusActual(lead));
}

function render2Ventas(leads) {
    const leadsVenta = leads.filter(l => STATUS_PAGOS.includes(l[COLUMNAS.STATUS_GESTION]));

    const porCampana = {};
    leadsVenta.forEach(l => {
        const camp = l[COLUMNAS.CAMPANA] || '-';
        porCampana[camp] = porCampana[camp] || [];
        porCampana[camp].push(l);
    });

    const set = state.indicadores.expandido['indVentas'] = state.indicadores.expandido['indVentas'] || new Set();

    let filas = '';
    Object.keys(porCampana).sort().forEach(camp => {
        const itemsCamp = porCampana[camp];
        const totalCamp = itemsCamp.length;
        const arbol = construirArbolFechasInd(itemsCamp, fechaVentaLead);
        const filasDeEstaCamp = [];

        Object.keys(arbol).sort().forEach(mk => {
            const mes = arbol[mk];
            const claveMesRow = `${camp}|${mk}`;
            const abiertoMes = set.has(claveMesRow);
            filasDeEstaCamp.push(`
                <tr class="ind-row ind-row-mes" onclick="window.toggleIndRow('indVentas','${claveMesRow}')">{{CAMP_TD}}
                    <td><span class="ind-caret">${abiertoMes ? '▾' : '▸'}</span> ${escapeHtml(mes.label)}</td>
                    <td>${mes.items.length}</td>
                    <td>${pctInd(mes.items.length, totalCamp)}</td>
                </tr>`);

            if (abiertoMes) {
                Object.keys(mes.semanas).sort().forEach(sk => {
                    const sem = mes.semanas[sk];
                    const claveSemRow = `${claveMesRow}|${sk}`;
                    const abiertoSem = set.has(claveSemRow);
                    filasDeEstaCamp.push(`
                        <tr class="ind-row ind-row-semana" onclick="window.toggleIndRow('indVentas','${claveSemRow}')">{{CAMP_TD}}
                            <td class="ind-indent-1"><span class="ind-caret">${abiertoSem ? '▾' : '▸'}</span> ${escapeHtml(sem.label)}</td>
                            <td>${sem.items.length}</td>
                            <td>${pctInd(sem.items.length, totalCamp)}</td>
                        </tr>`);

                    if (abiertoSem) {
                        Object.keys(sem.dias).sort().forEach(dk => {
                            const dia = sem.dias[dk];
                            filasDeEstaCamp.push(`
                                <tr class="ind-row ind-row-dia">{{CAMP_TD}}
                                    <td class="ind-indent-2">${escapeHtml(dia.label)}</td>
                                    <td>${dia.items.length}</td>
                                    <td>${pctInd(dia.items.length, totalCamp)}</td>
                                </tr>`);
                        });
                    }
                });
            }
        });

        filasDeEstaCamp.push(`
            <tr class="ind-row-subtotal">{{CAMP_TD}}
                <td>Total</td>
                <td>${totalCamp}</td>
                <td>100%</td>
            </tr>`);

        filas += emitirFilasConCampana(filasDeEstaCamp, camp);
    });
    if (!filas) filas = `<tr><td colspan="4" style="text-align:center;color:#888;">Sin datos con los filtros actuales</td></tr>`;

    return `
        <div class="card ind-card">
            <h3>Ventas</h3>
            <table class="ind-table">
                <thead><tr><th>Campaña</th><th>Fecha</th><th># de Pagos</th><th>%</th></tr></thead>
                <tbody>${filas}</tbody>
            </table>
        </div>`;
}

// ---- Sección: Condiciones Comerciales ----
// Cruza cada solicitud CC con el lead correspondiente (mismo ID_PROMETEO +
// campaña) para sacar su status de venta actual. Una columna por cada
// status del embudo comercial; cada columna trae su propia cantidad y %,
// SIEMPRE calculado sobre el total de solicitudes de la campaña (no sobre
// el total de esa columna).
const STATUS_CC_COLS = [
    { status: STATUS.PAGO_COMPLETO, label: 'Pago Completo' },
    { status: STATUS.PAGO_FRACCIONADO, label: 'Pago Fraccionado' },
    { status: STATUS.PP_VIVA, label: 'PP Viva' },
    { status: STATUS.PP_MUERTA, label: 'PP Muerta' },
    { status: STATUS.VP_VIVA, label: 'VP Viva' },
    { status: STATUS.VP_MUERTA, label: 'VP Muerta' },
    { status: STATUS.SIN_CONTACTO, label: 'Sin Contacto' },
    { status: STATUS.VOLVER_A_LLAMAR, label: 'Volver a Llamar' },
    { status: STATUS.PERDIDO, label: 'Perdido' },
    { status: STATUS.BLACK_LIST, label: 'Blacklist' },
];

function render2CondicionesComerciales(leadsFiltrados) {
    const idsPermitidos = new Set(leadsFiltrados.map(l => `${l[COLUMNAS.ID_PROMETEO]}|${l[COLUMNAS.CAMPANA]}`));
    const mapaLeads = {};
    leadsFiltrados.forEach(l => { mapaLeads[`${l[COLUMNAS.ID_PROMETEO]}|${l[COLUMNAS.CAMPANA]}`] = l; });

    const porCampana = {};
    const totalesPorStatus = {}; // para decidir dinámicamente qué columnas mostrar
    (state.solicitudesCC || []).forEach(sol => {
        const clave = `${sol.ID_PROMETEO}|${sol.CAMPANA}`;
        if (!idsPermitidos.has(clave)) return; // respeta los filtros generales
        const leadCruzado = mapaLeads[clave];
        const camp = sol.CAMPANA || '-';
        const statusActual = leadCruzado ? (leadCruzado[COLUMNAS.STATUS_GESTION] || '-') : '-';
        porCampana[camp] = porCampana[camp] || [];
        porCampana[camp].push({ ...sol, _fechaEnvio: sol.FECHA_SOLICITUD, _statusActual: statusActual });
        totalesPorStatus[statusActual] = (totalesPorStatus[statusActual] || 0) + 1;
    });

    // Columna dinámica: un status solo se muestra (con su "Categoría" y su
    // "%") si tiene AL MENOS un valor > 0 dentro del conjunto actualmente
    // filtrado. Se recalcula en cada render, así que aparecen/desaparecen
    // solas según los filtros activos — Total y Total % siempre visibles.
    const columnasVisibles = STATUS_CC_COLS.filter(c => (totalesPorStatus[c.status] || 0) > 0);

    const set = state.indicadores.expandido['indCC'] = state.indicadores.expandido['indCC'] || new Set();

    // Cada status aporta 2 <td>: cantidad y %. Al final siempre van Total y
    // Total % (ambos calculados sobre totalCamp, igual que el resto de
    // columnas — consistente con las demás tablas de Indicadores).
    function celdasStatus(items, totalCamp) {
        const celdasPorStatus = columnasVisibles.map(c => {
            const n = items.filter(it => it._statusActual === c.status).length;
            return `<td>${n}</td><td>${pctInd(n, totalCamp)}</td>`;
        }).join('');
        return `${celdasPorStatus}<td>${items.length}</td><td>${pctInd(items.length, totalCamp)}</td>`;
    }

    let filas = '';
    Object.keys(porCampana).sort().forEach(camp => {
        const itemsCamp = porCampana[camp];
        const totalCamp = itemsCamp.length;
        const arbol = construirArbolFechasInd(itemsCamp, x => parsearFechaFlexible(x._fechaEnvio));
        const filasDeEstaCamp = [];

        Object.keys(arbol).sort().forEach(mk => {
            const mes = arbol[mk];
            const claveMesRow = `${camp}|${mk}`;
            const abiertoMes = set.has(claveMesRow);
            filasDeEstaCamp.push(`
                <tr class="ind-row ind-row-mes" onclick="window.toggleIndRow('indCC','${claveMesRow}')">{{CAMP_TD}}
                    <td><span class="ind-caret">${abiertoMes ? '▾' : '▸'}</span> ${escapeHtml(mes.label)}</td>
                    ${celdasStatus(mes.items, totalCamp)}
                </tr>`);

            if (abiertoMes) {
                Object.keys(mes.semanas).sort().forEach(sk => {
                    const sem = mes.semanas[sk];
                    const claveSemRow = `${claveMesRow}|${sk}`;
                    const abiertoSem = set.has(claveSemRow);
                    filasDeEstaCamp.push(`
                        <tr class="ind-row ind-row-semana" onclick="window.toggleIndRow('indCC','${claveSemRow}')">{{CAMP_TD}}
                            <td class="ind-indent-1"><span class="ind-caret">${abiertoSem ? '▾' : '▸'}</span> ${escapeHtml(sem.label)}</td>
                            ${celdasStatus(sem.items, totalCamp)}
                        </tr>`);

                    if (abiertoSem) {
                        Object.keys(sem.dias).sort().forEach(dk => {
                            const dia = sem.dias[dk];
                            filasDeEstaCamp.push(`
                                <tr class="ind-row ind-row-dia">{{CAMP_TD}}
                                    <td class="ind-indent-2">${escapeHtml(dia.label)}</td>
                                    ${celdasStatus(dia.items, totalCamp)}
                                </tr>`);
                        });
                    }
                });
            }
        });

        filasDeEstaCamp.push(`
            <tr class="ind-row-subtotal">{{CAMP_TD}}
                <td>Total</td>
                ${celdasStatus(itemsCamp, totalCamp)}
            </tr>`);

        filas += emitirFilasConCampana(filasDeEstaCamp, camp);
    });
    // 2 columnas fijas (Campaña, Fecha) + 2 por cada status visible + 2 de Total.
    const totalColumnas = 2 + columnasVisibles.length * 2 + 2;
    if (!filas) filas = `<tr><td colspan="${totalColumnas}" style="text-align:center;color:#888;">Sin datos</td></tr>`;

    // Cada status visible aporta dos encabezados: su nombre y "%", igual que
    // pide la estructura de la sección 5 (Campaña | Fecha | Pago Completo |
    // % | Pago Fraccionado | % | ... | Total | %).
    const headerStatus = columnasVisibles.map(c => `<th>${escapeHtml(c.label)}</th><th>%</th>`).join('');

    return `
        <div class="card ind-card">
            <h3>Condiciones Comerciales</h3>
            <table class="ind-table">
                <thead><tr><th>Campaña</th><th>Fecha</th>${headerStatus}<th>Total</th><th>%</th></tr></thead>
                <tbody>${filas}</tbody>
            </table>
        </div>`;
}

// ---- Sección: Perfilamiento ----
// NOTA: dejo fuera COMENTARIOS_PERFIL y ACCIONES_DEFINIDAS porque son texto
// libre (no categorías con catálogo), así que no calzan en una tabla
// Pregunta/#Leads/%. OTRAS_OPCIONES tampoco entra acá: tiene su propia
// sección especial (tabla + gráfico) más abajo — ver render7OtrasOpciones.
const PREGUNTAS_PERFIL_IND = [
    { columna: COLUMNAS.DOLOR_NECESIDAD, label: 'Dolor / Necesidad' },
    { columna: COLUMNAS.POR_QUE_ELIGIO_CARRERA, label: '¿Por qué eligió la carrera?' },
    { columna: COLUMNAS.QUE_BUSCA_UNIVERSIDAD, label: '¿Qué busca en una universidad?' },
    { columna: COLUMNAS.QUIEN_FINANCIARA, label: '¿Quién financiará la carrera?' },
    { columna: COLUMNAS.QUE_LE_FALTA, label: '¿Qué le falta para tomar una decisión?' }, // admite varias opciones separadas por coma
];

// Valor de OTRAS_OPCIONES que dispara los campos dependientes
// OPCION_INSTITUCION (Instituto/Universidad) y OPCION_NOMBRE_INSTITUCION —
// mismo valor usado en lead-detail.js (VALOR_OTRAS_OPCIONES_INSTITUCION).
const VALOR_OTRAS_OPCIONES_INSTITUCION_IND = 'Evaluando otras instituciones';
const TOP_N_INSTITUCIONES = 5;

// Tabla Pregunta/#Leads/% de "¿Cuáles son sus otras opciones?" (mismo
// formato que el resto de Perfilamiento), reutilizando renderTablaPerfilInd.
function renderTablaOtrasOpciones(leads) {
    return renderTablaPerfilInd({ columna: COLUMNAS.OTRAS_OPCIONES, label: '¿Cuáles son sus otras opciones?' }, leads);
}

// Cruza OPCION_INSTITUCION (tipo: INSTITUTO/UNIVERSIDAD) con
// OPCION_NOMBRE_INSTITUCION para el gráfico de la sección 7. Solo entran los
// leads cuya respuesta de OTRAS_OPCIONES es "Evaluando otras instituciones"
// (los únicos que llenan estos dos campos dependientes).
function datosInstitutoVsUniversidad(leads) {
    const relevantes = leads.filter(l => limpiarEspacios(l[COLUMNAS.OTRAS_OPCIONES]) === VALOR_OTRAS_OPCIONES_INSTITUCION_IND);

    const grupos = { instituto: {}, universidad: {} };
    let totalInstituto = 0, totalUniversidad = 0;

    relevantes.forEach(l => {
        const tipoCrudo = claveCategoriaLocal(l[COLUMNAS.OPCION_INSTITUCION]);
        const nombre = l[COLUMNAS.OPCION_NOMBRE_INSTITUCION];
        if (tipoCrudo.startsWith('instituto')) {
            totalInstituto++;
            if (nombre) sumarCategoria(grupos.instituto, nombre);
        } else if (tipoCrudo.startsWith('universidad')) {
            totalUniversidad++;
            if (nombre) sumarCategoria(grupos.universidad, nombre);
        }
    });

    const topN = (mapa) => Object.values(mapa).sort((a, b) => b.total - a.total).slice(0, TOP_N_INSTITUCIONES);

    return {
        totalInstituto, totalUniversidad,
        topInstituto: topN(grupos.instituto),
        topUniversidad: topN(grupos.universidad),
    };
}
function claveCategoriaLocal(s) { return limpiarEspacios(s).toLowerCase(); }

// Sección 7: tabla (izquierda) + gráfico Instituto vs. Universidad con su
// Top 5 (derecha), lado a lado. Va aparte del grid de Perfilamiento (no
// participa del empaquetado dinámico de la sección 4).
function filasInstitutoVsUniversidad(topInstituto, topUniversidad, totalInstituto, totalUniversidad) {
    const n = Math.max(topInstituto.length, topUniversidad.length);
    let filas = '';
    for (let i = 0; i < n; i++) {
        const inst = topInstituto[i];
        const uni = topUniversidad[i];
        filas += `
            <tr>
                <td>${inst ? escapeHtml(inst.label) : ''}</td>
                <td>${inst ? inst.total : ''}</td>
                <td>${uni ? escapeHtml(uni.label) : ''}</td>
                <td>${uni ? uni.total : ''}</td>
            </tr>`;
    }
    filas += `
        <tr class="ind-row-subtotal">
            <td>Total</td>
            <td>${totalInstituto}</td>
            <td>Total</td>
            <td>${totalUniversidad}</td>
        </tr>`;
    return filas;
}

function render7OtrasOpciones(leads) {
    const tabla = renderTablaOtrasOpciones(leads);
    if (!tabla) return '';

    const { totalInstituto, totalUniversidad, topInstituto, topUniversidad } = datosInstitutoVsUniversidad(leads);

    const contenidoInstUni = (totalInstituto === 0 && totalUniversidad === 0)
        ? `<p style="color:#888;">Sin datos con los filtros actuales</p>`
        : `
            <table class="ind-table ind-table-instituto-universidad">
                <thead><tr><th>Instituto</th><th>#</th><th>Universidad</th><th>#</th></tr></thead>
                <tbody>${filasInstitutoVsUniversidad(topInstituto, topUniversidad, totalInstituto, totalUniversidad)}</tbody>
            </table>`;

    return `
        <div class="card ind-card ind-otras-opciones-card">
            <div class="ind-otras-opciones-grid">
                <div>${tabla}</div>
                <div>
                    <h3>Instituto vs. Universidad</h3>
                    ${contenidoInstUni}
                </div>
            </div>
        </div>`;
}

function renderTablaPerfilInd(pregunta, leads) {
    const porCampana = {};
    leads.forEach(l => {
        const valorCrudo = limpiarEspacios(l[pregunta.columna]);
        if (!valorCrudo) return; // "solo las que se tienen por lo menos 1"
        const camp = l[COLUMNAS.CAMPANA] || '-';
        porCampana[camp] = porCampana[camp] || { total: 0, porValor: {} };
        const valores = pregunta.columna === COLUMNAS.QUE_LE_FALTA
            ? valorCrudo.split(',').map(v => limpiarEspacios(v)).filter(Boolean)
            : [valorCrudo];
        porCampana[camp].total++;
        valores.forEach(v => sumarCategoria(porCampana[camp].porValor, v));
    });

    let filas = '';
    Object.keys(porCampana).sort().forEach(camp => {
        const info = porCampana[camp];
        // Ordenado de mayor a menor por cantidad de leads.
        const valoresOrdenados = Object.values(info.porValor).sort((a, b) => b.total - a.total);
        const filasDeEstaCamp = valoresOrdenados.map(({ label, total: n }) => {
            return `
                <tr>{{CAMP_TD}}
                    <td>${escapeHtml(label)}</td>
                    <td>${n}</td>
                    <td>${pctInd(n, info.total)}</td>
                </tr>`;
        });
        filasDeEstaCamp.push(`
            <tr class="ind-row-subtotal">{{CAMP_TD}}
                <td>Total</td>
                <td>${info.total}</td>
                <td>100%</td>
            </tr>`);
        filas += emitirFilasConCampana(filasDeEstaCamp, camp);
    });
    if (!filas) return ''; // la tabla entera desaparece si nadie respondió esta pregunta

    return `
        <div class="card ind-card">
            <h3>${escapeHtml(pregunta.label)}</h3>
            <table class="ind-table">
                <thead><tr><th>Campaña</th><th>Respuesta</th><th># Leads</th><th>%</th></tr></thead>
                <tbody>${filas}</tbody>
            </table>
        </div>`;
}

// Distribución dinámica tipo masonry (columnas CSS) — ver .ind-perfil-grid
// en ui-kit.css. "¿Cuáles son sus otras opciones?" queda afuera de este
// grid: se arma aparte, como sección de ancho completo (tabla + gráfico).
function render3Perfilamiento(leads) {
    const tablas = PREGUNTAS_PERFIL_IND.map(p => renderTablaPerfilInd(p, leads)).filter(Boolean);
    const otrasOpciones = render7OtrasOpciones(leads);
    if (tablas.length === 0 && !otrasOpciones) return '';
    return `<div class="ind-perfil-grid">${tablas.join('')}${otrasOpciones}</div>`;
}

// ---- Orquestador ----
function renderIndicadores() {
    const cont = document.getElementById('indContent');
    if (!cont) return;
    const leads = leadsIndicadoresFiltrados();
    const tablasPerfil = render3Perfilamiento(leads);

    cont.innerHTML = `
        <h3 class="ind-section-title">Status de Gestión</h3>
        <div class="ind-row-cards">
            ${render1_1StatusGestion(leads)}
            ${render1_2DiasConversion(leads)}
        </div>

        <h3 class="ind-section-title">Ventas y Condiciones Comerciales</h3>
        ${render2Ventas(leads)}
        ${render2CondicionesComerciales(leads)}

        <h3 class="ind-section-title">Perfilamiento</h3>
        ${tablasPerfil || '<p style="color:#888;">Sin respuestas de perfilamiento con los filtros actuales.</p>'}
    `;
}
window.renderIndicadores = renderIndicadores;


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