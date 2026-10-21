import { API_URL, ROLES, tipoDocumentoPorNumero, etiquetaTipoDocumento, digitosTipoDocumento, COLUMNAS, STATUS, STATUS_LABELS, STATUS_CLASES, CACHE_KEYS, SELECT_OPTIONS, PRECIOS_BASE, esRolSupervisorOAdmision, TIPOS_INSTITUCION_PROCEDENCIA } from '../core/constants.js';

import { getCurrentUser, getSessionToken, cacheGet, cacheSet, cacheRemove, escapeHtml, normalizarTexto, parseNumero, getEspecializacionETU } from '../core/utils.js';

import { Sidebar, notificar } from '../core/components.js';
import { construirDatosCC } from './cc-template.js';
import { buscarDuplicados } from './duplicados-sugeridos.js';
import { prepararArchivosParaEnvio } from './pdf-cliente.js';

const state = {
    lead: null,
    campana: '',
    idPrometeo: '',
    historialAsesores: null,
    solicitudPendiente: null,
    recategorizacionAprobada: null,
    solicitudVerificada: false,
    historialSnapshots: [],
    ultimoCalculo: {},
    catalogoBoletas: [],
    catalogoBeneficios: [],
    catalogoInstitucionesProcedencia: [],
    catalogoCarrerasProcedencia: [],
    catalogoDoloresNecesidades: [],
    catalogoPorQueEligioCarrera: [],
    catalogoQueBuscaUniversidad: [],
    catalogoQuienFinancia: [],
    catalogoQueLeFalta: [],
    catalogoOtrasOpciones: [],
    solicitudCC: null
};

const VALOR_OTRAS_OPCIONES_INSTITUCION = 'Evaluando otras instituciones';

const CAMPOS_SELECT_PERFILAMIENTO = [
    { columna: COLUMNAS.POR_QUE_ELIGIO_CARRERA, label: '¿Por qué eligió la carrera?', selectId: 'selectPorQueEligio', cacheKey: CACHE_KEYS.CATALOGO_POR_QUE_ELIGIO_CARRERA, dataKey: 'porQueEligioCarrera', stateKey: 'catalogoPorQueEligioCarrera', permiteAgregarNuevo: false },
    { columna: COLUMNAS.QUE_BUSCA_UNIVERSIDAD, label: '¿Qué busca en una universidad?', selectId: 'selectQueBusca', cacheKey: CACHE_KEYS.CATALOGO_QUE_BUSCA_UNIVERSIDAD, dataKey: 'queBuscaUniversidad', stateKey: 'catalogoQueBuscaUniversidad', permiteAgregarNuevo: false },
    { columna: COLUMNAS.OTRAS_OPCIONES, label: '¿Cuáles son sus otras opciones?', selectId: 'selectOtrasOpciones', cacheKey: CACHE_KEYS.CATALOGO_OTRAS_OPCIONES, dataKey: 'queOtrasOpciones', stateKey: 'catalogoOtrasOpciones', permiteAgregarNuevo: false },
    { columna: COLUMNAS.QUE_LE_FALTA, label: '¿Qué le falta para tomar una decisión?', selectId: 'selectQueLeFalta', cacheKey: CACHE_KEYS.CATALOGO_QUE_LE_FALTA, dataKey: 'queFaltaParaDecision', stateKey: 'catalogoQueLeFalta', permiteAgregarNuevo: false, permiteMultiple: true },
    { columna: COLUMNAS.QUIEN_FINANCIARA, label: '¿Quién financiará la carrera?', selectId: 'selectQuienFinancia', cacheKey: CACHE_KEYS.CATALOGO_QUIEN_FINANCIARA, dataKey: 'quienFinanciaCarrera', stateKey: 'catalogoQuienFinancia', permiteAgregarNuevo: false },
    { columna: COLUMNAS.DOLOR_NECESIDAD, label: 'Dolor / Necesidad', selectId: 'selectDolorNecesidad', cacheKey: CACHE_KEYS.CATALOGO_DOLOR_NECESIDAD, dataKey: 'doloresNecesidades', stateKey: 'catalogoDoloresNecesidades', permiteAgregarNuevo: true },
];

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

    await cargarCatalogos();
    state.catalogoBoletas = cacheGet(CACHE_KEYS.BOLETAS) || [];
    state.catalogoBeneficios = cacheGet(CACHE_KEYS.BENEFICIOS) || [];
    state.catalogoInstitucionesProcedencia = cacheGet(CACHE_KEYS.INSTITUCIONES_PROCEDENCIA) || [];
    state.catalogoCarrerasProcedencia = cacheGet(CACHE_KEYS.CARRERAS_PROCEDENCIA) || [];
    CAMPOS_SELECT_PERFILAMIENTO.forEach(cfg => {
        state[cfg.stateKey] = cacheGet(cfg.cacheKey) || [];
    });

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
    document.getElementById('ccTipoDocumento').addEventListener('change', actualizarEtiquetasDocumentoCC);
    inicializarInputArchivoCC('dni', true);
    inicializarInputArchivoCC('certificado', false);
    inicializarInputArchivoCC('boletaProcedencia', false);
    document.getElementById('ccAgregarCorreoBtn').addEventListener('click', () => {
        const input = document.getElementById('ccNuevoCorreoInput');
        const correo = input.value.trim();
        if (!correo) return;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) { notificar('Correo inválido', 'err'); return; }
        if (ccCorreosAdicionales.includes(correo)) { notificar('Ese correo ya fue agregado', 'err'); return; }
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

    document.getElementById('btnAsignarAsesor').addEventListener('click', abrirModalAsignarAsesor);

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

async function cargarCatalogos() {
    try {
        const result = await callAPI('getCatalogos');
        if (result.success) {
            cacheSet(CACHE_KEYS.BOLETAS, result.data?.boletas || []);
            cacheSet(CACHE_KEYS.BENEFICIOS, result.data?.beneficios || []);
            cacheSet(CACHE_KEYS.INSTITUCIONES_PROCEDENCIA, result.data?.institucionesProcedencia || []);
            cacheSet(CACHE_KEYS.CARRERAS_PROCEDENCIA, result.data?.carrerasProcedencia || []);
            CAMPOS_SELECT_PERFILAMIENTO.forEach(cfg => {
                cacheSet(cfg.cacheKey, result.data?.[cfg.dataKey] || []);
            });
        }
    } catch (e) {
        console.error('Error cargando catálogos:', e);
    }
}

function determinarCasoIngreso(lead) {
    const tipoIngresoLower = String(obtenerCampo(lead, COLUMNAS.MODALIDAD_INGRESO) || '').trim().toLowerCase();
    if (tipoIngresoLower.indexOf('sin conva') !== -1) return 3;
    if (tipoIngresoLower.indexOf('con conva') !== -1) return 2;
    return 1;
}

const TIEMPO_OFRECIDO_MAS2 = '2 años';

function esModalidadMas2(lead) {
    return String(obtenerCampo(lead, COLUMNAS.MODALIDAD_INGRESO) || '').indexOf('+2') !== -1;
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

async function actualizarCatalogosPerfilamiento() {
    try {
        const result = await callAPI('getCatalogos');
        if (result.success) {
            CAMPOS_SELECT_PERFILAMIENTO.forEach(cfg => {
                const datos = result.data?.[cfg.dataKey] || [];
                cacheSet(cfg.cacheKey, datos);
                state[cfg.stateKey] = datos;
            });
        }
    } catch (e) {
        console.error('Error actualizando catálogos de perfilamiento:', e);
    }
}

async function cargarLead() {
    const user = getCurrentUser();

    const cachedSelected = cacheGet(CACHE_KEYS.LEAD_SELECTED(state.idPrometeo, state.campana));

    if (cachedSelected) {
        state.lead = cachedSelected;
        state.historialAsesores = esRolSupervisorOAdmision(user.rol) ? state.historialAsesores : null;
        renderAll();
        cargarSolicitudPendiente();
        cargarSolicitudCC();
        if (esLeadNoOrdinario(state.lead)) actualizarCatalogoProcedencia().then(() => renderVista1());
    }

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

            cacheSet(CACHE_KEYS.LEAD_DETAIL(state.idPrometeo, state.campana, user.email), state.lead);
            cacheSet(CACHE_KEYS.LEAD_SELECTED(state.idPrometeo, state.campana), state.lead);

            renderAll();
            cargarSolicitudPendiente();
            cargarSolicitudCC();
            if (esLeadNoOrdinario(state.lead)) actualizarCatalogoProcedencia().then(() => renderVista1());
        } else if (!cachedSelected) {
            alert('Error al cargar datos del lead: ' + (result?.error || 'No encontrado'));
            window.location.href = 'dashboard.html?view=bottomline';
        }
    } catch (e) {
        if (!cachedSelected) {
            alert('Error de conexión: ' + e.message);
            window.location.href = 'dashboard.html?view=bottomline';
        }
    }
}

async function cargarSolicitudPendiente() {
    try {
        const result = await callAPI('getSolicitudPendiente', {
            idPrometeo: state.idPrometeo,
            campana: state.campana
        });
        state.solicitudPendiente = (result && result.success) ? (result.data || null) : null;
        state.recategorizacionAprobada = (result && result.success) ? (result.aprobada || null) : null;
        state.solicitudVerificada = true;
        renderAll();
    } catch (e) {
        console.error('Error cargando solicitud:', e);
        state.solicitudVerificada = true;
        renderAll();
    }
}

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
    const esAdminVista = esRolSupervisorOAdmision(user.rol);
    const asesorProvisional = esAdminVista ? (lead.ASESOR_PROVISIONAL || '') : '';
    const etiquetaProvisional = document.getElementById('leadAsesorProvisional');
    if (esAdminVista) {
        document.getElementById('leadAsesor').textContent = asesor;
        asesorWrap.style.display = '';
    } else {
        asesorWrap.style.display = 'none';
    }
    etiquetaProvisional.style.display = asesorProvisional ? '' : 'none';
    etiquetaProvisional.textContent = asesorProvisional ? `Asignado hoy a ${asesorProvisional} (provisional)` : '';
    document.getElementById('btnAsignarAsesor').style.display = puedeAsignarAsesor() ? '' : 'none';

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

function renderVista1() {
    const container = document.getElementById('vista1Content');
    if (!container || !state.lead) return;

    const lead = state.lead;
    const id = obtenerCampo(lead, COLUMNAS.ID_PROMETEO) || '---';
    const colegio = obtenerCampo(lead, COLUMNAS.COLEGIO, 'NOMBRE DEL COLEGIO', 'Nombre del colegio') || '-';
    const carrera = obtenerCampo(lead, COLUMNAS.CARRERA, COLUMNAS.PROGRAMA) || '-';
    const modalidad = obtenerCampo(lead, COLUMNAS.MODALIDAD) || '-';
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
    const tipoAlumnoActual = obtenerCampo(lead, COLUMNAS.TIPO_ALUMNO) || 'ALUMNO REGULAR';
    const cuotasActual = obtenerCampo(lead, COLUMNAS.NUMERO_CUOTAS) || '5 cuotas';
    const metodoPagoActual = obtenerCampo(lead, COLUMNAS.METODO_PAGO) || '';
    const rindeExamenActual = obtenerCampo(lead, COLUMNAS.RINDE_EXAMEN_SUFICIENCIA) || 'NO';
    const mostrarRindeExamen = (caso === 1 && normalizarTexto(modalidad) === 'remoto') || caso === 3;
    const boletaColegioRaw = obtenerCampo(lead, COLUMNAS.BOLETA_COLEGIO);
    const boletaColegio = (boletaColegioRaw === null || boletaColegioRaw === '') ? '0' : boletaColegioRaw;
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
    if (String(boletaActual).trim() !== '' && !opcionesBoletaBeneficio.some(o => o.value === valorComboActual)) {
        const etiquetaBase = beneficioActual ? `S/ ${boletaActual} - S/ ${boletaConBecaActual} ${beneficioActual}` : `S/ ${boletaActual} - Sin beca`;
        opcionesBoletaBeneficio.unshift({
            value: valorComboActual,
            label: `${etiquetaBase} (${esRecategorizacionVigente(lead) ? 'Reca' : 'boleta actual'})`
        });
    }

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
            const esMas2 = esModalidadMas2(lead);
            const opcionesTiempo = esMas2
                ? [TIEMPO_OFRECIDO_MAS2]
                : (tiempoOfrecidoActual && !SELECT_OPTIONS.tiempo.includes(tiempoOfrecidoActual)
                    ? [tiempoOfrecidoActual, ...SELECT_OPTIONS.tiempo]
                    : SELECT_OPTIONS.tiempo);
            html += campoEditableHTML('Tiempo Ofrecido', selectSimpleHTML('selectTiempoOfrecido', opcionesTiempo, esMas2 ? TIEMPO_OFRECIDO_MAS2 : tiempoOfrecidoActual, bloqueado || esMas2));
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

    const permiteSolicitar = !esColegioAliado && boletaVirtualFija === null && boletaActual !== '';
    const opcionesRangoInferior = permiteSolicitar
        ? opcionesBoletaBeneficioCatalogo(filasCatalogoRangosInferiores(state.catalogoBoletas, tipoIngresoCatalogo, boletaReferencia))
        : [];

    html += renderSolicitudBox(permiteSolicitar, opcionesRangoInferior, id, esColegioAliado);

    container.innerHTML = html;

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

function inputBuscableHTML(id, opciones, valorActual, disabled, placeholder = 'Escribe para buscar...', multilinea = false) {
    const campo = multilinea
        ? `<textarea id="${id}" class="campo-editable-input combo-buscable-input" rows="1"
                    placeholder="${escapeHtml(placeholder)}" autocomplete="off"
                    style="resize:none; overflow:hidden; white-space:pre-wrap; word-break:break-word;"
                    ${disabled ? 'disabled' : ''}>${escapeHtml(valorActual || '')}</textarea>`
        : `<input type="text" id="${id}" class="campo-editable-input combo-buscable-input"
                  value="${escapeHtml(valorActual || '')}" placeholder="${escapeHtml(placeholder)}"
                  autocomplete="off" ${disabled ? 'disabled' : ''}>`;

    return `
        <div class="combo-buscable" id="${id}Wrap">
            ${campo}
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

    if (input.tagName === 'TEXTAREA') {
        const autoGrow = () => { input.style.height = 'auto'; input.style.height = input.scrollHeight + 'px'; };
        input.addEventListener('input', autoGrow);
        autoGrow();
    }

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
        if (input.tagName === 'TEXTAREA') { input.style.height = 'auto'; input.style.height = input.scrollHeight + 'px'; }
    });

    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !panel.contains(e.target)) {
            panel.classList.remove('open');
        }
    });

    input._actualizarOpcionesCombo = (nuevas) => { opciones = nuevas; };
}

function esRecategorizacionVigente(lead) {
    const a = state.recategorizacionAprobada;
    if (!a || !lead) return false;
    return String(a.BOLETA_SOLICITADA || '').trim() === String(obtenerCampo(lead, COLUMNAS.BOLETA) || '').trim()
        && String(a.BENEFICIO_SOLICITADO || '').trim() === String(obtenerCampo(lead, COLUMNAS.BENEFICIO) || '').trim();
}

function renderSolicitudBox(permite, opciones, id, esColegioAliado) {
    const user = getCurrentUser();
    const esAdmin = esRolSupervisorOAdmision(user.rol);
    let avisos = '';

    if (esRecategorizacionVigente(state.lead)) {
        const a = state.recategorizacionAprobada;
        avisos += `
            <div style="background:#e8f5e9; border:1px solid #81c784; padding:14px 18px; border-radius:8px; margin-top:20px; font-size:13px; color:#1b5e20;">
                <strong>Reca:</strong> Boleta S/ ${escapeHtml(a.BOLETA_SOLICITADA)} (${escapeHtml(a.BENEFICIO_SOLICITADO || 'Sin beca')}),
                aprobada por ${escapeHtml(a.ADMIN_NOMBRE || a.ADMIN_EMAIL || '')}${a.FECHA_RESOLUCION ? ' el ' + escapeHtml(formatearFecha(a.FECHA_RESOLUCION)) : ''}.
            </div>`;
    }

    if (state.solicitudPendiente && state.solicitudPendiente.STATUS === 'RECHAZADO' && !esAdmin) {
        avisos += `
            <div style="background:#ffebee; border:1px solid #ef9a9a; padding:14px 18px; border-radius:8px; margin-top:20px; font-size:13px; color:#b71c1c;">
                Tu solicitud de recategorización a Boleta S/ ${escapeHtml(state.solicitudPendiente.BOLETA_SOLICITADA)} fue rechazada. Puedes solicitar otra escala.
            </div>`;
    }

    const valorActual = state.lead
        ? `${obtenerCampo(state.lead, COLUMNAS.BOLETA) || ''}||${obtenerCampo(state.lead, COLUMNAS.BENEFICIO) || ''}||${obtenerCampo(state.lead, COLUMNAS.BOLETA_CON_BECA) || ''}`
        : '';
    const opcionesDisponibles = (opciones || []).filter(o => o.value !== valorActual);
    return avisos + renderSolicitudBoxContenido(permite, opcionesDisponibles, id, esColegioAliado, esAdmin);
}

function renderSolicitudBoxContenido(permite, opciones, id, esColegioAliado, esAdmin) {

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

function rangosUnicosOrdenados(filasTipo) {
    const rangosMap = new Map();
    filasTipo.forEach(fila => {
        const min = parseNumero(fila.BOLETA_PROCEDENCIA_MIN);
        const max = parseNumero(fila.BOLETA_PROCEDENCIA_MAX);
        if (isNaN(min) || isNaN(max)) return;
        const key = `${min}-${max}`;
        if (!rangosMap.has(key)) rangosMap.set(key, { min, max });
    });
    return Array.from(rangosMap.values()).sort((a, b) => a.max - b.max || a.min - b.min);
}

function encontrarIndiceRango(rangosOrdenadosPorMax, ref) {
    return rangosOrdenadosPorMax.findIndex(r => ref >= r.min && ref <= r.max);
}

function encontrarIndicesRango(rangosOrdenadosPorMax, ref) {
    const indices = [];
    rangosOrdenadosPorMax.forEach((r, i) => {
        if (ref >= r.min && ref <= r.max) indices.push(i);
    });
    return indices;
}

function filasCatalogoFiltradas(catalogo, tipoIngreso, referencia) {
    const tipoNorm = normalizarTexto(tipoIngreso);
    const ref = parseNumero(referencia);
    if (isNaN(ref)) return [];

    const filasTipo = (catalogo || []).filter(
        fila => normalizarTexto(fila.TIPO_INGRESO || '') === tipoNorm
    );

    const rangosOrdenados = rangosUnicosOrdenados(filasTipo);

    const indicesMatch = encontrarIndicesRango(rangosOrdenados, ref);

    if (indicesMatch.length === 0) return [];

    const maximoRangoOriginal = Math.max(
        ...indicesMatch.map(i => rangosOrdenados[i].max)
    );

    const esOrdinario = tipoNorm === normalizarTexto('Ordinario');
    const incremento = esOrdinario ? 200 : 100;

    const montoBusqueda = maximoRangoOriginal + incremento;

    const indicesSubida = encontrarIndicesRango(
        rangosOrdenados,
        montoBusqueda
    );

    const minRangoOriginal = Math.min(
        ...indicesMatch.map(i => rangosOrdenados[i].min)
    );

    const maxRangoFinal = indicesSubida.length
        ? Math.max(...indicesSubida.map(i => rangosOrdenados[i].max))
        : maximoRangoOriginal + incremento;

    const rangosIncluidos = rangosOrdenados.filter(rango => {
        return rango.max >= minRangoOriginal &&
               rango.min <= maxRangoFinal;
    });

    return filasTipo.filter(fila => {
        const min = parseNumero(fila.BOLETA_PROCEDENCIA_MIN);
        const max = parseNumero(fila.BOLETA_PROCEDENCIA_MAX);

        if (isNaN(min) || isNaN(max)) return false;

        return rangosIncluidos.some(r =>
            r.min === min && r.max === max
        );
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
        'disenograficoymarketingdigital': 690,
        'contabilidad': 690,
        'ingenieriadesistemas': 690,
    };
    if (preciosEspeciales690[carreraNorm] !== undefined) return 690;
    if (carreraNorm === 'disenograficopublicitario' && caso === 2) return 690;

    return 650;
}

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
                ${puedeRegistrarVenta() && sol.VENTA_REGISTRADA_EN
                    ? `<div style="margin-top:6px; font-weight:600;"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">point_of_sale</span> Venta registrada el ${formatearFecha(sol.VENTA_REGISTRADA_EN)}</div>`
                    : ''}
                <div style="margin-top:8px; display:flex; justify-content:center; align-items:center; gap:8px; flex-wrap:nowrap; white-space:nowrap;">
                    ${!puedeRegistrarVenta() ? '' : sol.VENTA_REGISTRADA_EN
                        ? !puedeEditarVenta(sol) ? '' : `<button class="btn-guardar" style="padding:6px 16px; font-size:12px; background:#2e7d32;" id="btnEditarVenta"><span class="material-symbols-outlined" style="font-size:15px;vertical-align:-3px;">edit</span> Editar venta</button>`
                        : `<button class="btn-guardar" style="padding:6px 16px; font-size:12px; background:#2e7d32;" id="btnRegistrarVenta"><span class="material-symbols-outlined" style="font-size:15px;vertical-align:-3px;">point_of_sale</span> Registrar venta</button>`}
                    <button class="btn-guardar" style="padding:6px 16px; font-size:12px;" id="btnSolicitarCCOtraVez">Solicitar nuevo envío</button>
                </div>
            </div>
        `;
        document.getElementById('btnRegistrarVenta')?.addEventListener('click', () => abrirModalVenta(false));
        document.getElementById('btnEditarVenta')?.addEventListener('click', () => abrirModalVenta(true));
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

async function normalizarOrientacionImagen(file) {
    if (!file.type || !file.type.startsWith('image/')) return file;
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
        return file;
    }
}

function inicializarInputArchivoCC(campo, multiple) {
    const idBase = idBaseArchivoCC(campo);
    const input = document.getElementById(idBase);
    const btn = document.getElementById(idBase + 'Btn');
    btn?.addEventListener('click', () => input.click());
    input?.addEventListener('change', async () => {
        const seleccionados = Array.from(input.files || []);
        input.value = '';
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
        notificar('Guarda primero los datos de la boleta. Falta: ' + faltantes.join(', ') + '.', 'err');
        return;
    }

    ccCorreosAdicionales = [];
    ccArchivos = { dni: [], certificado: [], boletaProcedencia: [] };
    ['dni', 'certificado', 'boletaProcedencia'].forEach(renderListaArchivosCC);

    const tipoIngreso = String(obtenerCampo(state.lead, COLUMNAS.MODALIDAD_INGRESO) || '').toLowerCase();
    const esTraslado = tipoIngreso.indexOf('con conva') !== -1 || tipoIngreso.indexOf('sin conva') !== -1;
    const bloqueBoletaProc = document.getElementById('ccBloqueBoletaProcedencia');
    if (bloqueBoletaProc) bloqueBoletaProc.style.display = esTraslado ? '' : 'none';
    if (!esTraslado) ccArchivos.boletaProcedencia = [];

    const dniActual = String(obtenerCampo(state.lead, COLUMNAS.DNI) || '').trim();
    const bloqueDniFaltante = document.getElementById('ccBloqueDniFaltante');
    const dniInput = document.getElementById('ccDniInput');
    if (bloqueDniFaltante) bloqueDniFaltante.style.display = dniActual ? 'none' : 'block';
    if (dniInput) dniInput.value = '';
    document.getElementById('ccTipoDocumento').value = tipoDocumentoPorNumero(dniActual);
    actualizarEtiquetasDocumentoCC();

    document.getElementById('ccNuevoCorreoInput').value = '';
    document.getElementById('ccSolicitudMsg').textContent = '';
    renderCorreosCCLista();
    document.getElementById('solicitudCCModal').classList.add('show');
}

function actualizarEtiquetasDocumentoCC() {
    const tipo = document.getElementById('ccTipoDocumento').value;
    document.querySelectorAll('.ccEtiquetaDocumento').forEach(el => { el.textContent = etiquetaTipoDocumento(tipo); });
    const dniInput = document.getElementById('ccDniInput');
    if (dniInput) dniInput.placeholder = tipo === 'CARNE DE EXTRANJERIA' ? 'Ej: 001234567' : 'Ej: 71234567';
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

async function armarArchivosCC(campo) {
    return prepararArchivosParaEnvio(ccArchivos[campo], campo);
}

async function enviarSolicitudCC() {
    const msgEl = document.getElementById('ccSolicitudMsg');
    const btn = document.getElementById('ccSolicitarBtn');
    const user = getCurrentUser();
    const id = obtenerCampo(state.lead, COLUMNAS.ID_PROMETEO);
    const dniInput = document.getElementById('ccDniInput');
    const dni = String(obtenerCampo(state.lead, COLUMNAS.DNI) || '').trim() || (dniInput?.value || '').trim();
    const nombreCompleto = obtenerCampo(state.lead, COLUMNAS.NOMBRES) || '';

    const tipoDocumento = document.getElementById('ccTipoDocumento').value;
    const etiquetaDocumento = etiquetaTipoDocumento(tipoDocumento);
    const digitos = digitosTipoDocumento(tipoDocumento);

    if (!dni) {
        msgEl.style.color = '#d32f2f';
        msgEl.textContent = `Ingresa el N° de ${etiquetaDocumento} del alumno para poder solicitar las Condiciones Comerciales.`;
        dniInput?.focus();
        return;
    }
    if (dniInput && dniInput.value.trim() && !new RegExp(`^\\d{${digitos}}$`).test(dni)) {
        msgEl.style.color = '#d32f2f';
        msgEl.textContent = `El ${etiquetaDocumento} debe tener ${digitos} dígitos.`;
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
            tipoDocumento: tipoDocumento,
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
                TIPO_DOCUMENTO: tipoDocumento,
                STATUS: 'PENDIENTE',
                FECHA_SOLICITUD: new Date().toISOString()
            };
            document.getElementById('solicitudCCModal').classList.remove('show');
            Object.assign(state.lead, capturarEdicionesTemporal());
            renderVista1();
            notificar('Solicitud de Condiciones Comerciales enviada');
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
            notificar('Solicitud de Condiciones Comerciales cancelada');
        } else {
            notificar('Error: ' + (result?.error || 'Error desconocido'), 'err');
        }
    } catch (e) {
        notificar('Error de conexión: ' + e.message, 'err');
    }
}

const MOTIVOS_COMPRA_VENTA = ['Convenios internacionales', 'Bolsa Laboral', 'Docentes', 'Egresados', 'Flexibilidad de horarios', 'Ubicación de sede', 'Precio accesible', 'Beca', 'Descuentos en boletas de pago', 'Prestigio de la institución', 'Metodología de enseñanza', 'Equipos e instalaciones', 'Malla curricular', 'Otros'];
const VB_VENTA_DEFECTO = ['RAUL', 'MARIO', 'ROSMERY'];
let ventaModoEdicion = false;
let ventaDuplicadosCRM = [];
let ventaVbLista = null;
const MEDIOS_PAGO_VENTA = ['Pago Link', 'POS', 'Cargo'];
const CONECTORES_TITULO = new Set(['y', 'o', 'e', 'u', 'a', 'al', 'de', 'del', 'la', 'las', 'el', 'los', 'en', 'con', 'para', 'por', 'sin']);
const SIGLAS_TITULO = new Set(['CPA', 'ETU', 'NEE', 'POS', 'UCAL']);
const COLUMNAS_SIN_FORMATO_VENTA = new Set(['C', 'D', 'V', 'Z']);
const COLUMNAS_MAYUSCULA_VENTA = new Set(['F', 'G', 'Q', 'R', 'S', 'X']);

function sinTildes(texto) {
    return String(texto).replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e').replace(/[íìïî]/g, 'i').replace(/[óòöô]/g, 'o').replace(/[úùüû]/g, 'u')
        .replace(/[ÁÀÄÂ]/g, 'A').replace(/[ÉÈËÊ]/g, 'E').replace(/[ÍÌÏÎ]/g, 'I').replace(/[ÓÒÖÔ]/g, 'O').replace(/[ÚÙÜÛ]/g, 'U');
}

function formatoTitulo(valor) {
    if (typeof valor !== 'string') return valor;
    const palabras = sinTildes(valor).trim().replace(/\s+/g, ' ').toLowerCase().split(' ').filter(Boolean);
    return palabras.map((palabra, i) => {
        if (SIGLAS_TITULO.has(palabra.toUpperCase().replace(/[^A-Z]/g, ''))) return palabra.toUpperCase();
        if (i > 0 && CONECTORES_TITULO.has(palabra)) return palabra;
        return palabra.replace(/(^|[-(\/])([a-zñ])/g, (_, previo, letra) => previo + letra.toUpperCase());
    }).join(' ');
}

function formatoMayuscula(valor) {
    if (typeof valor !== 'string') return valor;
    return sinTildes(valor).trim().replace(/\s+/g, ' ').toUpperCase();
}

function formatearFilaVenta(fila) {
    const resultado = {};
    Object.entries(fila).forEach(([columna, valor]) => {
        resultado[columna] = COLUMNAS_SIN_FORMATO_VENTA.has(columna) ? valor
            : COLUMNAS_MAYUSCULA_VENTA.has(columna) ? formatoMayuscula(valor)
            : formatoTitulo(valor);
    });
    return resultado;
}
const ROLES_REGISTRAR_VENTA = [ROLES.ASESOR, ROLES.SUPERVISOR, ROLES.ADMISION, ROLES.SISTEMAS];

function puedeRegistrarVenta() {
    return ROLES_REGISTRAR_VENTA.includes(getCurrentUser()?.rol);
}

function puedeEditarVenta(sol) {
    const user = getCurrentUser() || {};
    if (esRolSupervisorOAdmision(user.rol)) return true;
    const email = String(user.email || '').trim().toLowerCase();
    return !!email && [sol?.VENTA_REGISTRADA_POR, sol?.ASESOR_EMAIL]
        .some(v => String(v || '').trim().toLowerCase() === email);
}
const STATUS_PAGO_VENTA = [STATUS.PAGO_COMPLETO, STATUS.PAGO_FRACCIONADO];
const DOCS_VENTA = [
    { campo: 'comprobante', label: 'Comprobante de pago', claveId: 'COMPROBANTE_FILE_ID', obligatorio: true },
    { campo: 'dni', label: 'DNI del postulante', claveId: 'DNI_FILE_ID', obligatorio: true },
    { campo: 'conformidad', label: 'Conformidad de CC (captura del correo)', claveId: 'CONFORMIDAD_FILE_ID', obligatorio: true },
    { campo: 'nee', label: 'Encuesta NEE', claveId: 'NEE_FILE_ID', obligatorio: true }
];

let ventaArchivos = { comprobante: [], dni: [], conformidad: [], nee: [] };
let ventaAsesores = null;

function hoyISOLima() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
}

function campanaFormularioVenta(campana) {
    return '20' + String(campana || '').trim().replace('.', '-');
}

function esBecaVigente(lead) {
    const beneficio = String(obtenerCampo(lead, COLUMNAS.BENEFICIO) || '').trim().toUpperCase();
    return !!beneficio && !['NO', 'SIN BECA', 'ESCALA REGULAR', 'NINGUNO', 'RECATEGORIZACIÓN', 'RECATEGORIZACION'].includes(beneficio);
}

function montoAdmisionMatriculaVenta(lead) {
    const descuento = String(obtenerCampo(lead, COLUMNAS.DESCUENTO_PRECIOS) || '0').trim();
    const porDescuento = { '0': [250, 475], '80': [50, 95], '100': [0, 0] }[descuento] || [250, 475];
    const admision = String(lead['ADMISION_FINAL'] ?? '').trim();
    const matricula = String(lead['MATRICULA_FINAL'] ?? '').trim();
    return {
        admision: admision !== '' ? parseNumero(admision) : porDescuento[0],
        matricula: matricula !== '' ? parseNumero(matricula) : porDescuento[1]
    };
}

function datosDerivadosVenta(lead) {
    const nombres = String(obtenerCampo(lead, COLUMNAS.NOMBRES) || '').trim().split(/\s+/).filter(Boolean);
    const modalidadIngreso = String(obtenerCampo(lead, COLUMNAS.MODALIDAD_INGRESO) || '').toLowerCase();
    const esMas2 = modalidadIngreso.indexOf('+2') !== -1;
    const conConva = modalidadIngreso.indexOf('con conva') !== -1;
    const sinConva = modalidadIngreso.indexOf('sin conva') !== -1;
    const esEtu = obtenerCampo(lead, COLUMNAS.TIPO_ALUMNO) === 'ALUMNO ETU';
    const modalidadNorm = normalizarTexto(obtenerCampo(lead, COLUMNAS.MODALIDAD) || '');
    const esVirtual = modalidadNorm === 'virtual' || modalidadNorm === 'remoto';
    const reca = esRecategorizacionVigente(lead);
    const beca = esBecaVigente(lead);
    const beneficio = String(obtenerCampo(lead, COLUMNAS.BENEFICIO) || '').trim().toUpperCase();
    const adicional = String(obtenerCampo(lead, COLUMNAS.BENEFICIO_ADICIONAL) || '').split('||')[2] || '';
    const boleta = parseNumero(obtenerCampo(lead, COLUMNAS.BOLETA) || '');
    const boletaConBeca = parseNumero(obtenerCampo(lead, COLUMNAS.BOLETA_CON_BECA) || '');
    const metodoPago = String(obtenerCampo(lead, COLUMNAS.METODO_PAGO) || '').trim();
    const { admision, matricula } = montoAdmisionMatriculaVenta(lead);

    return formatearFilaVenta({
        C: campanaFormularioVenta(state.campana),
        D: String(obtenerCampo(lead, COLUMNAS.ID_PROMETEO) || '').trim(),
        F: nombres.slice(0, 2).join(' '),
        G: nombres.slice(2).join(' '),
        K: obtenerCampo(lead, COLUMNAS.CARRERA, COLUMNAS.PROGRAMA) || '',
        N: esMas2 ? 'Traslado +2'
            : (conConva || sinConva) ? 'Admisión Extraordinaria (Traslados)'
            : esEtu ? 'ETU'
            : 'Admisión Ordinaria',
        O: esVirtual ? 'Virtual' : 'Semi-presencial',
        P: esVirtual ? 'Nocturno - Todas las carreras (CPA)' : 'Diurno - Todas las carreras (Semipresencial)',
        Q: esMas2 ? 'Traslado +2' : conConva ? 'TRASLADO CON CONVA' : sinConva ? 'TRASLADO SIN CONVA' : 'NUEVO',
        R: reca && beca ? 'RECA-BECA' : reca ? 'RECA' : beca ? 'BECA' : 'ESCALA REGULAR',
        S: beca ? beneficio : reca ? 'RECATEGORIZACIÓN' : 'NINGUNO',
        T: adicional.trim() || 'Ninguno',
        W: metodoPago === 'LINK DE PAGO' ? 'Pago Link' : metodoPago,
        AE: admision,
        AF: matricula,
        AG: boleta,
        AI: beca && boletaConBeca ? boletaConBeca : boleta,
        AJ: (conConva || esMas2) ? 1 : 0,
        AK: String(obtenerCampo(lead, COLUMNAS.RINDE_EXAMEN_SUFICIENCIA) || '').toUpperCase() === 'SI' ? 1 : 0,
        AU: '',
        BA: obtenerCampo(lead, COLUMNAS.TIEMPO_OFRECIDO) || '',
        requiereVB: reca || beca
    });
}

function asegurarModalVenta() {
    if (document.getElementById('ventaModal')) return;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'ventaModal';
    overlay.innerHTML = `
        <div class="modal-box modal-box-detalle" style="max-width:860px;">
            <button class="modal-close-x" id="ventaModalClose"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">close</span></button>
            <h4 style="margin-bottom:2px;" id="ventaTitulo">Registrar venta</h4>
            <p style="color:#888; font-size:13px; margin-bottom:14px;">Revisa los datos, completa el pago y verifica los documentos antes de registrar.</p>
            <div id="ventaAvisoDuplicados" class="venta-aviso" style="display:none;"></div>
            <div id="ventaResumen" class="venta-resumen"></div>
            <div class="venta-grid">
                <label class="venta-campo">Nombre(s) del alumno *
                    <input type="text" id="ventaNombres" class="campo-editable-input">
                </label>
                <label class="venta-campo">Apellidos del alumno *
                    <input type="text" id="ventaApellidos" class="campo-editable-input">
                </label>
                <label class="venta-campo">Medio de pago *
                    <select id="ventaMedioPago" class="campo-editable-input">
                        <option value="">-- Seleccionar --</option>
                        ${MEDIOS_PAGO_VENTA.map(m => `<option value="${m}">${m}</option>`).join('')}
                    </select>
                </label>
                <label class="venta-campo">Status de pago *
                    <select id="ventaStatus" class="campo-editable-input">
                        ${STATUS_PAGO_VENTA.map(s => `<option value="${s}">${s}</option>`).join('')}
                    </select>
                </label>
                <label class="venta-campo">Fecha de pago *
                    <input type="date" id="ventaFechaPago" class="campo-editable-input">
                </label>
                <label class="venta-campo venta-fraccionado">Monto pagado (S/) *
                    <input type="number" id="ventaMontoFraccionado" class="campo-editable-input" min="0" step="0.01">
                </label>
                <label class="venta-campo venta-fraccionado">Fecha compromiso de pago completo *
                    <input type="date" id="ventaFechaCompromiso" class="campo-editable-input">
                </label>
                <label class="venta-campo" id="ventaBloqueVB">VB *
                    <select id="ventaVB" class="campo-editable-input">
                        <option value="">-- Seleccionar --</option>
                    </select>
                </label>
                <label class="venta-campo">Cuota que paga *
                    <select id="ventaCuota" class="campo-editable-input">
                        <option value="1">1</option><option value="2">2</option>
                    </select>
                </label>
                <label class="venta-campo">Motivo de compra *
                    <select id="ventaMotivo" class="campo-editable-input">
                        <option value="">-- Seleccionar --</option>
                        ${MOTIVOS_COMPRA_VENTA.map(formatoTitulo).map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('')}
                    </select>
                </label>
                <label class="venta-campo">Asesor que ayudó a cerrar
                    <select id="ventaAsesorAyudo" class="campo-editable-input"><option value="">Ninguno</option></select>
                </label>
                <label class="venta-campo venta-campo-ancho">Comentario
                    <textarea id="ventaComentario" class="campo-editable-input" rows="2"></textarea>
                </label>
            </div>
            <h5 class="venta-subtitulo">Documentos</h5>
            <div id="ventaDocs" class="venta-docs"></div>
            <div style="display:flex; gap:10px; margin-top:18px;">
                <button class="btn-guardar" style="background:#777; flex:1;" id="ventaCancelarBtn">Cancelar</button>
                <button class="btn-guardar" style="flex:1;" id="ventaRegistrarBtn">Registrar venta</button>
            </div>
            <span id="ventaMsg" style="display:block; margin-top:8px; font-size:13px; text-align:center;"></span>
        </div>
    `;
    document.body.appendChild(overlay);

    const cerrar = () => overlay.classList.remove('show');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(); });
    document.getElementById('ventaModalClose').addEventListener('click', cerrar);
    document.getElementById('ventaCancelarBtn').addEventListener('click', cerrar);
    document.getElementById('ventaStatus').addEventListener('change', actualizarCamposFraccionadoVenta);
    [['ventaNombres', formatoMayuscula], ['ventaApellidos', formatoMayuscula], ['ventaComentario', formatoTitulo]].forEach(([id, formato]) => {
        const campo = document.getElementById(id);
        campo.addEventListener('blur', () => { campo.value = formato(campo.value); });
    });
    document.getElementById('ventaRegistrarBtn').addEventListener('click', registrarVenta);
    document.getElementById('ventaDocs').addEventListener('click', (e) => {
        const subir = e.target.closest('[data-venta-subir]');
        if (subir) { document.getElementById('ventaInput_' + subir.dataset.ventaSubir).click(); return; }
        const quitar = e.target.closest('[data-venta-quitar]');
        if (quitar) { ventaArchivos[quitar.dataset.ventaQuitar] = []; renderDocVenta(quitar.dataset.ventaQuitar); }
    });
    document.getElementById('ventaDocs').addEventListener('change', async (e) => {
        const input = e.target.closest('[data-venta-input]');
        if (!input) return;
        const campo = input.dataset.ventaInput;
        const seleccionados = Array.from(input.files || []);
        input.value = '';
        if (seleccionados.length === 0) return;
        ventaArchivos[campo] = await Promise.all(seleccionados.map(normalizarOrientacionImagen));
        renderDocVenta(campo);
        document.getElementById('ventaMsg').textContent = '';
    });
}

function actualizarCamposFraccionadoVenta() {
    const fraccionado = document.getElementById('ventaStatus').value === STATUS.PAGO_FRACCIONADO;
    document.querySelectorAll('#ventaModal .venta-fraccionado').forEach(el => { el.style.display = fraccionado ? '' : 'none'; });
}

function etiquetaDocVenta(doc) {
    if (doc.campo !== 'dni') return doc.label;
    const sol = state.solicitudCC || {};
    const tipo = sol.TIPO_DOCUMENTO || tipoDocumentoPorNumero(obtenerCampo(state.lead, COLUMNAS.DNI));
    return `${etiquetaTipoDocumento(tipo)} del postulante`;
}

function archivoExistenteVenta(doc) {
    return String((state.solicitudCC || {})[doc.claveId] || '').trim();
}

function renderDocVenta(campo) {
    const doc = DOCS_VENTA.find(d => d.campo === campo);
    const cont = document.getElementById('ventaDoc_' + campo);
    if (!doc || !cont) return;
    const nuevos = ventaArchivos[campo];
    const existente = archivoExistenteVenta(doc);

    let preview;
    let estado;
    if (nuevos.length > 0) {
        const pdf = nuevos.length === 1 && nuevos[0].type === 'application/pdf';
        preview = pdf
            ? `<iframe src="${URL.createObjectURL(nuevos[0])}" class="venta-doc-frame"></iframe>`
            : `<div class="venta-doc-thumbs">${nuevos.map(f => (f.type || '').startsWith('image/')
                ? `<img src="${URL.createObjectURL(f)}" alt="">`
                : `<span class="material-symbols-outlined" style="font-size:40px; color:#c62828;">description</span>`).join('')}</div>`;
        estado = `<span class="venta-doc-estado nuevo">${existente ? 'Reemplazo' : 'Nuevo'} · ${nuevos.length} archivo(s)</span>`;
    } else if (existente) {
        preview = `<iframe src="https://drive.google.com/file/d/${encodeURIComponent(existente)}/preview" class="venta-doc-frame" allow="autoplay"></iframe>`;
        estado = `<span class="venta-doc-estado ok">Ya adjuntado</span>`;
    } else {
        preview = `<div class="venta-doc-vacio"><span class="material-symbols-outlined">upload_file</span>Sin documento</div>`;
        estado = `<span class="venta-doc-estado ${doc.obligatorio ? 'falta' : ''}">${doc.obligatorio ? 'Obligatorio' : 'Opcional'}</span>`;
    }

    cont.innerHTML = `
        <div class="venta-doc-cabecera">
            <strong>${etiquetaDocVenta(doc)}${doc.obligatorio ? ' *' : ''}</strong>
            ${estado}
        </div>
        ${preview}
        <div class="venta-doc-acciones">
            <input type="file" id="ventaInput_${campo}" data-venta-input="${campo}" accept=".pdf,.png,.jpg,.jpeg" multiple style="display:none;">
            <button type="button" class="btn-guardar" data-venta-subir="${campo}" style="padding:5px 12px; font-size:12px;">${existente || nuevos.length ? 'Reemplazar' : 'Subir'}</button>
            ${nuevos.length ? `<button type="button" class="btn-guardar" data-venta-quitar="${campo}" style="padding:5px 12px; font-size:12px; background:#777;">${existente ? 'Mantener actual' : 'Quitar'}</button>` : ''}
        </div>
    `;
}

async function cargarAsesoresVenta() {
    const select = document.getElementById('ventaAsesorAyudo');
    if (!ventaAsesores) {
        const result = await callAPI('getAsesoresActivos', { campana: state.campana });
        ventaAsesores = (result && result.success) ? (result.data || []) : [];
    }
    const user = getCurrentUser();
    select.innerHTML = '<option value="">Ninguno</option>' + ventaAsesores
        .filter(a => String(a.email || '').toLowerCase() !== String(user.email || '').toLowerCase())
        .map(a => formatoTitulo(a.nombre)).map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
}

async function cargarVbVenta() {
    if (!ventaVbLista) {
        const result = await callAPI('getCampanasConfig', {});
        const campana = (result && result.success) ? (result.data || []).find(c => c.codigo === state.campana) : null;
        ventaVbLista = (campana && Array.isArray(campana.vbLista) && campana.vbLista.length) ? campana.vbLista : VB_VENTA_DEFECTO;
    }
    const select = document.getElementById('ventaVB');
    const actual = select.value;
    select.innerHTML = '<option value="">-- Seleccionar --</option>' +
        ventaVbLista.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(formatoTitulo(v))}</option>`).join('');
    select.value = ventaVbLista.includes(actual) ? actual : '';
}

async function revisarDuplicadosVenta() {
    const aviso = document.getElementById('ventaAvisoDuplicados');
    aviso.style.display = 'none';
    ventaDuplicadosCRM = [];
    try {
        ventaDuplicadosCRM = await buscarDuplicados({
            idPrometeo: obtenerCampo(state.lead, COLUMNAS.ID_PROMETEO),
            celular: obtenerCampo(state.lead, COLUMNAS.TELEFONO_2),
            nombre: obtenerCampo(state.lead, COLUMNAS.NOMBRES)
        });
    } catch (e) {
        ventaDuplicadosCRM = [];
    }
    if (!ventaDuplicadosCRM.length) return;
    aviso.innerHTML = `
        <strong><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">warning</span> Posible lead duplicado</strong>
        <div>${ventaDuplicadosCRM.map(dup => `ID ${escapeHtml(String(dup[COLUMNAS.ID_PROMETEO] || ''))} (${escapeHtml(String(dup[COLUMNAS.CAMPANA] || ''))}) — ${escapeHtml((dup._motivos || []).join(', '))}`).join('<br>')}</div>
        <div>Unifica los IDs desde "Unificar IDs" antes de registrar la venta.</div>
    `;
    aviso.style.display = '';
}

function valorOpcion(select, valor, transformar = v => v) {
    const buscado = transformar(String(valor || '').trim());
    const opcion = Array.from(select.options).find(o => transformar(o.value) === buscado);
    select.value = opcion ? opcion.value : '';
}

async function precargarVentaExistente() {
    const msgEl = document.getElementById('ventaMsg');
    msgEl.style.color = '#666';
    msgEl.textContent = 'Cargando la venta registrada...';
    const result = await callAPI('obtenerVenta', { idSolicitud: state.solicitudCC.ID_SOLICITUD });
    if (!result || !result.success) {
        msgEl.style.color = '#d32f2f';
        msgEl.textContent = 'Error: ' + (result?.error || 'No se pudo cargar la venta');
        return;
    }
    const f = result.fila || {};
    msgEl.textContent = '';
    if (f.F) document.getElementById('ventaNombres').value = formatoMayuscula(f.F);
    if (f.G) document.getElementById('ventaApellidos').value = formatoMayuscula(f.G);
    if (f.W) valorOpcion(document.getElementById('ventaMedioPago'), f.W, formatoTitulo);
    if (f.X) valorOpcion(document.getElementById('ventaStatus'), f.X, formatoMayuscula);
    if (f.V) document.getElementById('ventaFechaPago').value = f.V;
    document.getElementById('ventaFechaCompromiso').value = f.Z || '';
    document.getElementById('ventaMontoFraccionado').value = String(f.AL || '').replace(/[^\d.]/g, '');
    if (f.U) valorOpcion(document.getElementById('ventaVB'), f.U, formatoMayuscula);
    if (f.AP) document.getElementById('ventaCuota').value = String(parseInt(f.AP, 10) || 1);
    if (f.AN) valorOpcion(document.getElementById('ventaMotivo'), f.AN, formatoTitulo);
    if (f.AM) valorOpcion(document.getElementById('ventaAsesorAyudo'), f.AM, formatoTitulo);
    document.getElementById('ventaComentario').value = f.AO || '';
    actualizarCamposFraccionadoVenta();
}

async function abrirModalVenta(editar = false) {
    if (!puedeRegistrarVenta() || !state.solicitudCC || state.solicitudCC.STATUS !== 'ENVIADO') return;
    if (editar && !puedeEditarVenta(state.solicitudCC)) return;
    asegurarModalVenta();
    ventaModoEdicion = !!editar;
    document.getElementById('ventaTitulo').textContent = ventaModoEdicion ? 'Editar venta' : 'Registrar venta';
    document.getElementById('ventaRegistrarBtn').textContent = ventaModoEdicion ? 'Guardar cambios' : 'Registrar venta';
    const lead = state.lead;
    const d = datosDerivadosVenta(lead);
    const fila = (label, valor) => `<div><span>${label}</span><strong>${escapeHtml(String(valor ?? '') || '-')}</strong></div>`;
    document.getElementById('ventaResumen').innerHTML = [
        fila('ID Prometeo', d.D),
        fila('Carrera', d.K),
        fila('Modalidad', d.O),
        fila('Tipo de ingreso', d.Q),
        fila('Descuento', d.S === 'NINGUNO' ? d.R : `${d.R} · ${d.S}`),
        fila('Beneficio adicional', d.T),
        fila('Boleta final', `S/ ${d.AI}`),
        fila('Admisión / Matrícula', `S/ ${d.AE} / S/ ${d.AF}`)
    ].join('');

    document.getElementById('ventaNombres').value = d.F;
    document.getElementById('ventaApellidos').value = d.G;
    document.getElementById('ventaMedioPago').value = MEDIOS_PAGO_VENTA.includes(d.W) ? d.W : '';
    document.getElementById('ventaStatus').value = STATUS.PAGO_COMPLETO;
    document.getElementById('ventaFechaPago').value = hoyISOLima();
    document.getElementById('ventaFechaPago').max = hoyISOLima();
    document.getElementById('ventaMontoFraccionado').value = '';
    document.getElementById('ventaFechaCompromiso').value = '';
    document.getElementById('ventaVB').value = '';
    document.getElementById('ventaBloqueVB').style.display = d.requiereVB ? '' : 'none';
    document.getElementById('ventaCuota').value = '1';
    document.getElementById('ventaMotivo').value = '';
    document.getElementById('ventaComentario').value = '';
    document.getElementById('ventaMsg').textContent = '';
    actualizarCamposFraccionadoVenta();

    ventaArchivos = { comprobante: [], dni: [], conformidad: [], nee: [] };
    document.getElementById('ventaDocs').innerHTML = DOCS_VENTA.map(doc => `<div class="venta-doc" id="ventaDoc_${doc.campo}"></div>`).join('');
    DOCS_VENTA.forEach(doc => renderDocVenta(doc.campo));

    document.getElementById('ventaModal').classList.add('show');
    await Promise.all([cargarAsesoresVenta(), cargarVbVenta(), revisarDuplicadosVenta()]);
    if (ventaModoEdicion) await precargarVentaExistente();
}

async function armarArchivosVenta(campo) {
    return prepararArchivosParaEnvio(ventaArchivos[campo], campo);
}

async function registrarVenta() {
    const msgEl = document.getElementById('ventaMsg');
    const btn = document.getElementById('ventaRegistrarBtn');
    const error = (texto) => { msgEl.style.color = '#d32f2f'; msgEl.textContent = texto; };
    const d = datosDerivadosVenta(state.lead);

    const status = document.getElementById('ventaStatus').value;
    const fechaPago = document.getElementById('ventaFechaPago').value;
    const fraccionado = status === STATUS.PAGO_FRACCIONADO;
    const monto = document.getElementById('ventaMontoFraccionado').value;
    const fechaCompromiso = document.getElementById('ventaFechaCompromiso').value;
    const vb = document.getElementById('ventaVB').value;
    const motivo = document.getElementById('ventaMotivo').value;

    const nombresAlumno = document.getElementById('ventaNombres').value.trim().replace(/\s+/g, ' ');
    const apellidosAlumno = document.getElementById('ventaApellidos').value.trim().replace(/\s+/g, ' ');
    const medioPago = document.getElementById('ventaMedioPago').value;

    if (!nombresAlumno) return error('Ingresa el/los nombre(s) del alumno.');
    if (!apellidosAlumno) return error('Ingresa los apellidos del alumno.');
    if (!medioPago) return error('Selecciona el medio de pago.');
    if (!fechaPago) return error('Selecciona la fecha de pago.');
    if (fraccionado && (!monto || Number(monto) <= 0)) return error('Ingresa el monto pagado.');
    if (fraccionado && !fechaCompromiso) return error('Selecciona la fecha de compromiso de pago completo.');
    if (d.requiereVB && !vb) return error('Selecciona el VB (obligatorio cuando hay Reca o Beca).');
    if (!motivo) return error('Selecciona el motivo de compra.');
    const faltante = DOCS_VENTA.find(doc => doc.obligatorio && ventaArchivos[doc.campo].length === 0 && !archivoExistenteVenta(doc));
    if (faltante) return error(`Adjunta el documento: ${etiquetaDocVenta(faltante)}.`);

    const { requiereVB, ...derivados } = d;
    const filaVenta = formatearFilaVenta({
        ...derivados,
        F: nombresAlumno,
        G: apellidosAlumno,
        W: medioPago,
        U: requiereVB ? vb : '',
        V: fechaPago,
        X: status,
        Z: fraccionado ? fechaCompromiso : '',
        AL: fraccionado ? Number(monto) : '',
        AM: document.getElementById('ventaAsesorAyudo').value,
        AN: motivo,
        AO: document.getElementById('ventaComentario').value.trim(),
        AP: Number(document.getElementById('ventaCuota').value) || 1
    });

    if (!ventaModoEdicion && ventaDuplicadosCRM.length
        && !confirm('Este lead tiene posibles duplicados sin unificar (mismo nombre o celular). Lo recomendable es unificarlos antes de registrar la venta.\n\n¿Registrar de todas formas?')) {
        return;
    }

    btn.disabled = true;
    msgEl.style.color = '#666';
    msgEl.textContent = 'Preparando documentos...';

    try {
        const [comprobante, dni, conformidad, nee] = await Promise.all(['comprobante', 'dni', 'conformidad', 'nee'].map(armarArchivosVenta));
        msgEl.textContent = ventaModoEdicion ? 'Guardando cambios...' : 'Registrando venta...';
        const payload = {
            idSolicitud: state.solicitudCC.ID_SOLICITUD,
            idPrometeo: d.D,
            campana: state.campana,
            editar: ventaModoEdicion,
            nombreCompleto: `${nombresAlumno} ${apellidosAlumno}`,
            nombreLead: obtenerCampo(state.lead, COLUMNAS.NOMBRES) || '',
            dni: String(obtenerCampo(state.lead, COLUMNAS.DNI) || '').trim(),
            fila: filaVenta,
            archivos: { comprobante, dni, conformidad, nee }
        };
        let result = await callAPI('registrarVenta', payload);
        if (result && result.requiereConfirmacion) {
            if (!confirm(result.error + '\n\n¿Guardar de todas formas?')) {
                msgEl.textContent = '';
                return;
            }
            result = await callAPI('registrarVenta', { ...payload, confirmarDuplicado: true });
        }

        if (!result || !result.success) return error('Error: ' + (result?.error || 'No se pudo registrar la venta'));

        Object.assign(state.solicitudCC, result.archivos || {}, { VENTA_REGISTRADA_EN: result.ventaRegistradaEn || new Date().toISOString() });
        if (result.statusProvisional) state.lead[COLUMNAS.STATUS_GESTION] = result.statusProvisional;
        sincronizarCache();
        document.getElementById('ventaModal').classList.remove('show');
        Object.assign(state.lead, capturarEdicionesTemporal());
        renderAll();
        if (result.statusProvisional) {
            notificar(ventaModoEdicion ? 'Venta actualizada' : 'Venta registrada');
        } else {
            notificar(`${ventaModoEdicion ? 'Venta actualizada' : 'Venta registrada'}, pero no se pudo actualizar el status del lead. Se actualizará con la carga del día siguiente.`, 'info');
        }
    } catch (e) {
        error('Error: ' + e.message);
    } finally {
        btn.disabled = false;
    }
}

const STATUS_NO_ASIGNABLES = [STATUS.VP_VIVA, STATUS.PP_VIVA, STATUS.PAGO_COMPLETO, STATUS.PAGO_FRACCIONADO];

function puedeAsignarAsesor() {
    if (!esRolSupervisorOAdmision(getCurrentUser()?.rol) || !state.lead) return false;
    const status = String(state.lead[COLUMNAS.STATUS_GESTION] || '').trim().toUpperCase();
    return !STATUS_NO_ASIGNABLES.includes(status);
}

function asegurarModalAsignarAsesor() {
    if (document.getElementById('asignarAsesorModal')) return;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'asignarAsesorModal';
    overlay.innerHTML = `
        <div class="modal-box modal-box-detalle" style="max-width:440px;">
            <button class="modal-close-x" id="asignarAsesorClose"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">close</span></button>
            <h4 style="margin-bottom:2px;">Asignar asesor</h4>
            <p style="color:#888; font-size:13px; margin-bottom:14px;">La asignación es provisional: el asesor verá este lead hoy para poder registrar su venta. Mañana se mantiene el asesor que traiga la base.</p>
            <label class="venta-campo">Asesor
                <select id="asignarAsesorSelect" class="campo-editable-input"><option value="">Cargando...</option></select>
            </label>
            <div style="display:flex; gap:10px; margin-top:18px;">
                <button class="btn-guardar" style="background:#777; flex:1;" id="asignarAsesorCancelar">Cancelar</button>
                <button class="btn-guardar" style="flex:1;" id="asignarAsesorConfirmar">Asignar</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    const cerrar = () => overlay.classList.remove('show');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(); });
    document.getElementById('asignarAsesorClose').addEventListener('click', cerrar);
    document.getElementById('asignarAsesorCancelar').addEventListener('click', cerrar);
    document.getElementById('asignarAsesorConfirmar').addEventListener('click', asignarAsesorProvisional);
}

async function abrirModalAsignarAsesor() {
    if (!puedeAsignarAsesor()) return;
    asegurarModalAsignarAsesor();
    document.getElementById('asignarAsesorModal').classList.add('show');
    const select = document.getElementById('asignarAsesorSelect');
    const result = await callAPI('getAsesoresActivos', { campana: state.campana });
    const asesores = (result && result.success) ? (result.data || []) : [];
    select.innerHTML = '<option value="">-- Selecciona un asesor --</option>' +
        asesores.map(a => `<option value="${escapeHtml(a.usuario)}">${escapeHtml(a.nombre)}</option>`).join('');
    if (!result || !result.success) notificar('No se pudo cargar la lista de asesores: ' + (result?.error || 'error desconocido'), 'err');
}

async function asignarAsesorProvisional() {
    const select = document.getElementById('asignarAsesorSelect');
    const usuario = select.value;
    if (!usuario) { notificar('Selecciona un asesor.', 'err'); return; }
    const btn = document.getElementById('asignarAsesorConfirmar');
    btn.disabled = true;
    try {
        const result = await callAPI('asignarLeadProvisional', {
            idPrometeo: obtenerCampo(state.lead, COLUMNAS.ID_PROMETEO),
            campana: state.campana,
            usuario
        });
        if (!result || !result.success) {
            notificar('Error: ' + (result?.error || 'No se pudo asignar el lead'), 'err');
            return;
        }
        state.lead.ASESOR_PROVISIONAL = result.asesor;
        sincronizarCache();
        document.getElementById('asignarAsesorModal').classList.remove('show');
        renderHeaderLead();
        notificar(`Lead asignado a ${result.asesor} por hoy`);
    } catch (e) {
        notificar('Error de conexión: ' + e.message, 'err');
    } finally {
        btn.disabled = false;
    }
}

async function guardarFicha(idPrometeo) {
    const user = getCurrentUser();

    if (!esRolSupervisorOAdmision(user.rol) && state.solicitudPendiente && state.solicitudPendiente.STATUS === 'PENDIENTE') {
        notificar('No puedes editar la ficha mientras tengas una solicitud pendiente.', 'err');
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
    if (getVal('selectTiempoOfrecido') !== undefined) {
        data[COLUMNAS.TIEMPO_OFRECIDO] = esModalidadMas2(state.lead) ? TIEMPO_OFRECIDO_MAS2 : getVal('selectTiempoOfrecido');
    }

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
            renderVista1();
            notificar('Ficha guardada');
        } else {
            notificar('Error al guardar: ' + (result?.error || 'Error desconocido'), 'err');
        }
    } catch (e) {
        notificar('Error de conexión: ' + e.message, 'err');
    } finally {
        mostrarOverlay(false);
    }
}

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

    CAMPOS_SELECT_PERFILAMIENTO.forEach(cfg => {
        if (cfg.columna === COLUMNAS.OTRAS_OPCIONES) {
            html += `<div>${selectorPerfilamientoHTML(cfg, lead, bloqueado)}${otrasOpcionesInstitucionHTML(lead, bloqueado)}</div>`;
        } else {
            html += selectorPerfilamientoHTML(cfg, lead, bloqueado);
        }
    });

    camposFinales.forEach(c => {
        html += `
            <div style="grid-column: 1 / -1;">
                <label style="font-size:13px; font-weight:600; color:#555; display:block; margin-bottom:4px;">${c.label}</label>
                <textarea id="${c.id}" class="campo-editable-input" style="width:100%; min-height:60px; padding:10px 12px; border:1px solid var(--color-border); border-radius:6px; font-size:14px; font-family:inherit; resize:vertical;" ${bloqueado ? 'disabled' : ''}>${escapeHtml(c.value)}</textarea>
            </div>
        `;
    });

    if (esRolSupervisorOAdmision(user.rol)) {
        html += `
            <div style="grid-column: 1 / -1;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; gap:8px; flex-wrap:wrap;">
                    <label style="font-size:13px; font-weight:600; color:#555; margin:0;">
                        Propuesta de Acción de la IA
                    </label>
                    <button type="button" class="btn-export" style="padding:6px 16px; font-size:12px;" id="btnGenerarPropuestaIA" ${bloqueado ? 'disabled' : ''}>
                        <span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px;">auto_awesome</span>
                        Generar con IA
                    </button>
                </div>
                <textarea id="inputPropuestaIA" class="campo-editable-input" style="width:100%; min-height:70px; padding:10px 12px; border:1px solid var(--color-border); border-radius:6px; font-size:14px; font-family:inherit; resize:vertical;" ${bloqueado ? 'disabled' : ''}>${escapeHtml(lead[COLUMNAS.PROPUESTA_ACCION_IA] || '')}</textarea>
            </div>
        `;
    }

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
    CAMPOS_SELECT_PERFILAMIENTO.forEach(cfg => {
        if (cfg.permiteMultiple) {
            initChecklistPerfilamiento(cfg, bloqueado);
            return;
        }
        document.getElementById(cfg.selectId)?.addEventListener('change', () => onCambioSelectorPerfilamiento(cfg));
    });

    const selectOtrasOpciones = document.getElementById('selectOtrasOpciones');
    const wrapOpcionInstitucion = document.getElementById('otrasOpcionesInstitucionWrap');
    if (selectOtrasOpciones && wrapOpcionInstitucion) {
        selectOtrasOpciones.addEventListener('change', () => {
            wrapOpcionInstitucion.style.display = (selectOtrasOpciones.value === VALOR_OTRAS_OPCIONES_INSTITUCION) ? 'grid' : 'none';
        });
    }

    const tipoActualOpcionInst = lead[COLUMNAS.OPCION_INSTITUCION] || '';
    initComboBuscable('selectOpcionInstitucionNombre', opcionesInstitucionPorTipo(tipoActualOpcionInst));

    const selectOpcionInstTipo = document.getElementById('selectOpcionInstitucionTipo');
    const inputOpcionInstNombre = document.getElementById('selectOpcionInstitucionNombre');
    if (selectOpcionInstTipo && inputOpcionInstNombre) {
        selectOpcionInstTipo.addEventListener('change', () => {
            const tipoSel = selectOpcionInstTipo.value;
            const nuevasOpciones = opcionesInstitucionPorTipo(tipoSel);

            if (inputOpcionInstNombre._actualizarOpcionesCombo) inputOpcionInstNombre._actualizarOpcionesCombo(nuevasOpciones);

            const valorActualNorm = String(inputOpcionInstNombre.value || '').trim().toUpperCase();
            const sigueValido = nuevasOpciones.some(op => String(op).trim().toUpperCase() === valorActualNorm);
            if (!sigueValido) inputOpcionInstNombre.value = '';

            inputOpcionInstNombre.disabled = !tipoSel || bloqueado;
            inputOpcionInstNombre.placeholder = tipoSel ? 'Escribe para buscar...' : 'Selecciona primero el tipo';
        });
    }

    document.getElementById('btnGenerarPropuestaIA')?.addEventListener('click', async () => {
        const btn = document.getElementById('btnGenerarPropuestaIA');
        btn.disabled = true; btn.textContent = 'Generando…';
        const result = await callAPI('generarPropuestaIA', { id, campana: state.campana });
        if (result.success) {
            document.getElementById('inputPropuestaIA').value = result.propuesta;
            state.lead.PROPUESTA_ACCION_IA = result.propuesta;
        } else {
            notificar(result.error || 'No se pudo generar la propuesta.', 'err');
        }
        btn.disabled = false; btn.textContent = 'Generar con IA';
    });
}

function selectorPerfilamientoHTML(cfg, lead, bloqueado) {
    if (cfg.permiteMultiple) return checklistPerfilamientoHTML(cfg, lead, bloqueado);

    const valorActual = lead[cfg.columna] || '';
    const catalogo = state[cfg.stateKey] || [];
    const coincide = catalogo.some(d => String(d.nombre) === String(valorActual));

    const opciones = catalogo.map(d =>
        `<option value="${escapeHtml(d.nombre)}" ${String(d.nombre) === String(valorActual) ? 'selected' : ''}>${escapeHtml(d.nombre)}</option>`
    ).join('');

    const opcionVacia = `<option value="" ${!valorActual ? 'selected' : ''}>-- Sin seleccionar --</option>`;

    let opcionExtra = '';
    if (valorActual && !coincide) {
        opcionExtra = `<option value="${escapeHtml(valorActual)}" selected>${escapeHtml(valorActual)}</option>`;
    }

    const nuevaOpcion = cfg.permiteAgregarNuevo ? '<option value="__nuevo__">+ Agregar nueva...</option>' : '';

    const itemActual = catalogo.find(d => String(d.nombre) === String(valorActual));
    const descripcionActual = itemActual ? (itemActual.descripcion || '') : '';

    let html = `
        <div>
            <label style="font-size:13px; font-weight:600; color:#555; display:block; margin-bottom:4px;">${cfg.label}</label>
            <select id="${cfg.selectId}" class="campo-editable-select" ${bloqueado ? 'disabled' : ''}>
                ${opcionVacia}${opcionExtra}${opciones}${nuevaOpcion}
            </select>
            <div id="${cfg.selectId}Descripcion" style="margin-top:6px; font-size:12px; color:#777; ${descripcionActual ? '' : 'display:none;'}">${escapeHtml(descripcionActual)}</div>
    `;

    if (cfg.permiteAgregarNuevo) {
        html += `
            <div id="${cfg.selectId}NuevoWrap" style="margin-top:8px; display:none;">
                <input type="text" id="${cfg.selectId}NuevoNombre" class="campo-editable-input"
                       placeholder="Nombre (máx. 5 palabras)" style="width:100%; margin-bottom:6px;" ${bloqueado ? 'disabled' : ''}>
                <textarea id="${cfg.selectId}NuevaDescripcion" class="campo-editable-input" placeholder="Descripción"
                          style="width:100%; min-height:50px; padding:8px 10px; border:1px solid var(--color-border); border-radius:6px; font-size:13px; font-family:inherit; resize:vertical;" ${bloqueado ? 'disabled' : ''}></textarea>
                <span id="${cfg.selectId}NuevoError" style="color:#c62828; font-size:12px; display:none;"></span>
            </div>
        `;
    }

    html += `</div>`;
    return html;
}

function checklistPerfilamientoHTML(cfg, lead, bloqueado) {
    const catalogo = state[cfg.stateKey] || [];
    const seleccionados = String(lead[cfg.columna] || '').split(',').map(v => v.trim()).filter(Boolean);

    const extras = seleccionados.filter(v => !catalogo.some(d => String(d.nombre) === v));
    const opciones = [...catalogo.map(d => d.nombre), ...extras];

    const checkboxes = opciones.map(nombre => `
        <label style="display:flex; align-items:center; gap:6px; font-size:13px; font-weight:400; padding:6px 10px; cursor:${bloqueado ? 'default' : 'pointer'};">
            <input type="checkbox" class="checklist-${cfg.selectId}" value="${escapeHtml(nombre)}" ${seleccionados.includes(nombre) ? 'checked' : ''} ${bloqueado ? 'disabled' : ''}>
            ${escapeHtml(nombre)}
        </label>
    `).join('');

    const textoResumen = seleccionados.length
        ? escapeHtml(seleccionados.join(', '))
        : '<span style="color:#999;">-- Sin seleccionar --</span>';

    return `
        <div>
            <label style="font-size:13px; font-weight:600; color:#555; display:block; margin-bottom:4px;">${cfg.label}</label>
            <div style="position:relative;">
                <div id="${cfg.selectId}Display" class="campo-editable-select"
                     style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; cursor:${bloqueado ? 'default' : 'pointer'}; height:auto; min-height:38px; padding:8px 10px;">
                    <span id="${cfg.selectId}DisplayText" style="white-space:normal; overflow-wrap:break-word; line-height:1.4;">${textoResumen}</span>
                    <span class="material-symbols-outlined" style="font-size:18px; color:#777; flex-shrink:0; margin-top:1px;">expand_more</span>
                </div>
                <div id="${cfg.selectId}" style="display:none; position:absolute; z-index:20; top:calc(100% + 4px); left:0; right:0;
                     background:white; border:1px solid var(--color-border); border-radius:6px; box-shadow:0 4px 14px rgba(0,0,0,0.12);
                     max-height:220px; overflow-y:auto;">
                    ${checkboxes || '<span style="color:#999; font-size:12px; padding:8px 10px; display:block;">Sin opciones</span>'}
                </div>
            </div>
        </div>
    `;
}

function otrasOpcionesInstitucionHTML(lead, bloqueado) {
    const mostrar = (lead[COLUMNAS.OTRAS_OPCIONES] || '') === VALOR_OTRAS_OPCIONES_INSTITUCION;
    const tipoActual = lead[COLUMNAS.OPCION_INSTITUCION] || '';
    const nombreActual = lead[COLUMNAS.OPCION_NOMBRE_INSTITUCION] || '';

    return `
        <div id="otrasOpcionesInstitucionWrap" style="display:${mostrar ? 'grid' : 'none'}; grid-template-columns: repeat(2, 1fr); gap:12px; margin-top:12px;">
            <div>
                <label style="font-size:13px; font-weight:600; color:#555; display:block; margin-bottom:4px;">Tipo de Institución</label>
                ${selectSimpleHTML('selectOpcionInstitucionTipo', TIPOS_INSTITUCION_PROCEDENCIA, tipoActual, bloqueado)}
            </div>
            <div>
                <label style="font-size:13px; font-weight:600; color:#555; display:block; margin-bottom:4px;">Institución</label>
                ${inputBuscableHTML(
                    'selectOpcionInstitucionNombre',
                    opcionesInstitucionPorTipo(tipoActual),
                    nombreActual,
                    bloqueado || !tipoActual,
                    tipoActual ? 'Escribe para buscar...' : 'Selecciona primero el tipo',
                    true
                )}
            </div>
        </div>
    `;
}

function initChecklistPerfilamiento(cfg, bloqueado) {
    const display = document.getElementById(cfg.selectId + 'Display');
    const textEl = document.getElementById(cfg.selectId + 'DisplayText');
    const panel = document.getElementById(cfg.selectId);
    if (!display || !textEl || !panel) return;

    const cerrar = () => { panel.style.display = 'none'; };
    const abrir = () => { panel.style.display = 'block'; };

    if (!bloqueado) {
        display.addEventListener('click', () => {
            panel.style.display === 'none' ? abrir() : cerrar();
        });
    }

    panel.addEventListener('change', () => {
        const marcados = Array.from(panel.querySelectorAll(`.checklist-${cfg.selectId}:checked`)).map(el => el.value);
        textEl.innerHTML = marcados.length
            ? escapeHtml(marcados.join(', '))
            : '<span style="color:#999;">-- Sin seleccionar --</span>';
    });

    document.addEventListener('click', (e) => {
        if (!display.contains(e.target) && !panel.contains(e.target)) cerrar();
    });
}

function onCambioSelectorPerfilamiento(cfg) {
    const select = document.getElementById(cfg.selectId);
    const display = document.getElementById(cfg.selectId + 'Descripcion');
    if (!select || !display) return;

    if (cfg.permiteAgregarNuevo) {
        const wrapNuevo = document.getElementById(cfg.selectId + 'NuevoWrap');
        const errorEl = document.getElementById(cfg.selectId + 'NuevoError');
        if (errorEl) errorEl.style.display = 'none';

        if (select.value === '__nuevo__') {
            if (wrapNuevo) wrapNuevo.style.display = 'block';
            display.style.display = 'none';
            return;
        }
        if (wrapNuevo) wrapNuevo.style.display = 'none';
    }

    const item = (state[cfg.stateKey] || []).find(d => String(d.nombre) === select.value);
    display.textContent = item ? (item.descripcion || '') : '';
    display.style.display = (item && item.descripcion) ? 'block' : 'none';
}

async function guardarPerfilamiento(idPrometeo) {
    const getVal = id => { const el = document.getElementById(id); return el ? el.value : ''; };
    const data = {};
    let dolorDescripcionNueva = '';

    for (const cfg of CAMPOS_SELECT_PERFILAMIENTO) {
        if (cfg.permiteMultiple) {
            const marcados = Array.from(document.querySelectorAll(`.checklist-${cfg.selectId}:checked`)).map(el => el.value);
            data[cfg.columna] = marcados.join(', ');
            continue;
        }

        const select = document.getElementById(cfg.selectId);
        if (!select) continue;

        if (cfg.permiteAgregarNuevo && select.value === '__nuevo__') {
            const nombre = getVal(cfg.selectId + 'NuevoNombre').trim();
            const descripcion = getVal(cfg.selectId + 'NuevaDescripcion').trim();
            const errorEl = document.getElementById(cfg.selectId + 'NuevoError');
            const mostrarError = (msg) => { if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'inline'; } };

            if (!nombre || !descripcion) {
                mostrarError('Completa el nombre y la descripción del nuevo Dolor/Necesidad.');
                return;
            }
            if (nombre.split(/\s+/).filter(Boolean).length > 5) {
                mostrarError('El nombre debe tener máximo 5 palabras.');
                return;
            }
            data[cfg.columna] = nombre;
            dolorDescripcionNueva = descripcion;
        } else {
            data[cfg.columna] = select.value;
        }
    }

    if (dolorDescripcionNueva) data['DOLOR_DESCRIPCION_NUEVA'] = dolorDescripcionNueva;

    if (data[COLUMNAS.OTRAS_OPCIONES] === VALOR_OTRAS_OPCIONES_INSTITUCION) {
        data[COLUMNAS.OPCION_INSTITUCION] = getVal('selectOpcionInstitucionTipo');
        data[COLUMNAS.OPCION_NOMBRE_INSTITUCION] = getVal('selectOpcionInstitucionNombre').trim();
    } else {
        data[COLUMNAS.OPCION_INSTITUCION] = '';
        data[COLUMNAS.OPCION_NOMBRE_INSTITUCION] = '';
    }

    data[COLUMNAS.COMENTARIOS_PERFIL] = getVal('inputComentariosPerfil');
    data[COLUMNAS.FECHA_ULT_MODIFICACION] = new Date().toISOString();

    const acciones = document.getElementById('inputAccionesDefinidas');
    if (acciones) data[COLUMNAS.ACCIONES_DEFINIDAS] = acciones.value;

    const user = getCurrentUser();
    const asesorPropietario = esRolSupervisorOAdmision(user.rol)
        ? (state.lead[COLUMNAS.ASESOR_EMAIL] || user.email)
        : user.email;

    mostrarOverlay(true);
    try {
        const result = await callAPI('saveBottom', {
            idPrometeo, campana: state.campana, data, asesorEmail: asesorPropietario
        });

        if (result.success) {
            if (dolorDescripcionNueva) await actualizarCatalogosPerfilamiento();
            Object.assign(state.lead, data);
            sincronizarCache();
            renderVista2();
            notificar('Perfilamiento guardado');
        } else {
            notificar('Error al guardar: ' + (result?.error || 'Error desconocido'), 'err');
        }
    } catch (e) {
        notificar('Error de conexión: ' + e.message, 'err');
    } finally {
        mostrarOverlay(false);
    }
}

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
        OTRAS_OPCIONES: '¿Cuáles son sus otras opciones?',        
        QUE_LE_FALTA: '¿Qué le falta para tomar una decisión?',
        QUIEN_FINANCIARA: '¿Quién financiará la carrera?',
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
            notificar('Versión restablecida');
        } else {
            notificar('Error al restablecer: ' + (result?.error || 'Error desconocido'), 'err');
        }
    } catch (e) {
        notificar('Error de conexión: ' + e.message, 'err');
    } finally {
        mostrarOverlay(false);
    }
}

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
            notificar('Comentario agregado');
        } else {
            notificar('Error al agregar comentario: ' + (result?.error || 'Error desconocido'), 'err');
        }
    } catch (e) {
        notificar('Error de conexión: ' + e.message, 'err');
    } finally {
        mostrarOverlay(false);
    }
}

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

document.addEventListener('click', async (e) => {
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
                notificar(status === 'APROBADO' ? 'Recategorización aprobada' : 'Recategorización rechazada');
            } else {
                notificar('Error: ' + (result?.error || 'Error desconocido'), 'err');
            }
        } catch (err) {
            notificar('Error de conexión: ' + err.message, 'err');
        } finally {
            mostrarOverlay(false);
        }
    }

    if (e.target.id === 'btnSolicitarEscala') {
        const sel = document.getElementById('selectEscalaMenor');
        const msgEl = document.getElementById('solicitudMsg');
        if (!sel || !sel.value) {
            notificar('Selecciona una boleta para solicitar.', 'err');
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
                notificar('Solicitud de recategorización enviada');
            } else {
                if (msgEl) msgEl.textContent = '';
                notificar('Error: ' + (result?.error || 'Error desconocido'), 'err');
            }
        } catch (err) {
            if (msgEl) msgEl.textContent = '';
            notificar('Error de conexión: ' + err.message, 'err');
        }
    }

    if (e.target.id === 'btnCancelarSolicitud') {
        const idSol = state.solicitudPendiente?.ID_SOLICITUD;
        if (!idSol || !confirm('¿Confirmas cancelar tu solicitud pendiente?')) return;
        try {
            const result = await callAPI('cancelarSolicitud', { id: idSol });
            if (result.success) {
                state.solicitudPendiente = null;
                renderVista1();
                notificar('Solicitud de recategorización cancelada');
            } else {
                notificar('Error: ' + (result?.error || 'Error desconocido'), 'err');
            }
        } catch (err) {
            notificar('Error de conexión: ' + err.message, 'err');
        }
    }
});

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
    cacheRemove(CACHE_KEYS.LEADS_RAW(user.email, user.rol, state.campana));
}

function mostrarOverlay(show) {
    const el = document.getElementById('overlayGuardando');
    if (el) el.classList.toggle('show', show);
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