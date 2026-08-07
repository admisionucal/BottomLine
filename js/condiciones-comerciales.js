// ================================================================
// CONDICIONES COMERCIALES - Módulo de solicitudes CC (Supervisor/Admisión)
// ================================================================

import { API_URL, esRolSupervisorOAdmision, COLUMNAS, CACHE_KEYS, BCC_DEFAULT_CC, SELECT_OPTIONS, CARRERAS_ETU } from '../core/constants.js';

import {
    getCurrentUser, getUserCampanas, getSessionToken,
    cacheGet, cacheSet, cacheRemove,
    escapeHtml, formatearFecha
} from '../core/utils.js';

import { Sidebar, renderTable, Toast, createMultiSelect } from '../core/components.js';

import { construirDatosCC, renderPlantillaCC, renderPlantillaCCPreview, detectarTipoReferido, precargarLogoCC } from './cc-template.js';

// PDFs servidos como assets estáticos del proyecto (carpeta assets/), con
// el nombre real del archivo tal como se guarda cada semestre — incluye el
// periodo (ej. "2026-2") porque cambia de campaña en campaña.
// nombrePdf() da el nombre "plano" (el que se manda al backend para que el
// adjunto del correo salga con el nombre real, no uno genérico); rutaAsset()
// lo codifica para poder hacer fetch() de ese archivo.
function nombrePdf(nombreBase) {
    return `${nombreBase}.pdf`;
}
function rutaAsset(nombreArchivo) {
    return 'assets/' + encodeURIComponent(nombreArchivo);
}
const NOMBRE_LINEAMIENTOS_5C = (periodo) => nombrePdf(`Lineamientos de Admisión para ingresantes al semestre académico ${periodo}`);
const NOMBRE_LINEAMIENTOS_6C = (periodo) => nombrePdf(`Lineamientos de Admisión para ingresantes al semestre académico ${periodo} - 6c`);

function nombreLineamientosSegunCuotas(datosCC) {
    return datosCC.mostrar6Cuotas ? NOMBRE_LINEAMIENTOS_6C(datosCC.periodo) : NOMBRE_LINEAMIENTOS_5C(datosCC.periodo);
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

// ===== ESTADO =====
const state = {
    solicitudes: [],
    solicitudesFiltradas: [],
    terminoBusqueda: '',
    filtros: { carrera: [], asesor: [], estado: [], campana: [] },
    currentPage: 1,
    pageSize: 11,
    pagesPerBlock: 20,
    ultimaActualizacion: null,
    // Vista 2
    solicitudActual: null,
    leadActual: null,
    catalogoBeneficios: [],
    overrides: {},
    personasReferido: [],
    tipoReferente: 'nuevo',
    tipoReferidoActual: null
};

// true cuando esta vista vive embebida dentro de dashboard.html: en ese
// caso no tocamos la URL del navegador (nada de pushState/history), a
// diferencia del modo standalone donde sí queremos URLs compartibles.
let modoEmbebido = false;

// detectarTipoReferido se importa de cc-template.js (antes había una copia
// local aquí que comparaba contra los strings exactos del script viejo de
// Cargos y nunca hacía match con el LABEL real del catálogo de BENEFICIOS
// — ej. el catálogo real usa "Referido - 50% dscto. 1ra boleta", no
// "Descuento referido - 50% dscto. 1ra boleta". Ahora ambos archivos usan
// el mismo detector por palabras clave, para que no se desincronicen).

// PDFs de Referidos/Referentes (mismo patrón que NOMBRE_LINEAMIENTOS_5C).
// stock = alumno ya matriculado; nuevo = ingresante en proceso de admisión.
const NOMBRE_TERMINOS_REFERIDO = (periodo) => nombrePdf(`T&C - REFERIDO ${periodo}`);
const NOMBRE_TERMINOS_REFERENTE_ALUMNO = (periodo) => nombrePdf(`T&C - REFERENTE ALUMNO ${periodo}`);
const NOMBRE_TERMINOS_REFERENTE_INGRESANTE = (periodo) => nombrePdf(`T&C - REFERENTE INGRESANTE ${periodo}`);

// ===== INICIALIZACIÓN =====
document.addEventListener('DOMContentLoaded', () => {
    initCC();
});

// ===== PUNTO DE ENTRADA (para embebido en dashboard) =====
window.initCCEmbebido = function() {
    initCC();
};

let __ccListenersAtados = false;

function initCC() {
    const user = getCurrentUser();
    if (!user) {
        window.location.href = 'index.html';
        return;
    }

    if (!esRolSupervisorOAdmision(user.rol)) {
        alert('Acceso denegado: Privilegios insuficientes.');
        if (typeof window.mostrarBottomLine === 'function') {
            window.mostrarBottomLine();
        } else {
            window.location.href = 'dashboard.html?view=bottomline';
        }
        return;
    }

    // Si el sidebar ya existe (venimos embebidos dentro de dashboard.html)
    // no creamos uno nuevo; si es la página standalone, sí.
    modoEmbebido = !!document.querySelector('.sidebar-nav');
    if (!modoEmbebido) {
        new Sidebar({ active: 'cargos', activeSubitem: 'navCondicionesCC' });
    }

    // Los listeners solo se atan una vez: los elementos del DOM persisten
    // entre reingresos a esta vista (embebida o standalone).
    if (!__ccListenersAtados) {
        document.getElementById('btnActualizarCC')?.addEventListener('click', () => cargarSolicitudesCC(true));
        document.getElementById('btnExportarCC')?.addEventListener('click', exportarSolicitudesCCExcel);
        document.getElementById('filtrosToggleBtnCC')?.addEventListener('click', () => {
            document.getElementById('navFiltrosPanelCC')?.classList.toggle('open');
        });
        document.getElementById('ccSearchInput')?.addEventListener('input', (e) => {
            state.terminoBusqueda = e.target.value.trim().toLowerCase();
            aplicarFiltrosCC();
        });
        window.addEventListener('multiselect-change', (e) => {
            const mapaClaves = { cccarrera: 'carrera', ccasesor: 'asesor', ccestado: 'estado', cccampana: 'campana' };
            const filtroKey = mapaClaves[e.detail.key];
            if (filtroKey && Object.prototype.hasOwnProperty.call(state.filtros, filtroKey)) {
                state.filtros[filtroKey] = e.detail.values;
                aplicarFiltrosCC();
            }
        });
        __ccListenersAtados = true;
    }

    // El id de solicitud en la URL (para abrir directo en el detalle) solo
    // aplica en modo standalone: embebido, la URL es la de dashboard.html.
    const idSolicitud = !modoEmbebido
        ? new URLSearchParams(window.location.search).get('id')
        : null;

    if (idSolicitud) {
        mostrarVistaDetalle(idSolicitud);
    } else {
        // mostrarVistaLista() (y no solo cargarSolicitudesCC()) porque al
        // reingresar embebido puede haber quedado la vista de detalle
        // abierta de una visita anterior.
        mostrarVistaLista();
    }
}

// ===== VISTA 1: LISTADO =====
// Mismo patrón de caché que loadLeads() en dashboard.js: sessionStorage
// por email+rol, con forceRefresh para el botón "Actualizar".
async function cargarSolicitudesCC(forceRefresh = false) {
    const user = getCurrentUser();
    const wrap = document.getElementById('tablaCCWrap');

    // '_v2' fuerza a descartar cualquier caché vieja en sessionStorage que no
    // tenga los campos MODALIDAD_LEAD/MODALIDAD_INGRESO_LEAD/BENEFICIO_LEAD/
    // CELULAR_LEAD (agregados después) — si no, quedan "vacíos" hasta que el
    // usuario le dé manualmente a Actualizar.
    const cacheKey = CACHE_KEYS.SOLICITUDES_CC(user.email, user.rol, true) + '_v2';
    if (!forceRefresh) {
        const cached = cacheGet(cacheKey);
        if (cached && cached.data) {
            state.solicitudes = cached.data;
            state.ultimaActualizacion = cached.timestamp;
            aplicarFiltrosCC();
            return;
        }
    }

    wrap.innerHTML = '<div class="loading">Cargando solicitudes...</div>';

    try {
        const result = await callAPI('getSolicitudesCC', {
            campanas: getUserCampanas(),
            incluirResueltas: true
        });

        if (!result.success) {
            wrap.innerHTML = `<div class="loading">Error: ${escapeHtml(result.error || 'No se pudieron cargar las solicitudes')}</div>`;
            return;
        }

        state.solicitudes = result.data || [];
        state.ultimaActualizacion = Date.now();
        cacheSet(cacheKey, { data: state.solicitudes, timestamp: state.ultimaActualizacion });
        aplicarFiltrosCC();
    } catch (e) {
        wrap.innerHTML = `<div class="loading">Error de conexión: ${escapeHtml(e.message)}</div>`;
    }
}

const ORDEN_ESTADO_CC = { PENDIENTE: 0, PROCESANDO: 0, ENVIADO: 1, RECHAZADO: 2 };

function aplicarFiltrosCC() {
    const { carrera, asesor, estado, campana } = state.filtros;

    state.solicitudesFiltradas = state.solicitudes.filter(sol => {
        if (carrera.length > 0 && !carrera.includes(sol.CARRERA_LEAD || '')) return false;
        if (asesor.length > 0 && !asesor.includes(sol.ASESOR_NOMBRE || sol.ASESOR_EMAIL || '')) return false;
        if (estado.length > 0 && !estado.includes(sol.STATUS || '')) return false;
        if (campana.length > 0 && !campana.includes(sol.CAMPANA || '')) return false;

        if (state.terminoBusqueda) {
            const id = String(sol.ID_PROMETEO || '').toLowerCase();
            const nombre = String(sol.NOMBRE_LEAD || '').toLowerCase();
            const celular = String(sol.CELULAR_LEAD || '').toLowerCase();
            if (!id.includes(state.terminoBusqueda) && !nombre.includes(state.terminoBusqueda) && !celular.includes(state.terminoBusqueda)) return false;
        }
        return true;
    });

    // Orden fijo: Pendiente/Procesando primero, luego Enviado, luego
    // Rechazado; dentro de cada grupo, más reciente primero.
    state.solicitudesFiltradas.sort((a, b) => {
        const ordenA = ORDEN_ESTADO_CC[a.STATUS] ?? 3;
        const ordenB = ORDEN_ESTADO_CC[b.STATUS] ?? 3;
        if (ordenA !== ordenB) return ordenA - ordenB;
        return new Date(b.FECHA_SOLICITUD || 0) - new Date(a.FECHA_SOLICITUD || 0);
    });

    state.currentPage = 1;
    renderTablaCC();
    populateFiltrosCC();
}

function populateFiltrosCC() {
    const getValues = (campo) => state.solicitudes.map(s => s[campo] || '').filter(v => v && String(v).trim() !== '');
    createMultiSelect('filterCCCarrera', getValues('CARRERA_LEAD'), state.filtros.carrera, 'Todas');
    createMultiSelect('filterCCAsesor', state.solicitudes.map(s => s.ASESOR_NOMBRE || s.ASESOR_EMAIL || ''), state.filtros.asesor, 'Todos');
    createMultiSelect('filterCCEstado', getValues('STATUS'), state.filtros.estado, 'Todos');
    createMultiSelect('filterCCCampana', getValues('CAMPANA'), state.filtros.campana, 'Todas');
}

function renderTablaCC() {
    const wrap = document.getElementById('tablaCCWrap');
    const total = state.solicitudesFiltradas.length;

    const contador = document.getElementById('ccCount');
    if (contador) contador.textContent = `${total} solicitud${total === 1 ? '' : 'es'}`;

    if (total === 0) {
        wrap.innerHTML = '<p style="padding:20px;color:#888;">No hay solicitudes de Condiciones Comerciales.</p>';
        renderPaginacionCC(0);
        return;
    }

    const totalPages = Math.ceil(total / state.pageSize);
    if (state.currentPage > totalPages) state.currentPage = Math.max(1, totalPages);
    const start = (state.currentPage - 1) * state.pageSize;
    const pageItems = state.solicitudesFiltradas.slice(start, start + state.pageSize);

    // Mismas clases de badge que el resto de la app (STATUS_CLASES /
    // .status-badge en ui-kit.css) en vez de un badge propio — así el
    // color/estilo de "estado" es consistente en toda la app.
    const ESTADO_INFO = {
        PENDIENTE: { clase: 'status-pp', label: 'Pendiente' },
        PROCESANDO: { clase: 'status-pp', label: 'Enviando…' },
        ENVIADO: { clase: 'status-vp', label: 'Enviado' },
        RECHAZADO: { clase: 'status-perdido', label: 'Rechazado' }
    };

    const headers = ['ID PROMETEO', 'NOMBRE', 'CARRERA', 'ASESOR', 'CAMPAÑA', 'FECHA SOLICITUD', 'ESTADO'];
    const rows = pageItems.map(sol => {
        const estado = ESTADO_INFO[sol.STATUS] || ESTADO_INFO.PENDIENTE;
        return [
            `<a href="#" class="id-link" onclick="window.irADetalleCC && window.irADetalleCC('${escapeHtml(sol.ID_SOLICITUD)}'); return false;"><strong>${escapeHtml(sol.ID_PROMETEO || '')}</strong></a>`,
            escapeHtml(sol.NOMBRE_LEAD || 'Sin nombre'),
            escapeHtml(sol.CARRERA_LEAD || '-'),
            escapeHtml(sol.ASESOR_NOMBRE || sol.ASESOR_EMAIL || '-'),
            escapeHtml(sol.CAMPANA || ''),
            escapeHtml(formatearFecha(sol.FECHA_SOLICITUD)),
            `<span class="status-badge ${estado.clase}">${estado.label}</span>`
        ];
    });

    renderTable('tablaCCWrap', headers, rows);
    renderPaginacionCC(totalPages);

    // window.irADetalleCC se registra una sola vez más abajo (fuera de este
    // render) para que el onclick inline del HTML generado lo encuentre.
}

function renderPaginacionCC(totalPages) {
    const container = document.getElementById('paginationCCPages');
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
        if (!disabled && page) btn.onclick = () => { state.currentPage = page; renderTablaCC(); };
        container.appendChild(btn);
    };

    addBtn('‹', state.currentPage - 1, state.currentPage === 1);
    if (inicioBloque > 1) addBtn('‹‹', inicioBloque - 1);
    for (let i = inicioBloque; i <= finBloque; i++) {
        addBtn(String(i), i, false, i === state.currentPage ? 'active' : '');
    }
    if (finBloque < totalPages) addBtn('››', finBloque + 1);
    addBtn('›', state.currentPage + 1, state.currentPage === totalPages);
}

// window.irADetalleCC — registrado a nivel de módulo (no dentro de
// renderTablaCC) porque el HTML se regenera en cada render/página y el
// onclick inline necesita encontrar la función en window de forma estable.
window.irADetalleCC = function (idSolicitud) {
    const solicitud = state.solicitudes.find(s => s.ID_SOLICITUD === idSolicitud);
    irADetalle(solicitud || { ID_SOLICITUD: idSolicitud });
};

function exportarSolicitudesCCExcel() {
    if (state.solicitudesFiltradas.length === 0) {
        alert('No hay datos para exportar');
        return;
    }
    const datos = state.solicitudesFiltradas.map(sol => ({
        'ID PROMETEO': sol.ID_PROMETEO || '',
        'NOMBRE': sol.NOMBRE_LEAD || '',
        'CARRERA': sol.CARRERA_LEAD || '',
        'ASESOR': sol.ASESOR_NOMBRE || sol.ASESOR_EMAIL || '',
        'CAMPAÑA': sol.CAMPANA || '',
        'FECHA SOLICITUD': formatearFecha(sol.FECHA_SOLICITUD),
        'ESTADO': sol.STATUS || '',
        'MOTIVO RECHAZO': sol.MOTIVO_RECHAZO || ''
    }));
    const ws = XLSX.utils.json_to_sheet(datos);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Condiciones Comerciales');
    XLSX.writeFile(wb, `CondicionesComerciales_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function irADetalle(solicitud) {
    if (!modoEmbebido) {
        const url = `condiciones-comerciales.html?id=${encodeURIComponent(solicitud.ID_SOLICITUD)}`;
        window.history.pushState({}, '', url);
    }
    mostrarVistaDetalle(solicitud.ID_SOLICITUD, solicitud);
}

function mostrarVistaLista() {
    document.getElementById('vistaDetalleCC').style.display = 'none';
    document.getElementById('vistaListaCC').style.display = 'block';
    cargarSolicitudesCC();
}

// Se llama tras enviar/rechazar: la fila cambió de STATUS, así que el
// caché de sessionStorage queda desactualizado hasta el próximo forceRefresh.
function invalidarCacheSolicitudesCC() {
    const user = getCurrentUser();
    cacheRemove(CACHE_KEYS.SOLICITUDES_CC(user.email, user.rol, true));
    cacheRemove(CACHE_KEYS.SOLICITUDES_CC(user.email, user.rol, false));
}

// ===== VISTA 2: DETALLE =====
async function mostrarVistaDetalle(idSolicitud, solicitudPrecargada) {
    document.getElementById('vistaListaCC').style.display = 'none';
    document.getElementById('vistaDetalleCC').style.display = 'block';

    const container = document.getElementById('detalleCCContainer');
    container.innerHTML = '<div class="loading">Cargando solicitud...</div>';

    try {
        // Si venimos del listado ya tenemos la solicitud; si venimos de una URL
        // directa (?id=...), hay que buscarla en el listado completo primero.
        let solicitud = solicitudPrecargada;
        if (!solicitud) {
            const resultLista = await callAPI('getSolicitudesCC', {
                campanas: getUserCampanas(),
                incluirResueltas: true
            });
            if (!resultLista.success) throw new Error(resultLista.error || 'No se pudo cargar la solicitud');
            solicitud = (resultLista.data || []).find(s => s.ID_SOLICITUD === idSolicitud);
            if (!solicitud) throw new Error('Solicitud no encontrada');
        }

        state.solicitudActual = solicitud;
        state.overrides = {};
        state.personasReferido = [];
        state.tipoReferente = 'nuevo';
        state.tipoReferidoActual = null;

        const [resultLead, resultCatalogos] = await Promise.all([
            callAPI('getLeadDetail', { id: solicitud.ID_PROMETEO, campana: solicitud.CAMPANA }),
            callAPI('getCatalogos', {}),
            precargarLogoCC()
        ]);

        if (!resultLead.success) throw new Error(resultLead.error || 'No se pudo cargar el lead');

        state.leadActual = resultLead.data;
        state.catalogoBeneficios = (resultCatalogos.success && resultCatalogos.data.beneficios) || [];

        renderDetalleCC();
    } catch (e) {
        container.innerHTML = `<div class="loading">Error: ${escapeHtml(e.message)}</div>`;
    }
}

function opcionesBeneficioAdicional() {
    return state.catalogoBeneficios
        .filter(f => String(f.TIPO || '').trim().toUpperCase() === 'ADICIONAL')
        // "Sin descuento adicional" es redundante con "-- Ninguno --" — se
        // oculta de este dropdown a pedido explícito.
        .filter(f => String(f.LABEL || '').trim().toLowerCase() !== 'sin descuento adicional')
        .map(f => ({
            value: `${f.VALOR}||${f.MODO || ''}||${f.LABEL || ''}`,
            label: f.LABEL || String(f.VALOR)
        }));
}

function renderDetalleCC() {
    const container = document.getElementById('detalleCCContainer');
    const sol = state.solicitudActual;
    const lead = state.leadActual;

    const carreraActual = state.overrides.carrera ?? (lead[COLUMNAS.CARRERA] || lead[COLUMNAS.PROGRAMA] || '');
    const modalidadActual = state.overrides.modalidadEstudio ?? (lead[COLUMNAS.MODALIDAD] || '');
    // Si el valor real del lead no calza con ninguna de las dos opciones
    // estándar (por capitalización distinta, espacios, u otra modalidad),
    // se agrega igual como opción seleccionable en vez de perderlo o
    // disfrazarlo con el "Semi-Presencial" que el navegador marca por
    // defecto cuando ningún <option> trae "selected".
    const modalidadOpcionesCC = ['Semi-Presencial', 'Remoto'];
    if (modalidadActual && !modalidadOpcionesCC.includes(modalidadActual)) modalidadOpcionesCC.push(modalidadActual);
    const matriculaActual = state.overrides.montoMatricula ?? (lead['MATRICULA_FINAL'] ?? '');
    const examenActual = state.overrides.montoExamen ?? (lead['ADMISION_FINAL'] ?? '');
    const escalaRegularActual = state.overrides.escalaRegular ?? (lead[COLUMNAS.BOLETA] ?? '');
    const escalaFinalActual = state.overrides.escalaFinal ?? (lead[COLUMNAS.BOLETA_CON_BECA] ?? '');
    const tipoBecaActual = state.overrides.tipoBeca ?? (lead[COLUMNAS.BENEFICIO] ?? '');
    const beneficioRawActual = state.overrides.beneficioPrimeraRaw ?? (lead[COLUMNAS.BENEFICIO_ADICIONAL] ?? '');
    const tipoAlumnoActual = state.overrides.tipoAlumno ?? (lead[COLUMNAS.TIPO_ALUMNO] || 'ALUMNO REGULAR');
    const cuotasActual = state.overrides.cuotas ?? (lead[COLUMNAS.NUMERO_CUOTAS] || '5 cuotas');
    const esCarreraElegibleETU = !!CARRERAS_ETU[carreraActual];

    const modalidadIngresoLead = String(lead[COLUMNAS.MODALIDAD_INGRESO] || '').toLowerCase();
    const tipoIngresoDefault = modalidadIngresoLead.indexOf('con conva') !== -1
        ? 'con_convalidacion'
        : modalidadIngresoLead.indexOf('sin conva') !== -1
            ? 'sin_convalidacion'
            : 'regular';
    const tipoIngresoActual = state.overrides.tipoIngresoOverride ?? tipoIngresoDefault;
    const esExtraordinario = tipoIngresoActual !== 'regular';
    const esExtraordinarioConva = tipoIngresoActual === 'con_convalidacion';

    const opcionesBenef = opcionesBeneficioAdicional();
    const benefSelected = opcionesBenef.find(o => o.value === String(beneficioRawActual))?.value
        || opcionesBenef.find(o => o.value.split('||')[0] === String(beneficioRawActual))?.value
        || '';

    // Editables: solo ID_PROMETEO y CAMPANA quedan fijos (identifican la
    // fila real en el backend); todo lo demás, incluido nombre y asesor,
    // se puede ajustar como override local de esta solicitud.
    const nombreActual = state.overrides.nombreCompleto ?? (lead[COLUMNAS.NOMBRES] || '');
    const asesorActual = state.overrides.asesorNombre ?? (sol.ASESOR_NOMBRE || sol.ASESOR_EMAIL || '');

    const adjuntos = [
        { label: 'DNI', id: sol.DNI_FILE_ID, nombre: sol.DNI_FILE_NOMBRE },
        { label: 'Certificado de Estudios', id: sol.CERTIFICADO_FILE_ID, nombre: sol.CERTIFICADO_FILE_NOMBRE }
    ];
    // Boleta de Procedencia: mismo criterio que en lead-detail.js (solo aplica
    // a Traslado con o sin convalidación) — para Ordinario ni se pide al
    // solicitar ni debe listarse acá como documento pendiente.
    if (tipoIngresoActual !== 'regular') {
        adjuntos.push({ label: 'Boleta de Procedencia', id: sol.BOLETA_PROCEDENCIA_FILE_ID, nombre: sol.BOLETA_PROCEDENCIA_FILE_NOMBRE });
    }

    const correosDestinoDefault = [
        lead[COLUMNAS.EMAIL],
        ...(String(sol.CORREOS_ADICIONALES || '').split(',').map(c => c.trim()).filter(Boolean))
    ].filter(Boolean);
    const correosDestinoActual = state.overrides.correosDestino ?? correosDestinoDefault.join(', ');

    container.innerHTML = `
        <div style="background:white; padding:24px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.05); margin-bottom:20px; text-align:left;">
            <h3 style="color:var(--color-primary); margin:0 0 16px 0; font-size:16px;">
                ID PROMETEO: <span style="font-weight:400; color:#666;">${escapeHtml(String(sol.ID_PROMETEO || '-'))}</span>
            </h3>
            <div style="display:grid; grid-template-columns: repeat(${esExtraordinario ? 3 : 4}, 1fr); gap:20px;">
                ${campoHTML('CAMPAÑA', sol.CAMPANA)}
                ${campoHTML('COLEGIO', lead[COLUMNAS.COLEGIO])}
                ${campoHTML('CÓDIGO MODULAR', lead[COLUMNAS.CODIGO_MODULAR])}
                ${esExtraordinario ? campoHTML('INSTITUCIÓN DE PROCEDENCIA', lead[COLUMNAS.INSTITUCION_PROCEDENCIA]) : ''}
                ${esExtraordinario ? campoHTML('CARRERA DE PROCEDENCIA', lead[COLUMNAS.CARRERA_PROCEDENCIA]) : ''}
                ${esExtraordinario ? campoHTML('BOLETA DE PROCEDENCIA', lead[COLUMNAS.BOLETA_PROCEDENCIA]) : ''}
                ${esExtraordinarioConva ? campoHTML('EN QUE CICLO SE QUEDO', lead[COLUMNAS.CICLO_QUEDO]) : ''}
                ${esExtraordinarioConva ? campoHTML('TIEMPO OFRECIDO', lead[COLUMNAS.TIEMPO_OFRECIDO]) : ''}
                ${campoHTML('MÉTODO DE PAGO', lead[COLUMNAS.METODO_PAGO])}
            </div>
        </div>
        <div style="display:flex; gap:20px; align-items:flex-start; flex-wrap:wrap; text-align:left;">
            <div style="flex:1 1 380px; background:white; border-radius:10px; box-shadow:0 1px 4px rgba(0,0,0,0.06); padding:24px;">
                <h3 style="font-size:16px; color:var(--color-primary); margin:0 0 16px 0;">Datos de la boleta</h3>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
                    <label class="cc-campo">Tipo de Alumno
                        <select id="ccTipoAlumno">
                            ${SELECT_OPTIONS.tipoAlumno.map(o =>
                                `<option value="${o}" ${o === tipoAlumnoActual ? 'selected' : ''}>${o === 'ALUMNO ETU' ? 'Alumno ETU' : 'Alumno Regular'}</option>`
                            ).join('')}
                        </select>
                        <span id="ccTipoAlumnoHint" style="display:${(tipoAlumnoActual === 'ALUMNO ETU' && !esCarreraElegibleETU) ? 'block' : 'none'}; font-size:11px; color:#c62828; margin-top:4px;">
                            Esta carrera no tiene especialización ETU definida; no se incluirá en el PDF.
                        </span>
                    </label>
                    <label class="cc-campo">Número de Cuotas
                        <select id="ccCuotas">
                            ${SELECT_OPTIONS.cuotas.map(o =>
                                `<option value="${o}" ${o === cuotasActual ? 'selected' : ''}>${o}</option>`
                            ).join('')}
                        </select>
                    </label>
                    <label class="cc-campo" style="grid-column:1 / -1;">Nombre completo
                        <input type="text" id="ccNombreCompleto" value="${escapeHtml(nombreActual)}">
                    </label>
                    <label class="cc-campo">Asesor
                        <input type="text" id="ccAsesorNombre" value="${escapeHtml(asesorActual)}">
                    </label>
                    <label class="cc-campo">Carrera
                        <input type="text" id="ccCarrera" value="${escapeHtml(carreraActual)}">
                    </label>
                    <label class="cc-campo">Modalidad
                        <select id="ccModalidad">
                            ${!modalidadActual ? '<option value="" selected disabled>-- Sin definir --</option>' : ''}
                            ${modalidadOpcionesCC.map(m =>
                                `<option value="${m}" ${m === modalidadActual ? 'selected' : ''}>${m}</option>`
                            ).join('')}
                        </select>
                    </label>
                    <label class="cc-campo">Matrícula (S/)
                        <input type="number" id="ccMatricula" value="${escapeHtml(String(matriculaActual))}">
                    </label>
                    <label class="cc-campo">Examen Admisión (S/)
                        <input type="number" id="ccExamen" value="${escapeHtml(String(examenActual))}">
                    </label>
                    <label class="cc-campo">Escala Regular (S/)
                        <input type="number" id="ccEscalaRegular" value="${escapeHtml(String(escalaRegularActual))}">
                    </label>
                    <label class="cc-campo">Escala Final / con Beca (S/)
                        <input type="number" id="ccEscalaFinal" value="${escapeHtml(String(escalaFinalActual))}">
                    </label>
                    <label class="cc-campo">Tipo de Beca
                        <input type="text" id="ccTipoBeca" value="${escapeHtml(tipoBecaActual)}" placeholder="Ej: Beca Impacto">
                    </label>
                    <label class="cc-campo">Tipo de Ingreso
                        <select id="ccTipoIngreso">
                            <option value="regular" ${tipoIngresoActual === 'regular' ? 'selected' : ''}>Ordinario</option>
                            <option value="con_convalidacion" ${tipoIngresoActual === 'con_convalidacion' ? 'selected' : ''}>Traslado con Convalidación</option>
                            <option value="sin_convalidacion" ${tipoIngresoActual === 'sin_convalidacion' ? 'selected' : ''}>Traslado sin Convalidación</option>
                        </select>
                    </label>
                    <label class="cc-campo">Beneficio 1ra Boleta
                        <select id="ccBeneficioAdicional">
                            <option value="">-- Ninguno --</option>
                            ${opcionesBenef.map(o =>
                                `<option value="${escapeHtml(o.value)}" ${o.value === benefSelected ? 'selected' : ''}>${escapeHtml(o.label)}</option>`
                            ).join('')}
                        </select>
                    </label>
                </div>

                <div id="ccReferidosBlockVista2" style="display:none; margin-top:20px; border-top:1px solid #eee; padding-top:16px;">
                    <h4 id="ccReferidosTitulo" style="font-size:13px; margin-bottom:4px;"></h4>
                    <p id="ccReferidosHintVista2" style="font-size:12px; color:#888; margin-bottom:8px;"></p>
                    <div id="ccReferidosTipoWrap" style="display:none; margin-bottom:10px;">
                        <label class="cc-campo">Tipo de Referente
                            <select id="ccTipoReferente">
                                <option value="nuevo" ${state.tipoReferente === 'nuevo' ? 'selected' : ''}>Alumno Nuevo</option>
                                <option value="stock" ${state.tipoReferente === 'stock' ? 'selected' : ''}>Alumno Stock</option>
                            </select>
                        </label>
                    </div>

                    <!-- REFERIDO: una sola persona (el referente), sin lista ni botón Agregar -->
                    <div id="ccReferidoUnicoWrap" style="display:none; flex-direction:column; gap:10px;">
                        <label class="cc-campo">Nombre completo
                            <input type="text" id="ccRefUnicoNombre">
                        </label>
                        <div style="display:flex; gap:8px;">
                            <label class="cc-campo" style="flex:1;">DNI (8 dígitos)
                                <input type="text" id="ccRefUnicoDni" maxlength="8">
                            </label>
                            <label class="cc-campo" style="flex:1;">Email
                                <input type="email" id="ccRefUnicoEmail">
                            </label>
                        </div>
                    </div>

                    <!-- REFERENTE: lista de varias personas (los referidos), con Agregar -->
                    <div id="ccReferidoListaWrap" style="display:none;">
                        <div id="ccPersonasReferidoLista" style="display:flex; flex-direction:column; gap:6px; margin-bottom:10px;"></div>
                        <div style="display:flex; flex-direction:column; gap:10px;">
                            <label class="cc-campo">Nombre completo
                                <input type="text" id="ccRefNombre">
                            </label>
                            <div style="display:flex; gap:8px;">
                                <label class="cc-campo" style="flex:1;">DNI (8 dígitos)
                                    <input type="text" id="ccRefDni" maxlength="8">
                                </label>
                                <label class="cc-campo" style="flex:1;">Email
                                    <input type="email" id="ccRefEmail">
                                </label>
                            </div>
                            <button type="button" class="btn-secundario" id="ccAgregarRefBtn">➕ Agregar</button>
                        </div>
                    </div>
                </div>

                <div style="margin-top:20px; border-top:1px solid #eee; padding-top:16px;">
                    <h4 style="font-size:13px; margin-bottom:8px;">Documentos adjuntados por el asesor</h4>
                    ${adjuntos.map(a => a.id
                        ? `<a href="https://drive.google.com/file/d/${a.id}/view" target="_blank" rel="noopener" style="display:block; font-size:13px; margin-bottom:6px; color:var(--color-primary);">
                             <span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px;">description</span>
                             Ver ${a.label}
                           </a>`
                        : `<p style="font-size:13px; color:#aaa; margin-bottom:6px;">${a.label}: no adjuntado</p>`
                    ).join('')}
                </div>

                <div style="margin-top:20px; border-top:1px solid #eee; padding-top:16px;">
                    <h4 style="font-size:13px; margin-bottom:8px;">Se enviará a</h4>
                    <input type="text" id="ccCorreosDestino"
                           value="${escapeHtml(correosDestinoActual)}"
                           placeholder="correo@ejemplo.com, otro@ejemplo.com"
                           style="width:100%;">
                    <p style="font-size:11px; color:#999; margin-top:4px;">Separa varios correos con comas. Solo aplica a este envío, no se guarda en la solicitud.</p>
                </div>

                <div style="margin-top:20px; border-top:1px solid #eee; padding-top:16px;">
                    <h4 style="font-size:13px; margin-bottom:8px;">Copia oculta (BCC)</h4>
                    <div id="ccCopiaCheckboxes"></div>
                    <input type="text" id="ccCorreosCopiaExtra" placeholder="Agregar otro correo (opcional), separa varios con comas" style="width:100%; margin-top:8px;">
                </div>

                ${sol.STATUS === 'RECHAZADO' ? `
                <p style="font-size:13px; color:#c62828; background:#fdecea; padding:10px 12px; border-radius:6px; margin-top:20px;">
                    Rechazada${sol.ADMIN_EMAIL ? ' por ' + escapeHtml(sol.ADMIN_EMAIL) : ''}.
                    ${sol.MOTIVO_RECHAZO ? '<br><b>Motivo:</b> ' + escapeHtml(sol.MOTIVO_RECHAZO) : ''}
                </p>` : `
                <div style="display:flex; gap:10px; margin-top:20px;">
                    <button class="btn-guardar" id="btnEnviarCC" style="flex:1;" ${sol.STATUS === 'PROCESANDO' ? 'disabled' : ''}>
                        <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">${sol.STATUS === 'ENVIADO' ? 'forward_to_inbox' : 'send'}</span>
                        ${sol.STATUS === 'ENVIADO' ? 'Reenviar' : sol.STATUS === 'PROCESANDO' ? 'Enviando…' : 'Enviar'}
                    </button>
                    <button class="btn-secundario" id="btnRechazarCC" style="flex:0 0 auto; padding:0 16px;" ${sol.STATUS !== 'PENDIENTE' ? 'disabled' : ''}>
                        Rechazar
                    </button>
                </div>`}
                <p id="ccEnviarMsg" style="font-size:12px; margin-top:8px;"></p>
            </div>

            <div style="flex:1 1 480px; background:#525659; border-radius:10px; overflow:hidden; box-shadow:0 1px 4px rgba(0,0,0,0.06); min-height:600px;">
                <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:#333;">
                    <span style="color:#ccc; font-size:12px;">Vista previa</span>
                    <button class="btn-secundario" id="btnDescargarPreviewPDF" style="font-size:12px; padding:4px 12px; background:white;">
                        <span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px;">picture_as_pdf</span> Exportar PDF
                    </button>
                </div>
                <iframe id="ccPreviewFrame" style="width:100%; height:760px; border:none; background:#525659;"></iframe>
            </div>
        </div>
    `;

    // Eventos: cada cambio actualiza overrides y refresca el iframe en vivo
    const bind = (id, campo, transform = v => v) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
            state.overrides[campo] = transform(el.value);
            actualizarPreviewCC();
        });
    };
    bind('ccTipoAlumno', 'tipoAlumno');
    bind('ccCuotas', 'cuotas');
    bind('ccNombreCompleto', 'nombreCompleto');
    bind('ccAsesorNombre', 'asesorNombre');
    bind('ccCarrera', 'carrera');
    bind('ccModalidad', 'modalidadEstudio');
    bind('ccMatricula', 'montoMatricula', v => Number(v || 0));
    bind('ccExamen', 'montoExamen', v => Number(v || 0));
    bind('ccEscalaRegular', 'escalaRegular', v => Number(v || 0));
    bind('ccEscalaFinal', 'escalaFinal', v => Number(v || 0));
    bind('ccTipoBeca', 'tipoBeca');
    bind('ccTipoIngreso', 'tipoIngresoOverride');
    bind('ccBeneficioAdicional', 'beneficioPrimeraRaw');
    bind('ccCorreosDestino', 'correosDestino');

    renderCopiaCheckboxes(sol.CAMPANA);
    document.getElementById('ccCorreosCopiaExtra')?.addEventListener('input', recalcularCorreosCopia);

    document.getElementById('btnEnviarCC')?.addEventListener('click', enviarCC);
    document.getElementById('btnRechazarCC')?.addEventListener('click', rechazarCC);
    document.getElementById('btnDescargarPreviewPDF')?.addEventListener('click', descargarPreviewPDF);

    // REFERIDO: una sola persona — se sincroniza directo con state en cada
    // tecleo, sin botón "Agregar" ni lista (a diferencia de REFERENTE).
    ['ccRefUnicoNombre', 'ccRefUnicoDni', 'ccRefUnicoEmail'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', actualizarPersonaReferidoUnica);
    });

    document.getElementById('ccAgregarRefBtn')?.addEventListener('click', agregarPersonaReferidoVista2);
    document.getElementById('ccPersonasReferidoLista')?.addEventListener('click', (e) => {
        const el = e.target.closest('[data-quitar-ref]');
        if (!el) return;
        state.personasReferido.splice(Number(el.dataset.quitarRef), 1);
        renderPersonasReferidoListaVista2();
    });
    document.getElementById('ccTipoReferente')?.addEventListener('change', (e) => {
        state.tipoReferente = e.target.value;
    });
    renderPersonasReferidoListaVista2();

    actualizarPreviewCC();
}

function actualizarPreviewCC() {
    const iframe = document.getElementById('ccPreviewFrame');
    if (!iframe) return;

    const datosCC = construirDatosCC(state.leadActual, state.solicitudActual.CAMPANA, state.overrides);
    iframe.srcdoc = renderPlantillaCCPreview(datosCC);

    const hintETU = document.getElementById('ccTipoAlumnoHint');
    if (hintETU) {
        hintETU.style.display = (datosCC.tipoAlumno === 'ALUMNO ETU' && !datosCC.carreraETU) ? 'block' : 'none';
    }

    const tipoRef = detectarTipoReferido(datosCC.beneficioPrimera);
    state.tipoReferidoActual = tipoRef;

    const bloqueRef = document.getElementById('ccReferidosBlockVista2');
    const tituloRef = document.getElementById('ccReferidosTitulo');
    const hintRef = document.getElementById('ccReferidosHintVista2');
    const tipoWrap = document.getElementById('ccReferidosTipoWrap');
    const unicoWrap = document.getElementById('ccReferidoUnicoWrap');
    const listaWrap = document.getElementById('ccReferidoListaWrap');
    if (bloqueRef) {
        if (tipoRef === 'REFERIDO') {
            bloqueRef.style.display = 'block';
            tituloRef.textContent = 'Datos del Referente';
            hintRef.textContent = 'Este alumno fue referido — agrega los datos de quien lo refirió. Recibirá el documento de Términos y Condiciones - Referente.';
            if (tipoWrap) tipoWrap.style.display = 'block';
            if (unicoWrap) unicoWrap.style.display = 'flex';
            if (listaWrap) listaWrap.style.display = 'none';
        } else if (tipoRef === 'REFERENTE') {
            bloqueRef.style.display = 'block';
            tituloRef.textContent = 'Datos del/los Referido(s)';
            hintRef.textContent = 'Este alumno es referente — agrega los datos de las personas que trajo. Recibirán el documento de Términos y Condiciones - Referido.';
            if (tipoWrap) tipoWrap.style.display = 'none';
            if (unicoWrap) unicoWrap.style.display = 'none';
            if (listaWrap) listaWrap.style.display = 'block';
        } else {
            bloqueRef.style.display = 'none';
        }
    }

    const btnEnviar = document.getElementById('btnEnviarCC');
    const msg = document.getElementById('ccEnviarMsg');
    // REFERIDO: la única persona (índice 0) debe ser válida (nombre + DNI de
    // 8 dígitos + email). REFERENTE: basta con que la lista no esté vacía
    // (cada entrada ya se validó al agregarla).
    const faltanPersonas = tipoRef === 'REFERIDO'
        ? !personaReferidoValida(state.personasReferido[0])
        : tipoRef === 'REFERENTE'
            ? state.personasReferido.length === 0
            : false;
    if (btnEnviar && (state.solicitudActual.STATUS === 'PENDIENTE' || state.solicitudActual.STATUS === 'ENVIADO')) {
        btnEnviar.disabled = !datosCC.datosCompletos || faltanPersonas;
        if (msg) {
            if (!datosCC.datosCompletos) {
                msg.textContent = 'Faltan datos obligatorios (carrera, modalidad o escala regular) para poder enviar.';
            } else if (faltanPersonas) {
                msg.textContent = tipoRef === 'REFERIDO'
                    ? 'Completa los datos del Referente (nombre, DNI y email) antes de enviar.'
                    : 'Agrega al menos una persona (Referido) antes de enviar.';
            } else {
                msg.textContent = '';
            }
            msg.style.color = '#c62828';
        }
    }
}

function personaReferidoValida(p) {
    return !!p && !!p.nombre && /^\d{8}$/.test(p.dni || '') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email || '');
}

// Pinta los checkboxes de BCC por defecto según campaña, tomados del
// catálogo único en core/constants.js (BCC_DEFAULT_CC) — incluye
// onboarding como uno más de la lista, marcado por defecto pero
// desmarcable como cualquier otro.
function renderCopiaCheckboxes(campana) {
    const cont = document.getElementById('ccCopiaCheckboxes');
    if (!cont) return;
    const defaults = BCC_DEFAULT_CC[String(campana).trim()] || [];
    cont.innerHTML = defaults.map(correo => `
        <label style="display:flex; align-items:center; gap:6px; font-size:13px; margin-bottom:6px;">
            <input type="checkbox" class="cc-copia-chk" value="${escapeHtml(correo)}" checked>
            ${escapeHtml(correo)}
        </label>
    `).join('');
    cont.querySelectorAll('.cc-copia-chk').forEach(chk => chk.addEventListener('change', recalcularCorreosCopia));
    recalcularCorreosCopia();
}

function recalcularCorreosCopia() {
    const marcados = Array.from(document.querySelectorAll('.cc-copia-chk:checked')).map(chk => chk.value);
    const extra = (document.getElementById('ccCorreosCopiaExtra')?.value || '')
        .split(',').map(c => c.trim()).filter(Boolean);
    state.overrides.correosCopia = [...marcados, ...extra].join(', ');
}

function actualizarPersonaReferidoUnica() {
    const nombre = (document.getElementById('ccRefUnicoNombre')?.value || '').trim();
    const dni = (document.getElementById('ccRefUnicoDni')?.value || '').trim();
    const email = (document.getElementById('ccRefUnicoEmail')?.value || '').trim();

    state.personasReferido = (nombre || dni || email) ? [{ nombre, dni, email }] : [];
    actualizarPreviewCC();
}

function renderPersonasReferidoListaVista2() {
    const cont = document.getElementById('ccPersonasReferidoLista');
    if (!cont) return;
    if (state.personasReferido.length === 0) {
        cont.innerHTML = '<span style="font-size:12px; color:#999;">Sin personas agregadas.</span>';
        return;
    }
    cont.innerHTML = state.personasReferido.map((p, i) => `
        <div style="display:flex; align-items:center; justify-content:space-between; background:#f3f8ff; border:1px solid #90caf9; border-radius:6px; padding:6px 10px; font-size:13px;">
            <span>${escapeHtml(p.nombre)} — DNI ${escapeHtml(p.dni)} — ${escapeHtml(p.email)}</span>
            <span class="material-symbols-outlined" data-quitar-ref="${i}" style="cursor:pointer; font-size:16px; color:#d32f2f;">close</span>
        </div>
    `).join('');
}

function agregarPersonaReferidoVista2() {
    const nombreInput = document.getElementById('ccRefNombre');
    const dniInput = document.getElementById('ccRefDni');
    const emailInput = document.getElementById('ccRefEmail');

    const nombre = nombreInput.value.trim();
    const dni = dniInput.value.trim();
    const email = emailInput.value.trim();

    if (!nombre) { alert('Ingresa el nombre.'); return; }
    if (!/^\d{8}$/.test(dni)) { alert('El DNI debe tener 8 dígitos.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert('Email inválido.'); return; }
    if (state.personasReferido.some(p => p.dni === dni || p.email === email)) {
        alert('Ya agregaste a una persona con ese DNI o email.');
        return;
    }

    state.personasReferido.push({ nombre, dni, email });
    nombreInput.value = '';
    dniInput.value = '';
    emailInput.value = '';
    renderPersonasReferidoListaVista2();
    actualizarPreviewCC(); // recalcula si ya se puede habilitar "Enviar"
}

// Exporta la vista previa como PDF real, generado por el MISMO motor que
// usa el correo real (Apps Script: Utilities.newBlob(html).getAs(PDF)) —
// antes usaba window.print() del navegador, que es un motor de impresión
// DISTINTO y podía verse ligeramente distinto al PDF que realmente se
// envía. No toca STATUS ni la hoja, no envía correo — solo genera y
// descarga el archivo.
async function descargarPreviewPDF() {
    const btn = document.getElementById('btnDescargarPreviewPDF');
    const labelOriginal = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px;">hourglass_top</span> Generando...';
    }

    try {
        const datosCC = construirDatosCC(state.leadActual, state.solicitudActual.CAMPANA, state.overrides);
        const htmlFinal = renderPlantillaCC(datosCC);

        const result = await callAPI('generarPreviewPDF', { htmlFinal });
        if (!result.success) {
            alert('No se pudo generar el PDF: ' + (result.error || 'Error desconocido'));
            return;
        }

        const binario = atob(result.pdfBase64);
        const bytes = new Uint8Array(binario.length);
        for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `CC - ${datosCC.nombreCompleto || state.solicitudActual.ID_PROMETEO || 'preview'}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
        alert('Error generando el PDF: ' + e.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = labelOriginal;
        }
    }
}

// Convierte un asset estático (ej. PDF de Lineamientos) a base64 para
// mandarlo al backend como adjunto — evita depender del CONFIG del otro
// Apps Script, que no es accesible desde este backend.
async function fetchAssetBase64(path) {
    try {
        const res = await fetch(path);
        if (!res.ok) return null;
        const buffer = await res.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    } catch (e) {
        console.warn('No se pudo cargar el asset de Lineamientos:', e);
        return null;
    }
}

// ===== ENVIAR (Parte 6 — pendiente de backend `enviarCC`) =====
async function enviarCC() {
    const btn = document.getElementById('btnEnviarCC');
    const msg = document.getElementById('ccEnviarMsg');
    const esReenvio = state.solicitudActual.STATUS === 'ENVIADO';

    const textoConfirmacion = esReenvio
        ? '¡Atención! Esta solicitud ya fue enviada antes. ¿Confirmas que quieres REENVIAR las Condiciones Comerciales con los datos mostrados en la vista previa?'
        : '¿Confirmas el envío de las Condiciones Comerciales con los datos mostrados en la vista previa?';
    if (!confirm(textoConfirmacion)) return;

    btn.disabled = true;
    msg.style.color = '#555';
    msg.textContent = esReenvio ? 'Reenviando...' : 'Enviando...';

    try {
        const datosCC = construirDatosCC(state.leadActual, state.solicitudActual.CAMPANA, state.overrides);
        const htmlFinal = renderPlantillaCC(datosCC);
        const lineamientosNombre = nombreLineamientosSegunCuotas(datosCC);
        const lineamientosBase64 = await fetchAssetBase64(rutaAsset(lineamientosNombre));

        // Referidos/Referentes: se captura recién aquí (Vista 2), no en el
        // modal del asesor — el backend necesita el PDF correcto según el
        // caso, cargado como asset estático igual que Lineamientos.
        // - tipoReferido REFERIDO: el lead fue referido -> él recibe "T&C - REFERIDO"
        //   y el referente que lo trajo recibe "T&C - REFERENTE ALUMNO" (stock) o
        //   "T&C - REFERENTE INGRESANTE" (nuevo), según tipoReferente.
        // - tipoReferido REFERENTE: el lead refirió a otros -> cada persona de
        //   la lista recibe "T&C - REFERIDO".
        // Se manda también el nombre "plano" de cada PDF para que el backend
        // arme el adjunto con el nombre real del archivo, no uno genérico.
        let terminosReferidoBase64 = null;
        let terminosReferidoNombre = null;
        let terminosReferenteBase64 = null;
        let terminosReferenteNombre = null;
        if (state.tipoReferidoActual === 'REFERIDO') {
            terminosReferidoNombre = NOMBRE_TERMINOS_REFERIDO(datosCC.periodo);
            terminosReferidoBase64 = await fetchAssetBase64(rutaAsset(terminosReferidoNombre));
            terminosReferenteNombre = state.tipoReferente === 'stock'
                ? NOMBRE_TERMINOS_REFERENTE_ALUMNO(datosCC.periodo)
                : NOMBRE_TERMINOS_REFERENTE_INGRESANTE(datosCC.periodo);
            terminosReferenteBase64 = await fetchAssetBase64(rutaAsset(terminosReferenteNombre));
        } else if (state.tipoReferidoActual === 'REFERENTE') {
            terminosReferidoNombre = NOMBRE_TERMINOS_REFERIDO(datosCC.periodo);
            terminosReferidoBase64 = await fetchAssetBase64(rutaAsset(terminosReferidoNombre));
        }

        const result = await callAPI('enviarCC', {
            idSolicitud: state.solicitudActual.ID_SOLICITUD,
            reenvio: esReenvio,
            htmlFinal,
            lineamientosBase64,
            lineamientosNombre,
            tipoReferido: state.tipoReferidoActual || '',
            personasReferido: state.personasReferido,
            tipoReferente: state.tipoReferente,
            terminosReferidoBase64,
            terminosReferidoNombre,
            terminosReferenteBase64,
            terminosReferenteNombre,
            asesorNombreOverride: state.overrides.asesorNombre ?? null,
            correosDestinoOverride: state.overrides.correosDestino ?? null,
            correosCopiaOverride: state.overrides.correosCopia ?? null,
            nombreCompletoOverride: datosCC.nombreCompleto
        });

        if (result.success) {
            const mensajeExito = esReenvio ? 'Condiciones Comerciales reenviadas correctamente' : 'Condiciones Comerciales enviadas correctamente';
            Toast?.show ? Toast.show(mensajeExito) : alert(mensajeExito);
            state.solicitudActual.STATUS = 'ENVIADO';
            invalidarCacheSolicitudesCC();
            renderDetalleCC();
        } else {
            msg.style.color = '#c62828';
            msg.textContent = 'Error: ' + (result.error || 'No se pudo enviar');
            btn.disabled = false;
        }
    } catch (e) {
        msg.style.color = '#c62828';
        msg.textContent = 'Error de conexión: ' + e.message;
        btn.disabled = false;
    }
}

// ===== RECHAZAR =====
async function rechazarCC() {
    const motivo = prompt('Motivo del rechazo (se guardará en la solicitud):');
    if (motivo === null) return; // canceló el prompt
    if (!motivo.trim()) {
        alert('Debes indicar un motivo para rechazar la solicitud.');
        return;
    }

    const btnEnviar = document.getElementById('btnEnviarCC');
    const btnRechazar = document.getElementById('btnRechazarCC');
    const msg = document.getElementById('ccEnviarMsg');
    if (btnEnviar) btnEnviar.disabled = true;
    if (btnRechazar) btnRechazar.disabled = true;
    if (msg) { msg.style.color = '#555'; msg.textContent = 'Rechazando...'; }

    try {
        const result = await callAPI('rechazarCC', {
            id: state.solicitudActual.ID_SOLICITUD,
            motivo: motivo.trim()
        });

        if (result.success) {
            state.solicitudActual.STATUS = 'RECHAZADO';
            state.solicitudActual.MOTIVO_RECHAZO = motivo.trim();
            invalidarCacheSolicitudesCC();
            renderDetalleCC();
        } else {
            if (msg) { msg.style.color = '#c62828'; msg.textContent = 'Error: ' + (result.error || 'No se pudo rechazar'); }
            if (btnEnviar) btnEnviar.disabled = false;
            if (btnRechazar) btnRechazar.disabled = false;
        }
    } catch (e) {
        if (msg) { msg.style.color = '#c62828'; msg.textContent = 'Error de conexión: ' + e.message; }
        if (btnEnviar) btnEnviar.disabled = false;
        if (btnRechazar) btnRechazar.disabled = false;
    }
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