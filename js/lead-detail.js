// ================================================================
// LEAD DETAIL - Módulo de detalle de lead
// ================================================================

import {
    API_URL, COLUMNAS, STATUS, STATUS_LABELS, STATUS_CLASES,
    CACHE_KEYS, SELECT_OPTIONS, PRECIOS_BASE,
    esRolSupervisorOAdmision, TIPOS_INSTITUCION_PROCEDENCIA
} from '../core/constants.js';

import {
    getCurrentUser, getSessionToken,
    cacheGet, cacheSet, cacheRemove,
    escapeHtml, normalizarTexto, parseNumero,
    diffHoras, horasLabel,
    parsearFechaFlexible, fechaAClaveISO,
    hoyDDMMYYYY, nowPeru, getEspecializacionETU
} from '../core/utils.js';

import { Sidebar, Toast, Modal } from '../core/components.js';
import { construirDatosCC } from './cc-template.js';

// ===== ESTADO =====
const state = {
    lead: null,
    campana: '',
    idPrometeo: '',
    historialAsesores: null,
    solicitudPendiente: null,
    solicitudVerificada: false,
    historialSnapshots: [],
    ultimoCalculo: {},
    catalogoBoletas: [],
    catalogoBeneficios: [],
    catalogoInstitucionesProcedencia: [],
    catalogoCarrerasProcedencia: [],
    catalogoDoloresNecesidades: [],
    solicitudCC: null
};

// ===== INICIALIZACIÓN =====
document.addEventListener('DOMContentLoaded', async () => {
    const user = getCurrentUser();
    if (!user) {
        window.location.href = 'index.html';
        return;
    }

    new Sidebar({ active: 'bottomline' });

    const params = new URLSearchParams(window.location.search);
    state.idPrometeo = params.get('id');
    state.campana = params.get('campana') || '26.2';

    if (!state.idPrometeo) {
        alert('No se especificó un ID de lead');
        window.location.href = 'dashboard.html?view=bottomline';
        return;
    }

    // Los catálogos (BOLETAS, BENEFICIOS, INSTITUCIONES/CARRERAS_PROCEDENCIA)
    await cargarCatalogos();
    state.catalogoBoletas = cacheGet(CACHE_KEYS.BOLETAS) || [];
    state.catalogoBeneficios = cacheGet(CACHE_KEYS.BENEFICIOS) || [];
    state.catalogoInstitucionesProcedencia = cacheGet(CACHE_KEYS.INSTITUCIONES_PROCEDENCIA) || [];
    state.catalogoCarrerasProcedencia = cacheGet(CACHE_KEYS.CARRERAS_PROCEDENCIA) || [];
    state.catalogoDoloresNecesidades = cacheGet(CACHE_KEYS.DOLORES_NECESIDADES) || [];

    // Configurar tabs
    document.querySelectorAll('.tabs button[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tabId = btn.dataset.tab;
            document.querySelectorAll('.tab-content').forEach(tc => tc.style.display = 'none');
            const target = document.getElementById('tab-' + tabId);
            if (target) target.style.display = 'block';
            if (tabId === 'pagos') cargarPagos();
            if (tabId === 'historial') renderHistorial();
        });
    });

    document.getElementById('solicitudCCModalClose').addEventListener('click', () => {
        document.getElementById('solicitudCCModal').classList.remove('show');
    });
    document.getElementById('solicitudCCModal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) e.currentTarget.classList.remove('show');
    });
    document.getElementById('ccCancelarBtn').addEventListener('click', () => {
        document.getElementById('solicitudCCModal').classList.remove('show');
    });
    document.getElementById('ccSolicitarBtn').addEventListener('click', enviarSolicitudCC);
    inicializarInputArchivoCC('dni', true);
    inicializarInputArchivoCC('certificado', false);
    inicializarInputArchivoCC('boletaProcedencia', false);
    document.getElementById('ccAgregarCorreoBtn').addEventListener('click', () => {
        const input = document.getElementById('ccNuevoCorreoInput');
        const correo = input.value.trim();
        if (!correo) return;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) { alert('Correo inválido'); return; }
        if (ccCorreosAdicionales.includes(correo)) { alert('Ese correo ya fue agregado'); return; }
        ccCorreosAdicionales.push(correo);
        input.value = '';
        renderCorreosCCLista();
    });
    document.getElementById('ccCorreosLista').addEventListener('click', (e) => {
        const el = e.target.closest('[data-quitar-correo]');
        if (!el) return;
        ccCorreosAdicionales.splice(Number(el.dataset.quitarCorreo), 1);
        renderCorreosCCLista();
    });    

    // Modal de snapshot
    document.getElementById('snapshotModalClose').addEventListener('click', () => {
        document.getElementById('snapshotModal').classList.remove('show');
    });
    document.getElementById('snapshotModal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
            document.getElementById('snapshotModal').classList.remove('show');
        }
    });

    await cargarLead();
});

// ===== CATÁLOGOS =====
async function cargarCatalogos() {
    try {
        const result = await callAPI('getCatalogos');
        if (result.success) {
            cacheSet(CACHE_KEYS.BOLETAS, result.data?.boletas || []);
            cacheSet(CACHE_KEYS.BENEFICIOS, result.data?.beneficios || []);
            cacheSet(CACHE_KEYS.INSTITUCIONES_PROCEDENCIA, result.data?.institucionesProcedencia || []);
            cacheSet(CACHE_KEYS.CARRERAS_PROCEDENCIA, result.data?.carrerasProcedencia || []);
            cacheSet(CACHE_KEYS.DOLORES_NECESIDADES, result.data?.doloresNecesidades || []);
        }
    } catch (e) {
        console.error('Error cargando catálogos:', e);
    }
}

// Determina el "caso" de ingreso del lead a partir de su MODALIDAD_INGRESO:
// 1 = Ordinario, 2 = Traslado con Conva, 3 = Traslado sin Conva.
function determinarCasoIngreso(lead) {
    const tipoIngresoLower = String(obtenerCampo(lead, COLUMNAS.MODALIDAD_INGRESO) || '').trim().toLowerCase();
    if (tipoIngresoLower.indexOf('sin conva') !== -1) return 3;
    if (tipoIngresoLower.indexOf('con conva') !== -1) return 2;
    return 1;
}

function esLeadNoOrdinario(lead) {
    return determinarCasoIngreso(lead) !== 1;
}

async function actualizarCatalogoProcedencia() {
    try {
        const result = await callAPI('getCatalogos');
        if (result.success) {
            const instituciones = result.data?.institucionesProcedencia || [];
            const carreras = result.data?.carrerasProcedencia || [];
            cacheSet(CACHE_KEYS.INSTITUCIONES_PROCEDENCIA, instituciones);
            cacheSet(CACHE_KEYS.CARRERAS_PROCEDENCIA, carreras);
            state.catalogoInstitucionesProcedencia = instituciones;
            state.catalogoCarrerasProcedencia = carreras;
        }
    } catch (e) {
        console.error('Error actualizando catálogo de instituciones/carreras de procedencia:', e);
    }
}

// Se llama tras crear un nuevo valor de Dolor/Necesidad, para que el <select>
// lo muestre de inmediato sin esperar a un refresco completo de página.
async function actualizarCatalogoDolor() {
    try {
        const result = await callAPI('getCatalogos');
        if (result.success) {
            const dolores = result.data?.doloresNecesidades || [];
            cacheSet(CACHE_KEYS.DOLORES_NECESIDADES, dolores);
            state.catalogoDoloresNecesidades = dolores;
        }
    } catch (e) {
        console.error('Error actualizando catálogo de Dolor/Necesidad:', e);
    }
}

// ===== LEAD =====
async function cargarLead() {
    const user = getCurrentUser();

    // Intentar caché
    const cachedSelected = cacheGet(CACHE_KEYS.LEAD_SELECTED(state.idPrometeo, state.campana));
    const cachedDetail = cacheGet(CACHE_KEYS.LEAD_DETAIL(state.idPrometeo, state.campana, user.email));

    // ASESOR: usar caché si existe
    if (!esRolSupervisorOAdmision(user.rol) && cachedSelected) {
        state.lead = cachedSelected;
        state.historialAsesores = null;
        renderAll();
        cargarSolicitudPendiente();
        cargarSolicitudCC();
        if (esLeadNoOrdinario(state.lead)) actualizarCatalogoProcedencia().then(() => renderVista1());
        return;
    }

    // SUPERVISOR o sin caché: cargar del backend
    try {
        const result = await callAPI('getLeadDetail', {
            id: state.idPrometeo,
            campana: state.campana,
            email: user.email,
            rol: user.rol
        });

        if (result.success && result.data) {
            state.lead = result.data;
            state.historialAsesores = result.historialAsesores || null;

            // Si venimos del dashboard, el status puede estar chanceado
            if (cachedSelected) {
                const statusCache = cachedSelected[COLUMNAS.STATUS_GESTION];
                if (statusCache === STATUS.PAGO_COMPLETO || statusCache === STATUS.PAGO_FRACCIONADO) {
                    state.lead[COLUMNAS.STATUS_GESTION] = statusCache;
                    if (cachedSelected[COLUMNAS.FECHA_PAGO_COMPLETO]) {
                        state.lead[COLUMNAS.FECHA_PAGO_COMPLETO] = cachedSelected[COLUMNAS.FECHA_PAGO_COMPLETO];
                    }
                    if (cachedSelected[COLUMNAS.FECHA_PROMESA_PAGO]) {
                        state.lead[COLUMNAS.FECHA_PROMESA_PAGO] = cachedSelected[COLUMNAS.FECHA_PROMESA_PAGO];
                    }
                }
            }

            cacheSet(CACHE_KEYS.LEAD_DETAIL(state.idPrometeo, state.campana, user.email), state.lead);
            cacheSet(CACHE_KEYS.LEAD_SELECTED(state.idPrometeo, state.campana), state.lead);

            renderAll();
            cargarSolicitudPendiente();
            cargarSolicitudCC();
            if (esLeadNoOrdinario(state.lead)) actualizarCatalogoProcedencia().then(() => renderVista1());
        } else {
            alert('Error al cargar datos del lead: ' + (result?.error || 'No encontrado'));
            window.location.href = 'dashboard.html?view=bottomline';
        }
    } catch (e) {
        alert('Error de conexión: ' + e.message);
        window.location.href = 'dashboard.html?view=bottomline';
    }
}

// ===== SOLICITUD PENDIENTE =====
async function cargarSolicitudPendiente() {
    try {
        const result = await callAPI('getSolicitudPendiente', {
            idPrometeo: state.idPrometeo,
            campana: state.campana
        });
        state.solicitudPendiente = (result && result.success) ? (result.data || null) : null;
        state.solicitudVerificada = true;
        renderAll();
    } catch (e) {
        console.error('Error cargando solicitud:', e);
        state.solicitudVerificada = true;
        renderAll();
    }
}

// ===== SOLICITUD CONDICIONES COMERCIALES =====
async function cargarSolicitudCC() {
    try {
        const result = await callAPI('getSolicitudCC', {
            idPrometeo: state.idPrometeo,
            campana: state.campana
        });
        state.solicitudCC = (result && result.success) ? (result.data || null) : null;
        renderAll();
    } catch (e) {
        console.error('Error cargando solicitud CC:', e);
    }
}

// ===== RENDER =====
function renderAll() {
    if (!state.lead) return;
    renderHeaderLead();
    renderVista1();
    renderVista2();
    renderHistorial();
}

function renderHeaderLead() {
    const lead = state.lead;
    const user = getCurrentUser();

    const id = obtenerCampo(lead, COLUMNAS.ID_PROMETEO) || '---';
    const nombre = obtenerCampo(lead, COLUMNAS.NOMBRES) || 'Sin Nombre';
    const canal = obtenerCampo(lead, COLUMNAS.CANAL) || '-';
    const asesor = obtenerCampo(lead, COLUMNAS.ASESOR_NOMBRE, COLUMNAS.ASESOR_ULTIMO_CONTACTO) || '-';
    const status = lead[COLUMNAS.STATUS_GESTION] || 'SIN_STATUS';

    const dni = obtenerCampo(lead, COLUMNAS.DNI) || '-';
    const celular1 = obtenerCampo(lead, COLUMNAS.TELEFONO_2) || '';
    const celular2 = obtenerCampo(lead, COLUMNAS.TELEFONO_3) || '';
    const celularesTexto = [celular1, celular2].filter(Boolean).join(' / ') || '-';
    const correo = obtenerCampo(lead, COLUMNAS.EMAIL) || '-';

    const carrera = obtenerCampo(lead, COLUMNAS.CARRERA, COLUMNAS.PROGRAMA) || '-';
    const modalidad = obtenerCampo(lead, COLUMNAS.MODALIDAD) || '-';

    const colegio = obtenerCampo(lead, COLUMNAS.COLEGIO, 'NOMBRE DEL COLEGIO', 'Nombre del colegio') || '-';
    const boletaColegioRaw = obtenerCampo(lead, COLUMNAS.BOLETA_COLEGIO);
    const boletaColegio = (boletaColegioRaw === null || boletaColegioRaw === '') ? '0' : boletaColegioRaw;
    const tipoIngreso = String(obtenerCampo(lead, COLUMNAS.MODALIDAD_INGRESO) || '').trim() || '-';

    document.getElementById('leadId').textContent = id;
    document.getElementById('leadNombre').textContent = nombre;
    document.getElementById('leadCanal').textContent = canal;

    const asesorWrap = document.getElementById('leadAsesorWrap');
    if (esRolSupervisorOAdmision(user.rol)) {
        document.getElementById('leadAsesor').textContent = asesor;
        asesorWrap.style.display = '';
    } else {
        asesorWrap.style.display = 'none';
    }

    document.getElementById('leadDocumento').textContent = dni;
    document.getElementById('leadCelular').textContent = celularesTexto;
    document.getElementById('leadCorreo').textContent = correo;

    document.getElementById('leadCampana').textContent = state.campana;
    document.getElementById('leadCarrera').textContent = carrera;
    document.getElementById('leadModalidad').textContent = modalidad;

    document.getElementById('leadColegio').textContent = colegio;
    document.getElementById('leadBoletaColegio').textContent = boletaColegio;
    document.getElementById('leadTipoIngreso').textContent = tipoIngreso;

    const badge = document.getElementById('statusBadge');
    badge.textContent = STATUS_LABELS[status] || status;
    badge.className = 'status-large ' + (STATUS_CLASES[status] || '');
}

function obtenerCampo(lead, ...posibles) {
    if (!lead) return '';
    for (const nombre of posibles) {
        if (lead[nombre] !== undefined && lead[nombre] !== null && String(lead[nombre]).trim() !== '') {
            return lead[nombre];
        }
    }
    const normalizar = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    const objetivos = posibles.map(normalizar);
    for (const key in lead) {
        if (objetivos.includes(normalizar(key)) && lead[key] !== undefined && lead[key] !== null && String(lead[key]).trim() !== '') {
            return lead[key];
        }
    }
    return '';
}

// ===== VISTA 1: DATOS =====
function renderVista1() {
    const container = document.getElementById('vista1Content');
    if (!container || !state.lead) return;

    const lead = state.lead;
    const id = obtenerCampo(lead, COLUMNAS.ID_PROMETEO) || '---';
    const nombre = obtenerCampo(lead, COLUMNAS.NOMBRES) || 'Sin Nombre';
    const colegio = obtenerCampo(lead, COLUMNAS.COLEGIO, 'NOMBRE DEL COLEGIO', 'Nombre del colegio') || '-';
    const carrera = obtenerCampo(lead, COLUMNAS.CARRERA, COLUMNAS.PROGRAMA) || '-';
    const modalidad = obtenerCampo(lead, COLUMNAS.MODALIDAD) || '-';
    const tipoIngreso = String(obtenerCampo(lead, COLUMNAS.MODALIDAD_INGRESO) || '').trim();
    const caso = determinarCasoIngreso(lead);

    const boletaActual = obtenerCampo(lead, COLUMNAS.BOLETA) || '';
    const beneficioActual = obtenerCampo(lead, COLUMNAS.BENEFICIO) || '';
    const beneficioAdicionalActual = obtenerCampo(lead, COLUMNAS.BENEFICIO_ADICIONAL) || '0';
    const beneficioEngancheActual = obtenerCampo(lead, COLUMNAS.BENEFICIO_ENGANCHE) || '0';
    const institucionActual = obtenerCampo(lead, COLUMNAS.INSTITUCION_PROCEDENCIA) || '';
    const carreraProcedenciaActual = obtenerCampo(lead, COLUMNAS.CARRERA_PROCEDENCIA) || '';
    const tipoInstitucionProcedenciaActual = obtenerCampo(lead, COLUMNAS.TIPO_INSTITUCION_PROCEDENCIA) || '';
    const boletaProcedenciaActual = obtenerCampo(lead, COLUMNAS.BOLETA_PROCEDENCIA) || '';
    const cicloQuedoActual = obtenerCampo(lead, COLUMNAS.CICLO_QUEDO) || '';
    const tiempoOfrecidoActual = obtenerCampo(lead, COLUMNAS.TIEMPO_OFRECIDO) || '';
    // Por defecto: Alumno Regular / 5 cuotas
    const tipoAlumnoActual = obtenerCampo(lead, COLUMNAS.TIPO_ALUMNO) || 'ALUMNO REGULAR';
    const cuotasActual = obtenerCampo(lead, COLUMNAS.NUMERO_CUOTAS) || '5 cuotas';
    const metodoPagoActual = obtenerCampo(lead, COLUMNAS.METODO_PAGO) || '';
    const rindeExamenActual = obtenerCampo(lead, COLUMNAS.RINDE_EXAMEN_SUFICIENCIA) || 'NO';
    const mostrarRindeExamen = (caso === 1 && normalizarTexto(modalidad) === 'remoto') || caso === 3;
    const boletaFinal = obtenerCampo(lead, COLUMNAS.BOLETA_FINAL) || '-';
    const boletaColegioRaw = obtenerCampo(lead, COLUMNAS.BOLETA_COLEGIO);
    const boletaColegio = (boletaColegioRaw === null || boletaColegioRaw === '') ? '0' : boletaColegioRaw;
    const celular1 = obtenerCampo(lead, COLUMNAS.TELEFONO_2) || '';
    const celular2 = obtenerCampo(lead, COLUMNAS.TELEFONO_3) || '';
    const celularesTexto = [celular1, celular2].filter(Boolean).join(' / ') || '-';
    const correo = obtenerCampo(lead, COLUMNAS.EMAIL) || '-';
    const dni = obtenerCampo(lead, COLUMNAS.DNI) || '-';
    const descuentoActual = obtenerCampo(lead, COLUMNAS.DESCUENTO_PRECIOS) || '0';

    const tipoIngresoCatalogo = tipoIngresoCatalogoPorCaso(caso);
    const boletaReferencia = (caso === 1) ? boletaColegio : boletaProcedenciaActual;

    const colegioNorm = normalizarTexto(colegio);
    const modalidadNorm = normalizarTexto(modalidad);
    const esColegioAliado = (caso === 1) && modalidadNorm === 'semipresencial' &&
        (colegioNorm.includes('innovaschool') || colegioNorm.includes('sacooliveros')) &&
        !colegioNorm.includes('pascual');

    const filasFiltradas = esColegioAliado
        ? filasCatalogoSinRango(state.catalogoBoletas, tipoIngresoCatalogo)
        : filasCatalogoFiltradas(state.catalogoBoletas, tipoIngresoCatalogo, boletaReferencia);

    const opcionesBoletaBeneficio = opcionesBoletaBeneficioCatalogo(filasFiltradas);
    const boletaConBecaActual = obtenerCampo(lead, COLUMNAS.BOLETA_CON_BECA) || '';
    const valorComboActual = `${boletaActual}||${beneficioActual}||${boletaConBecaActual}`;

    const boletaVirtualFija = obtenerBoletaVirtualFija(carrera, caso, modalidad);

    const opcionesAdicional = opcionesBeneficioPorTipo(state.catalogoBeneficios, 'ADICIONAL');
    const opcionesEnganche = opcionesBeneficioPorTipo(state.catalogoBeneficios, 'ENGANCHE');
    const valorAdicionalCombo = opcionesAdicional.find(o => o.value === String(beneficioAdicionalActual))?.value
        || opcionesAdicional.find(o => o.value.split('||')[0] === String(beneficioAdicionalActual))?.value
        || `${beneficioAdicionalActual}||PORCENTAJE||`;
    const valorEngancheCombo = opcionesEnganche.find(o => o.value.split('||')[0] === String(beneficioEngancheActual))?.value || `${beneficioEngancheActual}||`;

    const user = getCurrentUser();
    const esAdmin = esRolSupervisorOAdmision(user.rol);
    const bloqueado = !esAdmin && state.solicitudPendiente && state.solicitudPendiente.STATUS === 'PENDIENTE';

    let html = `
        <div style="display:flex; gap:20px; align-items:stretch; flex-wrap:wrap;">
            <div style="flex:1 1 600px; display:flex; flex-direction:column; gap:20px;">
                <div style="background:white; padding:24px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.05);">
                    <h3 style="color:var(--color-accent); font-size:18px; margin:0;">Datos de la boleta</h3>
                    <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:20px;" id="bloqueEditableFicha">
    `;

    // Campos editables
    const esCarreraElegibleETU = !!getEspecializacionETU(carrera);
    html += campoEditableHTML('Tipo de Alumno',
        selectSimpleHTML('selectTipoAlumno', SELECT_OPTIONS.tipoAlumno, tipoAlumnoActual, bloqueado) +
        `<span id="tipoAlumnoHint" style="display:${(tipoAlumnoActual === 'ALUMNO ETU' && !esCarreraElegibleETU) ? 'block' : 'none'}; font-size:11px; color:#d32f2f; margin-top:4px;">
            Esta carrera no tiene especialización ETU definida; no se incluirá en las Condiciones Comerciales.
        </span>`
    );
    html += campoEditableHTML('Número de Cuotas', selectSimpleHTML('selectCuotas', SELECT_OPTIONS.cuotas, cuotasActual, bloqueado));

    if (caso === 2 || caso === 3) {
        html += campoEditableHTML('Tipo de Institución de Procedencia', selectSimpleHTML('selectTipoInstitucion', TIPOS_INSTITUCION_PROCEDENCIA, tipoInstitucionProcedenciaActual, bloqueado));
        html += campoEditableHTML('Institución de Procedencia', inputBuscableHTML(
            'selectInstitucion',
            opcionesInstitucionPorTipo(tipoInstitucionProcedenciaActual),
            institucionActual,
            bloqueado || !tipoInstitucionProcedenciaActual,
            tipoInstitucionProcedenciaActual ? 'Escribe para buscar...' : 'Selecciona primero el tipo'
        ));
        html += campoEditableHTML('Carrera de Procedencia', inputBuscableHTML('selectCarreraProcedencia', state.catalogoCarrerasProcedencia, carreraProcedenciaActual, bloqueado));
        html += campoEditableHTML('Boleta de Procedencia', `<input type="number" id="inputBoletaProcedencia" class="campo-editable-input" value="${escapeHtml(boletaProcedenciaActual)}" ${bloqueado ? 'disabled' : ''}>`);
        if (caso === 2) {
            html += campoEditableHTML('¿En qué ciclo se quedó?', selectSimpleHTML('selectCicloQuedo', opcionesCicloPorTipoInstitucion(tipoInstitucionProcedenciaActual), cicloQuedoActual, bloqueado || !tipoInstitucionProcedenciaActual));
            html += campoEditableHTML('Tiempo Ofrecido', selectSimpleHTML('selectTiempoOfrecido', SELECT_OPTIONS.tiempo, tiempoOfrecidoActual, bloqueado));
        }
    }

    if (boletaVirtualFija !== null) {
        html += campoEditableHTML('Descuento Admisión y Matrícula',
            `<input type="text" class="campo-editable-input" value="Matrícula S/0 - E. Admisión S/0" disabled>
             <input type="hidden" id="selectDescuento" value="100">`
        );
        html += campoEditableHTML('Boleta / Beneficio',
            `<input type="text" class="campo-editable-input" value="S/ ${boletaVirtualFija}" disabled>
             <input type="hidden" id="selectBoletaBeneficio" value="${[boletaVirtualFija, '', ''].join('||')}">`
        );
    } else {
        html += campoEditableHTML('Descuento Admisión y Matrícula', selectConValorHTML('selectDescuento', SELECT_OPTIONS.descuentoPrecios, descuentoActual, bloqueado));
        html += campoEditableHTML('Boleta / Beneficio',
            opcionesBoletaBeneficio.length
                ? selectConValorHTML('selectBoletaBeneficio', opcionesBoletaBeneficio, valorComboActual, bloqueado)
                : `<input type="text" class="campo-editable-input" value="Sin opciones para este rango/tipo" disabled>`
        );
    }

    html += campoEditableHTML('Beneficio Adicional', selectConValorHTML('selectBeneficioAdicional', opcionesAdicional, valorAdicionalCombo, bloqueado));
    html += campoEditableHTML('Beneficio Enganche', selectConValorHTML('selectBeneficioEnganche', opcionesEnganche, valorEngancheCombo, bloqueado));
    html += campoEditableHTML('Método de Pago', selectSimpleHTML('selectMetodoPago', SELECT_OPTIONS.metodoPago, metodoPagoActual, bloqueado));

    if (mostrarRindeExamen) {
        html += campoEditableHTML('¿Rinde Examen de Suficiencia?', selectSimpleHTML('selectRindeExamenSuficiencia', SELECT_OPTIONS.rindeExamenSuficiencia, rindeExamenActual, bloqueado));
    }

    html += `
                    </div>
                    <button class="btn-guardar" id="btnGuardarFicha" ${bloqueado ? 'disabled' : ''}>
                        <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">save</span> Guardar
                    </button>
                    <span id="fichaGuardadoMsg" style="margin-left:12px; font-size:13px; color:#1b5e20;"></span>
                </div>
            </div>

            <div style="flex:0 1 360px; display:flex; flex-direction:column; gap:14px; align-items:center; justify-content:flex-start;">
                <div id="montoAPagarBox" style="width:100%;"></div>
                <div id="solicitudCCBox" style="width:100%;"></div>
            </div>
        </div>
    `;

    // Solicitud de escala menor
    const permiteSolicitar = !esColegioAliado && boletaVirtualFija === null && boletaActual !== '';
    const opcionesRangoInferior = permiteSolicitar
        ? opcionesBoletaBeneficioCatalogo(filasCatalogoRangosInferiores(state.catalogoBoletas, tipoIngresoCatalogo, boletaReferencia))
        : [];

    html += renderSolicitudBox(permiteSolicitar, opcionesRangoInferior, id, esColegioAliado);

    container.innerHTML = html;

    // Eventos
    ['selectDescuento', 'selectBoletaBeneficio', 'selectBeneficioAdicional', 'selectCuotas'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', actualizarMonto);
    });

    const inputProc = document.getElementById('inputBoletaProcedencia');
    if (inputProc) {
        inputProc.addEventListener('change', () => {
            Object.assign(state.lead, capturarEdicionesTemporal());
            renderVista1();
        });
    }

    initComboBuscable('selectInstitucion', opcionesInstitucionPorTipo(tipoInstitucionProcedenciaActual));
    initComboBuscable('selectCarreraProcedencia', state.catalogoCarrerasProcedencia);

    const selectTipoInst = document.getElementById('selectTipoInstitucion');
    const inputInstitucion = document.getElementById('selectInstitucion');
    if (selectTipoInst && inputInstitucion) {
        selectTipoInst.addEventListener('change', () => {
            const tipoSel = selectTipoInst.value;
            const nuevasOpciones = opcionesInstitucionPorTipo(tipoSel);

            if (inputInstitucion._actualizarOpcionesCombo) inputInstitucion._actualizarOpcionesCombo(nuevasOpciones);

            const valorActualNorm = String(inputInstitucion.value || '').trim().toUpperCase();
            const sigueValido = nuevasOpciones.some(op => String(op).trim().toUpperCase() === valorActualNorm);
            if (!sigueValido) inputInstitucion.value = '';

            inputInstitucion.disabled = !tipoSel || bloqueado;
            inputInstitucion.placeholder = tipoSel ? 'Escribe para buscar...' : 'Selecciona primero el tipo';

            const selectCiclo = document.getElementById('selectCicloQuedo');
            if (selectCiclo) {
                const nuevasOpcionesCiclo = opcionesCicloPorTipoInstitucion(tipoSel);
                const valorCicloActual = selectCiclo.value;
                selectCiclo.innerHTML = '<option value="">-- Seleccionar --</option>' +
                    nuevasOpcionesCiclo.map(o => `<option value="${o}" ${o === valorCicloActual ? 'selected' : ''}>${o}</option>`).join('');
                selectCiclo.disabled = !tipoSel || bloqueado;
                if (!nuevasOpcionesCiclo.includes(valorCicloActual)) selectCiclo.value = '';
            }
        });
    }

    document.getElementById('selectTipoAlumno')?.addEventListener('change', (e) => {
        const hint = document.getElementById('tipoAlumnoHint');
        if (hint) hint.style.display = (e.target.value === 'ALUMNO ETU' && !esCarreraElegibleETU) ? 'block' : 'none';
    });

    document.getElementById('btnGuardarFicha')?.addEventListener('click', () => guardarFicha(id));

    actualizarMonto();
    // Se guarda en state (no solo como argumento local) para poder
    // revalidarlo justo al hacer clic en "Solicitar envío de CC" — ver
    // abrirModalSolicitudCC(), que usa esto como segunda barrera además
    // de que el botón ni siquiera se pinte cuando esto es false.
    // Nota: antes esto se saltaba con `boletaVirtualFija !== null` (precio
    // fijo por modalidad Remoto) sin exigir guardado — se quitó esa
    // excepción: aunque el precio sea fijo, si no se guarda la ficha no hay
    // garantía de que siga correspondiendo a la carrera/modalidad vigente.
    state.boletaGuardada = boletaActual !== '';
    renderSolicitudCCBox(state.boletaGuardada);
}

function capturarEdicionesTemporal() {
    const getVal = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
    const cambios = {};
    if (getVal('selectTipoInstitucion') !== undefined) cambios[COLUMNAS.TIPO_INSTITUCION_PROCEDENCIA] = getVal('selectTipoInstitucion');
    if (getVal('selectInstitucion') !== undefined) cambios[COLUMNAS.INSTITUCION_PROCEDENCIA] = getVal('selectInstitucion');
    if (getVal('selectCarreraProcedencia') !== undefined) cambios[COLUMNAS.CARRERA_PROCEDENCIA] = getVal('selectCarreraProcedencia');
    if (getVal('inputBoletaProcedencia') !== undefined) cambios[COLUMNAS.BOLETA_PROCEDENCIA] = getVal('inputBoletaProcedencia');
    if (getVal('selectCicloQuedo') !== undefined) cambios[COLUMNAS.CICLO_QUEDO] = getVal('selectCicloQuedo');
    return cambios;
}

function campoHTML(label, value) {
    const safe = (value !== undefined && value !== null && String(value).trim() !== '') ? value : '-';
    return `
        <div>
            <span style="color:#888; font-size:12px; display:block; text-transform:uppercase; font-weight:600;">${escapeHtml(label)}</span>
            <strong style="color:#222; font-size:15px; display:block; margin-top:2px;">${escapeHtml(safe)}</strong>
        </div>
    `;
}

function campoEditableHTML(label, inputHTML) {
    return `
        <div>
            <span style="color:#888; font-size:12px; display:block; text-transform:uppercase; font-weight:600;">${label}</span>
            <div style="margin-top:4px;">${inputHTML}</div>
        </div>
    `;
}

function selectSimpleHTML(id, opciones, valorActual, disabled) {
    const opts = opciones.map(op =>
        `<option value="${escapeHtml(op)}" ${String(op) === String(valorActual) ? 'selected' : ''}>${escapeHtml(op)}</option>`
    ).join('');
    return `<select id="${id}" class="campo-editable-select" ${disabled ? 'disabled' : ''}><option value="">-- Seleccionar --</option>${opts}</select>`;
}

function selectConValorHTML(id, opciones, valorActual, disabled) {
    const hayCoincidencia = opciones.some(op => String(op.value) === String(valorActual));
    const opts = opciones.map(op =>
        `<option value="${escapeHtml(op.value)}" ${String(op.value) === String(valorActual) ? 'selected' : ''}>${escapeHtml(op.label)}</option>`
    ).join('');
    // Si nada calza con el valor guardado (p.ej. porque todavía no se ha
    // guardado nada para este lead), el navegador seleccionaría la PRIMERA
    // opción del catálogo por defecto — dando la falsa impresión de que ya
    // hay algo elegido. Se agrega un placeholder deshabilitado y
    // seleccionado en ese caso para que el <select> se vea genuinamente vacío.
    const placeholder = hayCoincidencia ? '' : '<option value="" selected disabled hidden>-- Selecciona --</option>';
    return `<select id="${id}" class="campo-editable-select" ${disabled ? 'disabled' : ''}>${placeholder}${opts}</select>`;
}

function opcionesInstitucionPorTipo(tipo) {
    const tipoNorm = String(tipo || '').trim().toUpperCase();
    if (!tipoNorm) return [];
    return state.catalogoInstitucionesProcedencia
        .filter(i => String(i.tipo || '').trim().toUpperCase() === tipoNorm)
        .map(i => i.nombre);
}

function opcionesCicloPorTipoInstitucion(tipo) {
    const tipoNorm = String(tipo || '').trim().toUpperCase();
    if (tipoNorm === 'INSTITUTO') return Array.from({ length: 8 }, (_, i) => String(i + 1));
    if (tipoNorm === 'UNIVERSIDAD') return Array.from({ length: 10 }, (_, i) => String(i + 1));
    return [];
}

function inputBuscableHTML(id, opciones, valorActual, disabled, placeholder = 'Escribe para buscar...') {
    return `
        <div class="combo-buscable" id="${id}Wrap">
            <input type="text" id="${id}" class="campo-editable-input combo-buscable-input"
                   value="${escapeHtml(valorActual || '')}" placeholder="${escapeHtml(placeholder)}"
                   autocomplete="off" ${disabled ? 'disabled' : ''}>
            <span class="material-symbols-outlined combo-buscable-arrow">expand_more</span>
            <div class="combo-buscable-panel" id="${id}Panel"></div>
        </div>
    `;
}

function initComboBuscable(id, opcionesIniciales) {
    const input = document.getElementById(id);
    const panel = document.getElementById(id + 'Panel');
    if (!input || !panel) return;

    let opciones = opcionesIniciales;

    function renderPanel(filtro) {
        const filtroNorm = normalizarTexto(filtro || '');
        const filtradas = filtroNorm
            ? opciones.filter(op => normalizarTexto(op).includes(filtroNorm))
            : opciones;

        panel.innerHTML = filtradas.length
            ? filtradas.map(op => `<div class="combo-buscable-option" data-valor="${escapeHtml(op)}">${escapeHtml(op)}</div>`).join('')
            : `<div class="combo-buscable-empty">Sin coincidencias — se guardará el texto escrito</div>`;
    }

    input.addEventListener('focus', () => {
        if (input.disabled) return;
        renderPanel(input.value);
        panel.classList.add('open');
    });

    input.addEventListener('input', () => {
        renderPanel(input.value);
        panel.classList.add('open');
    });

    panel.addEventListener('click', (e) => {
        const opt = e.target.closest('.combo-buscable-option');
        if (!opt) return;
        input.value = opt.dataset.valor;
        panel.classList.remove('open');
        input.dispatchEvent(new Event('change'));
    });

    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !panel.contains(e.target)) {
            panel.classList.remove('open');
        }
    });

    // Permite refrescar la lista de opciones desde afuera (ej. al cambiar el Tipo)
    input._actualizarOpcionesCombo = (nuevas) => { opciones = nuevas; };
}

function renderSolicitudBox(permite, opciones, id, esColegioAliado) {
    const user = getCurrentUser();
    const esAdmin = esRolSupervisorOAdmision(user.rol);

    if (state.solicitudPendiente && state.solicitudPendiente.STATUS === 'PENDIENTE') {
        const boletaSol = state.solicitudPendiente.BOLETA_SOLICITADA;
        const beneficioSol = state.solicitudPendiente.BENEFICIO_SOLICITADO || 'Sin beca';
        const asesorNombre = state.solicitudPendiente.ASESOR_NOMBRE || state.solicitudPendiente.ASESOR_EMAIL || 'Asesor';

        if (esAdmin) {
            return `
                <div style="background:#fff8e1; border:1px solid #ffca28; padding:18px 20px; border-radius:8px; margin-top:20px;">
                    <strong style="color:#e65100;">Solicitud de escala menor pendiente</strong>
                    <p style="margin:8px 0; font-size:14px; color:#555;">
                        <strong>${escapeHtml(asesorNombre)}</strong> solicita cambiar la boleta de
                        <strong>S/ ${escapeHtml(state.solicitudPendiente.BOLETA_ACTUAL)}</strong> a
                        <strong>S/ ${escapeHtml(boletaSol)}</strong> (${escapeHtml(beneficioSol)}).
                    </p>
                    <div style="display:flex; gap:10px;">
                        <button class="btn-guardar" style="background:var(--color-success);" data-resolver="APROBADO">
                            Aprobar
                        </button>
                        <button class="btn-guardar" style="background:var(--color-danger);" data-resolver="RECHAZADO">
                            Rechazar
                        </button>
                    </div>
                </div>
            `;
        }

        return `
            <div style="background:#e3f2fd; border:1px solid #64b5f6; padding:16px 20px; border-radius:8px; margin-top:20px; font-size:14px; color:#0d47a1;">
                Tienes una solicitud pendiente: Boleta S/ ${escapeHtml(boletaSol)} (${escapeHtml(beneficioSol)}) — esperando aprobación.
                <div style="margin-top:10px;">
                    <button class="btn-guardar" style="background:#777;" id="btnCancelarSolicitud">Cancelar solicitud</button>
                </div>
            </div>
        `;
    }

    if (state.solicitudPendiente && state.solicitudPendiente.STATUS === 'RECHAZADO' && !esAdmin) {
        return `
            <div style="background:#ffebee; border:1px solid #ef9a9a; padding:16px 20px; border-radius:8px; margin-top:20px; font-size:14px; color:#b71c1c;">
                Solicitud de recategorización a Boleta S/ ${escapeHtml(state.solicitudPendiente.BOLETA_SOLICITADA)} Rechazada.
            </div>
        `;
    }

    if (esAdmin) return '';

    if (!permite) {
        if (state.lead && !state.lead[COLUMNAS.BOLETA] && !esColegioAliado) {
            return `
                <div style="background:#fff3e0; border:1px solid #ffb74d; padding:14px 18px; border-radius:8px; margin-top:20px; font-size:13px; color:#e65100;">
                    Debes guardar la boleta del lead antes de poder solicitar una recategorización.
                </div>
            `;
        }
        return '';
    }

    if (opciones.length === 0) return '';

    return `
        <div style="background:white; padding:20px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.05); margin-top:20px;">
            <strong style="color:#555; font-size:14px;">¿Necesitas ofrecer una boleta más baja?</strong>
            <p style="font-size:12px; color:#999; margin:4px 0 10px;">Requiere aprobación del administrador.</p>
            <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end;">
                <div style="flex:1; min-width:220px;">${selectConValorHTML('selectEscalaMenor', opciones, '', false)}</div>
                <button class="btn-guardar" id="btnSolicitarEscala">Solicitar aprobación</button>
            </div>
            <span id="solicitudMsg" style="display:block; margin-top:8px; font-size:13px; color:#1b5e20;"></span>
        </div>
    `;
}

// ===== LÓGICA DE CATÁLOGO =====
function tipoIngresoCatalogoPorCaso(caso) {
    if (caso === 2) return 'Traslado con Conva';
    if (caso === 3) return 'Traslado sin Conva';
    return 'Ordinario';
}

function filasCatalogoSinRango(catalogo, tipoIngreso) {
    const tipoNorm = normalizarTexto(tipoIngreso);
    return (catalogo || []).filter(fila => {
        if (normalizarTexto(fila.TIPO_INGRESO || '') !== tipoNorm) return false;
        const min = parseNumero(fila.BOLETA_PROCEDENCIA_MIN);
        const max = parseNumero(fila.BOLETA_PROCEDENCIA_MAX);
        return isNaN(min) && isNaN(max);
    });
}

// Arma la lista de rangos únicos de un TIPO_INGRESO, ordenados por
// BOLETA_PROCEDENCIA_MAX ascendente. Se agrupa SOLO por MAX (no por el par
// min-max): si en la hoja BOLETAS quedó una fila ancha "catch-all" que
// traslapa con el desglose fino (ej. 0-1249 conviviendo con 1100-1149,
// 1150-1199, 1200-1249...), la fila ancha comparte el mismo MAX que una de
// las finas y por lo tanto queda descartada automáticamente (se conserva la
// que aparece primero en la hoja). Esto evita tener que editar/depurar la
// hoja manualmente: basta con que el desglose fino exista antes en el orden
// de filas para que gane.
function rangosUnicosOrdenados(filasTipo) {
    const rangosMap = new Map(); // key: MAX
    filasTipo.forEach(fila => {
        const min = parseNumero(fila.BOLETA_PROCEDENCIA_MIN);
        const max = parseNumero(fila.BOLETA_PROCEDENCIA_MAX);
        if (isNaN(min) || isNaN(max)) return;
        if (!rangosMap.has(max)) rangosMap.set(max, { min, max });
    });
    return Array.from(rangosMap.values()).sort((a, b) => a.max - b.max);
}

// El rango que le corresponde a `ref` es el de MENOR MAX que aún lo cubre
// (equivalente a una tabla de tramos/tax-bracket: se busca el primer
// "hasta X" que alcance). Como los rangos ya vienen ordenados por MAX
// ascendente, el primer match es siempre el más ajustado — sin necesidad de
// comparar amplitudes ni de que la hoja esté libre de filas anchas legacy.
function encontrarIndiceRango(rangosOrdenadosPorMax, ref) {
    return rangosOrdenadosPorMax.findIndex(r => ref >= r.min && ref <= r.max);
}

function filasCatalogoFiltradas(catalogo, tipoIngreso, referencia) {
    const tipoNorm = normalizarTexto(tipoIngreso);
    const ref = parseNumero(referencia);
    if (isNaN(ref)) return [];

    const filasTipo = (catalogo || []).filter(fila => normalizarTexto(fila.TIPO_INGRESO || '') === tipoNorm);
    const rangosOrdenados = rangosUnicosOrdenados(filasTipo);

    const indiceMatch = encontrarIndiceRango(rangosOrdenados, ref);
    if (indiceMatch === -1) return [];

    const rangosPermitidos = rangosOrdenados.slice(indiceMatch, indiceMatch + 3);
    return filasTipo.filter(fila => {
        const max = parseNumero(fila.BOLETA_PROCEDENCIA_MAX);
        return rangosPermitidos.some(r => r.max === max);
    });
}

function filasCatalogoRangosInferiores(catalogo, tipoIngreso, referencia) {
    const tipoNorm = normalizarTexto(tipoIngreso);
    const ref = parseNumero(referencia);
    if (isNaN(ref)) return [];

    const filasTipo = (catalogo || []).filter(fila => normalizarTexto(fila.TIPO_INGRESO || '') === tipoNorm);
    const rangosOrdenados = rangosUnicosOrdenados(filasTipo);

    const indiceMatch = encontrarIndiceRango(rangosOrdenados, ref);
    if (indiceMatch <= 0) return [];

    const rangosInferiores = rangosOrdenados.slice(0, indiceMatch);
    return filasTipo.filter(fila => {
        const max = parseNumero(fila.BOLETA_PROCEDENCIA_MAX);
        return rangosInferiores.some(r => r.max === max);
    });
}

function opcionesBoletaBeneficioCatalogo(filas) {
    const vistos = new Set();
    const opciones = [];
    (filas || []).forEach(fila => {
        const boletaBase = fila.BOLETA_BASE;
        const beca = fila.BECA_APLICABLE;
        const boletaConBeca = fila.BOLETA_CON_BECA;
        if (boletaBase === undefined || boletaBase === '') return;

        const value = `${boletaBase}||${beca || ''}||${boletaConBeca || ''}`;
        if (vistos.has(value)) return;
        vistos.add(value);

        const label = beca ? `S/ ${boletaBase} - S/ ${boletaConBeca} ${beca}` : `S/ ${boletaBase} - Sin beca`;
        opciones.push({ value, label });
    });
    return opciones;
}

function opcionesBeneficioPorTipo(catalogo, tipo) {
    return (catalogo || [])
        .filter(fila => normalizarTexto(fila.TIPO) === normalizarTexto(tipo))
        .map(fila => ({
            value: `${fila.VALOR}||${fila.MODO || ''}||${fila.LABEL || ''}`,
            label: fila.LABEL || String(fila.VALOR)
        }));
}

function obtenerBoletaVirtualFija(carrera, caso, modalidad) {
    if (normalizarTexto(modalidad) !== 'remoto') return null;

    const carreraNorm = normalizarTexto(carrera);
    const preciosEspeciales690 = {
        'comunicacionymarketingdigital': 690,
        'disenodigitaldeinteriores': 690,
        'disenograficopublicitario': 690,
        'disenograficoymarketingdigital': 690
    };
    if (preciosEspeciales690[carreraNorm] !== undefined) return 690;
    if (carreraNorm === 'disenograficopublicitario' && caso === 2) return 690;

    return 650; // remoto, cualquier otra carrera
}

// ===== MONTO A PAGAR =====
function actualizarMonto() {
    const box = document.getElementById('montoAPagarBox');
    if (!box) return;

    const getVal = id => { const el = document.getElementById(id); return el ? el.value : ''; };

    const descuento = Number(getVal('selectDescuento') || 0);
    const comboRaw = getVal('selectBoletaBeneficio');
    const [boletaBaseStr, becaNombre, boletaConBecaStr] = comboRaw.includes('||') ? comboRaw.split('||') : ['', '', ''];
    const boleta = Number(boletaBaseStr || 0);
    const montoConBeca = boletaConBecaStr ? Number(boletaConBecaStr) : null;

    const adicionalRaw = getVal('selectBeneficioAdicional');
    const [adicionalValorStr, adicionalModo] = adicionalRaw.includes('||') ? adicionalRaw.split('||') : [adicionalRaw, 'PORCENTAJE'];
    const adicionalValor = Number(adicionalValorStr || 0);

    const engancheEl = document.getElementById('selectBeneficioEnganche');
    const engancheLabel = engancheEl ? engancheEl.options[engancheEl.selectedIndex]?.text : '-';

    const admision = +(PRECIOS_BASE.ADMISION * (1 - descuento / 100)).toFixed(2);
    const matricula = +(PRECIOS_BASE.MATRICULA * (1 - descuento / 100)).toFixed(2);
    const boletaAPagar = montoConBeca !== null ? montoConBeca : boleta;

    const beneficioAdicionalMonto = adicionalModo === 'EXACTO'
        ? +(boletaAPagar - adicionalValor).toFixed(2)
        : adicionalModo === 'FIJO'
            ? +adicionalValor.toFixed(2)
            : adicionalModo === 'CICLO'
                ? +(boletaAPagar * 5 * (adicionalValor / 100)).toFixed(2)
                : +(boletaAPagar * (adicionalValor / 100)).toFixed(2);

    const total = +(admision + matricula + boletaAPagar - beneficioAdicionalMonto).toFixed(2);

    state.ultimoCalculo = { descuento, admision, matricula, boletaAPagar, beneficioAdicionalMonto, total };

    // Línea informativa de "6 cuotas": reusa exactamente el mismo cálculo
    // que va a terminar en el PDF de Condiciones Comerciales (construirDatosCC
    // en cc-template.js), pasando como overrides los valores que hay AHORA
    // MISMO en el formulario (aunque todavía no se hayan guardado), para que
    // el asesor vea el número real antes de solicitar el envío. No afecta
    // en nada el cálculo del Total de arriba — es solo informativo.
    const datosCC = construirDatosCC(state.lead, state.campana, {
        escalaRegular: boleta || undefined,
        escalaFinal: montoConBeca !== null ? montoConBeca : undefined,
        tipoBeca: becaNombre || undefined,
        beneficioPrimeraRaw: adicionalRaw || undefined,
        cuotas: getVal('selectCuotas') || undefined
    });

    function fila(label, valor, destacado) {
        return `<div style="display:flex; justify-content:space-between; padding:6px 0; ${destacado ? '' : 'border-bottom:1px solid #f0f0f0;'}">
            <span style="color:#555; font-size:14px;">${label}</span>
            <strong style="color:${destacado ? 'var(--color-primary)' : '#222'}; font-size:${destacado ? '17px' : '14px'};">${valor}</strong>
        </div>`;
    }

    box.innerHTML = `
        <div style="background:white; padding:24px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.05); max-width:420px; margin:0 auto;">
            <h3 style="color:var(--color-primary); margin-bottom:12px; font-size:16px; border-bottom:2px solid #e8eaf6; padding-bottom:8px;">Monto a pagar</h3>
            ${fila('Admisión', 'S/ ' + admision)}
            ${fila('Matrícula', 'S/ ' + matricula)}
            ${fila('Boleta', 'S/ ' + boleta)}
            ${fila('Beneficio', 'S/ ' + (montoConBeca !== null ? montoConBeca : 0))}
            ${fila('Beneficio Adicional', 'S/ ' + beneficioAdicionalMonto)}
            <div style="border-top:2px solid var(--color-primary); margin-top:6px;"></div>
            ${fila('Total', 'S/ ' + total, true)}
            <div style="margin-top:10px; padding-top:10px; border-top:1px dashed #ddd; font-size:13px; color:#888;">
                Beneficio de Enganche : <strong style="color:#555;">${escapeHtml(engancheLabel)}</strong>
            </div>
            ${datosCC.mostrar6Cuotas && datosCC.boleta6C ? `
            <div style="margin-top:6px; padding-top:6px; border-top:1px dashed #ddd; font-size:13px; color:#888;">
                ${escapeHtml(datosCC.boleta6CLabel)} : <strong style="color:#555;">${escapeHtml(datosCC.boleta6C)} (por cuota)</strong>
            </div>` : ''}
        </div>
    `;
}

// ===== SOLICITUD DE CONDICIONES COMERCIALES =====
let ccCorreosAdicionales = [];

function renderSolicitudCCBox(hayBoletaGuardada) {
    const box = document.getElementById('solicitudCCBox');
    if (!box) return;

    if (!hayBoletaGuardada) {
        box.innerHTML = '';
        return;
    }

    const sol = state.solicitudCC;

    if (sol && sol.STATUS === 'PENDIENTE') {
        box.innerHTML = `
            <div style="background:#e3f2fd; border:1px solid #64b5f6; padding:14px 16px; border-radius:8px; font-size:13px; color:#0d47a1; text-align:center; width:100%; box-sizing:border-box;">
                <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">hourglass_top</span>
                Solicitud de Condiciones Comerciales pendiente de envío.
                <div style="margin-top:8px;">
                    <button class="btn-guardar" style="background:#777; padding:6px 16px; font-size:12px;" id="btnCancelarSolicitudCC">Cancelar solicitud</button>
                </div>
            </div>
        `;
        document.getElementById('btnCancelarSolicitudCC')?.addEventListener('click', cancelarSolicitudCC);
        return;
    }

    if (sol && sol.STATUS === 'ENVIADO') {
        box.innerHTML = `
            <div style="background:#e8f5e9; border:1px solid #81c784; padding:14px 16px; border-radius:8px; font-size:13px; color:#1b5e20; text-align:center; width:100%; box-sizing:border-box;">
                <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">check_circle</span>
                Condiciones Comerciales enviadas el ${formatearFecha(sol.FECHA_RESOLUCION)}.
                <div style="margin-top:8px;">
                    <button class="btn-guardar" style="padding:6px 16px; font-size:12px;" id="btnSolicitarCCOtraVez">Solicitar nuevo envío</button>
                </div>
            </div>
        `;
        document.getElementById('btnSolicitarCCOtraVez')?.addEventListener('click', abrirModalSolicitudCC);
        return;
    }

    if (sol && sol.STATUS === 'RECHAZADO') {
        box.innerHTML = `
            <div style="background:#ffebee; border:1px solid #ef9a9a; padding:14px 16px; border-radius:8px; font-size:13px; color:#b71c1c; text-align:center; width:100%; box-sizing:border-box;">
                Tu solicitud de Condiciones Comerciales fue rechazada.
                <div style="margin-top:8px;">
                    <button class="btn-guardar" style="padding:6px 16px; font-size:12px;" id="btnSolicitarCCOtraVez">Solicitar de nuevo</button>
                </div>
            </div>
        `;
        document.getElementById('btnSolicitarCCOtraVez')?.addEventListener('click', abrirModalSolicitudCC);
        return;
    }

    box.innerHTML = `
        <button class="btn-guardar" id="btnAbrirSolicitudCC" style="width:100%;">
            <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">forward_to_inbox</span>
            Solicitar envío de Condiciones Comerciales
        </button>
    `;
    document.getElementById('btnAbrirSolicitudCC')?.addEventListener('click', abrirModalSolicitudCC);
}

let ccArchivos = { dni: [], certificado: [], boletaProcedencia: [] };

function idBaseArchivoCC(campo) {
    return 'ccArchivo' + campo.charAt(0).toUpperCase() + campo.slice(1);
}

// Las fotos de celular suelen traer una etiqueta EXIF de rotación (según cómo
// se sostuvo el teléfono al tomarla). Apps Script IGNORA esa etiqueta al
// insertar la imagen en el PDF, así que dos fotos "derechas" en la galería
// pueden terminar una horizontal y otra vertical en el documento. Se corrige
// acá, en el navegador, dibujando la imagen en un canvas con la orientación
// ya aplicada — así el archivo que se sube ya viene "derecho" sin depender
// de metadata que el backend no puede leer.
async function normalizarOrientacionImagen(file) {
    if (!file.type || !file.type.startsWith('image/')) return file; // PDFs: sin cambios
    try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
        if (!blob) return file;
        return new File([blob], file.name, { type: 'image/jpeg' });
    } catch (e) {
        return file; // navegador sin soporte: se sube tal cual, sin corregir
    }
}

function inicializarInputArchivoCC(campo, multiple) {
    const idBase = idBaseArchivoCC(campo);
    const input = document.getElementById(idBase);
    const btn = document.getElementById(idBase + 'Btn');
    btn?.addEventListener('click', () => input.click());
    input?.addEventListener('change', async () => {
        const seleccionados = Array.from(input.files || []);
        input.value = ''; // permite volver a elegir el mismo archivo si lo quita y lo agrega de nuevo
        const normalizados = await Promise.all(seleccionados.map(normalizarOrientacionImagen));
        ccArchivos[campo] = multiple ? ccArchivos[campo].concat(normalizados) : normalizados.slice(0, 1);
        renderListaArchivosCC(campo);
    });
}

function renderListaArchivosCC(campo) {
    const cont = document.getElementById(idBaseArchivoCC(campo) + 'Lista');
    if (!cont) return;
    cont.innerHTML = '';
    ccArchivos[campo].forEach((file, i) => {
        const esImagen = file.type && file.type.startsWith('image/');
        const wrap = document.createElement('div');
        wrap.style.cssText = 'text-align:center;';
        wrap.innerHTML = `
            <div style="position:relative; width:64px; height:64px; border:1px solid #ddd; border-radius:6px; overflow:hidden; display:flex; align-items:center; justify-content:center; background:#f7f7f7;">
                ${esImagen ? `<img src="${URL.createObjectURL(file)}" style="width:100%; height:100%; object-fit:cover;">` : '<span class="material-symbols-outlined" style="font-size:28px; color:#c62828;">picture_as_pdf</span>'}
                <span class="material-symbols-outlined" data-quitar-archivo="${campo}:${i}" style="position:absolute; top:-2px; right:-2px; background:#d32f2f; color:#fff; border-radius:50%; font-size:14px; width:16px; height:16px; display:flex; align-items:center; justify-content:center; cursor:pointer;">close</span>
            </div>
            <div style="font-size:10px; color:#888; max-width:64px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:2px;" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
        `;
        cont.appendChild(wrap);
    });
}

document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-quitar-archivo]');
    if (!el) return;
    const [campo, index] = el.dataset.quitarArchivo.split(':');
    ccArchivos[campo].splice(Number(index), 1);
    renderListaArchivosCC(campo);
});

function camposFaltantesCC(lead, caso) {
    const vacio = v => v === undefined || v === null || String(v).trim() === '';
    const faltantes = [];
    if (vacio(obtenerCampo(lead, COLUMNAS.TIPO_ALUMNO))) faltantes.push('Tipo de Alumno');
    if (vacio(obtenerCampo(lead, COLUMNAS.NUMERO_CUOTAS))) faltantes.push('Número de Cuotas');
    if (vacio(obtenerCampo(lead, COLUMNAS.DESCUENTO_PRECIOS))) faltantes.push('Descuento Admisión y Matrícula');
    if (vacio(obtenerCampo(lead, COLUMNAS.BOLETA))) faltantes.push('Boleta / Beneficio');
    if (vacio(obtenerCampo(lead, COLUMNAS.METODO_PAGO))) faltantes.push('Método de Pago');
    if (caso === 2 || caso === 3) {
        if (vacio(obtenerCampo(lead, COLUMNAS.TIPO_INSTITUCION_PROCEDENCIA))) faltantes.push('Tipo de Institución de Procedencia');
        if (vacio(obtenerCampo(lead, COLUMNAS.INSTITUCION_PROCEDENCIA))) faltantes.push('Institución de Procedencia');
        if (vacio(obtenerCampo(lead, COLUMNAS.CARRERA_PROCEDENCIA))) faltantes.push('Carrera de Procedencia');
        if (vacio(obtenerCampo(lead, COLUMNAS.BOLETA_PROCEDENCIA))) faltantes.push('Boleta de Procedencia');
        if (caso === 2 && vacio(obtenerCampo(lead, COLUMNAS.TIEMPO_OFRECIDO))) faltantes.push('Tiempo Ofrecido');
        if (caso === 2 && vacio(obtenerCampo(lead, COLUMNAS.CICLO_QUEDO))) faltantes.push('¿En qué ciclo se quedó?');
    }
    return faltantes;
}

function abrirModalSolicitudCC() {
    const caso = determinarCasoIngreso(state.lead);
    const faltantes = camposFaltantesCC(state.lead, caso);
    if (faltantes.length > 0) {
        alert('Debes guardar los datos de la boleta antes de solicitar Condiciones Comerciales:\n\n- ' + faltantes.join('\n- '));
        return;
    }

    ccCorreosAdicionales = [];
    ccArchivos = { dni: [], certificado: [], boletaProcedencia: [] };
    ['dni', 'certificado', 'boletaProcedencia'].forEach(renderListaArchivosCC);

    // Boleta de Procedencia: solo aplica a Traslado (con o sin convalidación).
    // Si el lead no es traslado, se oculta el campo y se limpia cualquier
    // archivo que hubiera quedado seleccionado de una apertura anterior.
    const tipoIngreso = String(obtenerCampo(state.lead, COLUMNAS.MODALIDAD_INGRESO) || '').toLowerCase();
    const esTraslado = tipoIngreso.indexOf('con conva') !== -1 || tipoIngreso.indexOf('sin conva') !== -1;
    const bloqueBoletaProc = document.getElementById('ccBloqueBoletaProcedencia');
    if (bloqueBoletaProc) bloqueBoletaProc.style.display = esTraslado ? '' : 'none';
    if (!esTraslado) ccArchivos.boletaProcedencia = [];

    // DNI: si el lead no lo tiene registrado, se pide acá mismo — es el dato
    // que arma el nombre de la carpeta del alumno en Drive (ver solicitarCC
    // en el backend); sin él la carpeta se crea como "SIN-DNI".
    const dniActual = String(obtenerCampo(state.lead, COLUMNAS.DNI) || '').trim();
    const bloqueDniFaltante = document.getElementById('ccBloqueDniFaltante');
    const dniInput = document.getElementById('ccDniInput');
    if (bloqueDniFaltante) bloqueDniFaltante.style.display = dniActual ? 'none' : 'block';
    if (dniInput) dniInput.value = '';

    document.getElementById('ccNuevoCorreoInput').value = '';
    document.getElementById('ccSolicitudMsg').textContent = '';
    renderCorreosCCLista();
    document.getElementById('solicitudCCModal').classList.add('show');
}

function renderCorreosCCLista() {
    const cont = document.getElementById('ccCorreosLista');
    if (!cont) return;
    if (ccCorreosAdicionales.length === 0) {
        cont.innerHTML = '<span style="font-size:12px; color:#999;">Sin correos adicionales agregados.</span>';
        return;
    }
    cont.innerHTML = ccCorreosAdicionales.map((correo, i) => `
        <div style="display:flex; align-items:center; justify-content:space-between; background:#f3f8ff; border:1px solid #90caf9; border-radius:6px; padding:6px 10px; font-size:13px;">
            <span>${escapeHtml(correo)}</span>
            <span class="material-symbols-outlined" data-quitar-correo="${i}" style="cursor:pointer; font-size:16px; color:#d32f2f;">close</span>
        </div>
    `).join('');
}

function leerArchivoBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
        reader.readAsDataURL(file);
    });
}

// Devuelve la lista de archivos de un campo ya leídos en base64. La
// conversión a PDF (y, para DNI con 2 archivos, la unión en una sola hoja
// en horizontal) la hace el backend en solicitarCC.
async function armarArchivosCC(campo) {
    const files = ccArchivos[campo];
    if (!files || files.length === 0) return [];
    return Promise.all(files.map(async (file) => ({
        nombre: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64: await leerArchivoBase64(file)
    })));
}

async function enviarSolicitudCC() {
    const msgEl = document.getElementById('ccSolicitudMsg');
    const btn = document.getElementById('ccSolicitarBtn');
    const user = getCurrentUser();
    const id = obtenerCampo(state.lead, COLUMNAS.ID_PROMETEO);
    const dniInput = document.getElementById('ccDniInput');
    // Si el lead no tenía DNI registrado, se usa el que se acaba de ingresar
    // en el aviso del modal (ccBloqueDniFaltante) — es el dato que arma el
    // nombre de la carpeta del alumno en Drive.
    const dni = String(obtenerCampo(state.lead, COLUMNAS.DNI) || '').trim() || (dniInput?.value || '').trim();
    const nombreCompleto = obtenerCampo(state.lead, COLUMNAS.NOMBRES) || '';

    if (!dni) {
        msgEl.style.color = '#d32f2f';
        msgEl.textContent = 'Ingresa el N° de DNI del alumno para poder solicitar las Condiciones Comerciales.';
        dniInput?.focus();
        return;
    }
    if (dniInput && dniInput.value.trim() && !/^\d{8}$/.test(dni)) {
        msgEl.style.color = '#d32f2f';
        msgEl.textContent = 'El DNI debe tener 8 dígitos.';
        dniInput.focus();
        return;
    }

    btn.disabled = true;
    msgEl.style.color = '#666';
    msgEl.textContent = 'Enviando solicitud...';

    try {
        const [dniArchivos, certificadoArchivos, boletaProcedenciaArchivos] = await Promise.all([
            armarArchivosCC('dni'),
            armarArchivosCC('certificado'),
            armarArchivosCC('boletaProcedencia')
        ]);

        const result = await callAPI('solicitarCC', {
            idPrometeo: id,
            campana: state.campana,
            dni: dni,
            nombreCompleto: nombreCompleto,
            modalidadIngreso: obtenerCampo(state.lead, COLUMNAS.MODALIDAD_INGRESO) || '',
            asesorEmail: user.email,
            asesorNombre: user.nombre,
            correosAdicionales: ccCorreosAdicionales,
            archivos: {
                dni: dniArchivos,
                certificado: certificadoArchivos[0] || null,
                boletaProcedencia: boletaProcedenciaArchivos[0] || null
            }
        });

        if (result.success) {
            state.solicitudCC = {
                ID_SOLICITUD: result.idSolicitud,
                STATUS: 'PENDIENTE',
                FECHA_SOLICITUD: new Date().toISOString()
            };
            document.getElementById('solicitudCCModal').classList.remove('show');
            Object.assign(state.lead, capturarEdicionesTemporal());
            renderVista1();
        } else {
            msgEl.style.color = '#d32f2f';
            msgEl.textContent = 'Error: ' + (result?.error || 'No se pudo enviar la solicitud');
        }
    } catch (e) {
        msgEl.style.color = '#d32f2f';
        msgEl.textContent = 'Error: ' + e.message;
    } finally {
        btn.disabled = false;
    }
}

async function cancelarSolicitudCC() {
    if (!state.solicitudCC || !confirm('¿Confirmas cancelar tu solicitud de Condiciones Comerciales?')) return;
    try {
        const result = await callAPI('cancelarSolicitudCC', { id: state.solicitudCC.ID_SOLICITUD });
        if (result.success) {
            state.solicitudCC = null;
            Object.assign(state.lead, capturarEdicionesTemporal());
            renderVista1();
        } else {
            alert('Error: ' + (result?.error || 'Error desconocido'));
        }
    } catch (e) {
        alert('Error de conexión: ' + e.message);
    }
}

// ===== GUARDAR FICHA =====
async function guardarFicha(idPrometeo) {
    const user = getCurrentUser();

    if (!esRolSupervisorOAdmision(user.rol) && state.solicitudPendiente && state.solicitudPendiente.STATUS === 'PENDIENTE') {
        alert('No puedes editar la ficha mientras tengas una solicitud pendiente.');
        return;
    }

    const data = {};
    const getVal = id => { const el = document.getElementById(id); return el ? el.value : undefined; };

    if (getVal('selectTipoAlumno') !== undefined) data[COLUMNAS.TIPO_ALUMNO] = getVal('selectTipoAlumno');
    if (getVal('selectCuotas') !== undefined) data[COLUMNAS.NUMERO_CUOTAS] = getVal('selectCuotas');
    if (getVal('selectMetodoPago') !== undefined) data[COLUMNAS.METODO_PAGO] = getVal('selectMetodoPago');
    if (getVal('selectDescuento') !== undefined) data[COLUMNAS.DESCUENTO_PRECIOS] = getVal('selectDescuento');
    if (getVal('selectRindeExamenSuficiencia') !== undefined) data[COLUMNAS.RINDE_EXAMEN_SUFICIENCIA] = getVal('selectRindeExamenSuficiencia');

    if (getVal('selectBoletaBeneficio') !== undefined) {
        const raw = getVal('selectBoletaBeneficio');
        const [boletaBase, beca, boletaConBeca] = raw.includes('||') ? raw.split('||') : [raw, '', ''];
        data[COLUMNAS.BOLETA] = boletaBase;
        data[COLUMNAS.BENEFICIO] = beca;
        data[COLUMNAS.BOLETA_CON_BECA] = boletaConBeca;
    }

    if (getVal('selectBeneficioAdicional') !== undefined) {
        data[COLUMNAS.BENEFICIO_ADICIONAL] = getVal('selectBeneficioAdicional');
    }
    if (getVal('selectBeneficioEnganche') !== undefined) {
        data[COLUMNAS.BENEFICIO_ENGANCHE] = getVal('selectBeneficioEnganche').split('||')[0];
    }

    const tipoInstSel = getVal('selectTipoInstitucion');
    if (tipoInstSel !== undefined) data[COLUMNAS.TIPO_INSTITUCION_PROCEDENCIA] = tipoInstSel;
    if (getVal('selectInstitucion') !== undefined) {
        data[COLUMNAS.INSTITUCION_PROCEDENCIA] = tipoInstSel ? getVal('selectInstitucion').trim().toUpperCase() : '';
    }
    if (getVal('selectCarreraProcedencia') !== undefined) data[COLUMNAS.CARRERA_PROCEDENCIA] = getVal('selectCarreraProcedencia').trim().toUpperCase();
    if (getVal('inputBoletaProcedencia') !== undefined) data[COLUMNAS.BOLETA_PROCEDENCIA] = getVal('inputBoletaProcedencia');
    if (getVal('selectCicloQuedo') !== undefined) data[COLUMNAS.CICLO_QUEDO] = getVal('selectCicloQuedo');
    if (getVal('selectTiempoOfrecido') !== undefined) data[COLUMNAS.TIEMPO_OFRECIDO] = getVal('selectTiempoOfrecido');

    if (state.ultimoCalculo.total !== undefined) {
        data[COLUMNAS.BOLETA_FINAL] = state.ultimoCalculo.total;
        data['DESCUENTO_MATRICULA'] = state.ultimoCalculo.descuento;
        data['MATRICULA_FINAL'] = state.ultimoCalculo.matricula;
        data['DESCUENTO_ADMISION'] = state.ultimoCalculo.descuento;
        data['ADMISION_FINAL'] = state.ultimoCalculo.admision;
    }

    data[COLUMNAS.FECHA_ULT_MODIFICACION] = new Date().toISOString();

    const asesorPropietario = esRolSupervisorOAdmision(user.rol)
        ? (state.lead[COLUMNAS.ASESOR_EMAIL] || user.email)
        : user.email;

    mostrarOverlay(true);
    try {
        const result = await callAPI('saveBottom', {
            idPrometeo: idPrometeo,
            campana: state.campana,
            data: data,
            asesorEmail: asesorPropietario
        });

        if (result.success) {
            Object.assign(state.lead, data);
            sincronizarCache();
            document.getElementById('fichaGuardadoMsg').innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">check_circle</span> Guardado correctamente';
            renderVista1();
        } else {
            alert('Error al guardar: ' + (result?.error || 'Error desconocido'));
        }
    } catch (e) {
        alert('Error de conexión: ' + e.message);
    } finally {
        mostrarOverlay(false);
    }
}

// ===== VISTA 2: PERFILAMIENTO =====
function renderVista2() {
    const container = document.getElementById('vista2Content');
    if (!container || !state.lead) return;

    const lead = state.lead;
    const user = getCurrentUser();
    const esAdmin = esRolSupervisorOAdmision(user.rol);
    const id = obtenerCampo(lead, COLUMNAS.ID_PROMETEO) || '---';

    const status = lead[COLUMNAS.STATUS_GESTION] || '';
    const esPP = status === STATUS.PP_VIVA || status === STATUS.PP_MUERTA;
    const esPagoCompleto = status === STATUS.PAGO_COMPLETO;
    const esPagoFraccionado = status === STATUS.PAGO_FRACCIONADO;

    let statusHTML = '';
    if (esPP) {
        const fecha = formatearFecha(lead[COLUMNAS.FECHA_COMPROMISO_PAGO]) || 'No registrada';
        statusHTML += `<p><strong>Fecha de Promesa de Pago:</strong> ${fecha}</p>`;
    } else if (esPagoCompleto) {
        const fecha = formatearFecha(lead[COLUMNAS.FECHA_PAGO_COMPLETO]) || 'No registrada';
        statusHTML += `<p><strong>Fecha de pago:</strong> ${fecha}</p>`;
    } else if (esPagoFraccionado) {
        const fechaPago = formatearFecha(lead[COLUMNAS.FECHA_PAGO]) || 'No registrada';
        const fechaPromesa = formatearFecha(lead[COLUMNAS.FECHA_PROMESA_PAGO]) || 'No registrada';
        statusHTML += `<p><strong>Fecha de pago:</strong> ${fechaPago}</p>`;
        statusHTML += `<p><strong>Fecha de Promesa de Pago:</strong> ${fechaPromesa}</p>`;
    }

    const bloqueado = !esAdmin && state.solicitudPendiente && state.solicitudPendiente.STATUS === 'PENDIENTE';

    const campos = [
        { id: 'inputPorQueEligio', label: '¿Por qué eligió la carrera?', value: lead[COLUMNAS.POR_QUE_ELIGIO_CARRERA] || '' },
        { id: 'inputQueBusca', label: '¿Qué busca en una universidad?', value: lead[COLUMNAS.QUE_BUSCA_UNIVERSIDAD] || '' },
        { id: 'inputQuienFinancia', label: '¿Quién financiará la carrera?', value: lead[COLUMNAS.QUIEN_FINANCIARA] || '' },
        { id: 'inputQueLeFalta', label: '¿Qué le falta para tomar una decisión?', value: lead[COLUMNAS.QUE_LE_FALTA] || '' },
        { id: 'inputOtrasOpciones', label: '¿Cuáles son sus otras opciones?', value: lead[COLUMNAS.OTRAS_OPCIONES] || '' }
    ];

    // Comentarios pasa a ocupar el ancho completo (igual que Acciones Definidas);
    // el espacio normal que dejaba libre lo toma el bloque de Dolor/Necesidad.
    const camposFinales = [
        { id: 'inputComentariosPerfil', label: 'Comentarios', value: lead[COLUMNAS.COMENTARIOS_PERFIL] || '' }
    ];

    if (esAdmin) {
        camposFinales.push({ id: 'inputAccionesDefinidas', label: 'Acciones Definidas', value: lead[COLUMNAS.ACCIONES_DEFINIDAS] || '' });
    }

    let html = `
        ${statusHTML ? `<div style="background:white; padding:24px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.05); margin-bottom:16px;">
            ${statusHTML}
        </div>` : ''}

        <div style="background:white; padding:24px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.05); margin-bottom:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:8px;">
                <h3 style="color:var(--color-accent); font-size:18px; margin:0;">Perfilamiento</h3>
                <span style="color:#777; font-size:13px;">Última fecha bottom: ${formatearFecha(lead[COLUMNAS.FECHA_ULT_MODIFICACION])}</span>
            </div>
            <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:16px;">
    `;

    campos.forEach(c => {
        html += `
            <div>
                <label style="font-size:13px; font-weight:600; color:#555; display:block; margin-bottom:4px;">${c.label}</label>
                <textarea id="${c.id}" class="campo-editable-input" style="width:100%; min-height:60px; padding:10px 12px; border:1px solid var(--color-border); border-radius:6px; font-size:14px; font-family:inherit; resize:vertical;" ${bloqueado ? 'disabled' : ''}>${escapeHtml(c.value)}</textarea>
            </div>
        `;
    });

    html += dolorNecesidadHTML(lead, bloqueado);

    camposFinales.forEach(c => {
        html += `
            <div style="grid-column: 1 / -1;">
                <label style="font-size:13px; font-weight:600; color:#555; display:block; margin-bottom:4px;">${c.label}</label>
                <textarea id="${c.id}" class="campo-editable-input" style="width:100%; min-height:60px; padding:10px 12px; border:1px solid var(--color-border); border-radius:6px; font-size:14px; font-family:inherit; resize:vertical;" ${bloqueado ? 'disabled' : ''}>${escapeHtml(c.value)}</textarea>
            </div>
        `;
    });

    html += `
            </div>
            <button class="btn-guardar" id="btnGuardarPerfil" ${bloqueado ? 'disabled' : ''}>
                <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">save</span> Guardar
            </button>
            <span id="perfilGuardadoMsg" style="margin-left:12px; font-size:13px; color:#1b5e20;"></span>
        </div>
    `;

    container.innerHTML = html;

    document.getElementById('btnGuardarPerfil')?.addEventListener('click', () => guardarPerfilamiento(id));
    document.getElementById('selectDolorNecesidad')?.addEventListener('change', onCambioDolorNecesidad);
}

function dolorNecesidadHTML(lead, bloqueado) {
    const valorActual = lead[COLUMNAS.DOLOR_NECESIDAD] || '';
    const catalogo = state.catalogoDoloresNecesidades || [];
    const coincide = catalogo.some(d => String(d.nombre) === String(valorActual));

    const opciones = catalogo.map(d =>
        `<option value="${escapeHtml(d.nombre)}" ${String(d.nombre) === String(valorActual) ? 'selected' : ''}>${escapeHtml(d.nombre)}</option>`
    ).join('');

    // Si el valor guardado ya no calza con ningún ítem del catálogo (o todavía
    // no hay nada guardado), se agrega un placeholder para no inducir a error,
    // igual que se hace en selectConValorHTML.
    let placeholder = '';
    if (valorActual && !coincide) {
        placeholder = `<option value="${escapeHtml(valorActual)}" selected>${escapeHtml(valorActual)}</option>`;
    } else if (!valorActual) {
        placeholder = '<option value="" selected disabled hidden>-- Seleccionar --</option>';
    }

    const itemActual = catalogo.find(d => String(d.nombre) === String(valorActual));
    const descripcionActual = itemActual ? (itemActual.descripcion || '') : '';

    return `
        <div>
            <label style="font-size:13px; font-weight:600; color:#555; display:block; margin-bottom:4px;">Dolor / Necesidad</label>
            <select id="selectDolorNecesidad" class="campo-editable-select" ${bloqueado ? 'disabled' : ''}>
                ${placeholder}${opciones}<option value="__nuevo__">+ Agregar nueva...</option>
            </select>
            <div id="dolorDescripcionDisplay" style="margin-top:6px; font-size:12px; color:#777; ${descripcionActual ? '' : 'display:none;'}">${escapeHtml(descripcionActual)}</div>
            <div id="dolorNuevoWrap" style="margin-top:8px; display:none;">
                <input type="text" id="inputDolorNuevoNombre" class="campo-editable-input"
                       placeholder="Nombre (máx. 5 palabras)" style="width:100%; margin-bottom:6px;" ${bloqueado ? 'disabled' : ''}>
                <textarea id="inputDolorNuevaDescripcion" class="campo-editable-input" placeholder="Descripción"
                          style="width:100%; min-height:50px; padding:8px 10px; border:1px solid var(--color-border); border-radius:6px; font-size:13px; font-family:inherit; resize:vertical;" ${bloqueado ? 'disabled' : ''}></textarea>
                <span id="dolorNuevoError" style="color:#c62828; font-size:12px; display:none;"></span>
            </div>
        </div>
    `;
}

function onCambioDolorNecesidad() {
    const select = document.getElementById('selectDolorNecesidad');
    const wrapNuevo = document.getElementById('dolorNuevoWrap');
    const display = document.getElementById('dolorDescripcionDisplay');
    if (!select || !wrapNuevo || !display) return;

    const errorEl = document.getElementById('dolorNuevoError');
    if (errorEl) errorEl.style.display = 'none';

    if (select.value === '__nuevo__') {
        wrapNuevo.style.display = 'block';
        display.style.display = 'none';
    } else {
        wrapNuevo.style.display = 'none';
        const item = (state.catalogoDoloresNecesidades || []).find(d => String(d.nombre) === select.value);
        display.textContent = item ? (item.descripcion || '') : '';
        display.style.display = (item && item.descripcion) ? 'block' : 'none';
    }
}

async function guardarPerfilamiento(idPrometeo) {
    const getVal = id => { const el = document.getElementById(id); return el ? el.value : ''; };

    // Dolor / Necesidad: si está en modo "agregar nueva", valida nombre (máx. 5
    // palabras) y descripción antes de armar el payload; si no, usa el valor
    // ya elegido del catálogo tal cual.
    const selectDolor = document.getElementById('selectDolorNecesidad');
    let dolorNecesidadValor = '';
    let dolorDescripcionNueva = '';

    if (selectDolor) {
        if (selectDolor.value === '__nuevo__') {
            dolorNecesidadValor = getVal('inputDolorNuevoNombre').trim();
            dolorDescripcionNueva = getVal('inputDolorNuevaDescripcion').trim();
            const errorEl = document.getElementById('dolorNuevoError');

            const mostrarErrorDolor = (msg) => {
                if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'inline'; }
            };

            if (!dolorNecesidadValor || !dolorDescripcionNueva) {
                mostrarErrorDolor('Completa el nombre y la descripción del nuevo Dolor/Necesidad.');
                return;
            }
            if (dolorNecesidadValor.split(/\s+/).filter(Boolean).length > 5) {
                mostrarErrorDolor('El nombre debe tener máximo 5 palabras.');
                return;
            }
        } else {
            dolorNecesidadValor = selectDolor.value;
        }
    }

    const data = {
        [COLUMNAS.POR_QUE_ELIGIO_CARRERA]: getVal('inputPorQueEligio'),
        [COLUMNAS.QUE_BUSCA_UNIVERSIDAD]: getVal('inputQueBusca'),
        [COLUMNAS.QUIEN_FINANCIARA]: getVal('inputQuienFinancia'),
        [COLUMNAS.QUE_LE_FALTA]: getVal('inputQueLeFalta'),
        [COLUMNAS.OTRAS_OPCIONES]: getVal('inputOtrasOpciones'),
        [COLUMNAS.COMENTARIOS_PERFIL]: getVal('inputComentariosPerfil'),
        [COLUMNAS.DOLOR_NECESIDAD]: dolorNecesidadValor,
        [COLUMNAS.FECHA_ULT_MODIFICACION]: new Date().toISOString()
    };
    // Campo transitorio: solo viaja al backend para crear el ítem nuevo en el
    // catálogo DOLOR; no se guarda como columna en bottom{campaña}.
    if (dolorDescripcionNueva) data['DOLOR_DESCRIPCION_NUEVA'] = dolorDescripcionNueva;

    const acciones = document.getElementById('inputAccionesDefinidas');
    if (acciones) data[COLUMNAS.ACCIONES_DEFINIDAS] = acciones.value;

    const user = getCurrentUser();
    const asesorPropietario = esRolSupervisorOAdmision(user.rol)
        ? (state.lead[COLUMNAS.ASESOR_EMAIL] || user.email)
        : user.email;

    mostrarOverlay(true);
    try {
        const result = await callAPI('saveBottom', {
            idPrometeo: idPrometeo,
            campana: state.campana,
            data: data,
            asesorEmail: asesorPropietario
        });

        if (result.success) {
            if (dolorDescripcionNueva) await actualizarCatalogoDolor();
            Object.assign(state.lead, data);
            sincronizarCache();
            document.getElementById('perfilGuardadoMsg').innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">check_circle</span> Guardado correctamente';
            renderVista2();
        } else {
            alert('Error al guardar: ' + (result?.error || 'Error desconocido'));
        }
    } catch (e) {
        alert('Error de conexión: ' + e.message);
    } finally {
        mostrarOverlay(false);
    }
}

// ===== HISTORIAL =====
function renderHistorial() {
    const container = document.getElementById('historialContent');
    if (!container || !state.lead) return;

    const user = getCurrentUser();
    state.historialSnapshots = [];

    if (esRolSupervisorOAdmision(user.rol) && state.historialAsesores) {
        if (state.historialAsesores.length === 0) {
            container.innerHTML = '<p style="padding:20px;color:#888;">Ningún asesor ha registrado gestión sobre este lead todavía.</p>';
            return;
        }

        let html = '';
        state.historialAsesores
            .slice()
            .sort((a, b) => new Date(b.FECHA_ULT_MODIFICACION || 0) - new Date(a.FECHA_ULT_MODIFICACION || 0))
            .forEach(fila => {
                const items = parsearHistorial(fila.COMENTARIOS_HISTORIAL);
                html += `
                    <div style="background:white; padding:20px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.05); margin-bottom:16px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #eee; padding-bottom:8px;">
                            <strong style="color:var(--color-primary);">
                                <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">person</span>
                                ${escapeHtml(fila.ASESOR_NOMBRE || fila.ASESOR_EMAIL || 'Asesor desconocido')}
                            </strong>
                            <span style="font-size:12px;color:#888;">Última actualización: ${escapeHtml(formatearFechaHora(fila.FECHA_ULT_MODIFICACION))}</span>
                        </div>
                        ${renderItemsHistorial(items, fila.ASESOR_EMAIL)}
                    </div>
                `;
            });
        container.innerHTML = html;
        return;
    }

    const items = parsearHistorial(state.lead[COLUMNAS.COMENTARIOS_HISTORIAL]);
    const asesorEmail = state.lead[COLUMNAS.ASESOR_EMAIL] || user.email;

    container.innerHTML = `
        <div style="background:white; padding:24px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.05);">
            ${renderItemsHistorial(items, asesorEmail)}
            <div class="comentarios-section">
                <h4>Agregar comentario</h4>
                <div class="comentario-nuevo">
                    <input type="text" id="nuevoComentario" placeholder="Escribe un comentario...">
                    <button id="btnAgregarComentario">Enviar</button>
                </div>
            </div>
        </div>
    `;

    document.getElementById('btnAgregarComentario')?.addEventListener('click', agregarComentario);
    document.getElementById('nuevoComentario')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') agregarComentario();
    });
}

function renderItemsHistorial(items, asesorEmail) {
    if (!items || items.length === 0) {
        return '<p style="color:#888; font-size:14px;">Sin interacciones registradas.</p>';
    }

    // Más reciente primero. El backend agrega cada entrada al final del array
    // (orden cronológico ascendente), así que acá se invierte para mostrar.
    const itemsOrdenados = items
        .slice()
        .sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));

    return itemsOrdenados.map(it => {
        if (it.tipo === 'perfil_snapshot') {
            const idx = state.historialSnapshots.length;
            state.historialSnapshots.push({ datos: it.datos, usuario: it.usuario, fecha: it.fecha, asesorEmail: asesorEmail });
            return `
                <div onclick="window.abrirSnapshot(${idx})"
                     style="cursor:pointer; background:#f3f6ff; border:1px solid #c5cae9; border-radius:6px; padding:10px 14px; margin-bottom:6px; font-size:14px; color:var(--color-primary);">
                    <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">edit_note</span>
                    Actualización de perfilamiento — <strong>${escapeHtml(it.usuario)}</strong>
                    <span style="color:#888; font-size:12px;"> · ${formatearFechaHora(it.fecha)}</span>
                    <span style="float:right; color:var(--color-primary); font-size:12px;">Ver detalle →</span>
                </div>
            `;
        }
        return `
            <div style="padding:8px 4px; font-size:14px; color:#333; border-bottom:1px solid #f0f0f0;">
                <span style="color:#888;">[${formatearFechaHora(it.fecha)}]</span>
                <strong>${escapeHtml(it.usuario)}</strong>: ${escapeHtml(it.texto)}
            </div>
        `;
    }).join('');
}

function parsearHistorial(raw) {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

// ===== SNAPSHOT MODAL =====
window.abrirSnapshot = function(idx) {
    const item = state.historialSnapshots[idx];
    if (!item) return;

    const user = getCurrentUser();
    const camposVisibles = esRolSupervisorOAdmision(user.rol)
        ? ['POR_QUE_ELIGIO_CARRERA', 'QUE_BUSCA_UNIVERSIDAD', 'QUIEN_FINANCIARA', 'QUE_LE_FALTA', 'OTRAS_OPCIONES', 'DOLOR_NECESIDAD', 'COMENTARIOS_PERFIL', 'ACCIONES_DEFINIDAS']
        : ['POR_QUE_ELIGIO_CARRERA', 'QUE_BUSCA_UNIVERSIDAD', 'QUIEN_FINANCIARA', 'QUE_LE_FALTA', 'OTRAS_OPCIONES', 'DOLOR_NECESIDAD', 'COMENTARIOS_PERFIL'];

    const labels = {
        POR_QUE_ELIGIO_CARRERA: '¿Por qué eligió la carrera?',
        QUE_BUSCA_UNIVERSIDAD: '¿Qué busca en una universidad?',
        QUIEN_FINANCIARA: '¿Quién financiará la carrera?',
        QUE_LE_FALTA: '¿Qué le falta para tomar una decisión?',
        OTRAS_OPCIONES: '¿Cuáles son sus otras opciones?',
        DOLOR_NECESIDAD: 'Dolor / Necesidad',
        COMENTARIOS_PERFIL: 'Comentarios',
        ACCIONES_DEFINIDAS: 'Acciones Definidas'
    };

    const preguntas = camposVisibles.map(c =>
        `<p style="margin:6px 0;"><strong>${escapeHtml(labels[c])}</strong><br>${escapeHtml(item.datos[c] || '-')}</p>`
    ).join('');

    document.getElementById('snapshotFecha').textContent = `${escapeHtml(item.usuario)} — ${formatearFechaHora(item.fecha)}`;
    document.getElementById('snapshotContenido').innerHTML = preguntas;
    document.getElementById('snapshotRestaurarBtn').onclick = () => restaurarSnapshot(idx);
    document.getElementById('snapshotModal').classList.add('show');
};

async function restaurarSnapshot(idx) {
    const item = state.historialSnapshots[idx];
    if (!item || !confirm('¿Confirmas restablecer esta versión? Se guardará como el estado actual.')) return;

    const id = obtenerCampo(state.lead, COLUMNAS.ID_PROMETEO);
    const user = getCurrentUser();

    const data = Object.assign({}, item.datos, { [COLUMNAS.FECHA_ULT_MODIFICACION]: new Date().toISOString() });
    if (!esRolSupervisorOAdmision(user.rol)) delete data.ACCIONES_DEFINIDAS;

    const asesorPropietario = item.asesorEmail || user.email;

    mostrarOverlay(true);
    try {
        const result = await callAPI('saveBottom', {
            idPrometeo: id,
            campana: state.campana,
            data: data,
            asesorEmail: asesorPropietario
        });

        if (result.success) {
            document.getElementById('snapshotModal').classList.remove('show');
            await cargarLead();
            alert('Versión restablecida correctamente.');
        } else {
            alert('Error al restablecer: ' + (result?.error || 'Error desconocido'));
        }
    } catch (e) {
        alert('Error de conexión: ' + e.message);
    } finally {
        mostrarOverlay(false);
    }
}

// ===== COMENTARIOS =====
async function agregarComentario() {
    const input = document.getElementById('nuevoComentario');
    const texto = input?.value.trim();
    if (!texto) return;

    const user = getCurrentUser();
    const id = obtenerCampo(state.lead, COLUMNAS.ID_PROMETEO);

    mostrarOverlay(true);
    try {
        const result = await callAPI('addComment', {
            id: id,
            campana: state.campana,
            comentario: texto,
            usuario: user.nombre || user.email,
            asesorEmail: user.email
        });

        if (result.success) {
            input.value = '';
            await cargarLead();
        } else {
            alert('Error al agregar comentario: ' + (result?.error || 'Error desconocido'));
        }
    } catch (e) {
        alert('Error de conexión: ' + e.message);
    } finally {
        mostrarOverlay(false);
    }
}

// ===== PAGOS =====
async function cargarPagos() {
    const container = document.getElementById('pagosContent');
    if (!container) return;
    container.innerHTML = '<div class="loading">Cargando historial de pagos...</div>';

    const id = state.lead[COLUMNAS.ID_PROMETEO] || state.lead['ID_PROMETEO'];

    try {
        const result = await callAPI('getLeadPayments', {
            idPrometeo: id,
            campana: state.campana
        });

        if (!result.success || !result.data || result.data.length === 0) {
            container.innerHTML = '<p style="color:#888; padding:20px; background:white; border-radius:8px;">Sin registros de pago financieros para este alumno.</p>';
            return;
        }

        const campos = ['FECHA DE PAGO', 'BOLETA CAMPUS', 'ESCALA FINAL', 'TIPO DE DESCUENTO', 'DETALLE TIPO DE DESCUENTO', 'STATUS DE PAGO FINAL', 'MEDIO DE PAGO'];
        let html = '<div style="overflow-x:auto; background:white; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.05);"><table style="width:100%; border-collapse:collapse; min-width:800px;">';
        html += '<thead><tr style="background:var(--color-primary); color:white; text-align:left;">' + campos.map(c => `<th style="padding:12px 16px; font-size:13px; font-weight:600;">${c}</th>`).join('') + '</tr></thead><tbody>';

        result.data.forEach(p => {
            html += '<tr style="border-bottom:1px solid #eee; font-size:14px; color:#444;">' +
                campos.map(c => `<td style="padding:12px 16px;">${p[c] || p[c.toLowerCase()] || '-'}</td>`).join('') +
                '</tr>';
        });

        html += '</tbody></table></div>';
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = '<p style="color:#d32f2f; padding:20px;">Error al cargar pagos: ' + e.message + '</p>';
    }
}

// ===== SOLICITUD DE ESCALA =====
document.addEventListener('click', async (e) => {
    // Resolver solicitud (admin)
    if (e.target.dataset.resolver) {
        const status = e.target.dataset.resolver;
        const idSol = state.solicitudPendiente?.ID_SOLICITUD;
        if (!idSol) return;
        const confirmMsg = status === 'APROBADO'
            ? '¿Confirmas aprobar esta solicitud? Se aplicará la nueva boleta al lead.'
            : '¿Confirmas rechazar esta solicitud?';
        if (!confirm(confirmMsg)) return;

        const user = getCurrentUser();
        mostrarOverlay(true);
        try {
            const result = await callAPI('resolveSolicitud', {
                id: idSol,
                status: status,
                adminEmail: user.email
            });
            if (result.success) {
                state.solicitudPendiente = null;
                if (status === 'APROBADO') {
                    await cargarLead();
                } else {
                    renderAll();
                }
            } else {
                alert('Error: ' + (result?.error || 'Error desconocido'));
            }
        } catch (err) {
            alert('Error de conexión: ' + err.message);
        } finally {
            mostrarOverlay(false);
        }
    }

    // Solicitar escala menor (asesor)
    if (e.target.id === 'btnSolicitarEscala') {
        const sel = document.getElementById('selectEscalaMenor');
        const msgEl = document.getElementById('solicitudMsg');
        if (!sel || !sel.value) {
            alert('Selecciona una boleta para solicitar.');
            return;
        }

        const [boletaSolicitada, beneficioSolicitado, boletaConBecaSolicitada] = sel.value.split('||');
        const user = getCurrentUser();
        const id = obtenerCampo(state.lead, COLUMNAS.ID_PROMETEO);

        const payload = {
            idPrometeo: id,
            campana: state.campana,
            asesorEmail: user.email,
            asesorNombre: user.nombre,
            boletaActual: obtenerCampo(state.lead, COLUMNAS.BOLETA) || '',
            beneficioActual: obtenerCampo(state.lead, COLUMNAS.BENEFICIO) || '',
            boletaConBecaActual: obtenerCampo(state.lead, COLUMNAS.BOLETA_CON_BECA) || '',
            boletaSolicitada: boletaSolicitada,
            beneficioSolicitado: beneficioSolicitado,
            boletaConBecaSolicitada: boletaConBecaSolicitada
        };

        if (msgEl) msgEl.textContent = 'Enviando...';
        try {
            const result = await callAPI('createSolicitud', payload);
            if (result.success) {
                state.solicitudPendiente = {
                    ID_SOLICITUD: result.idSolicitud,
                    BOLETA_ACTUAL: payload.boletaActual,
                    BOLETA_SOLICITADA: boletaSolicitada,
                    BENEFICIO_SOLICITADO: beneficioSolicitado,
                    ASESOR_NOMBRE: user.nombre,
                    ASESOR_EMAIL: user.email,
                    STATUS: 'PENDIENTE'
                };
                renderVista1();
            } else {
                if (msgEl) msgEl.textContent = '';
                alert('Error: ' + (result?.error || 'Error desconocido'));
            }
        } catch (err) {
            if (msgEl) msgEl.textContent = '';
            alert('Error de conexión: ' + err.message);
        }
    }

    // Cancelar solicitud
    if (e.target.id === 'btnCancelarSolicitud') {
        const idSol = state.solicitudPendiente?.ID_SOLICITUD;
        if (!idSol || !confirm('¿Confirmas cancelar tu solicitud pendiente?')) return;
        try {
            const result = await callAPI('cancelarSolicitud', { id: idSol });
            if (result.success) {
                state.solicitudPendiente = null;
                renderVista1();
            } else {
                alert('Error: ' + (result?.error || 'Error desconocido'));
            }
        } catch (err) {
            alert('Error de conexión: ' + err.message);
        }
    }
});

// ===== UTILITIES =====
function formatearFecha(valor) {
    if (!valor) return '';
    if (typeof valor === 'string') {
        const m = valor.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    }

    const fecha = new Date(valor);
    if (isNaN(fecha.getTime())) return String(valor);
    const dd = String(fecha.getDate()).padStart(2, '0');
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    const yyyy = fecha.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

// Igual que formatearFecha pero con hora:minuto — solo se usa en el Historial,
// donde interesa saber en qué momento exacto del día ocurrió cada interacción.
function formatearFechaHora(valor) {
    if (!valor) return '';
    const fecha = new Date(valor);
    if (isNaN(fecha.getTime())) return String(valor);
    const dd = String(fecha.getDate()).padStart(2, '0');
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    const yyyy = fecha.getFullYear();
    const hh = String(fecha.getHours()).padStart(2, '0');
    const min = String(fecha.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function sincronizarCache() {
    const user = getCurrentUser();
    const id = state.lead[COLUMNAS.ID_PROMETEO];
    cacheSet(CACHE_KEYS.LEAD_SELECTED(id, state.campana), state.lead);
    cacheRemove(CACHE_KEYS.LEAD_DETAIL(id, state.campana, user.email));
    // Invalidar caché del dashboard
    cacheRemove(CACHE_KEYS.LEADS_RAW(user.email, user.rol, state.campana));
}

function mostrarOverlay(show) {
    const el = document.getElementById('overlayGuardando');
    if (el) el.classList.toggle('show', show);
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