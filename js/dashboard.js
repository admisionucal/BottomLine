import { API_URL, COLUMNAS, STATUS, STATUS_LABELS, CACHE_KEYS, esRolSupervisorOAdmision } from '../core/constants.js';

import { getCurrentUser, getUserCampanas, getSessionToken, cacheGet, cacheSet, escapeHtml, parsearFechaFlexible, fechaAClaveISO, limpiarEspacios, sumarCategoria } from '../core/utils.js';

import { Sidebar, Toast, createMultiSelect, toggleMultiSelect, renderTable } from '../core/components.js';
import { buscarDuplicados, limpiarCacheDuplicados } from './duplicados-sugeridos.js';
import { unificarLeads } from './unificar-core.js';

let state = {
    leadsRaw: [],
    leadsFiltered: [],
    currentPage: 1,
    pageSize: 11,
    pagesPerBlock: 20,
    terminoBusqueda: '',
    filtros: {
        carrera: [], canal: [], ingreso: [], beneficio: [], modalidad: [], asesor: [], perfil: [], dolorNecesidad: [],
        fechaPrimVpPp: [],
        status: [STATUS.VP_VIVA, STATUS.PP_VIVA]
    },
    campana: '',
    calCampanas: [],
    campanasVigentes: [],
    campanasActivas: [],
    calLeadsPorCampana: {},
    mapaCalendario: {},
    categoriasVisibles: { viva: true, muerta: false, pagoCompleto: false, pagoFraccionado: false, visitaGuiada: true },
    calendarioMes: new Date(),
    vistaCalendario: 'mes',
    diaSeleccionado: null,
    ultimaActualizacion: null,
    calVpPpMes: new Date(),
    solicitudesCC: [],
    indicadores: {
        filtros: { campana: [], programa: [], modalidad: [], ingreso: [], asesor: [], canal: [], status: [STATUS.VP_VIVA, STATUS.PP_VIVA], perfil: [], fechaCalendario: [] },
        expandido: {},
        calMes: new Date(),
        cargado: false,
        leadsPorCampana: {},
        perfilPopupData: {}
    }
};

const CATEGORIAS_CALENDARIO = {
    viva: { label: 'PP Viva', color: '#0040A1', status: STATUS.PP_VIVA, campoFecha: COLUMNAS.FECHA_COMPROMISO_PAGO },
    muerta: { label: 'PP Muerta', color: '#5e35b1', status: STATUS.PP_MUERTA, campoFecha: COLUMNAS.FECHA_COMPROMISO_PAGO },
    pagoCompleto: { label: 'Pago Completo', color: '#2e7d32', status: STATUS.PAGO_COMPLETO, campoFecha: COLUMNAS.FECHA_PAGO_COMPLETO },
    pagoFraccionado: { label: 'Pago Fraccionado', color: '#f9a825', status: STATUS.PAGO_FRACCIONADO, campoFecha: COLUMNAS.FECHA_PROMESA_PAGO },
    visitaGuiada: { label: 'Visita Guiada', color: '#00897b', campoFecha: COLUMNAS.FECHA_VISITA_GUIADA }
};

const CATEGORIAS_POR_ROL = {
    admin: ['viva', 'muerta', 'pagoCompleto', 'pagoFraccionado', 'visitaGuiada'],
    asesor: ['viva', 'visitaGuiada']
};

function categoriasVisiblesParaRol(esAdmin) {
    return esAdmin ? CATEGORIAS_POR_ROL.admin : CATEGORIAS_POR_ROL.asesor;
}

function calcularColumnasBoleta(lead) {
    const total = lead['BOLETA_FINAL'] ?? lead['BOLETA FINAL'];
    if (total === undefined || total === null || total === '') {
        return { boleta: '-', boletaConMatricula: '-' };
    }
    const totalNum = parseFloat(total) || 0;
    const matriculaNum = parseFloat(lead['MATRICULA_FINAL']) || 0;
    const admisionNum = parseFloat(lead['ADMISION_FINAL']) || 0;
    return {
        boleta: (totalNum - matriculaNum - admisionNum).toFixed(2),
        boletaConMatricula: totalNum.toFixed(2),
    };
}

document.addEventListener('DOMContentLoaded', async () => {
    const user = getCurrentUser();
    if (!user) {
        window.location.href = 'index.html';
        return;
    }

    const vistaInicial = new URLSearchParams(window.location.search).get('view') || 'usuario';
    const gruposBottomLine = ['bottomline', 'calendario', 'unificar', 'cc'];
    const activaInicial = gruposBottomLine.includes(vistaInicial) ? 'bottomline' : vistaInicial;

    new Sidebar({ active: activaInicial });

    setupUI(user);
    if (esRolSupervisorOAdmision(user.rol)) actualizarBadgeCC();
    await loadCampanas(user);
    setupCalendarioCampanaFiltro(user);
    setupBuscador();
    await loadLeads();
    cargarLeadsIndicadores().catch(() => {});
    await cargarLeadsCalendario();

    document.getElementById('btnActualizar')?.addEventListener('click', () => loadLeads(true));
    document.getElementById('btnExportar')?.addEventListener('click', exportarExcel);
    document.getElementById('filtrosToggleBtn')?.addEventListener('click', toggleFiltrosPanel);
    document.getElementById('calVpPpToggleBtn')?.addEventListener('click', toggleCalVpPpPanel);
    setupAutoHideToolbar();

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

function setupAutoHideToolbar() {
    const barra = document.getElementById('tableControlsSticky');
    const filtros = document.getElementById('navFiltrosPanel');
    if (!barra) return;

    let ultimoScrollY = window.scrollY;
    let ticking = false;
    const UMBRAL = 8;

    window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
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
                    barra.classList.add('oculto');
                } else {
                    barra.classList.remove('oculto');
                }
                ultimoScrollY = actual;
            }
            ticking = false;
        });
    }, { passive: true });
}

function setupUI(user) {
    const esAdmin = esRolSupervisorOAdmision(user.rol);
    const asesorGroup = document.getElementById('filterAsesorGroup');
    if (!esAdmin && asesorGroup) asesorGroup.style.display = 'none';

    if (esAdmin) {

        const filtersContainer = document.getElementById('filtersContainer');
        if (filtersContainer) filtersContainer.classList.add('cols-4');

        const navMarcacion = document.getElementById('navAsistenciaMarcacion');
        if (navMarcacion) navMarcacion.style.display = 'none';
    }
}

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

async function loadCampanas(user) {
    const codigos = getUserCampanas();
    const select = document.getElementById('selectCampana');
    if (!select) return;

    if (codigos.length === 0) {
        select.innerHTML = '<option value="">Sin campañas asignadas</option>';
        return;
    }

    const configResult = await callAPI('getCampanasConfig', {});
    const configPorCodigo = {};
    (configResult.data || []).forEach(c => { configPorCodigo[c.codigo] = c; });

    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });

    const activas = codigos
        .map(cod => configPorCodigo[cod])
        .filter(Boolean)
        .filter(c => c.activa);

    const vigentes = activas
        .filter(c => !c.fechaFinPeriodo || String(c.fechaFinPeriodo).slice(0, 10) >= hoy)
        .sort((a, b) => String(a.fechaInicioPeriodo || '').localeCompare(String(b.fechaInicioPeriodo || '')));

    state.campanasVigentes = vigentes.map(c => c.codigo);
    state.campanasActivas = activas.map(c => c.codigo);

    select.innerHTML = '';
    activas.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.codigo;
        opt.textContent = c.codigo;
        select.appendChild(opt);
    });

    const saved = cacheGet(CACHE_KEYS.FILTROS_ESTADO);
    if (saved && saved.campana && vigentes.some(c => c.codigo === saved.campana)) {
        select.value = saved.campana;
        if (saved.filtros) state.filtros = { ...state.filtros, ...saved.filtros };
        if (saved.busqueda) state.terminoBusqueda = saved.busqueda;
    } else {
        select.value = vigentes[0]?.codigo || activas[0]?.codigo || '';
    }

    state.campana = select.value;
    renderCampanaOptions(activas.map(c => c.codigo));
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

function setupCalendarioCampanaFiltro(user) {
    const campanas = getCampanasCalendario();
    const grupo = document.getElementById('calCampanaFilterGroup');
    if (!grupo) return;

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

function canalDeLead(lead) {
    return String(lead[COLUMNAS.CANAL] || '').trim();
}

function getCampanasCalendario() {
    const todas = getUserCampanas();
    const filtradas = todas.filter(c => state.campanasVigentes.includes(c));
    return filtradas.length ? filtradas : todas;
}

function getCalCampanasEfectivas() {
    const todas = getCampanasCalendario();
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
        }
        return { campana, leads: [] };
    }));

    state.calLeadsPorCampana = {};
    resultados.forEach(({ campana, leads }) => { state.calLeadsPorCampana[campana] = leads; });

    actualizarCalendario();
    renderCalendarioPP();
    renderLeyendaCalendario();
}

async function loadLeads(forceRefresh = false) {
    const user = getCurrentUser();
    const campana = document.getElementById('selectCampana')?.value || state.campana;
    if (!campana) return;

    state.campana = campana;

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

window.addEventListener('multiselect-change', (e) => {
    const { key, values, containerId } = e.detail;
    if (!String(containerId || '').startsWith('filter')) return;
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
    const canal = state.filtros.canal || [];

    state.leadsFiltered = state.leadsRaw.filter(lead => {
        if (carrera.length > 0 && !carrera.includes(lead[COLUMNAS.CARRERA] || lead[COLUMNAS.PROGRAMA] || '')) return false;
        if (canal.length > 0 && !canal.includes(canalDeLead(lead))) return false;
        if (ingreso.length > 0 && !ingreso.includes(lead[COLUMNAS.MODALIDAD_INGRESO] || '')) return false;
        if (beneficio.length > 0 && !beneficio.includes(lead[COLUMNAS.BENEFICIO] || '')) return false;
        if (modalidad.length > 0 && !modalidad.includes(lead[COLUMNAS.MODALIDAD] || '')) return false;
        if (esAdmin && asesor.length > 0 && !asesor.includes(lead[COLUMNAS.ASESOR_NOMBRE_RAW] || '')) return false;
        if (status.length > 0 && !status.includes(lead[COLUMNAS.STATUS_GESTION] || '')) return false;
        if (perfil.length > 0 && !perfil.includes((lead.PERFILAMIENTO_COMPLETO || {}).estado || '')) return false;
        if (dolorNecesidad.length > 0 && !dolorNecesidad.includes(lead[COLUMNAS.DOLOR_NECESIDAD] || '')) return false;
        if (fechaPrimVpPp.length > 0 && !fechaPrimVpPp.includes(lead[COLUMNAS.FECHA_PRIM_VP_PP] || '')) return false;

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
    createMultiSelect('filterCanal', getValues(COLUMNAS.CANAL, 'canal'), state.filtros.canal || [], 'Todos');
    createMultiSelect('filterIngreso', getValues(COLUMNAS.MODALIDAD_INGRESO, 'ingreso'), state.filtros.ingreso, 'Todos');
    createMultiSelect('filterBeneficio', getValues(COLUMNAS.BENEFICIO, 'beneficio'), state.filtros.beneficio, 'Todos');
    createMultiSelect('filterModalidad', getValues(COLUMNAS.MODALIDAD, 'modalidad'), state.filtros.modalidad, 'Todas');
    createMultiSelect('filterStatus', getValues(COLUMNAS.STATUS_GESTION, 'status'), state.filtros.status, 'Todos', STATUS_LABELS);
    createMultiSelect('filterPerfil', ['Pendiente Asesor', 'Pendiente Supervisor', 'Completo'], state.filtros.perfil, 'Todos');
    createMultiSelect('filterDolorNecesidad', getValues(COLUMNAS.DOLOR_NECESIDAD, 'dolorNecesidad'), state.filtros.dolorNecesidad, 'Todos');

    if (esAdmin) {
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
    const canal = filtros.canal || [];

    if (canal.length > 0 && !canal.includes(canalDeLead(lead))) return false;
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

function verDetalleIndicadores(id, campana) {
    const lead = leadsIndicadoresFiltrados().find(l =>
        String(l[COLUMNAS.ID_PROMETEO]) === String(id) && l[COLUMNAS.CAMPANA] === campana
    );
    if (lead) {
        cacheSet(CACHE_KEYS.LEAD_SELECTED(id, campana), lead);
    }
    window.location.href = `lead-detail.html?id=${encodeURIComponent(id)}&campana=${encodeURIComponent(campana)}`;
}
window.verDetalleIndicadores = verDetalleIndicadores;

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
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
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

            const catKey = Object.keys(categoriasEstado).find(k => categoriasEstado[k].status === status);
            if (catKey) {
                const fecha = parsearFechaFlexible(lead[categoriasEstado[catKey].campo]);
                if (fecha) agregar(fechaAClaveISO(fecha), catKey, lead, campana);
            }

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

function cambiarVistaCalendario(vista) {
    state.vistaCalendario = vista;
    const contenido = document.querySelector('#view-calendario .cal-page-content');
    if (contenido) contenido.classList.toggle('vista-anio', vista === 'ano');
    document.querySelectorAll('#calViewToggle button').forEach(btn => {
        btn.classList.toggle('activo', btn.dataset.vista === vista);
    });
    renderCalendarioPP();
}

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

function renderCalendarioAnio(cont) {
    const year = state.calendarioMes.getFullYear();
    const hoyClave = fechaAClaveISO(new Date());

    let totalAnio = 0;
    Object.keys(state.mapaCalendario).forEach(clave => {
        if (clave.startsWith(String(year))) totalAnio += itemsVisiblesDelDia(clave).length;
    });

    let mesesHtml = '';
    for (let m = 0; m < 12; m++) {
        const nombreMes = mesAnioCorto(state.calendarioMes);
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
        const canal = canalDeLead(lead) || '-';
        const modalidadIngreso = lead['MODALIDAD INGRESO'] || '-';
        const modalidad = lead['MODALIDAD'] || '-';
        const { boleta, boletaConMatricula } = calcularColumnasBoleta(lead);
        const asesor = lead[COLUMNAS.ASESOR_ULTIMO_CONTACTO] || '-';
        const cat = CATEGORIAS_CALENDARIO[categoria];
        filas += `
            <tr>
                <td><span class="cal-dot" style="background:${colorParaItem(categoria, campana)};"></span> ${escapeHtml(cat.label)}</td>
                ${mostrarCampana ? `<td>${escapeHtml(campana)}</td>` : ''}
                <td>${escapeHtml(canal)}</td>
                <td><a href="#" class="id-link" onclick="verDetalleDesdeCalendario('${escapeHtml(id)}'); return false;">${escapeHtml(id)}</a></td>
                <td>${escapeHtml(carrera)}</td>
                <td>${escapeHtml(modalidadIngreso)}</td>
                <td>${escapeHtml(modalidad)}</td>
                <td>${boleta === '-' ? '-' : 'S/ ' + escapeHtml(boleta)}</td>
                <td>${boletaConMatricula === '-' ? '-' : 'S/ ' + escapeHtml(boletaConMatricula)}</td>
                ${esAdmin ? `<td>${escapeHtml(asesor)}</td>` : ''}
            </tr>`;
    });

    const colspan = (esAdmin ? 9 : 8) + (mostrarCampana ? 1 : 0);

    const pesos = ['cat', ...(mostrarCampana ? ['camp'] : []), 'canal', 'id', 'carrera', 'mi', 'mod', 'bol', 'bolm', ...(esAdmin ? ['ase'] : [])]
        .map(k => (k === 'carrera' ? 1.1 : 1));
    const totalPesos = pesos.reduce((a, b) => a + b, 0);
    const colgroup = `<colgroup>${pesos.map(p => `<col style="width:${(p / totalPesos * 100).toFixed(2)}%">`).join('')}</colgroup>`;

    const modalHtml = `
        <div class="cal-modal-overlay cal-modal-overlay-top" id="calModalOverlay" onclick="cerrarDetalleDia(event)">
            <div class="cal-modal" style="max-width:1200px; width:96%;" onclick="event.stopPropagation()">
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
                        ${colgroup}
                        <thead><tr>
                            <th>CATEGORÍA</th>${mostrarCampana ? '<th>CAMPAÑA</th>' : ''}<th>CANAL</th><th>ID</th><th>CARRERA</th><th>MODALIDAD INGRESO</th><th>MODALIDAD</th><th>BOLETA</th><th>BOLETA CON CONCEPTOS DE MATRÍCULA</th>${esAdmin ? '<th>ASESOR</th>' : ''}
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

const PERFIL_POPUP_TITULOS = {
    'Completo': 'con Perfilamiento Completo',
    'Pendiente Supervisor': 'con Perfilamiento Pendiente por Supervisor',
    'Pendiente Asesor': 'con Perfilamiento Pendiente por Asesor'
};

function abrirPopupPerfilamiento(clave) {
    const data = state.indicadores.perfilPopupData && state.indicadores.perfilPopupData[clave];
    if (!data) return;
    const { estado, leads, campana } = data;
    const tituloEstado = PERFIL_POPUP_TITULOS[estado] || estado;

    let filas = '';
    leads.forEach(l => {
        const id = l[COLUMNAS.ID_PROMETEO] || '-';
        const nombre = l[COLUMNAS.NOMBRES] || 'Sin Nombre';
        const carrera = l[COLUMNAS.CARRERA] || l['PROGRAMA'] || '-';
        const modalidad = l[COLUMNAS.MODALIDAD] || '-';
        const { boleta, boletaConMatricula } = calcularColumnasBoleta(l);
        const asesor = l[COLUMNAS.ASESOR_ULTIMO_CONTACTO] || '-';
        const campLead = l[COLUMNAS.CAMPANA] || '';
        filas += `
            <tr>
                <td>${escapeHtml(asesor)}</td>
                <td><a href="#" class="id-link" onclick="window.verDetalleIndicadores('${escapeHtml(id)}', '${escapeHtml(campLead)}'); return false;">${escapeHtml(id)}</a></td>
                <td>${escapeHtml(nombre)}</td>
                <td>${escapeHtml(carrera)}</td>
                <td>${escapeHtml(modalidad)}</td>
                <td>${boleta === '-' ? '-' : 'S/ ' + escapeHtml(boleta)}</td>
                <td>${boletaConMatricula === '-' ? '-' : 'S/ ' + escapeHtml(boletaConMatricula)}</td>
            </tr>`;
    });

    const modalHtml = `
        <div class="cal-modal-overlay cal-modal-overlay-top" id="perfilModalOverlay" onclick="cerrarPopupPerfilamiento(event)">
            <div class="cal-modal" onclick="event.stopPropagation()">
                <div class="cal-modal-header">
                    <strong>${escapeHtml(campana)} - Leads ${escapeHtml(tituloEstado)}</strong>
                    <button class="cal-modal-close" onclick="cerrarPopupPerfilamiento()"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">close</span></button>
                </div>
                <div class="cal-modal-toolbar">
                    <span>${leads.length} registro${leads.length === 1 ? '' : 's'}</span>
                </div>
                <div class="cal-modal-body">
                    <table>
                        <thead><tr>
                            <th>ASESOR</th><th>ID</th><th>NOMBRE DEL LEAD</th><th>CARRERA</th><th>MODALIDAD</th><th>BOLETA</th><th>BOLETA CON CONCEPTOS DE MATRÍCULA</th>
                        </tr></thead>
                        <tbody>${filas || '<tr><td colspan="7" style="text-align:center;color:#888;padding:20px;">Sin registros</td></tr>'}</tbody>
                    </table>
                </div>
            </div>
        </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
}
window.abrirPopupPerfilamiento = abrirPopupPerfilamiento;

function cerrarPopupPerfilamiento(e) {
    if (e && e.target && e.target.id !== 'perfilModalOverlay') return;
    const overlay = document.getElementById('perfilModalOverlay');
    if (overlay) overlay.remove();
}
window.cerrarPopupPerfilamiento = cerrarPopupPerfilamiento;

function verDetalleDesdeCalendario(id) {
    verDetalle(id);
}

function construirFilasExportCalendario(items, esAdmin, incluirFecha) {
    const mostrarCampana = getCalCampanasEfectivas().length > 1;
    return items.map(({ lead, categoria, campana, fecha }) => {
        const fila = {};
        if (incluirFecha && fecha) fila['FECHA'] = fecha.split('-').reverse().join('/');
        fila['CATEGORÍA'] = CATEGORIAS_CALENDARIO[categoria].label;
        if (mostrarCampana) fila['CAMPAÑA'] = campana || '';
        fila['CANAL'] = canalDeLead(lead);
        fila['ID PROMETEO'] = lead[COLUMNAS.ID_PROMETEO] || '';
        fila['CARRERA'] = lead['CARRERA'] || lead['PROGRAMA'] || '';
        fila['MODALIDAD INGRESO'] = lead['MODALIDAD INGRESO'] || '';
        fila['MODALIDAD'] = lead['MODALIDAD'] || '';
        const { boleta, boletaConMatricula } = calcularColumnasBoleta(lead);
        fila['BOLETA'] = boleta;
        fila['BOLETA CON CONCEPTOS DE MATRÍCULA'] = boletaConMatricula;
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
    const nombreMes = mesAnioCorto(state.calendarioMes).replace(/\s+/g, '_');
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

async function actualizarCalendarioLeads() {
    const btn = document.getElementById('btnActualizarCalendario');
    if (btn?.disabled) return;
    const htmlOriginal = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">refresh</span> Actualizando…';
    }
    try {
        await cargarLeadsCalendario(true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = htmlOriginal;
        }
    }
}

window.actualizarCalendarioLeads = actualizarCalendarioLeads;
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

function toggleFiltrosPanel() {
    const panel = document.getElementById('navFiltrosPanel');
    const btn = document.getElementById('filtrosToggleBtn');
    if (!panel) return;
    const abierto = panel.classList.toggle('open');
    if (btn) btn.classList.toggle('active', abierto);
}

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
    if (!panel || !panel.classList.contains('open')) return;

    const grid = document.getElementById('calVpPpGrid');
    const label = document.getElementById('calVpPpMesLabel');
    if (!grid || !label) return;

    const mes = state.calVpPpMes;
    label.textContent = mesAnioCorto(mes);

    const mapa = mapaFechasVpPp();
    const seleccionadas = state.filtros.fechaPrimVpPp;

    const primerDia = new Date(mes.getFullYear(), mes.getMonth(), 1);
    const ultimoDia = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);
    const offset = (primerDia.getDay() + 6) % 7;

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

function emitirFilasConCampana(filasDeEstaCamp, campana) {
    return filasDeEstaCamp.map((tr, i) => {
        const celda = i === 0
            ? `<td class="ind-td-campana" rowspan="${filasDeEstaCamp.length}">${escapeHtml(campana)}</td>`
            : '';
        return tr.replace('{{CAMP_TD}}', celda);
    }).join('');
}

function pctInd(n, total) {
    if (!total) return '0%';
    return `${Math.round((n / total) * 100)}%`;
}

async function inicializarIndicadores() {
    if (state.indicadores.leadsPorCampana && Object.keys(state.indicadores.leadsPorCampana).length > 0) {
        poblarFiltrosIndicadores();
        configurarTabsIndicadores();
        renderIndicadores();
        renderIndCalendarioFiltro();
        return;
    }
    
    await cargarLeadsIndicadores();
    poblarFiltrosIndicadores();
    configurarTabsIndicadores();
    renderIndicadores();
    renderIndCalendarioFiltro();
}
window.inicializarIndicadores = inicializarIndicadores;

async function cargarLeadsCampanaIndicadores(campana, forceRefresh = false) {
    const user = getCurrentUser();
    if (!user) return null;
    const cacheKey = CACHE_KEYS.LEADS_RAW(user.email, user.rol, campana);
    if (!forceRefresh) {
        const cached = cacheGet(cacheKey);
        if (cached && cached.data) return cached.data;
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
            return data;
        }
    } catch (error) {
    }
    return null;
}

async function cargarLeadsIndicadores(forceRefresh = false) {
    const user = getCurrentUser();
    if (!user) return;
    const todas = getUserCampanas();

    if (todas.length === 0) {
        state.indicadores.leadsPorCampana = {};
        return;
    }

    const base = state.campanasVigentes.length ? state.campanasVigentes : todas;
    const campanasACargar = [...new Set([...base, ...(state.indicadores.filtros.campana || [])])];
    const resultados = await Promise.all(campanasACargar.map(async (campana) => ({
        campana,
        leads: (await cargarLeadsCampanaIndicadores(campana, forceRefresh)) || []
    })));

    state.indicadores.leadsPorCampana = {};
    resultados.forEach(({ campana, leads }) => { state.indicadores.leadsPorCampana[campana] = leads; });

    try {
        const result = await callAPI('getSolicitudesCC', { 
            campanas: getUserCampanas(), 
            incluirResueltas: true 
        });
        state.solicitudesCC = result.success ? (result.data || []) : [];
    } catch (e) {
        state.solicitudesCC = [];
    }
}

function configurarTabsIndicadores() {
    if (state.indicadores.tabsListenerListo) return;
    document.querySelectorAll('#indTabs button[data-indtab]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#indTabs button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.ind-tab-content').forEach(tc => tc.style.display = 'none');
            const target = document.getElementById('indTab-' + btn.dataset.indtab);
            if (target) target.style.display = 'block';
        });
    });
    state.indicadores.tabsListenerListo = true;
}

function todosLosLeadsIndicadores() {
    return Object.values(state.indicadores.leadsPorCampana || {}).flat();
}

function poblarFiltrosIndicadores() {
    if (!state.indicadores.multiListener) {
        state.indicadores.multiListener = true;
        window.addEventListener('multiselect-change', async (e) => {
            const id = e.detail.containerId || '';
            if (!id.startsWith('indFilter')) return;
            const nombre = id.slice('indFilter'.length);
            const k = Object.keys(state.indicadores.filtros).find(k => k.toLowerCase() === nombre.toLowerCase());
            if (!k) return;
            state.indicadores.filtros[k] = e.detail.values;
            if (k === 'campana') await Promise.all(e.detail.values
                .filter(c => !(c in state.indicadores.leadsPorCampana))
                .map(async c => { const d = await cargarLeadsCampanaIndicadores(c); if (d) state.indicadores.leadsPorCampana[c] = d; }));
            poblarFiltrosIndicadores();
            renderIndicadores();
            renderIndCalendarioFiltro();
        });
    }

    const valoresUnicos = (columna, excluirClave) => [...new Set(
        leadsIndicadoresFiltradosExcluyendo(excluirClave)
            .map(l => String(l[columna] || '').trim()).filter(Boolean)
    )].sort();

    createMultiSelect('indFilterPrograma', valoresUnicos(COLUMNAS.PROGRAMA, 'programa'), state.indicadores.filtros.programa, 'Todos');
    createMultiSelect('indFilterIngreso', valoresUnicos(COLUMNAS.MODALIDAD_INGRESO, 'ingreso'), state.indicadores.filtros.ingreso, 'Todos');
    createMultiSelect('indFilterModalidad', valoresUnicos(COLUMNAS.MODALIDAD, 'modalidad'), state.indicadores.filtros.modalidad, 'Todas');

    const leadsParaAsesor = leadsIndicadoresFiltradosExcluyendo('asesor');
    const nombresRawAsesor = [...new Set(leadsParaAsesor.map(l => String(l[COLUMNAS.ASESOR_NOMBRE_RAW] || '').trim()).filter(Boolean))].sort();
    const labelsAsesor = {};
    leadsParaAsesor.forEach(l => {
        const raw = String(l[COLUMNAS.ASESOR_NOMBRE_RAW] || '').trim();
        if (raw && !labelsAsesor[raw]) labelsAsesor[raw] = l[COLUMNAS.ASESOR_ULTIMO_CONTACTO] || raw;
    });
    createMultiSelect('indFilterAsesor', nombresRawAsesor, state.indicadores.filtros.asesor, 'Todos', labelsAsesor);
    createMultiSelect('indFilterCanal', valoresUnicos(COLUMNAS.CANAL, 'canal'), state.indicadores.filtros.canal, 'Todos');
    createMultiSelect('indFilterStatus', valoresUnicos(COLUMNAS.STATUS_GESTION, 'status'), state.indicadores.filtros.status, 'Todos', STATUS_LABELS);
    createMultiSelect('indFilterPerfil', ['Completo', 'Pendiente Supervisor', 'Pendiente Asesor'], state.indicadores.filtros.perfil, 'Todos');

    const desdeLeads = todosLosLeadsIndicadores().map(l => String(l[COLUMNAS.CAMPANA] || '').trim()).filter(Boolean);
    const opcionesCampana = [...new Set([...state.campanasActivas, ...desdeLeads])].sort();

    if (state.indicadores.filtros.campana.length === 0 && opcionesCampana.length > 0) {
        const porDefecto = state.campanasVigentes.filter(c => opcionesCampana.includes(c));
        state.indicadores.filtros.campana = porDefecto.length ? porDefecto : opcionesCampana.slice();
    }
    createMultiSelect('indFilterCampana', opcionesCampana, state.indicadores.filtros.campana, 'Todas', null, { permitirTodos: false });
}

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
        if (excluirClave !== 'status' && f.status.length && !f.status.includes(lead[COLUMNAS.STATUS_GESTION] || '')) return false;
        if (excluirClave !== 'perfil' && f.perfil.length && !f.perfil.includes((lead.PERFILAMIENTO_COMPLETO || {}).estado || '')) return false;
        return true;
    });
}

function leadsIndicadoresFiltrados() {
    return leadsIndicadoresFiltradosExcluyendo(null);
}

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
    if (!panel || !panel.classList.contains('open')) return;

    const grid = document.getElementById('indCalGrid');
    const label = document.getElementById('indCalMesLabel');
    if (!grid || !label) return;

    const mes = state.indicadores.calMes;
    label.textContent = mesAnioCorto(mes);

    const mapa = mapaFechasIndCal();
    const seleccionadas = state.indicadores.filtros.fechaCalendario;

    const primerDia = new Date(mes.getFullYear(), mes.getMonth(), 1);
    const ultimoDia = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);
    const offset = (primerDia.getDay() + 6) % 7;

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
    poblarFiltrosIndicadores();
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

function claveMesInd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function labelMesInd(d) {
    return mesAnioCorto(d);
}
function mesAnioCorto(d) {
    const mes = d.toLocaleDateString('es-PE', { month: 'long' });
    return `${mes.charAt(0).toUpperCase()}${mes.slice(1)} ${d.getFullYear()}`;
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

function fechaStatusActual(lead) {
    return lead[COLUMNAS.FECHA_ULT_MODIFICACION];
}

const COLS_PP_VP_PERFIL = [
    { status: STATUS.PP_VIVA, label: 'PPs Vivas' },
    { status: STATUS.VP_VIVA, label: 'VPs Vivas' },
];

function render0PerfilamientoResumen(leads) {
    const porCampana = {};
    const totalesPorStatusPerfil = {};

    leads.forEach(l => {
        const camp = l[COLUMNAS.CAMPANA] || '-';
        const estado = (l.PERFILAMIENTO_COMPLETO || {}).estado || 'Pendiente Asesor';
        const statusGestion = l[COLUMNAS.STATUS_GESTION] || '-';

        porCampana[camp] = porCampana[camp] || { total: 0, porEstado: {} };
        porCampana[camp].total++;

        porCampana[camp].porEstado[estado] = porCampana[camp].porEstado[estado] || { n: 0, leads: [], porStatus: {} };
        const grupo = porCampana[camp].porEstado[estado];
        grupo.n++;
        grupo.leads.push(l);
        grupo.porStatus[statusGestion] = (grupo.porStatus[statusGestion] || 0) + 1;

        totalesPorStatusPerfil[statusGestion] = (totalesPorStatusPerfil[statusGestion] || 0) + 1;
    });

    const columnasVisiblesPerfil = COLS_PP_VP_PERFIL.filter(c => (totalesPorStatusPerfil[c.status] || 0) > 0);

    function celdasPPVP(porStatus, totalCamp) {
        return columnasVisiblesPerfil.map(c => {
            const n = porStatus[c.status] || 0;
            return `<td>${n}</td><td>${pctInd(n, totalCamp)}</td>`;
        }).join('');
    }

    const orden = ['Completo', 'Pendiente Supervisor', 'Pendiente Asesor'];

    let filas = '';
    Object.keys(porCampana).sort().forEach(camp => {
        const info = porCampana[camp];
        const filasDeEstaCamp = [];
        const totalPorStatusCamp = {};

        orden.filter(e => info.porEstado[e]).forEach(estado => {
            const grupo = info.porEstado[estado];
            const clave = `${camp}|${estado}`;
            state.indicadores.perfilPopupData[clave] = { estado, leads: grupo.leads, campana: camp };
            
            Object.keys(grupo.porStatus).forEach(st => {
                totalPorStatusCamp[st] = (totalPorStatusCamp[st] || 0) + grupo.porStatus[st];
            });

            filasDeEstaCamp.push(`
                <tr class="ind-row" onclick="window.abrirPopupPerfilamiento('${escapeHtml(clave)}')">{{CAMP_TD}}
                    <td>${escapeHtml(estado)}</td>
                    ${celdasPPVP(grupo.porStatus, info.total)}
                    <td>${grupo.n}</td>
                    <td>${pctInd(grupo.n, info.total)}</td>
                </tr>`);
        });

        filasDeEstaCamp.push(`
            <tr class="ind-row-subtotal">{{CAMP_TD}}
                <td>Total</td>
                ${celdasPPVP(totalPorStatusCamp, info.total)}
                <td>${info.total}</td><td>100%</td>
            </tr>`);
        filas += emitirFilasConCampana(filasDeEstaCamp, camp);
    });

    const totalColumnas = 4 + columnasVisiblesPerfil.length * 2;
    if (!filas) filas = `<tr><td colspan="${totalColumnas}" style="text-align:center;color:#888;">Sin datos</td></tr>`;

    const headerPPVP = columnasVisiblesPerfil.map(c => `<th>${escapeHtml(c.label)}</th><th>%</th>`).join('');

    return `
        <div class="card ind-card">
            <h3>Resumen de Perfilamiento</h3>
            <table class="ind-table">
                <thead><tr><th>Campaña</th><th>Estado</th>${headerPPVP}<th># Leads</th><th>%</th></tr></thead>
                <tbody>${filas}</tbody>
            </table>
        </div>`;
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
        if (!fPrim || !fStatus) return;
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

const STATUS_PAGOS = [STATUS.PAGO_COMPLETO, STATUS.PAGO_FRACCIONADO];

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
    const totalesPorStatus = {};
    (state.solicitudesCC || []).forEach(sol => {
        const clave = `${sol.ID_PROMETEO}|${sol.CAMPANA}`;
        if (!idsPermitidos.has(clave)) return;
        const leadCruzado = mapaLeads[clave];
        const camp = sol.CAMPANA || '-';
        const statusActual = leadCruzado ? (leadCruzado[COLUMNAS.STATUS_GESTION] || '-') : '-';
        porCampana[camp] = porCampana[camp] || [];
        porCampana[camp].push({ ...sol, _fechaEnvio: sol.FECHA_SOLICITUD, _statusActual: statusActual });
        totalesPorStatus[statusActual] = (totalesPorStatus[statusActual] || 0) + 1;
    });

    const columnasVisibles = STATUS_CC_COLS.filter(c => (totalesPorStatus[c.status] || 0) > 0);

    const set = state.indicadores.expandido['indCC'] = state.indicadores.expandido['indCC'] || new Set();

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
    const totalColumnas = 2 + columnasVisibles.length * 2 + 2;
    if (!filas) filas = `<tr><td colspan="${totalColumnas}" style="text-align:center;color:#888;">Sin datos</td></tr>`;

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

const PREGUNTAS_PERFIL_IND = [
    { columna: COLUMNAS.DOLOR_NECESIDAD, label: 'Dolor / Necesidad' },
    { columna: COLUMNAS.POR_QUE_ELIGIO_CARRERA, label: '¿Por qué eligió la carrera?' },
    { columna: COLUMNAS.QUE_BUSCA_UNIVERSIDAD, label: '¿Qué busca en una universidad?' },
    { columna: COLUMNAS.QUIEN_FINANCIARA, label: '¿Quién financiará la carrera?' },
    { columna: COLUMNAS.QUE_LE_FALTA, label: '¿Qué le falta para tomar una decisión?' },
];

const VALOR_OTRAS_OPCIONES_INSTITUCION_IND = 'Evaluando otras instituciones';
const TOP_N_INSTITUCIONES = 5;

function renderTablaOtrasOpciones(leads) {
    return renderTablaPerfilInd({ columna: COLUMNAS.OTRAS_OPCIONES, label: '¿Cuáles son sus otras opciones?' }, leads);
}

function datosInstitutoVsUniversidad(leads) {
    const relevantes = leads.filter(l => limpiarEspacios(l[COLUMNAS.OTRAS_OPCIONES]) === VALOR_OTRAS_OPCIONES_INSTITUCION_IND);

    const grupos = { instituto: {}, universidad: {} };
    let totalInstituto = 0, totalUniversidad = 0;
    let sinNombreInstituto = 0, sinNombreUniversidad = 0;

    relevantes.forEach(l => {
        const tipoCrudo = claveCategoriaLocal(l[COLUMNAS.OPCION_INSTITUCION]);
        const nombre = l[COLUMNAS.OPCION_NOMBRE_INSTITUCION];
        if (tipoCrudo.startsWith('instituto')) {
            totalInstituto++;
            if (nombre) sumarCategoria(grupos.instituto, nombre);
            else sinNombreInstituto++;
        } else if (tipoCrudo.startsWith('universidad')) {
            totalUniversidad++;
            if (nombre) sumarCategoria(grupos.universidad, nombre);
            else sinNombreUniversidad++;
        }
    });

    const topN = (mapa) => Object.values(mapa).sort((a, b) => b.total - a.total).slice(0, TOP_N_INSTITUCIONES);

    return {
        totalInstituto, totalUniversidad,
        topInstituto: topN(grupos.instituto),
        topUniversidad: topN(grupos.universidad),
        sinNombreInstituto, sinNombreUniversidad,
    };
}

function claveCategoriaLocal(s) { return limpiarEspacios(s).toLowerCase(); }

function filasInstitutoVsUniversidad(topInstituto, topUniversidad, totalInstituto, totalUniversidad, sinNombreInstituto, sinNombreUniversidad) {
    const instFilas = [...topInstituto];
    if (sinNombreInstituto > 0) instFilas.push({ label: 'No seleccionó', total: sinNombreInstituto });

    const uniFilas = [...topUniversidad];
    if (sinNombreUniversidad > 0) uniFilas.push({ label: 'No seleccionó', total: sinNombreUniversidad });

    const n = Math.max(instFilas.length, uniFilas.length);
    let filas = '';
    for (let i = 0; i < n; i++) {
        const inst = instFilas[i];
        const uni = uniFilas[i];
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

    const { totalInstituto, totalUniversidad, topInstituto, topUniversidad, sinNombreInstituto, sinNombreUniversidad } = datosInstitutoVsUniversidad(leads);

    const contenidoInstUni = (totalInstituto === 0 && totalUniversidad === 0)
        ? `<p style="color:#888;">Sin datos con los filtros actuales</p>`
        : `
            <table class="ind-table ind-table-instituto-universidad">
                <thead><tr><th>Instituto</th><th>#</th><th>Universidad</th><th>#</th></tr></thead>
                <tbody>${filasInstitutoVsUniversidad(topInstituto, topUniversidad, totalInstituto, totalUniversidad, sinNombreInstituto, sinNombreUniversidad)}</tbody>
            </table>`;

    return `
        <div class="card ind-card ind-otras-opciones-card">
            <div class="ind-otras-opciones-grid">
                <div>${tabla}</div>
                <div>
                    ${contenidoInstUni}
                </div>
            </div>
        </div>`;
}

function renderTablaPerfilInd(pregunta, leads) {
    const porCampana = {};
    leads.forEach(l => {
        const valorCrudo = limpiarEspacios(l[pregunta.columna]);
        if (!valorCrudo) return;
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
    if (!filas) return '';

    return `
        <div class="card ind-card">
            <h3>${escapeHtml(pregunta.label)}</h3>
            <table class="ind-table">
                <thead><tr><th>Campaña</th><th>Respuesta</th><th># Leads</th><th>%</th></tr></thead>
                <tbody>${filas}</tbody>
            </table>
        </div>`;
}

function render3Perfilamiento(leads) {
    const tablas = PREGUNTAS_PERFIL_IND.map(p => renderTablaPerfilInd(p, leads)).filter(Boolean);
    const otrasOpciones = render7OtrasOpciones(leads);
    if (tablas.length === 0 && !otrasOpciones) return '';
    return `<div class="ind-perfil-grid">${tablas.join('')}${otrasOpciones}</div>`;
}

function renderIndicadores() {
    const contStatus = document.getElementById('indTab-status');
    const contVentas = document.getElementById('indTab-ventas');
    const contPerfil = document.getElementById('indTab-perfil');
    if (!contStatus || !contVentas || !contPerfil) return;

    const leads = leadsIndicadoresFiltrados();
    const leadsSinFiltroStatus = leadsIndicadoresFiltradosExcluyendo('status');
    const tablasPerfil = render3Perfilamiento(leads);

    contStatus.innerHTML = `
        <div class="ind-row-cards">
            ${render1_1StatusGestion(leadsSinFiltroStatus)}
            ${render1_2DiasConversion(leads)}
        </div>`;

    contVentas.innerHTML = `
        ${render2CondicionesComerciales(leadsSinFiltroStatus)}
        ${render2Ventas(leadsSinFiltroStatus)}
    `;

    contPerfil.innerHTML = `
        ${render0PerfilamientoResumen(leads)}
        ${tablasPerfil || '<p style="color:#888;">Sin respuestas de perfilamiento con los filtros actuales.</p>'}
    `;
}
window.renderIndicadores = renderIndicadores;

function mostrarUltimaActualizacion() {
    const el = document.getElementById('lastUpdate');
    if (!el || !state.ultimaActualizacion) return;
    const fecha = new Date(state.ultimaActualizacion);
    el.textContent = `Última actualización: ${fecha.toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
    el.style.opacity = '1';
    setTimeout(() => el.style.opacity = '0', 4000);
}

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