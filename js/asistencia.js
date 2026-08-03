// ================================================================
// ASISTENCIA - Módulo de control de asistencia
// ================================================================

import {
    API_URL, COLUMNAS, CACHE_KEYS, ROLES, esRolSupervisorOAdmision
} from '../core/constants.js';

import {
    getCurrentUser, getUserCampanas, getSessionToken,
    cacheGet, cacheSet,
    escapeHtml, normalizarTexto, parseNumero,
    horaAMinutos, minutosAHora, diffHoras, horasLabel,
    parsearFechaFlexible, fechaAClaveISO, fechaDDMMYYYY, hoyDDMMYYYY,
    nowPeru, formato12h, normalizarUrlFoto
} from '../core/utils.js';

import { Sidebar, Toast, Modal, startClock } from '../core/components.js';

// ===== ESTADO =====
const state = {
    user: null,
    todayRecord: null,
    empleadosCache: [],
    location: { lat: '', lng: '', direccion: 'Sin ubicación' },
    marcaPendiente: null,
    todosLosRegistros: null,
    registrosCalendario: {},
    calAnio: 0,
    calMes: 0,
    tabActual: 'marcacion',
    ultimaMarcacion: 0,
    minSegundosEntreMarcaciones: 5,
    vistaCalendario: 'mes',
    config: {
        horaEntrada: localStorage.getItem('asis_entrada') || '09:00',
        horasJornada: parseFloat(localStorage.getItem('asis_jornada')) || 9,
        tolerancia: parseInt(localStorage.getItem('asis_tolerancia')) || 15,
        minHorasTrabajo: parseFloat(localStorage.getItem('asis_min_horas')) || 3,
        minMinutosAlmuerzo: parseInt(localStorage.getItem('asis_min_almuerzo')) || 20
    },
    configColaboradores: {},
    categoriasCalendario: {
        viva: { label: 'PP Viva', color: '#0040A1', status: 'VALORES_PROMESA_DE_PAGO_VIVA', campoFecha: 'FECHA COMPROMISO DE PAGO' },
        muerta: { label: 'PP Muerta', color: '#5e35b1', status: 'VALORES_PROMESA_DE_PAGO_MUERTA', campoFecha: 'FECHA COMPROMISO DE PAGO' },
        pagoCompleto: { label: 'Pago Completo', color: '#2e7d32', status: 'PAGO COMPLETO', campoFecha: 'FECHA DE PAGO COMPLETO' },
        pagoFraccionado: { label: 'Pago Fraccionado', color: '#f9a825', status: 'PAGO FRACCIONADO', campoFecha: 'FECHA DE PROMESA DE PAGO' }
    },
    categoriasVisibles: { viva: true, muerta: false, pagoCompleto: false, pagoFraccionado: false }
};

const SEDE = { lat: -12.085641188440665, lng: -76.90846848513861, radio: 100 };

// ===== INICIALIZACIÓN =====
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    initAsistencia(urlParams.get('tab') || 'marcacion');
});

window.initAsistenciaEmbebido = function(tab) {
    initAsistencia(tab || 'marcacion');
};

window.asisIrATab = function(tab) {
    initAsistencia(tab || 'marcacion');
};

async function initAsistencia(tab) {
    const user = getCurrentUser();
    if (!user) {
        window.location.href = 'index.html';
        return;
    }

    state.user = user;

    // Inyectar Sidebar y Header
    if (!document.querySelector('.sidebar-nav')) {
        new Sidebar({ active: 'asistencia' });
    }

    // Cargar configuración de colaboradores
    cargarConfigColaboradores();

    const esAdmin = esRolSupervisorOAdmision(user.rol);

    // KPIs/Análisis/Mantenimiento son exclusivos de SUPERVISOR/ADMISION;
    // Marcación es exclusiva de ASESOR. Calendario es de ambos — cada rol
    // ve una versión distinta (el ASESOR ve su propio historial/faltas, el
    // SUPERVISOR/ADMISION ve el resumen del equipo; la diferenciación ya
    // vive dentro de initPanelCalendario/renderCalendarioAsis*).
    const tabsSoloAdmin = ['kpis', 'analisis', 'mantenimiento'];
    const tabsAsesor = ['marcacion', 'calendario'];
    let tabFinal = tab || (esAdmin ? 'calendario' : 'marcacion');
    if (esAdmin && tabFinal === 'marcacion') tabFinal = 'calendario';
    if (!esAdmin && tabsSoloAdmin.includes(tabFinal)) tabFinal = 'marcacion';
    if (!tabsAsesor.includes(tabFinal) && !tabsSoloAdmin.includes(tabFinal)) tabFinal = esAdmin ? 'calendario' : 'marcacion';
    state.tabActual = tabFinal;

    switch (tabFinal) {
        case 'calendario': await initPanelCalendario(); break;
        case 'kpis': await initPanelKpis(); break;
        case 'analisis': await initPanelAnalisis(); break;
        case 'mantenimiento': await initPanelMantenimiento(); break;
        default: await initPanelMarcacion(); break;
    }
}

async function initPanelCalendario() {
    const app = document.getElementById('asisApp');
    app.innerHTML = `
            <div class="asis-tab-panel active" id="tabPanel-calendario">
                <div class="cal-page-card">
                    <div class="cal-page-header">
                        <strong><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">calendar_today</span> Calendario</strong>
                        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                            <div class="cal-view-toggle" id="calViewToggleAsis">
                                <button type="button" data-vista="mes" class="activo" id="calVistaMesBtn">Mes</button>
                                <button type="button" data-vista="ano" id="calVistaAnoBtn">Año</button>
                            </div>
                            <button class="btn-export" id="btnExportarCalendarioAsis"><span class="material-symbols-outlined" style="font-size:16px;">download</span> Exportar</button>
                        </div>
                    </div>
                    <div class="cal-page-content" id="calAsisContent">
                        <div class="cal-page-body" id="calendarioGrid">
                            <div class="loading">Cargando…</div>
                        </div>
                        <div class="cal-page-leyenda" id="calAsisLeyenda"></div>
                    </div>
                </div>
            </div>
        `;
    document.getElementById('calVistaMesBtn').addEventListener('click', () => cambiarVistaCalendarioAsis('mes'));
    document.getElementById('calVistaAnoBtn').addEventListener('click', () => cambiarVistaCalendarioAsis('ano'));
    document.getElementById('btnExportarCalendarioAsis').addEventListener('click', () => exportarCalendarioAsisActual());
    await cargarRegistrosCalendario();
}

async function initPanelMarcacion() {
    const app = document.getElementById('asisApp');
    app.innerHTML = `
            <div class="asis-tab-panel active" id="tabPanel-marcacion">
                <div class="asis-dashboard">
                    <div class="asis-left">
                        <div class="card asis-clock-card">
                            <div class="asis-header-live">
                                <span class="asis-conectado-pill">
                                    <span class="dot"></span> Conectado
                                </span>
                            </div>
                            <div class="asis-date-label" id="dateLabel"></div>
                            <div class="asis-time" id="timeLive">--:--:--</div>
                            <div class="asis-tz-pill">UTC-5 · Lima</div>
                        </div>
                        <div class="mark-grid">
                            <button class="mark-btn mb-entrada" id="btnEntrada" disabled>
                                <div class="mark-icon-circle green"><span class="material-symbols-outlined">login</span></div>
                                <div class="mark-title">Entrada</div>
                                <div class="mark-sub">Inicio de jornada</div>
                                <div class="mark-time green" id="tEntrada">Sin marcar</div>
                            </button>
                            <button class="mark-btn mb-almuerzo" id="btnAlmuerzo" disabled>
                                <div class="mark-icon-circle orange"><span class="material-symbols-outlined">lunch_dining</span></div>
                                <div class="mark-title">Inicio Almuerzo</div>
                                <div class="mark-sub">Salida a almorzar</div>
                                <div class="mark-time yellow" id="tAlmuerzo">Sin marcar</div>
                            </button>
                            <button class="mark-btn mb-regreso" id="btnRegreso" disabled>
                                <div class="mark-icon-circle blue"><span class="material-symbols-outlined">restaurant</span></div>
                                <div class="mark-title">Fin Almuerzo</div>
                                <div class="mark-sub">Regreso al trabajo</div>
                                <div class="mark-time blue" id="tRegreso">Sin marcar</div>
                            </button>
                            <button class="mark-btn mb-salida" id="btnSalida" disabled>
                                <div class="mark-icon-circle red"><span class="material-symbols-outlined">logout</span></div>
                                <div class="mark-title">Salida</div>
                                <div class="mark-sub">Fin de jornada</div>
                                <div class="mark-time red" id="tSalida">Sin marcar</div>
                            </button>
                        </div>
                    </div>
                    <div class="asis-right">
                        <div class="card summary-card">
                            <h3>Resumen del día</h3>
                            <div class="summary-content">
                                <div class="summary-box">
                                    <div class="summary-top">
                                        <span class="material-symbols-outlined summary-icon">schedule</span>
                                        <div class="summary-value" id="sHorasTrab">--</div>
                                        <div class="summary-label">Horas trabajadas</div>
                                    </div>
                                </div>
                                <div class="summary-box">
                                    <div class="summary-top">
                                        <span class="material-symbols-outlined summary-icon">timer</span>
                                        <div class="summary-value" id="sHorasAlm">--</div>
                                        <div class="summary-label">Tiempo almuerzo</div>
                                    </div>
                                </div>
                                <div class="summary-box">
                                    <div class="summary-top">
                                        <span class="material-symbols-outlined summary-icon">apartment</span>
                                        <div class="summary-value" id="sEstado">En oficina</div>
                                        <div class="summary-label">Estado</div>
                                    </div>
                                </div>
                                <div class="asis-loc-row" id="locRow">
                                    <span class="material-symbols-outlined summary-icon-location">location_on</span>
                                    <span id="locText">Obteniendo ubicación...</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Configurar eventos
        document.getElementById('btnEntrada').addEventListener('click', () => marcar('entrada'));
        document.getElementById('btnAlmuerzo').addEventListener('click', () => marcar('almuerzo'));
        document.getElementById('btnRegreso').addEventListener('click', () => marcar('regreso'));
        document.getElementById('btnSalida').addEventListener('click', () => marcar('salida'));
        document.getElementById('locRow').addEventListener('click', getLocation);

        // Modal
        document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
        document.getElementById('modalConfirmBtn').addEventListener('click', confirmarMarca);

        // Iniciar
        startClock('timeLive', () => {
            toggleLunchButtonsByDay();
            loadTodayRecord();
        });
        getLocation();
        toggleLunchButtonsByDay();
        await loadTodayRecord();
}

async function initPanelKpis() {
    const app = document.getElementById('asisApp');
    app.innerHTML = `
        <div class="asis-tab-panel active" id="tabPanel-kpis">
            <div class="stat-row">
                <div class="stat-card sc-green"><div class="stat-num" id="stPresentes">—</div><div class="stat-lbl">Presentes</div></div>
                <div class="stat-card sc-warn"><div class="stat-num" id="stAlmuerzo">—</div><div class="stat-lbl">En almuerzo</div></div>
                <div class="stat-card sc-purple"><div class="stat-num" id="stCompletos">—</div><div class="stat-lbl">Jornada completa</div></div>
                <div class="stat-card sc-red"><div class="stat-num" id="stAusentes">—</div><div class="stat-lbl">Sin registrar</div></div>
            </div>
            <div class="filter-row">
                <label class="cfg-label" style="margin:0;align-self:center;">Fecha</label>
                <input type="date" id="fFechaKpis">
                <select id="fEmp"><option value="">Todos los colaboradores</option></select>
                <select id="fCampana"><option value="">Todas las campañas</option></select>
                <button class="btn-refresh" id="btnActualizarKpis">↺ Actualizar</button>
                <button class="btn-export" id="btnExportarKpis" style="margin-left:auto;"><span class="material-symbols-outlined" style="font-size:16px;">download</span> Exportar</button>
            </div>
            <div class="table-wrap">
                <table>
                    <thead><tr>
                        <th onclick="ordenarTablaKpis(0)">Colaborador</th>
                        <th onclick="ordenarTablaKpis(1)">Campaña</th>
                        <th onclick="ordenarTablaKpis(2)">Entrada</th>
                        <th onclick="ordenarTablaKpis(3)">In. Almuerzo</th>
                        <th onclick="ordenarTablaKpis(4)">Fin Almuerzo</th>
                        <th onclick="ordenarTablaKpis(5)">Salida</th>
                        <th>T. Trabajo</th><th>T. Almuerzo</th><th>Tipo</th><th>Estado</th>
                    </tr></thead>
                    <tbody id="bodyKpis"></tbody>
                </table>
            </div>
        </div>
    `;

    const hoyPeru = nowPeru();
    const fFecha = document.getElementById('fFechaKpis');
    fFecha.value = `${hoyPeru.getFullYear()}-${String(hoyPeru.getMonth() + 1).padStart(2, '0')}-${String(hoyPeru.getDate()).padStart(2, '0')}`;

    fFecha.addEventListener('change', () => cargarKpis());
    document.getElementById('fEmp').addEventListener('change', () => cargarKpis());
    document.getElementById('fCampana').addEventListener('change', () => { filtrarEmpleadosKpis(); cargarKpis(); });
    document.getElementById('btnActualizarKpis').addEventListener('click', () => cargarKpis(true));
    document.getElementById('btnExportarKpis').addEventListener('click', () => exportarKpisExcel());

    if (await ensureEmpleadosCache()) {
        poblarSelectEmpleados('fEmp', 'fCampana', 'Todos los colaboradores');
    }
    await cargarKpis();
}

async function initPanelAnalisis() {
    const app = document.getElementById('asisApp');
    app.innerHTML = `
        <div class="asis-tab-panel active" id="tabPanel-analisis">
            <div class="filter-row">
                <input type="date" id="fechaDesde">
                <span style="color:#888;font-size:13px;">hasta</span>
                <input type="date" id="fechaHasta">
                <select id="fEmpAnalisis"><option value="">Todos los empleados</option></select>
                <select id="fCampanaAnalisis"><option value="">Todas las campañas</option></select>
                <button class="btn-refresh" id="btnActualizarAnalisis">↺ Actualizar</button>
            </div>
            <div class="stat-row" id="analStatsHoy"></div>
            <div class="stat-row" id="analStats"></div>
            <div class="chart-grid">
                <div class="card"><h3><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">bar_chart</span> Promedio horas trabajadas</h3><canvas id="chartHoras" height="230"></canvas></div>
                <div class="card"><h3><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">track_changes</span> Puntualidad (% entrada a tiempo)</h3><canvas id="chartPuntual" height="230"></canvas></div>
                <div class="card"><h3><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">restaurant</span> Tiempo promedio de almuerzo</h3><canvas id="chartAlmuerzo" height="230"></canvas></div>
                <div class="card"><h3><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">emoji_events</span> Ranking de puntualidad</h3><div id="rankingPuntualidad" style="max-height:380px;overflow-y:auto;"></div></div>
            </div>
        </div>
    `;

    const hoyPeru = nowPeru();
    document.getElementById('fechaDesde').value = `${hoyPeru.getFullYear()}-${String(hoyPeru.getMonth() + 1).padStart(2, '0')}-01`;
    document.getElementById('fechaHasta').value = `${hoyPeru.getFullYear()}-${String(hoyPeru.getMonth() + 1).padStart(2, '0')}-${String(hoyPeru.getDate()).padStart(2, '0')}`;

    document.getElementById('fechaDesde').addEventListener('change', () => cargarAnalisis());
    document.getElementById('fechaHasta').addEventListener('change', () => cargarAnalisis());
    document.getElementById('fEmpAnalisis').addEventListener('change', () => cargarAnalisis());
    document.getElementById('fCampanaAnalisis').addEventListener('change', () => { filtrarEmpleadosAnalisis(); cargarAnalisis(); });
    document.getElementById('btnActualizarAnalisis').addEventListener('click', () => cargarAnalisis(true));

    if (await ensureEmpleadosCache()) {
        poblarSelectEmpleados('fEmpAnalisis', 'fCampanaAnalisis', 'Todos los empleados');
    }
    try {
        await ensureChartJs();
    } catch (e) {
        showToast(e.message, 'err');
        return;
    }
    await cargarAnalisis();
}

async function initPanelMantenimiento() {
    const app = document.getElementById('asisApp');
    app.innerHTML = `
        <div class="asis-tab-panel active" id="tabPanel-mantenimiento">
            <div class="mant-layout">
                <div class="mant-col-izq">
                    <div class="card">
                        <h3><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">schedule</span> Horario estándar</h3>
                        <p style="font-size:13px;color:#888;margin-bottom:12px;">Usado para calcular tardanzas y puntualidad (horario por defecto si un colaborador no tiene uno personalizado).</p>
                        <label class="cfg-label">Hora de entrada esperada</label>
                        <input class="cfg-input" type="time" id="cfgEntrada">
                        <label class="cfg-label">Minutos de tolerancia</label>
                        <input class="cfg-input" type="number" id="cfgTolerancia" min="0" max="60">
                        <label class="cfg-label">Horas de jornada laboral</label>
                        <input class="cfg-input" type="number" id="cfgJornada" min="1" max="16">
                        <br><button class="btn-save" id="btnGuardarCfg">Guardar</button>
                    </div>
                    <div class="card">
                        <h3><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">schedule</span> Restricciones de marcaje</h3>
                        <p style="font-size:13px;color:#888;margin-bottom:12px;">Mínimos requeridos para poder marcar salida y fin de almuerzo.</p>
                        <label class="cfg-label">Horas mínimas trabajadas (para marcar salida)</label>
                        <input class="cfg-input" type="number" id="cfgMinHoras" min="1" max="12" step="0.5">
                        <label class="cfg-label">Minutos mínimos de almuerzo</label>
                        <input class="cfg-input" type="number" id="cfgMinAlmuerzo" min="1" max="120">
                        <br><button class="btn-save" id="btnGuardarRestricciones">Guardar</button>
                    </div>
                </div>
                <div class="card">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                        <h3 style="margin-bottom:0;"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">group</span> Colaboradores</h3>
                        <button class="btn-save" id="btnGuardarColabs">Guardar</button>
                    </div>
                    <p style="font-size:13px;color:#888;margin-bottom:12px;">Activa/desactiva a cada colaborador y define su horario de entrada por día.</p>
                    <div class="colab-cfg-fila colab-cfg-head">
                        <div>Colaborador</div><div>Activo</div>
                        <div>Lun</div><div>Mar</div><div>Mié</div><div>Jue</div><div>Vie</div><div>Sáb</div>
                    </div>
                    <div class="colab-cfg-scroll" id="colabCfgLista">
                        <div class="loading">Cargando colaboradores...</div>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.getElementById('cfgEntrada').value = state.config.horaEntrada;
    document.getElementById('cfgTolerancia').value = state.config.tolerancia;
    document.getElementById('cfgJornada').value = state.config.horasJornada;
    document.getElementById('cfgMinHoras').value = state.config.minHorasTrabajo;
    document.getElementById('cfgMinAlmuerzo').value = state.config.minMinutosAlmuerzo;

    document.getElementById('btnGuardarCfg').addEventListener('click', guardarCfgHorario);
    document.getElementById('btnGuardarRestricciones').addEventListener('click', guardarRestricciones);
    document.getElementById('btnGuardarColabs').addEventListener('click', guardarConfigColaboradoresUI);

    await renderColabCfgLista();
}

// ===== CONFIGURACIÓN COLABORADORES =====
function cargarConfigColaboradores() {
    try {
        state.configColaboradores = JSON.parse(localStorage.getItem('asis_config_colaboradores') || '{}');
    } catch { state.configColaboradores = {}; }
}

function guardarConfigColaboradores() {
    localStorage.setItem('asis_config_colaboradores', JSON.stringify(state.configColaboradores));
}

function horaEsperada(usuario, fecha) {
    const cfg = state.configColaboradores[usuario];
    const dow = fecha.getDay();
    if (cfg && cfg.horarios && cfg.horarios[dow]) return cfg.horarios[dow];
    return state.config.horaEntrada;
}

function colaboradorActivo(usuario) {
    const cfg = state.configColaboradores[usuario];
    return !cfg || cfg.activo !== false;
}

// ===== MARCACIÓN =====
async function loadTodayRecord() {
    lockAllBtns();
    try {
        const fecha = hoyDDMMYYYY();
        const data = await callAPI('getAsistenciaRegistroHoy', { fecha });
        if (data && data.success) {
            state.todayRecord = data.record || { usuario: state.user.usuario, fecha, nombre: state.user.nombre };
        } else {
            state.todayRecord = { usuario: state.user.usuario, fecha, nombre: state.user.nombre };
        }
        updateMarkUI();
        updateSummary();
    } catch (e) {
        if (!state.todayRecord) {
            state.todayRecord = { usuario: state.user.usuario, fecha: hoyDDMMYYYY(), nombre: state.user.nombre };
        }
        updateMarkUI();
    }
}

function lockAllBtns() {
    ['btnEntrada', 'btnAlmuerzo', 'btnRegreso', 'btnSalida'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = true;
    });
}

function updateMarkUI() {
    const m = state.todayRecord || {};
    const map = {
        entrada: ['btnEntrada', 'tEntrada'],
        almuerzo: ['btnAlmuerzo', 'tAlmuerzo'],
        regreso: ['btnRegreso', 'tRegreso'],
        salida: ['btnSalida', 'tSalida']
    };
    for (const key in map) {
        const [btnId, lblId] = map[key];
        const lbl = document.getElementById(lblId);
        if (lbl) lbl.textContent = m[key] || 'Sin marcar';
        const btn = document.getElementById(btnId);
        if (btn) {
            const marcado = !!(m[key] && String(m[key]).trim() !== '');
            btn.classList.toggle('done', marcado);
            btn.disabled = marcado;
        }
    }
}

function updateSummary() {
    const m = state.todayRecord || {};
    if (!m.entrada) return;
    const now = nowPeru().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const sal = m.salida || now;
    const hTrab = diffHoras(m.entrada, sal);
    const hAlm = (m.almuerzo && m.regreso) ? diffHoras(m.almuerzo, m.regreso) : 0;
    document.getElementById('sHorasTrab').textContent = horasLabel(Math.max(0, hTrab - hAlm));
    document.getElementById('sHorasAlm').textContent = hAlm ? horasLabel(hAlm) : '--';
    const estado = m.salida ? 'Completo' : (m.almuerzo && !m.regreso) ? 'Almuerzo' : 'En oficina';
    document.getElementById('sEstado').textContent = estado;
}

function toggleLunchButtonsByDay() {
    const dia = nowPeru().getDay();
    const esFinDeSemana = (dia === 0 || dia === 6);
    ['btnAlmuerzo', 'btnRegreso'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = esFinDeSemana ? 'none' : '';
    });
}

async function marcar(tipo) {
    const ahora = Date.now();
    if (ahora - state.ultimaMarcacion < state.minSegundosEntreMarcaciones * 1000) {
        showToast(`Espera ${state.minSegundosEntreMarcaciones} segundos entre marcaciones`, 'err');
        return;
    }

    const btn = document.getElementById('btn' + tipo.charAt(0).toUpperCase() + tipo.slice(1));
    if (btn.dataset.processing === '1') return;

    state.ultimaMarcacion = ahora;
    state.marcaPendiente = tipo;
    btn.dataset.processing = '1';

    const configs = {
        entrada: { icon: '<span class="material-symbols-outlined" style="color:#2e7d32;">check_circle</span>', title: 'Confirmar Entrada', sub: '¿Estás seguro de registrar tu hora de entrada?', cls: 'entrada' },
        almuerzo: { icon: '<span class="material-symbols-outlined" style="color:#FB923C;">check_circle</span>', title: 'Confirmar Inicio de Almuerzo', sub: '¿Estás seguro de registrar tu salida a almorzar?', cls: 'almuerzo' },
        regreso: { icon: '<span class="material-symbols-outlined" style="color:#1565c0;">check_circle</span>', title: 'Confirmar Fin de Almuerzo', sub: '¿Estás seguro de registrar tu regreso del almuerzo?', cls: 'regreso' },
        salida: { icon: '<span class="material-symbols-outlined" style="color:#d32f2f;">check_circle</span>', title: 'Confirmar Salida', sub: '¿Estás seguro de registrar tu hora de salida?', cls: 'salida' }
    };

    const c = configs[tipo];
    document.getElementById('modalIcon').innerHTML = c.icon;
    document.getElementById('modalTitle').textContent = c.title;
    document.getElementById('modalSub').textContent = c.sub;
    document.getElementById('modalConfirmBtn').className = 'modal-btn modal-btn-confirm ' + c.cls;
    document.getElementById('confirmModal').classList.add('show');
}

function closeModal() {
    document.getElementById('confirmModal').classList.remove('show');
    if (state.marcaPendiente) {
        const btn = document.getElementById('btn' + state.marcaPendiente.charAt(0).toUpperCase() + state.marcaPendiente.slice(1));
        if (btn) { btn.dataset.processing = '0'; btn.disabled = false; }
        state.marcaPendiente = null;
    }
}

async function confirmarMarca() {
    const tipo = state.marcaPendiente;
    document.getElementById('confirmModal').classList.remove('show');
    if (tipo) await ejecutarMarcacion(tipo);
}

async function ejecutarMarcacion(tipo) {
    const ahora = nowPeru();
    const esFinDeSemana = (ahora.getDay() === 0 || ahora.getDay() === 6);
    const btn = document.getElementById('btn' + tipo.charAt(0).toUpperCase() + tipo.slice(1));

    const liberar = () => {
        btn.classList.remove('done');
        btn.disabled = false;
        btn.dataset.processing = '0';
        state.marcaPendiente = null;
    };

    if ((tipo === 'almuerzo' || tipo === 'regreso') && esFinDeSemana) {
        showToast('Los fines de semana no se registra almuerzo', 'err');
        liberar();
        return;
    }

    btn.dataset.processing = '1';
    btn.disabled = true;

    try {
        // Validar ubicación para entrada
        if (tipo === 'entrada' && !state.location.lat) {
            getLocation();
            await new Promise(resolve => {
                const check = () => state.location.lat ? resolve() : setTimeout(check, 250);
                check();
                setTimeout(resolve, 3000);
            });
        }

        const m = state.todayRecord || {};
        if (m[tipo] && String(m[tipo]).trim() !== '') {
            showToast(`${tipo} ya fue registrado hoy`, 'err');
            liberar();
            return;
        }

        if (tipo === 'almuerzo' && !(m.entrada && String(m.entrada).trim())) {
            showToast('Primero marca Entrada', 'err');
            liberar();
            return;
        }

        const fecha = hoyDDMMYYYY();
        const hora = ahora.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

        if (tipo === 'regreso') {
            if (!m.almuerzo) {
                showToast('No puedes marcar el Fin de Almuerzo sin haber marcado el Inicio de Almuerzo.', 'err');
                liberar();
                return;
            }
            const minAlm = diffHoras(m.almuerzo, hora) * 60;
            if (minAlm < state.config.minMinutosAlmuerzo) {
                showToast(`El mínimo entre inicio y fin de almuerzo es de ${state.config.minMinutosAlmuerzo} minutos. Llevas solo ${Math.round(minAlm)} minutos.`, 'err');
                liberar();
                return;
            }
        }

        if (tipo === 'salida') {
            const hTrab = m.entrada ? diffHoras(m.entrada, hora) : 0;
            if (hTrab < state.config.minHorasTrabajo && hTrab > 0) {
                showToast(`El mínimo entre la entrada y la salida es de ${state.config.minHorasTrabajo} horas. Llevas ${horasLabel(hTrab)}`, 'err');
                liberar();
                return;
            }
        }

        if (!state.todayRecord) {
            state.todayRecord = { usuario: state.user.usuario, fecha, nombre: state.user.nombre };
        }

        const hTrab = m.salida && m.entrada ? diffHoras(m.entrada, m.salida) : 0;
        const hAlm = m.almuerzo && m.regreso ? diffHoras(m.almuerzo, m.regreso) : 0;
        const estado = m.salida ? 'Completo' : tipo === 'almuerzo' ? 'En almuerzo' : m.entrada ? 'En oficina' : 'Sin registro';

        const result = await callAPI('marcarAsistencia', {
            fecha,
            campaña: state.user.campaña || '',
            cargo: state.user.cargo || '',
            dni: state.user.dni || '',
            campo: tipo,
            valor: hora,
            lat: tipo === 'entrada' ? state.location.lat : '',
            lng: tipo === 'entrada' ? state.location.lng : '',
            direccion: tipo === 'entrada' ? state.location.direccion : '',
            horasTrab: (Math.max(0, hTrab - hAlm)).toFixed(2),
            horasAlm: hAlm.toFixed(2),
            estado,
            ip: tipo === 'entrada' ? await getIP() : '0.0.0.0',
            tipo: tipo === 'entrada' ? (state.location.lat ? 'Sede' : 'Remoto') : 'Remoto'
        });

        if (!result || !result.success) {
            showToast(result?.error || 'Error al guardar', 'err');
            liberar();
            return;
        }

        state.todayRecord[tipo] = hora;
        if (tipo === 'entrada') {
            state.todayRecord.lat = state.location.lat;
            state.todayRecord.lng = state.location.lng;
            state.todayRecord.direccion = state.location.direccion;
        }
        updateMarkUI();
        updateSummary();
        showToast(`${tipo} registrado correctamente`, 'ok');
    } catch (e) {
        showToast('Error inesperado - Recarga la página', 'err');
        liberar();
    } finally {
        btn.dataset.processing = '0';
        state.marcaPendiente = null;
    }
}

// ===== GEOLOCALIZACIÓN =====
function getLocation() {
    if (!navigator.geolocation) {
        state.location = { lat: '', lng: '', direccion: 'NO_AUTORIZADO' };
        setLoc('Geolocalización no disponible');
        return;
    }

    setLoc('Obteniendo ubicación...');
    navigator.geolocation.getCurrentPosition(
        async pos => {
            state.location.lat = String(parseFloat(pos.coords.latitude).toFixed(6));
            state.location.lng = String(parseFloat(pos.coords.longitude).toFixed(6));
            state.location.direccion = `${state.location.lat}, ${state.location.lng}`;
            setLoc(`${state.location.direccion} (obteniendo dirección...)`);

            try {
                const controller = new AbortController();
                const t = setTimeout(() => controller.abort(), 3000);
                const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${state.location.lat}&lon=${state.location.lng}&format=json&accept-language=es`, { signal: controller.signal });
                clearTimeout(t);
                const j = await r.json();
                const addr = [j.address?.road, j.address?.city_district || j.address?.suburb, j.address?.city || j.address?.town].filter(Boolean).join(', ');
                state.location.direccion = addr || `${state.location.lat}, ${state.location.lng}`;
                setLoc(state.location.direccion);
            } catch (e) {
                setLoc(`${state.location.lat}, ${state.location.lng} (dirección no disponible)`);
            }
        },
        error => {
            state.location = { lat: '', lng: '', direccion: 'NO_AUTORIZADO' };
            const msgs = { 1: 'Permiso denegado — click para reintentar', 2: 'Posición no disponible — click para reintentar', 3: 'Tiempo de espera agotado — click para reintentar' };
            setLoc('Error de ubicación: ' + (msgs[error.code] || error.message));
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

function setLoc(text) {
    const el = document.getElementById('locText');
    if (el) el.textContent = text;
}

// ===== CALENDARIO =====
async function cargarRegistrosCalendario() {
    const n = nowPeru();
    state.calAnio = n.getFullYear();
    state.calMes = n.getMonth();

    const esAdmin = esRolSupervisorOAdmision(state.user.rol);
    const grid = document.getElementById('calendarioGrid');
    grid.innerHTML = '<div class="loading">Cargando registros...</div>';

    try {
        const data = await callAPI('getAsistenciaRegistros', esAdmin ? {} : { empleado: state.user.usuario });
        if (!data || !data.success) throw new Error(data?.error || 'Error al cargar registros');

        state.todosLosRegistros = {};
        (data.data || []).forEach(r => {
            const f = normalizarFecha(r.fecha);
            if (!state.todosLosRegistros[f]) state.todosLosRegistros[f] = [];
            state.todosLosRegistros[f].push(r);
        });
        state.registrosCalendario = state.todosLosRegistros;
        renderCalendarioAsis();
    } catch (e) {
        console.error('cargarRegistrosCalendario:', e);
        grid.innerHTML = `<div class="loading" style="color:#d32f2f;">Error: ${escapeHtml(e.message)}</div>`;
    }
}

function normalizarFecha(f) {
    if (!f) return '';
    const p = String(f).trim().split('/');
    return p.length === 3 ? p[0].padStart(2, '0') + '/' + p[1].padStart(2, '0') + '/' + p[2] : String(f).trim();
}

// Color del día según puntualidad: verde = OK, naranja = tardanzas, rojo = mal.
// Admin ve el promedio del equipo ese día; asesor ve su propio estado.
function colorEstadoDia(pct) {
    return pct >= 90 ? '#2e7d32' : pct >= 70 ? '#FB923C' : '#d32f2f';
}

function cambiarVistaCalendarioAsis(vista) {
    state.vistaCalendario = vista;
    const contenido = document.getElementById('calAsisContent');
    if (contenido) contenido.classList.toggle('vista-anio', vista === 'ano');
    document.querySelectorAll('#calViewToggleAsis button').forEach(btn => {
        btn.classList.toggle('activo', btn.dataset.vista === vista);
    });
    renderCalendarioAsis();
}

function renderCalendarioAsis() {
    if (state.vistaCalendario === 'ano') {
        renderCalendarioAsisAnio();
    } else {
        renderCalendarioAsisMes();
    }
    renderLeyendaAsis();
}

function renderCalendarioAsisMes() {
    const cont = document.getElementById('calendarioGrid');
    const esAdmin = esRolSupervisorOAdmision(state.user.rol);
    const hoy = nowPeru();

    const primerDiaSemana = new Date(state.calAnio, state.calMes, 1).getDay();
    const diasEnMes = new Date(state.calAnio, state.calMes + 1, 0).getDate();
    const nombreMes = new Date(state.calAnio, state.calMes, 1).toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });
    const offsetInicio = (primerDiaSemana === 0 ? 6 : primerDiaSemana - 1);

    let totalMes = 0;
    let celdas = '';
    for (let i = 0; i < offsetInicio; i++) celdas += `<div class="cal-celda vacia"></div>`;

    for (let dia = 1; dia <= diasEnMes; dia++) {
        const fechaDia = new Date(state.calAnio, state.calMes, dia);
        const fechaStr = `${String(dia).padStart(2, '0')}/${String(state.calMes + 1).padStart(2, '0')}/${state.calAnio}`;
        const registros = (state.registrosCalendario[fechaStr] || []).filter(r => r.entrada && colaboradorActivo(r.usuario));
        const esHoy = fechaDia.getDate() === hoy.getDate() && fechaDia.getMonth() === hoy.getMonth() && fechaDia.getFullYear() === hoy.getFullYear();
        const tieneRegistro = registros.length > 0;
        const esFaltaAsesor = !esAdmin && !tieneRegistro && fechaDia.getDay() !== 0 && fechaDia <= hoy;
        if (tieneRegistro) totalMes += esAdmin ? registros.length : 1;

        let estiloFondo = '';
        if (tieneRegistro) {
            if (esAdmin) {
                const r = resumenDiaAdmin(registros, fechaDia);
                const pct = r.total ? Math.round((r.puntuales / r.total) * 100) : 100;
                estiloFondo = `background:${colorEstadoDia(pct)};`;
            } else {
                const estado = estadoDiaAsesor(registros[0], fechaDia, true);
                estiloFondo = `background:${estado === 'tardanza' ? '#FB923C' : '#2e7d32'};`;
            }
        }

        celdas += `
            <div class="cal-celda ${tieneRegistro ? 'con-datos' : ''} ${esFaltaAsesor ? 'cal-falta' : ''} ${esHoy ? 'hoy' : ''}"
                 style="${estiloFondo}"
                 ${tieneRegistro ? `onclick="verDetalleDia(${dia}, ${state.calMes}, ${state.calAnio})"` : ''}
                 title="${esAdmin && tieneRegistro ? registros.length + ' marcación(es)' : esFaltaAsesor ? 'Faltó' : ''}">
                <span class="cal-numero">${dia}</span>
                ${esAdmin && tieneRegistro ? `<span class="cal-badge">${registros.length}</span>` : ''}
            </div>`;
    }

    cont.innerHTML = `
        <div class="cal-header">
            <button class="cal-nav" onclick="cambiarMesAsis(-1)">‹</button>
            <div class="cal-titulo">
                <strong style="text-transform:capitalize;">${nombreMes}</strong>
                <span class="cal-total">${totalMes} ${esAdmin ? 'marcación' + (totalMes === 1 ? '' : 'es') : 'día' + (totalMes === 1 ? '' : 's') + ' registrado' + (totalMes === 1 ? '' : 's')}</span>
            </div>
            <button class="cal-nav" onclick="cambiarMesAsis(1)">›</button>
        </div>
        <div class="cal-dias-semana"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
        <div class="cal-grid">${celdas}</div>
    `;
}

function cambiarMesAsis(delta) {
    const f = new Date(state.calAnio, state.calMes + delta, 1);
    state.calAnio = f.getFullYear();
    state.calMes = f.getMonth();
    renderCalendarioAsis();
}

function renderCalendarioAsisAnio() {
    const cont = document.getElementById('calendarioGrid');
    const esAdmin = esRolSupervisorOAdmision(state.user.rol);
    const hoy = nowPeru();
    const year = state.calAnio;

    let totalAnio = 0;
    let mesesHtml = '';
    for (let m = 0; m < 12; m++) {
        const nombreMes = new Date(year, m, 1).toLocaleDateString('es-PE', { month: 'long' });
        const primerDiaSemana = new Date(year, m, 1).getDay();
        const diasEnMes = new Date(year, m + 1, 0).getDate();
        const offsetInicio = (primerDiaSemana === 0 ? 6 : primerDiaSemana - 1);

        let totalMes = 0;
        let celdas = '';
        for (let i = 0; i < offsetInicio; i++) celdas += `<div class="cal-mini-celda vacia"></div>`;

        for (let dia = 1; dia <= diasEnMes; dia++) {
            const fechaDia = new Date(year, m, dia);
            const fechaStr = `${String(dia).padStart(2, '0')}/${String(m + 1).padStart(2, '0')}/${year}`;
            const registros = (state.registrosCalendario[fechaStr] || []).filter(r => r.entrada && colaboradorActivo(r.usuario));
            const esHoy = fechaDia.getDate() === hoy.getDate() && fechaDia.getMonth() === hoy.getMonth() && fechaDia.getFullYear() === hoy.getFullYear();
            const tieneRegistro = registros.length > 0;
            const esFaltaAsesor = !esAdmin && !tieneRegistro && fechaDia.getDay() !== 0 && fechaDia <= hoy;
            if (tieneRegistro) { totalMes += esAdmin ? registros.length : 1; totalAnio += esAdmin ? registros.length : 1; }

            let estiloFondo = '';
            if (tieneRegistro) {
                if (esAdmin) {
                    const r = resumenDiaAdmin(registros, fechaDia);
                    const pct = r.total ? Math.round((r.puntuales / r.total) * 100) : 100;
                    estiloFondo = `background:${colorEstadoDia(pct)};`;
                } else {
                    const estado = estadoDiaAsesor(registros[0], fechaDia, true);
                    estiloFondo = `background:${estado === 'tardanza' ? '#FB923C' : '#2e7d32'};`;
                }
            }

            celdas += `
                <div class="cal-mini-celda ${tieneRegistro ? 'con-datos' : ''} ${esFaltaAsesor ? 'cal-falta' : ''} ${esHoy ? 'hoy' : ''}"
                     style="${estiloFondo}"
                     ${tieneRegistro ? `onclick="verDetalleDia(${dia}, ${m}, ${year})"` : ''}>${dia}</div>`;
        }

        mesesHtml += `
            <div class="cal-mini-mes">
                <div class="cal-mini-header" onclick="irAMesAsis(${year}, ${m})" title="Ver ${nombreMes} en detalle" style="text-transform:capitalize;">${nombreMes}</div>
                <div class="cal-mini-dias-semana"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
                <div class="cal-mini-grid">${celdas}</div>
                <div class="cal-mini-total">${totalMes > 0 ? totalMes + (esAdmin ? ' marc.' : ' día(s)') : '—'}</div>
            </div>`;
    }

    cont.innerHTML = `
        <div class="cal-header">
            <button class="cal-nav" onclick="cambiarAnioAsis(-1)">‹</button>
            <div class="cal-titulo">
                <strong>${year}</strong>
                <span class="cal-total">${totalAnio} ${esAdmin ? 'marcación' + (totalAnio === 1 ? '' : 'es') : 'día' + (totalAnio === 1 ? '' : 's') + ' registrado' + (totalAnio === 1 ? '' : 's')}</span>
            </div>
            <button class="cal-nav" onclick="cambiarAnioAsis(1)">›</button>
        </div>
        <div class="cal-anio-grid">${mesesHtml}</div>
    `;
}

function cambiarAnioAsis(delta) {
    state.calAnio += delta;
    renderCalendarioAsis();
}

function irAMesAsis(year, month) {
    state.calAnio = year;
    state.calMes = month;
    cambiarVistaCalendarioAsis('mes');
}

// Panel lateral: leyenda de colores para admin, resumen mensual para asesor
// (mismo espacio visual que la leyenda del Calendario de PPs, contenido distinto).
function renderLeyendaAsis() {
    const cont = document.getElementById('calAsisLeyenda');
    if (!cont) return;
    const esAdmin = esRolSupervisorOAdmision(state.user.rol);

    if (esAdmin) {
        cont.classList.remove('cal-page-leyenda-wide');
        cont.innerHTML = `
            <div class="cal-leyenda-items">
                <div class="cal-leyenda-item estatico"><span class="cal-leyenda-badge" style="background:#2e7d32;color:white;">≥90%<span class="cal-leyenda-badge-linea">Puntual</span></span></div>
                <div class="cal-leyenda-item estatico"><span class="cal-leyenda-badge" style="background:#FB923C;color:white;">70-89%<span class="cal-leyenda-badge-linea">Puntual</span></span></div>
                <div class="cal-leyenda-item estatico"><span class="cal-leyenda-badge" style="background:#d32f2f;color:white;">&lt;70%<span class="cal-leyenda-badge-linea">Puntual</span></span></div>
            </div>`;
        return;
    }

    if (state.vistaCalendario === 'ano') {
        cont.classList.remove('cal-page-leyenda-wide');
        cont.innerHTML = `
            <div class="cal-leyenda-items">
                <div class="cal-leyenda-item estatico"><span class="cal-leyenda-badge" style="background:#2e7d32;color:white;">Asistió</span></div>
                <div class="cal-leyenda-item estatico"><span class="cal-leyenda-badge" style="background:#FB923C;color:white;">Tardanza</span></div>
                <div class="cal-leyenda-item estatico"><span class="cal-leyenda-badge cal-falta" style="color:#c0392b;">Faltó</span></div>
            </div>`;
        return;
    }

    cont.classList.add('cal-page-leyenda-wide');
    renderResumenMensualAsesor(cont);
}

function renderResumenMensualAsesor(cont) {
    const ultimoDia = new Date(state.calAnio, state.calMes + 1, 0).getDate();
    const hoy = nowPeru();
    let asistidos = 0, tardanzas = 0, faltas = 0, sumaEntradaMin = 0, conEntrada = 0, sumaAlmMin = 0, conAlm = 0;

    for (let dia = 1; dia <= ultimoDia; dia++) {
        const fecha = new Date(state.calAnio, state.calMes, dia);
        const esHoyOAnterior = fecha <= hoy;
        const fechaStr = `${String(dia).padStart(2, '0')}/${String(state.calMes + 1).padStart(2, '0')}/${state.calAnio}`;
        const registros = (state.registrosCalendario[fechaStr] || []).filter(r => r.entrada);
        const r = registros[0] || null;
        const estado = estadoDiaAsesor(r, fecha, esHoyOAnterior);
        if (estado === 'asistio') asistidos++;
        else if (estado === 'tardanza') { asistidos++; tardanzas++; }
        else if (estado === 'falta') faltas++;

        if (r && r.entrada) {
            const [ah, am] = String(r.entrada).trim().split(':').map(Number);
            if (!isNaN(ah) && !isNaN(am)) { sumaEntradaMin += ah * 60 + am; conEntrada++; }
        }
        if (r && r.horasAlm && parseFloat(r.horasAlm) > 0) { sumaAlmMin += parseFloat(r.horasAlm) * 60; conAlm++; }
        else if (r && r.almuerzo && r.regreso) { const h = diffHoras(r.almuerzo, r.regreso); if (h > 0) { sumaAlmMin += h * 60; conAlm++; } }
    }

    const promEntrada = conEntrada ? minutosAHora(Math.round(sumaEntradaMin / conEntrada)) : '—';
    const promAlmuerzo = conAlm ? minutosAHora(Math.round(sumaAlmMin / conAlm)) : '—';

    cont.innerHTML = `
        <div class="resumen-mensual-panel" style="background:transparent;padding:0;">
            <h4>Resumen del mes</h4>
            <div class="rm-item"><span class="material-symbols-outlined rm-icon">calendar_month</span><div><div class="rm-num">${asistidos}</div><div class="rm-lbl">Días asistidos</div></div></div>
            <div class="rm-item"><span class="material-symbols-outlined rm-icon" style="color:#FB923C;">restaurant</span><div><div class="rm-num">${tardanzas}</div><div class="rm-lbl">Tardanzas</div></div></div>
            <div class="rm-item"><span class="material-symbols-outlined rm-icon" style="color:#d32f2f;">warning</span><div><div class="rm-num">${faltas}</div><div class="rm-lbl">Faltas</div></div></div>
            <div class="rm-item"><span class="material-symbols-outlined rm-icon">schedule</span><div><div class="rm-num">${formato12h(promEntrada)}</div><div class="rm-lbl">Prom. entrada</div></div></div>
            <div class="rm-item"><span class="material-symbols-outlined rm-icon">restaurant</span><div><div class="rm-num">${formato12h(promAlmuerzo)}</div><div class="rm-lbl">Prom. almuerzo</div></div></div>
        </div>`;
}

window.cambiarVistaCalendarioAsis = cambiarVistaCalendarioAsis;
window.cambiarMesAsis = cambiarMesAsis;
window.cambiarAnioAsis = cambiarAnioAsis;
window.irAMesAsis = irAMesAsis;

function tiempoAlmuerzoMin(registro) {
    let horas = null;
    if (registro.horasAlm && parseFloat(registro.horasAlm) > 0) horas = parseFloat(registro.horasAlm);
    else if (registro.almuerzo && registro.regreso) horas = diffHoras(registro.almuerzo, registro.regreso);
    if (!horas || horas <= 0) return '—';
    return `${Math.round(horas * 60)} min`;
}

function verDetalleDia(dia, mes, anio) {
    const fechaStr = `${String(dia).padStart(2, '0')}/${String(mes + 1).padStart(2, '0')}/${anio}`;
    state.diaAsisSeleccionado = { dia, mes, anio, fechaStr };
    const registros = (state.registrosCalendario[fechaStr] || []).filter(r => r.entrada && colaboradorActivo(r.usuario));
    const nombreDia = new Date(anio, mes, dia).toLocaleDateString('es-ES', { weekday: 'long' });
    const tituloFecha = `${nombreDia.charAt(0).toUpperCase() + nombreDia.slice(1)} ${dia}/${mes + 1}/${anio}`;
    const esAdmin = esRolSupervisorOAdmision(state.user.rol);

    let filas, encabezados;
    if (esAdmin) {
        encabezados = '<th>Nombre</th><th>Entrada</th><th>Inicio Almuerzo</th><th>Fin de Almuerzo</th><th>Tiempo Almuerzo</th><th>Salida</th>';
        filas = registros.map(r => `
            <tr>
                <td>${escapeHtml(r.nombre || '—')}</td>
                <td>${escapeHtml(r.entrada || '—')}</td>
                <td>${escapeHtml(r.almuerzo || '—')}</td>
                <td>${escapeHtml(r.regreso || '—')}</td>
                <td>${tiempoAlmuerzoMin(r)}</td>
                <td>${escapeHtml(r.salida || '—')}</td>
            </tr>`).join('');
    } else {
        encabezados = '<th>Entrada</th><th>Inicio Almuerzo</th><th>Fin de Almuerzo</th><th>Tiempo Almuerzo</th><th>Salida</th>';
        filas = registros.map(r => `
            <tr>
                <td>${escapeHtml(r.entrada || '—')}</td>
                <td>${escapeHtml(r.almuerzo || '—')}</td>
                <td>${escapeHtml(r.regreso || '—')}</td>
                <td>${tiempoAlmuerzoMin(r)}</td>
                <td>${escapeHtml(r.salida || '—')}</td>
            </tr>`).join('');
    }
    const colspan = esAdmin ? 6 : 5;

    // Modal inyectado directamente al <body> (no a un elemento estático de
    // asistencia.html): cuando este módulo corre embebido dentro del
    // Dashboard, sidebar.js solo copia #toast/#confirmModal/#asisApp — cualquier
    // otro elemento del HTML original se descarta y nunca llegaría al DOM real.
    // Misma estructura .cal-modal-* que el popup del Calendario de PPs.
    const modalHtml = `
        <div class="cal-modal-overlay cal-modal-overlay-top" id="calDetalleModal">
            <div class="cal-modal" onclick="event.stopPropagation()">
                <div class="cal-modal-header">
                    <strong><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">calendar_today</span> ${escapeHtml(tituloFecha)}</strong>
                    <button class="cal-modal-close" id="calDetalleCloseBtn"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">close</span></button>
                </div>
                <div class="cal-modal-toolbar">
                    <span>${registros.length} registro${registros.length === 1 ? '' : 's'}</span>
                    <button class="btn-export" id="calDetalleExportBtn"><span class="material-symbols-outlined" style="font-size:16px;">download</span> Exportar</button>
                </div>
                <div class="cal-modal-body">
                    <table>
                        <thead><tr>${encabezados}</tr></thead>
                        <tbody>${filas || `<tr><td colspan="${colspan}" style="text-align:center;color:#888;padding:20px;">Sin registros ese día</td></tr>`}</tbody>
                    </table>
                </div>
            </div>
        </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const overlay = document.getElementById('calDetalleModal');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrarDetalleDia(); });
    document.getElementById('calDetalleCloseBtn').addEventListener('click', cerrarDetalleDia);
    document.getElementById('calDetalleExportBtn').addEventListener('click', exportarDiaAsisExcel);
}

function cerrarDetalleDia() {
    document.getElementById('calDetalleModal')?.remove();
    state.diaAsisSeleccionado = null;
}

window.verDetalleDia = verDetalleDia;
window.cerrarDetalleDia = cerrarDetalleDia;

// ===== EXPORTAR CALENDARIO DE ASISTENCIA (mismo patrón que Calendario de PPs) =====
function filasExportAsis(registros, esAdmin, incluirFecha) {
    return registros.map(({ registro, fecha }) => {
        const fila = {};
        if (incluirFecha) fila['Fecha'] = fecha;
        if (esAdmin) fila['Colaborador'] = registro.nombre || '';
        fila['Entrada'] = registro.entrada || '';
        fila['Inicio Almuerzo'] = registro.almuerzo || '';
        fila['Fin Almuerzo'] = registro.regreso || '';
        fila['Tiempo Almuerzo'] = tiempoAlmuerzoMin(registro);
        fila['Salida'] = registro.salida || '';
        return fila;
    });
}

function descargarExcelAsis(filas, nombreArchivo) {
    const ws = XLSX.utils.json_to_sheet(filas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Asistencia');
    XLSX.writeFile(wb, nombreArchivo);
}

async function exportarDiaAsisExcel() {
    if (!state.diaAsisSeleccionado) return;
    const esAdmin = esRolSupervisorOAdmision(state.user.rol);
    const registros = (state.registrosCalendario[state.diaAsisSeleccionado.fechaStr] || []).filter(r => r.entrada && colaboradorActivo(r.usuario));
    if (!registros.length) { showToast('No hay datos para exportar', 'err'); return; }
    try { await ensureXLSX(); } catch (e) { showToast(e.message, 'err'); return; }
    const filas = filasExportAsis(registros.map(registro => ({ registro })), esAdmin, false);
    descargarExcelAsis(filas, `Asistencia_${state.diaAsisSeleccionado.fechaStr.replace(/\//g, '-')}.xlsx`);
    showToast('Exportado a Excel', 'ok');
}

function recolectarRegistrosAsisPorPrefijo(mesNum, anio) {
    let items = [];
    Object.keys(state.registrosCalendario).forEach(fechaStr => {
        const [d, m, y] = fechaStr.split('/');
        if (Number(y) !== anio) return;
        if (mesNum !== null && Number(m) - 1 !== mesNum) return;
        (state.registrosCalendario[fechaStr] || []).filter(r => r.entrada && colaboradorActivo(r.usuario)).forEach(registro => {
            items.push({ registro, fecha: fechaStr });
        });
    });
    items.sort((a, b) => {
        const [da, ma, ya] = a.fecha.split('/'), [db, mb, yb] = b.fecha.split('/');
        return `${ya}${ma}${da}`.localeCompare(`${yb}${mb}${db}`);
    });
    return items;
}

async function exportarMesAsisExcel() {
    const esAdmin = esRolSupervisorOAdmision(state.user.rol);
    const items = recolectarRegistrosAsisPorPrefijo(state.calMes, state.calAnio);
    if (!items.length) { showToast('No hay datos para exportar en este mes', 'err'); return; }
    try { await ensureXLSX(); } catch (e) { showToast(e.message, 'err'); return; }
    const filas = filasExportAsis(items, esAdmin, true);
    const nombreMes = new Date(state.calAnio, state.calMes, 1).toLocaleDateString('es-PE', { month: 'long', year: 'numeric' }).replace(/\s+/g, '_');
    descargarExcelAsis(filas, `Asistencia_${nombreMes}.xlsx`);
    showToast('Exportado a Excel', 'ok');
}

async function exportarAnioAsisExcel() {
    const esAdmin = esRolSupervisorOAdmision(state.user.rol);
    const items = recolectarRegistrosAsisPorPrefijo(null, state.calAnio);
    if (!items.length) { showToast('No hay datos para exportar en este año', 'err'); return; }
    try { await ensureXLSX(); } catch (e) { showToast(e.message, 'err'); return; }
    const filas = filasExportAsis(items, esAdmin, true);
    descargarExcelAsis(filas, `Asistencia_${state.calAnio}.xlsx`);
    showToast('Exportado a Excel', 'ok');
}

function exportarCalendarioAsisActual() {
    if (state.vistaCalendario === 'ano') exportarAnioAsisExcel();
    else exportarMesAsisExcel();
}

window.exportarDiaAsisExcel = exportarDiaAsisExcel;
window.exportarCalendarioAsisActual = exportarCalendarioAsisActual;

function resumenDiaAdmin(registros, fecha) {
    const total = registros.length;
    let puntuales = 0, sumaTardanzaMin = 0, conHora = 0;

    registros.forEach(r => {
        const [ah, am] = String(r.entrada || '').trim().split(':').map(Number);
        if (isNaN(ah) || isNaN(am)) return;
        const minutos = ah * 60 + am;
        const [eh, em] = horaEsperada(r.usuario, fecha).split(':').map(Number);
        const esperadaMin = eh * 60 + em;
        conHora++;
        if (minutos <= esperadaMin + state.config.tolerancia) puntuales++;
        sumaTardanzaMin += Math.max(0, minutos - esperadaMin);
    });

    return {
        total,
        puntuales,
        promTardanza: conHora ? Math.round(sumaTardanzaMin / conHora) : 0
    };
}

function estadoDiaAsesor(registro, fecha, esHoyOAnterior) {
    if (registro && registro.entrada) {
        const [ah, am] = String(registro.entrada).trim().split(':').map(Number);
        const [eh, em] = horaEsperada(registro.usuario || state.user.usuario, fecha).split(':').map(Number);
        if (!isNaN(ah) && !isNaN(am)) {
            const limitePuntual = eh * 60 + em + state.config.tolerancia;
            return (ah * 60 + am) <= limitePuntual ? 'asistio' : 'tardanza';
        }
        return 'asistio';
    }
    if (fecha.getDay() !== 0 && esHoyOAnterior) return 'falta';
    return null;
}

// ===== UTILITIES =====
function showToast(msg, type = 'info') {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `toast show ${type}`;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 3200);
}

async function getIP() {
    try {
        const r = await fetch('https://api.ipify.org?format=json');
        return (await r.json()).ip;
    } catch { return '0.0.0.0'; }
}

// ===== EMPLEADOS (cache compartido entre KPIs / Análisis / Mantenimiento) =====
async function ensureEmpleadosCache() {
    if (state.empleadosCache.length) return true;
    try {
        const d = await callAPI('getAsistenciaEmpleados');
        if (!d || !d.success) throw new Error(d && d.error);
        state.empleadosCache = d.data || [];
        return true;
    } catch (e) {
        showToast('No se pudo cargar la lista de colaboradores', 'err');
        return false;
    }
}

function poblarSelectEmpleados(selEmpId, selCampanaId, placeholderEmp) {
    const empleados = state.empleadosCache.filter(u => u.rol !== 'admin');
    const campanas = new Set();
    const selEmp = document.getElementById(selEmpId), selCampana = document.getElementById(selCampanaId);
    let optsEmp = `<option value="">${placeholderEmp}</option>`;
    empleados.forEach(u => { optsEmp += `<option value="${u.usuario}">${escapeHtml(u.nombre)}</option>`; if (u.campaña) campanas.add(u.campaña); });
    selEmp.innerHTML = optsEmp;
    let optsCampana = '<option value="">Todas las campañas</option>';
    campanas.forEach(c => optsCampana += `<option value="${c}">${escapeHtml(c)}</option>`);
    selCampana.innerHTML = optsCampana;
}

function normalizarFechaCorta(f) {
    if (!f) return '';
    const p = String(f).trim().split('/');
    return p.length === 3 ? p[0].padStart(2, '0') + '/' + p[1].padStart(2, '0') + '/' + p[2] : String(f).trim();
}

// ===== KPIs =====
// El backend no filtra por fecha en getAsistenciaRegistros — devuelve todo el
// histórico del filtro empleado/campaña — así que solo se vuelve a pedir
// cuando cambia ese filtro o al forzar con "Actualizar"; cambiar solo la
// fecha filtra en el navegador sobre el mismo set.
let kpisCache = { key: null, data: null };
let ultimosRegistrosHistoricos = [];

async function cargarKpis(forzarRecarga = false) {
    const fFecha = document.getElementById('fFechaKpis').value;
    if (!fFecha) return;
    const [y, m, d] = fFecha.split('-');
    const fechaBuscada = `${d}/${m}/${y}`;
    const fEmp = document.getElementById('fEmp').value;
    const fCampana = document.getElementById('fCampana').value;
    const cacheKey = `${fEmp}|${fCampana}`;
    try {
        let datos;
        if (!forzarRecarga && kpisCache.key === cacheKey && kpisCache.data) {
            datos = kpisCache.data;
        } else {
            const dRes = await callAPI('getAsistenciaRegistros', { empleado: fEmp, campaña: fCampana });
            if (!dRes || !dRes.success) throw new Error((dRes && dRes.error) || 'El backend no devolvió una respuesta válida');
            datos = dRes.data || [];
            kpisCache = { key: cacheKey, data: datos };
        }

        const recsDelDia = (datos || []).filter(r => normalizarFechaCorta(r.fecha) === fechaBuscada);
        const byUser = {};
        recsDelDia.forEach(r => { byUser[r.usuario] = r; });

        const empleados = state.empleadosCache.filter(u => u.rol !== 'admin' && (!fEmp || u.usuario === fEmp) && (!fCampana || u.campaña === fCampana));
        let presentes = 0, enAlm = 0, completos = 0;
        const tbody = document.getElementById('bodyKpis');
        ultimosRegistrosHistoricos = [];
        const filas = [];
        empleados.forEach(u => {
            const r = byUser[u.usuario] || {};
            const tiene = !!(r.entrada && String(r.entrada).trim());
            if (tiene) presentes++;
            if (r.almuerzo && !r.regreso) enAlm++;
            if (r.salida) completos++;
            const estado = !tiene ? 'ausente' : r.salida ? 'completo' : (r.almuerzo && !r.regreso) ? 'almuerzo' : 'oficina';
            const chipCls = estado === 'completo' ? 'chip-ok' : estado === 'ausente' ? 'chip-err' : estado === 'almuerzo' ? 'chip-warn' : 'chip-blue';
            const chipTxt = { completo: 'Completo', ausente: 'Ausente', almuerzo: 'Almuerzo', oficina: 'En oficina' }[estado];
            const foto = normalizarUrlFoto(u.foto) || `https://api.dicebear.com/7.x/initials/svg?seed=${(u.nombre || '?')[0]}&backgroundColor=0040A1`;
            const tipoMarcacion = r.tipo || 'Remoto';
            filas.push(`<tr>
                <td><div style="display:flex;align-items:center;gap:8px;"><img src="${foto}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;"><span>${escapeHtml(u.nombre)}</span></div></td>
                <td style="color:#888;">${escapeHtml(u.campaña)}</td>
                <td>${r.entrada || '—'}</td><td>${r.almuerzo || '—'}</td><td>${r.regreso || '—'}</td><td>${r.salida || '—'}</td>
                <td style="color:#FB923C;">${r.horasTrab ? horasLabel(parseFloat(r.horasTrab)) : '—'}</td>
                <td>${r.horasAlm ? horasLabel(parseFloat(r.horasAlm)) : '—'}</td>
                <td>${tipoMarcacion}</td><td><span class="chip ${chipCls}">${chipTxt}</span></td>
            </tr>`);
            ultimosRegistrosHistoricos.push({ fecha: fechaBuscada, nombre: u.nombre, campaña: u.campaña, ...r, estado: chipTxt });
        });
        tbody.innerHTML = empleados.length ? filas.join('') : '<tr><td colspan="10"><div class="empty-state">Sin colaboradores para este filtro</div></td></tr>';
        document.getElementById('stPresentes').textContent = presentes;
        document.getElementById('stAlmuerzo').textContent = enAlm;
        document.getElementById('stCompletos').textContent = completos;
        document.getElementById('stAusentes').textContent = empleados.length - presentes;
    } catch (e) {
        console.error('cargarKpis:', e);
        showToast('Error al cargar KPIs: ' + (e.message || e), 'err');
    }
}

function filtrarEmpleadosKpis() {
    const sel = document.getElementById('fCampana').value, target = document.getElementById('fEmp');
    let opts = '<option value="">Todos los colaboradores</option>';
    state.empleadosCache.filter(u => u.rol !== 'admin' && (!sel || u.campaña === sel)).forEach(u => opts += `<option value="${u.usuario}">${escapeHtml(u.nombre)}</option>`);
    target.innerHTML = opts;
}

function filtrarEmpleadosAnalisis() {
    const sel = document.getElementById('fCampanaAnalisis').value, target = document.getElementById('fEmpAnalisis');
    let opts = '<option value="">Todos los empleados</option>';
    state.empleadosCache.filter(u => u.rol !== 'admin' && (!sel || u.campaña === sel)).forEach(u => opts += `<option value="${u.usuario}">${escapeHtml(u.nombre)}</option>`);
    target.innerHTML = opts;
}

function ordenarTablaKpis(columna) {
    const tbody = document.getElementById('bodyKpis');
    const filas = Array.from(tbody.querySelectorAll('tr'));
    const tabla = tbody.closest('table');
    const ths = tabla.querySelectorAll('thead th');
    const th = ths[columna];
    if (!th) return;
    const asc = !th.classList.contains('asc');
    ths.forEach(h => h.classList.remove('asc', 'desc'));
    filas.sort((a, b) => {
        const aVal = a.cells[columna]?.textContent.trim() || '', bVal = b.cells[columna]?.textContent.trim() || '';
        return asc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
    filas.forEach(f => tbody.appendChild(f));
    th.classList.add(asc ? 'asc' : 'desc');
}

// XLSX ya se carga siempre desde el <head> (tanto en dashboard.html embebido
// como en asistencia.html standalone), pero se deja este resguardo por si
// alguna vez se accede a este panel desde una página que no lo cargue.
let xlsxCargando = null;
function ensureXLSX() {
    if (typeof XLSX !== 'undefined') return Promise.resolve();
    if (!xlsxCargando) {
        xlsxCargando = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
            script.onload = resolve;
            script.onerror = () => { xlsxCargando = null; reject(new Error('No se pudo cargar XLSX')); };
            document.body.appendChild(script);
        });
    }
    return xlsxCargando;
}

async function exportarKpisExcel() {
    if (!ultimosRegistrosHistoricos.length) { showToast('No hay datos para exportar', 'err'); return; }
    try { await ensureXLSX(); } catch (e) { showToast(e.message, 'err'); return; }
    const filas = ultimosRegistrosHistoricos.map(r => ({
        'Fecha': r.fecha || '',
        'Colaborador': r.nombre || '',
        'Campaña': r.campaña || '',
        'Entrada': r.entrada || '',
        'Inicio Almuerzo': r.almuerzo || '',
        'Fin Almuerzo': r.regreso || '',
        'Salida': r.salida || '',
        'H. Trabajo': r.horasTrab ? horasLabel(parseFloat(r.horasTrab)) : '—',
        'H. Almuerzo': r.horasAlm ? horasLabel(parseFloat(r.horasAlm)) : '—',
        'Ubicación': r.direccion || '—',
        'Tipo': r.tipo || 'Remoto',
        'Estado': r.estado || ''
    }));
    const ws = XLSX.utils.json_to_sheet(filas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Asistencia');
    XLSX.writeFile(wb, 'kpis_asistencia.xlsx');
    showToast('Exportado a Excel', 'ok');
}

// ===== ANÁLISIS =====
// Chart.js no llega gratis cuando este panel corre embebido en el Dashboard
// SPA (dashboard.html no lo carga en el <head>, solo asistencia.html
// standalone lo hace) — se carga on-demand la primera vez que se entra aquí.
let chartJsCargando = null;
function ensureChartJs() {
    if (typeof Chart !== 'undefined') return Promise.resolve();
    if (!chartJsCargando) {
        chartJsCargando = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
            script.onload = resolve;
            script.onerror = () => { chartJsCargando = null; reject(new Error('No se pudo cargar Chart.js')); };
            document.body.appendChild(script);
        });
    }
    return chartJsCargando;
}

let analisisCache = { key: null, data: null };

async function cargarAnalisis(forzarRecarga = false) {
    const desde = document.getElementById('fechaDesde').value, hasta = document.getElementById('fechaHasta').value;
    const empFiltro = document.getElementById('fEmpAnalisis').value, campanaFiltro = document.getElementById('fCampanaAnalisis').value;
    const hoy = fechaDDMMYYYY(nowPeru());
    const cacheKey = `${empFiltro}|${campanaFiltro}`;
    try {
        let datos;
        if (!forzarRecarga && analisisCache.key === cacheKey && analisisCache.data) {
            datos = analisisCache.data;
        } else {
            const d = await callAPI('getAsistenciaRegistros', { empleado: empFiltro, campaña: campanaFiltro });
            if (!d || !d.success) throw new Error(d && d.error);
            datos = d.data || [];
            analisisCache = { key: cacheKey, data: datos };
        }
        let recs = datos;
        if (desde || hasta) {
            const desdeDate = desde ? new Date(desde + 'T00:00:00') : null, hastaDate = hasta ? new Date(hasta + 'T23:59:59') : null;
            recs = recs.filter(r => {
                if (!r.fecha) return false;
                const p = r.fecha.split('/'); if (p.length !== 3) return false;
                const fr = new Date(`${p[2]}-${p[1]}-${p[0]}T00:00:00`);
                if (isNaN(fr.getTime())) return false;
                if (desdeDate && fr < desdeDate) return false;
                if (hastaDate && fr > hastaDate) return false;
                return true;
            });
        }
        const recsHoy = recs.filter(r => normalizarFechaCorta(r.fecha) === hoy);
        const stats = {};
        state.empleadosCache.filter(u => u.rol !== 'admin').forEach(u => { stats[u.usuario] = { nombre: u.nombre.split(' ').slice(0, 2).join(' '), totalH: 0, totalAlm: 0, dias: 0, diasConAlmuerzo: 0, puntual: 0, foto: normalizarUrlFoto(u.foto) }; });
        recs.forEach(r => {
            const s = stats[r.usuario]; if (!s) return;
            const tieneEntrada = r.entrada && String(r.entrada).trim() !== '';
            const hTrab = parseFloat(r.horasTrab) || 0, hAlm = parseFloat(r.horasAlm) || 0;
            if (tieneEntrada) { s.dias++; s.totalH += hTrab; }
            if (hAlm > 0) { s.totalAlm += hAlm; s.diasConAlmuerzo++; }
            if (tieneEntrada) {
                const [ah, am] = String(r.entrada).trim().split(':').map(Number);
                const [eh, em] = state.config.horaEntrada.split(':').map(Number);
                if (!isNaN(ah) && !isNaN(am) && ah * 60 + am <= eh * 60 + em + state.config.tolerancia) s.puntual++;
            }
        });

        const entradasHoy = recsHoy.filter(r => r.entrada).map(r => String(r.entrada).trim());
        let entradaPromedioMin = 0;
        if (entradasHoy.length) entradaPromedioMin = Math.round(entradasHoy.reduce((sum, e) => { const [h, m] = e.split(':').map(Number); return sum + h * 60 + m; }, 0) / entradasHoy.length);
        const entradaPromH = String(Math.floor(entradaPromedioMin / 60)).padStart(2, '0'), entradaPromM = String(entradaPromedioMin % 60).padStart(2, '0');

        const almuerzosHoy = recsHoy.filter(r => r.horasAlm && parseFloat(r.horasAlm) > 0).map(r => parseFloat(r.horasAlm));
        let almuerzoLabel = '--';
        if (almuerzosHoy.length) {
            const mins = Math.round((almuerzosHoy.reduce((a, b) => a + b, 0) / almuerzosHoy.length) * 60);
            almuerzoLabel = mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ' ' + (mins % 60) + 'min' : ''}` : `${mins} min`;
        }

        const presentesHoy = recsHoy.filter(r => r.entrada).length;
        const [eh, em] = state.config.horaEntrada.split(':').map(Number);
        const limitePuntual = eh * 60 + em + state.config.tolerancia;
        const limiteH = String(Math.floor(limitePuntual / 60)).padStart(2, '0'), limiteM = String(limitePuntual % 60).padStart(2, '0');
        const puntualesHoy = recsHoy.filter(r => { if (!r.entrada) return false; const [ah, am] = String(r.entrada).trim().split(':').map(Number); return !isNaN(ah) && ah * 60 + am <= limitePuntual; }).length;
        const pctPuntuales = presentesHoy ? Math.round(puntualesHoy / presentesHoy * 100) : 0;

        document.getElementById('analStatsHoy').innerHTML = `
            <div class="stat-card sc-green"><div class="stat-num">${presentesHoy}</div><div class="stat-lbl"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">check_circle</span> Presentes hoy</div></div>
            <div class="stat-card sc-blue"><div class="stat-num">${entradasHoy.length ? entradaPromH + ':' + entradaPromM : '--'}</div><div class="stat-lbl"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">schedule</span> Hora entrada promedio (hoy)</div></div>
            <div class="stat-card sc-warn"><div class="stat-num">${almuerzosHoy.length ? almuerzoLabel : '--'}</div><div class="stat-lbl"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">restaurant</span> Almuerzo promedio (hoy)</div></div>
            <div class="stat-card sc-purple"><div class="stat-num">${puntualesHoy} <span style="font-size:14px;">(${pctPuntuales}%)</span></div><div class="stat-lbl"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">schedule</span> Puntuales hoy (≤ ${limiteH}:${limiteM})</div></div>`;

        const sorted = Object.values(stats).filter(e => e.dias > 0).sort((a, b) => b.totalH - a.totalH);
        const totDias = sorted.reduce((a, b) => a + b.dias, 0), totH = sorted.reduce((a, b) => a + b.totalH, 0);
        let totalPuntual = 0, totalDiasGlobal = 0;
        sorted.forEach(e => { totalPuntual += e.puntual; totalDiasGlobal += e.dias; });
        const pGlobal = totalDiasGlobal ? (totalPuntual / totalDiasGlobal) * 100 : 0;

        document.getElementById('analStats').innerHTML = `
            <div class="stat-card sc-green"><div class="stat-num">${sorted.length ? horasLabel(totH / sorted.length) : '--'}</div><div class="stat-lbl"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">bar_chart</span> Promedio horas/día</div></div>
            <div class="stat-card sc-blue"><div class="stat-num">${Math.round(pGlobal)}%</div><div class="stat-lbl"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">track_changes</span> Puntualidad global</div></div>
            <div class="stat-card sc-purple"><div class="stat-num">${sorted.length}</div><div class="stat-lbl"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">group</span> Empleados activos</div></div>
            <div class="stat-card sc-warn"><div class="stat-num">${totDias}</div><div class="stat-lbl"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">calendar_today</span> Días registrados</div></div>`;

        ['chartHoras', 'chartPuntual', 'chartAlmuerzo'].forEach(id => { const c = Chart.getChart(id); if (c) c.destroy(); });
        const labels = sorted.map(e => e.nombre);
        const colores = ['#0040A1', '#FB923C', '#2e7d32', '#1565c0', '#6a1b9a', '#d32f2f'];

        new Chart(document.getElementById('chartHoras'), {
            type: 'bar',
            data: { labels, datasets: [{ label: 'Horas promedio', data: sorted.map(e => e.dias ? +(e.totalH / e.dias).toFixed(2) : 0), backgroundColor: labels.map((_, i) => colores[i % colores.length] + 'CC'), borderRadius: 6 }] },
            options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 10, ticks: { callback: v => horasLabel(v) } } } }
        });
        new Chart(document.getElementById('chartPuntual'), {
            type: 'bar',
            data: { labels, datasets: [{ label: '% Puntualidad', data: sorted.map(e => e.dias ? Math.min(100, Math.round(e.puntual / e.dias * 100)) : 0), backgroundColor: sorted.map(e => { const p = e.dias ? e.puntual / e.dias * 100 : 0; return p >= 90 ? '#2e7d32CC' : p >= 70 ? '#FB923CCC' : '#d32f2fCC'; }), borderRadius: 6 }] },
            options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } } } }
        });
        const almData = sorted.filter(e => e.diasConAlmuerzo > 0).map(e => Math.round((e.totalAlm / e.diasConAlmuerzo) * 60));
        const almLabels = sorted.filter(e => e.diasConAlmuerzo > 0).map(e => e.nombre);
        if (almData.length) {
            new Chart(document.getElementById('chartAlmuerzo'), {
                type: 'bar',
                data: { labels: almLabels, datasets: [{ label: 'Almuerzo (min)', data: almData, backgroundColor: '#FB923CAA', borderRadius: 6 }] },
                options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: v => v >= 60 ? `${Math.floor(v / 60)}h${v % 60 ? ' ' + (v % 60) + 'm' : ''}` : v + 'm' } } } }
            });
        } else {
            const canvas = document.getElementById('chartAlmuerzo'); const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.font = '12px Segoe UI'; ctx.fillStyle = '#888'; ctx.textAlign = 'center';
            ctx.fillText('Sin datos de almuerzo', canvas.width / 2, canvas.height / 2);
        }

        const ranking = Object.values(stats).filter(e => e.dias > 0)
            .sort((a, b) => ((b.puntual / b.dias) * b.dias + b.dias * 2) - ((a.puntual / a.dias) * a.dias + a.dias * 2)).slice(0, 10);
        let rankingHTML = '';
        ranking.forEach((e, i) => {
            const pct = e.dias ? Math.round(e.puntual / e.dias * 100) : 0;
            const medalla = i === 0 ? '<span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;color:#D4AF37;">military_tech</span>' : i === 1 ? '<span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;color:#A8A8A8;">military_tech</span>' : i === 2 ? '<span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;color:#B5651D;">military_tech</span>' : `${i + 1}º`;
            const color = pct >= 90 ? '#2e7d32' : pct >= 70 ? '#FB923C' : '#d32f2f';
            const iniciales = e.nombre.split(' ').map(w => w[0]).join('').toUpperCase();
            const avatarURL = e.foto || `https://api.dicebear.com/7.x/initials/svg?seed=${iniciales}&backgroundColor=${colores[i % colores.length].replace('#', '')}`;
            rankingHTML += `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #eee;">
                <span style="font-size:18px;width:28px;">${medalla}</span>
                <img src="${avatarURL}" style="width:30px;height:30px;border-radius:50%;object-fit:cover;">
                <div style="flex:1;"><div style="font-weight:600;font-size:13px;">${escapeHtml(e.nombre)}</div><div style="font-size:11px;color:#888;">${e.dias} días registrados</div></div>
                <div style="font-size:16px;font-weight:700;color:${color};">${pct}%</div></div>`;
        });
        document.getElementById('rankingPuntualidad').innerHTML = rankingHTML || '<div class="empty-state">Sin datos para mostrar</div>';
    } catch (e) {
        console.error('cargarAnalisis:', e);
        showToast('Error al cargar análisis', 'err');
    }
}

// ===== MANTENIMIENTO =====
const DIAS_CFG = [{ dow: 1, lbl: 'Lun' }, { dow: 2, lbl: 'Mar' }, { dow: 3, lbl: 'Mié' }, { dow: 4, lbl: 'Jue' }, { dow: 5, lbl: 'Vie' }, { dow: 6, lbl: 'Sáb' }];

async function renderColabCfgLista() {
    const cont = document.getElementById('colabCfgLista');
    const ok = await ensureEmpleadosCache();
    if (!ok) { cont.innerHTML = '<p style="color:#d32f2f;font-size:13px;">No se pudo cargar la lista de colaboradores.</p>'; return; }
    const empleados = state.empleadosCache.filter(u => u.rol !== 'admin');
    if (!empleados.length) { cont.innerHTML = '<p style="color:#888;font-size:13px;">Sin colaboradores registrados.</p>'; return; }
    cont.innerHTML = empleados.map(u => {
        const cfg = state.configColaboradores[u.usuario] || { activo: true, horarios: {} };
        const activo = cfg.activo !== false;
        const inputsDias = DIAS_CFG.map(d => `<input type="time" class="colab-cfg-hora" data-usuario="${escapeHtml(u.usuario)}" data-dow="${d.dow}" value="${cfg.horarios && cfg.horarios[d.dow] ? cfg.horarios[d.dow] : ''}" ${activo ? '' : 'disabled'}>`).join('');
        return `
            <div class="colab-cfg-fila">
                <div class="colab-cfg-nombre" title="${escapeHtml(u.nombre)}">${escapeHtml(u.nombre)}</div>
                <label class="colab-switch">
                    <input type="checkbox" data-usuario-activo="${escapeHtml(u.usuario)}" ${activo ? 'checked' : ''} onchange="toggleColabActivo(this)">
                    <span class="colab-switch-slider"></span>
                </label>
                ${inputsDias}
            </div>`;
    }).join('');
}

function toggleColabActivo(chk) {
    const fila = chk.closest('.colab-cfg-fila');
    fila.querySelectorAll('.colab-cfg-hora').forEach(inp => inp.disabled = !chk.checked);
}

function guardarConfigColaboradoresUI() {
    const cont = document.getElementById('colabCfgLista');
    cont.querySelectorAll('[data-usuario-activo]').forEach(chk => {
        const usuario = chk.getAttribute('data-usuario-activo');
        if (!state.configColaboradores[usuario]) state.configColaboradores[usuario] = { activo: true, horarios: {} };
        state.configColaboradores[usuario].activo = chk.checked;
    });
    cont.querySelectorAll('.colab-cfg-hora').forEach(inp => {
        const usuario = inp.getAttribute('data-usuario');
        const dow = inp.getAttribute('data-dow');
        if (!state.configColaboradores[usuario]) state.configColaboradores[usuario] = { activo: true, horarios: {} };
        if (!state.configColaboradores[usuario].horarios) state.configColaboradores[usuario].horarios = {};
        if (inp.value) state.configColaboradores[usuario].horarios[dow] = inp.value;
        else delete state.configColaboradores[usuario].horarios[dow];
    });
    guardarConfigColaboradores();
    showToast('Configuración de colaboradores guardada', 'ok');
}

function guardarCfgHorario() {
    state.config.horaEntrada = document.getElementById('cfgEntrada').value || '09:00';
    state.config.tolerancia = parseInt(document.getElementById('cfgTolerancia').value) || 10;
    state.config.horasJornada = parseFloat(document.getElementById('cfgJornada').value) || 8;
    localStorage.setItem('asis_entrada', state.config.horaEntrada);
    localStorage.setItem('asis_tolerancia', state.config.tolerancia);
    localStorage.setItem('asis_jornada', state.config.horasJornada);
    showToast('Configuración guardada', 'ok');
}

function guardarRestricciones() {
    state.config.minHorasTrabajo = parseFloat(document.getElementById('cfgMinHoras').value) || 4;
    state.config.minMinutosAlmuerzo = parseInt(document.getElementById('cfgMinAlmuerzo').value) || 20;
    localStorage.setItem('asis_min_horas', state.config.minHorasTrabajo);
    localStorage.setItem('asis_min_almuerzo', state.config.minMinutosAlmuerzo);
    showToast('Restricciones guardadas', 'ok');
}

// Exponer al scope global: se invocan desde onclick="" en HTML generado dinámicamente.
window.ordenarTablaKpis = ordenarTablaKpis;
window.toggleColabActivo = toggleColabActivo;

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