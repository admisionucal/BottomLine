// LEAD DETAIL ================================================

let currentLead = null;
let currentCampana = '';
let historialAsesores = null;
let ultimoCalculoMonto = {};
let solicitudPendiente = null;

// Busca un valor en el objeto lead probando varias claves posibles,
// y si ninguna calza exactamente, busca de forma flexible (sin tildes,
// sin espacios extra, sin importar mayúsculas/minúsculas).
function obtenerCampo(lead, ...posiblesNombres) {
    if (!lead) return '';
    for (const nombre of posiblesNombres) {
        if (lead[nombre] !== undefined && lead[nombre] !== null && String(lead[nombre]).trim() !== '') {
            return lead[nombre];
        }
    }
    // Búsqueda flexible por si el header real tiene otra capitalización/acentos
    const normalizar = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    const objetivos = posiblesNombres.map(normalizar);
    for (const key in lead) {
        if (objetivos.includes(normalizar(key)) && lead[key] !== undefined && lead[key] !== null && String(lead[key]).trim() !== '') {
            return lead[key];
        }
    }
    return '';
}

function initLeadDetail() {
    const user = requireAuth();
    if (!user) return;

    const userBadge = document.getElementById('userBadge');
    if (userBadge) {
        userBadge.innerHTML = '👤 ' + user.nombre + ' <span class="rol ' + (user.rol === 'ADMIN' ? 'admin' : '') + '">' + user.rol + '</span>';
    }

    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    currentCampana = params.get('campana') || '26.2';

    if (!id) {
        alert('No se especificó un ID de lead');
        volver();
        return;
    }

    // Primero el lead (lo que el usuario necesita ver YA);
    // el catálogo de boletas se carga DESPUÉS, sin competir por el mismo Apps Script.
    cargarLead(id).then(() => {
        if (!sessionStorage.getItem('bl_boletas') || !sessionStorage.getItem('bl_beneficios')) {
            getCatalogos().then(r => {
                if (r && r.success) {
                    sessionStorage.setItem('bl_boletas', JSON.stringify(r.data?.boletas || []));
                    sessionStorage.setItem('bl_beneficios', JSON.stringify(r.data?.beneficios || []));
                    if (currentLead) renderFicha(currentLead); // refresca con catálogo ya disponible
                }
            }).catch(err => console.error("Error cargando catálogos:", err));
        }

        // Independiente de si el lead vino de caché o del backend: siempre se revisa
        // si hay una solicitud de escala menor pendiente (afecta a ambos roles).
        cargarSolicitudPendiente(id);
    });

    document.querySelectorAll('.tabs button[data-tab]').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const tabId = this.dataset.tab;

            document.querySelectorAll('.tab-content').forEach(tc => tc.style.display = 'none');
            const targetTab = document.getElementById('tab-' + tabId);
            if (targetTab) targetTab.style.display = 'block';

            if (tabId === 'pagos') cargarPagos();
            if (tabId === 'historial') renderHistorial();
        });
    });
}

// Consulta si hay una solicitud de escala menor PENDIENTE para este lead, y refresca la ficha.
// Se ejecuta siempre (para ASESOR y ADMIN), sin depender de la caché del dashboard.
function cargarSolicitudPendiente(id) {
    getSolicitudPendiente(id, currentCampana).then(r => {
        solicitudPendiente = (r && r.success) ? (r.data || null) : null;
        if (currentLead) renderFicha(currentLead);
    }).catch(err => console.error('Error cargando solicitud pendiente:', err));
}

function ocultarLoading() {
    document.querySelectorAll('.loading').forEach(el => el.style.display = 'none');
    const mainLoading = document.getElementById('loading') || document.getElementById('loadingOverlay');
    if (mainLoading) mainLoading.style.display = 'none';
}

async function cargarLead(id) {
    const user = getCurrentUser();
    const cacheKey = `bl_selected_${id}_${currentCampana}`;

    // ADMIN siempre pide al backend: necesita el historial completo por asesor
    // (historialAsesores), que no viene en el snapshot cacheado del dashboard.
    if (user.rol !== 'ADMIN') {
        const cachedRaw = sessionStorage.getItem(cacheKey);
        if (cachedRaw) {
            currentLead = JSON.parse(cachedRaw);
            historialAsesores = null;
            ocultarLoading();
            renderEncabezadosYFicha(currentLead);
            renderPerfilamiento();
            renderHistorial();
            return;
        }
    }

    // Respaldo: si no hay datos en caché (acceso directo por URL) o es ADMIN, se pide al backend
    const res = await getLeadDetail(id, currentCampana, user.email, user.rol);
    // if (res && res.timings) console.table(res.timings);
    if (res && res.success && res.data) {
        currentLead = res.data;
        historialAsesores = res.historialAsesores || null;
        ocultarLoading();

        renderEncabezadosYFicha(currentLead);
        renderPerfilamiento();
        renderHistorial();
    } else {
        alert('Error al cargar datos del lead: ' + (res?.error || 'No encontrado'));
        volver();
    }
}

function renderEncabezadosYFicha(lead) {
    if (!lead) return;

    const idPrometeo = obtenerCampo(lead, 'ID PROMETEO', 'ID_PROMETEO') || '---';
    const nombres = obtenerCampo(lead, 'NOMBRES', 'NOMBRE') || 'Sin Nombre';
    const carrera = obtenerCampo(lead, 'CARRERA', 'PROGRAMA') || '-';
    const tipoIngreso = obtenerCampo(lead, 'MODALIDAD INGRESO', 'MODALIDAD_INGRESO') || '-';
    const colegio = obtenerCampo(lead, 'COLEGIO', 'NOMBRE DEL COLEGIO', 'Nombre del colegio') || 'No registrado';
    const status = lead['STATUS DE GESTION'] || 'SIN_STATUS';

    const elId = document.getElementById('leadId');
    if (elId) elId.textContent = idPrometeo;
    const elNombre = document.getElementById('leadNombre');
    if (elNombre) elNombre.textContent = nombres;
    const elCarrera = document.getElementById('leadCarrera');
    if (elCarrera) elCarrera.textContent = carrera;
    const elIngreso = document.getElementById('leadIngreso');
    if (elIngreso) elIngreso.textContent = tipoIngreso;

    const statusEl = document.getElementById('statusBadge');
    if (statusEl) {
        statusEl.textContent = typeof STATUS_LABELS !== 'undefined' && STATUS_LABELS[status] ? STATUS_LABELS[status] : status;
        statusEl.className = 'status-large ' + (typeof STATUS_MAP !== 'undefined' ? STATUS_MAP[status] : '');
    }

    renderFicha(lead);
}

function campoFicha(label, value, colorClass) {
    const safeValue = (value !== undefined && value !== null && String(value).trim() !== '') ? value : '-';
    return `
        <div class="ficha-campo ${colorClass}">
            <span class="ficha-label">${escapeHtml(label)}</span>
            <strong class="ficha-valor">${escapeHtml(safeValue)}</strong>
        </div>`;
}

function renderFicha(lead) {
    const containerV1 = document.getElementById('vista1Content');
    if (!containerV1) return;

    const idPrometeo = obtenerCampo(lead, 'ID PROMETEO') || '---';
    const nombres = obtenerCampo(lead, 'NOMBRES', 'NOMBRE') || 'Sin Nombre';
    const colegio = obtenerCampo(lead, 'COLEGIO', 'NOMBRE DEL COLEGIO', 'Nombre del colegio') || '-';
    const carrera = obtenerCampo(lead, 'CARRERA', 'PROGRAMA') || '-';
    const modalidad = obtenerCampo(lead, 'MODALIDAD') || '-';
    const tipoIngreso = String(obtenerCampo(lead, 'MODALIDAD INGRESO', 'MODALIDAD_INGRESO') || '').trim();
    const tipoIngresoLower = tipoIngreso.toLowerCase();

    // Caso 1 = Ordinario, Caso 2 = Traslado con Conva, Caso 3 = Traslado sin Conva
    let caso = 1;
    if (tipoIngresoLower.indexOf('sin conva') !== -1) caso = 3;
    else if (tipoIngresoLower.indexOf('con conva') !== -1) caso = 2;

    const boletaActual = obtenerCampo(lead, 'BOLETA') || '';
    const beneficioActual = obtenerCampo(lead, 'BENEFICIO') || '';
    const beneficioAdicionalActual = obtenerCampo(lead, 'BENEFICIO_ADICIONAL', 'BENEFICIO ADICIONAL') || '0';
    const beneficioEngancheActual = obtenerCampo(lead, 'BENEFICIO_ENGANCHE', 'BENEFICIO ENGANCHE') || '0';
    const institucionActual = obtenerCampo(lead, 'INSTITUCION_PROCEDENCIA', 'INSTITUCIÓN DE PROCEDENCIA') || '';
    const boletaProcedenciaActual = obtenerCampo(lead, 'BOLETA_PROCEDENCIA', 'BOLETA DE PROCEDENCIA') || '';
    const tiempoOfrecidoActual = obtenerCampo(lead, 'TIEMPO_OFRECIDO', 'TIEMPO OFRECIDO') || '';
    const boletaFinal = obtenerCampo(lead, 'BOLETA_FINAL', 'BOLETA FINAL') || '-';

    function campo(label, value) {
        const safe = (value !== undefined && value !== null && String(value).trim() !== '') ? value : '-';
        return `
            <div>
                <span style="color:#888; font-size:12px; display:block; text-transform:uppercase; font-weight:600;">${escapeHtml(label)}</span>
                <strong style="color:#222; font-size:15px; display:block; margin-top:2px;">${escapeHtml(safe)}</strong>
            </div>`;
    }

    // Construye un <select> editable con opciones simples (array de strings)
    function selectSimple(id, opciones, valorActual) {
        const opts = opciones.map(op =>
            `<option value="${op}" ${String(op) === String(valorActual) ? 'selected' : ''}>${op}</option>`
        ).join('');
        return `<select id="${id}" class="campo-editable-select"><option value="">-- Seleccionar --</option>${opts}</select>`;
    }

    // Construye un <select> editable con opciones {value,label}
    function selectConValor(id, opciones, valorActual) {
        const opts = opciones.map(op =>
            `<option value="${op.value}" ${String(op.value) === String(valorActual) ? 'selected' : ''}>${op.label}</option>`
        ).join('');
        return `<select id="${id}" class="campo-editable-select">${opts}</select>`;
    }

    function campoEditable(label, inputHTML) {
        return `
            <div>
                <span style="color:#888; font-size:12px; display:block; text-transform:uppercase; font-weight:600;">${label}</span>
                <div style="margin-top:4px;">${inputHTML}</div>
            </div>`;
    }

    // ===== BLOQUE 1: DATOS NO EDITABLES (se jalan de la hoja de campaña) =====
    let camposHTML = '';
    camposHTML += campo('Campaña', currentCampana);
    camposHTML += campo('Nombre', nombres);
    camposHTML += campo('Carrera', carrera);
    camposHTML += campo('Colegio', colegio);
    camposHTML += campo('Modalidad', modalidad);
    camposHTML += campo('Tipo Ingreso', tipoIngreso || '-');

    // ===== BLOQUE 2: DATOS EDITABLES POR EL ASESOR (dropdowns) =====
    const catalogoBoletas = JSON.parse(sessionStorage.getItem('bl_boletas') || '[]');
    const catalogoBeneficios = JSON.parse(sessionStorage.getItem('bl_beneficios') || '[]');
    const tipoIngresoCatalogo = tipoIngresoCatalogoPorCaso(caso);

    // Referencia para el rango: Ordinario -> Boleta de Colegio (dato jalado) | Extraordinario -> Boleta de Procedencia (ingresada por el asesor)
    const boletaReferencia = (caso === 1)
        ? obtenerCampo(lead, 'BOLETA DE COLEGIO')
        : boletaProcedenciaActual;

    // Caso especial "Colegio Aliado" (Innova School / Saco Oliveros): Ordinario + Semipresencial,
    // no importa la boleta del colegio -> se usa la fila del catálogo sin rango (MIN/MAX en blanco).
    const colegioNorm = normalizarTexto(colegio);
    const modalidadNorm = normalizarTexto(modalidad);
    const esColegioAliadoEspecial = (caso === 1) && modalidadNorm === 'semipresencial'
        && (colegioNorm.includes('innovaschool') || colegioNorm.includes('sacooliveros'));

    const filasFiltradas = esColegioAliadoEspecial
        ? filasCatalogoSinRango(catalogoBoletas, tipoIngresoCatalogo)
        : filasCatalogoFiltradas(catalogoBoletas, tipoIngresoCatalogo, boletaReferencia);

    const opcionesBoletaBeneficio = opcionesBoletaBeneficioCatalogo(filasFiltradas);
    const boletaConBecaActual = obtenerCampo(lead, 'BOLETA_CON_BECA') || '';
    const valorComboActual = `${boletaActual}||${beneficioActual}||${boletaConBecaActual}`;
    const descuentoActual = obtenerCampo(lead, 'DESCUENTO_PRECIOS') || '0';

    // Modalidad Virtual: Admisión y Matrícula siempre S/0, Boleta con precio fijo exacto (sin beca)
    const boletaVirtualFija = (modalidadNorm === 'remoto') ? obtenerBoletaVirtualFija(carrera, caso) : null;

    // Dropdowns de Beneficio Adicional / Enganche desde el catálogo BENEFICIOS
    const opcionesAdicional = opcionesBeneficioPorTipo(catalogoBeneficios, 'ADICIONAL');
    const opcionesEnganche = opcionesBeneficioPorTipo(catalogoBeneficios, 'ENGANCHE');
    // El valor guardado hoy es solo el VALOR (sin MODO); se busca su combinación exacta en las opciones
    const valorAdicionalCombo = opcionesAdicional.find(o => o.value.split('||')[0] === String(beneficioAdicionalActual))?.value || `${beneficioAdicionalActual}||PORCENTAJE`;
    const valorEngancheCombo = opcionesEnganche.find(o => o.value.split('||')[0] === String(beneficioEngancheActual))?.value || `${beneficioEngancheActual}||`;

    let editablesHTML = '';

    if (caso === 2 || caso === 3) {
        editablesHTML += campoEditable('Boleta de Procedencia', `<input type="number" id="inputBoletaProcedencia" class="campo-editable-input" value="${boletaProcedenciaActual}">`);
        editablesHTML += campoEditable('Institución de Procedencia', selectSimple('selectInstitucion', SELECT_OPTIONS.institucion, institucionActual));
        if (caso === 2) {
            editablesHTML += campoEditable('Tiempo Ofrecido', selectSimple('selectTiempoOfrecido', SELECT_OPTIONS.tiempo, tiempoOfrecidoActual));
        }
    }

    if (boletaVirtualFija !== null) {
        // Precio fijo Virtual: Descuento y Boleta/Beneficio quedan bloqueados, pero se mantienen los mismos
        // ids (como <input type="hidden">) para que el cálculo del monto y el guardado no cambien.
        editablesHTML += campoEditable('Descuento Admisión y Matrícula',
            `<input type="text" class="campo-editable-input" value="Matrícula S/0 - E. Admisión S/0" disabled>
             <input type="hidden" id="selectDescuento" value="100">`);
        editablesHTML += campoEditable('Boleta / Beneficio',
            `<input type="text" class="campo-editable-input" value="S/ ${boletaVirtualFija}" disabled>
             <input type="hidden" id="selectBoletaBeneficio" value="${[boletaVirtualFija, '', ''].join('||')}">`);
    } else {
        editablesHTML += campoEditable('Descuento Admisión y Matrícula', selectConValor('selectDescuento', SELECT_OPTIONS.descuentoPrecios, descuentoActual));

        // Boleta y Beneficio van juntos: cada opción es una fila completa del catálogo (Boleta + su Beca correspondiente)
        editablesHTML += opcionesBoletaBeneficio.length
            ? campoEditable('Boleta / Beneficio', selectConValor('selectBoletaBeneficio', opcionesBoletaBeneficio, valorComboActual))
            : campoEditable('Boleta / Beneficio', `<input type="text" class="campo-editable-input" value="Sin opciones para este rango/tipo" disabled>`);
    }

    editablesHTML += campoEditable('Beneficio Adicional', selectConValor('selectBeneficioAdicional', opcionesAdicional, valorAdicionalCombo));
    editablesHTML += campoEditable('Beneficio Enganche', selectConValor('selectBeneficioEnganche', opcionesEnganche, valorEngancheCombo));

    // ===== SOLICITUD DE ESCALA MENOR (requiere aprobación del admin) =====
    // No aplica en Colegio Aliado (fila fija sin rango) ni en Virtual (precio fijo por carrera).
    const permiteSolicitarEscalaMenor = !esColegioAliadoEspecial && boletaVirtualFija === null;
    const opcionesRangoInferior = permiteSolicitarEscalaMenor
        ? opcionesBoletaBeneficioCatalogo(filasCatalogoRangosInferiores(catalogoBoletas, tipoIngresoCatalogo, boletaReferencia))
        : [];

    function renderSolicitudBox() {
        const user = getCurrentUser();
        if (!user) return '';

        if (solicitudPendiente) {
            const boletaSol = solicitudPendiente['BOLETA_SOLICITADA'];
            const beneficioSol = solicitudPendiente['BENEFICIO_SOLICITADO'] || 'Sin beca';
            const asesorNombreSol = solicitudPendiente['ASESOR_NOMBRE'] || solicitudPendiente['ASESOR_EMAIL'] || 'Asesor';

            if (user.rol === 'ADMIN') {
                return `
                    <div style="background:#fff8e1; border:1px solid #ffca28; padding:18px 20px; border-radius:8px; margin-top:20px;">
                        <strong style="color:#e65100;">🔔 Solicitud de escala menor pendiente</strong>
                        <p style="margin:8px 0; font-size:14px; color:#555;">
                            <strong>${asesorNombreSol}</strong> solicita cambiar la boleta de
                            <strong>S/ ${solicitudPendiente['BOLETA_ACTUAL']}</strong> a
                            <strong>S/ ${boletaSol}</strong> (${beneficioSol}).
                        </p>
                        <div style="display:flex; gap:10px;">
                            <button class="btn-guardar" style="background:#2e7d32;" onclick="resolverSolicitud('${solicitudPendiente['ID_SOLICITUD']}', 'APROBADO')">✅ Aprobar</button>
                            <button class="btn-guardar" style="background:#c62828;" onclick="resolverSolicitud('${solicitudPendiente['ID_SOLICITUD']}', 'RECHAZADO')">❌ Rechazar</button>
                        </div>
                    </div>`;
            }

            return `
                <div style="background:#e3f2fd; border:1px solid #64b5f6; padding:16px 20px; border-radius:8px; margin-top:20px; font-size:14px; color:#0d47a1;">
                    🕓 Tienes una solicitud pendiente: Boleta S/ ${boletaSol} (${beneficioSol}) — esperando aprobación del admin.
                </div>`;
        }

        if (user.rol === 'ADMIN' || !permiteSolicitarEscalaMenor || opcionesRangoInferior.length === 0) return '';

        return `
            <div style="background:white; padding:20px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.05); margin-top:20px;">
                <strong style="color:#555; font-size:14px;">¿Necesitas ofrecer una boleta más baja?</strong>
                <p style="font-size:12px; color:#999; margin:4px 0 10px;">Requiere aprobación del administrador.</p>
                <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end;">
                    <div style="flex:1; min-width:220px;">
                        ${selectConValor('selectEscalaMenor', opcionesRangoInferior, '')}
                    </div>
                    <button class="btn-guardar" onclick="solicitarEscalaMenor('${idPrometeo}')">📨 Solicitar aprobación</button>
                </div>
                <span id="solicitudMsg" style="display:block; margin-top:8px; font-size:13px; color:#1b5e20;"></span>
            </div>`;
    }

    containerV1.innerHTML = `
        <div style="background:white; padding:24px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.05)">
            <h2 style="color:#1a237e; margin-bottom:4px; font-size:22px;">${nombres}</h2>
            <p style="color:#666; margin-bottom:20px;"><strong>ID Prometeo:</strong> ${idPrometeo}</p>
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:20px;">
                ${camposHTML}
            </div>
        </div>

        <div style="display:flex; gap:20px; margin-top:20px; align-items:flex-start; flex-wrap:wrap;">
            <div style="background:white; padding:24px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.05); flex:1 1 380px;">
                <h3 style="color:#ff6f00; margin-bottom:4px; font-size:16px;">✏️ Datos del asesor</h3>
                <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:20px;" id="bloqueEditableFicha">
                    ${editablesHTML}
                </div>
                <button class="btn-guardar" onclick="guardarFicha('${idPrometeo}')">💾 Guardar cambios</button>
                <span id="fichaGuardadoMsg" style="margin-left:12px; font-size:13px; color:#1b5e20;"></span>
            </div>

            <div id="montoAPagarBox" style="flex:0 1 360px;"></div>
        </div>

        ${renderSolicitudBox()}
    `;

    ['selectDescuento', 'selectBoletaBeneficio', 'selectBeneficioAdicional'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', actualizarMontoAPagar);
    });

    // Al cambiar la Boleta de Procedencia se re-filtra el catálogo (rango) y se refresca toda la ficha
    const inputProcedencia = document.getElementById('inputBoletaProcedencia');
    if (inputProcedencia) {
        inputProcedencia.addEventListener('change', () => {
            currentLead['BOLETA_PROCEDENCIA'] = inputProcedencia.value;
            renderFicha(currentLead);
        });
    }

    actualizarMontoAPagar();
}

// Traduce el caso (1=Ordinario, 2=Traslado con Conva, 3=Traslado sin Conva)
// al valor exacto usado en la columna TIPO_INGRESO del catálogo BOLETAS
function tipoIngresoCatalogoPorCaso(caso) {
    if (caso === 2) return 'Traslado con Conva';
    if (caso === 3) return 'Traslado sin Conva';
    return 'Ordinario';
}

// Convierte a número de forma robusta, quitando "S/", comas de miles, espacios, etc.
function parseNumero(v) {
    if (v === undefined || v === null || v === '') return NaN;
    if (typeof v === 'number') return v;
    const limpio = String(v).replace(/[^0-9.\-]/g, '');
    return limpio === '' ? NaN : Number(limpio);
}

// Normaliza texto para comparaciones robustas: minúsculas, sin tildes, sin espacios/guiones/símbolos
function normalizarTexto(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

// Filtra filas del catálogo BOLETAS por TIPO_INGRESO exacto, SOLO las filas "sin rango"
// (BOLETA_PROCEDENCIA_MIN y MAX en blanco o "-"). Se usa para el caso especial de
// Colegio Aliado (Innova School / Saco Oliveros) donde no importa la boleta del colegio.
function filasCatalogoSinRango(catalogo, tipoIngresoCatalogo) {
    const tipoNorm = normalizarTexto(tipoIngresoCatalogo);
    return (catalogo || []).filter(fila => {
        if (normalizarTexto(fila['TIPO_INGRESO'] || '') !== tipoNorm) return false;
        const min = parseNumero(fila['BOLETA_PROCEDENCIA_MIN']);
        const max = parseNumero(fila['BOLETA_PROCEDENCIA_MAX']);
        return isNaN(min) && isNaN(max);
    });
}

// Precio fijo de Boleta para carreras en modalidad Virtual (sin beca, Admisión/Matrícula S/0)
function obtenerBoletaVirtualFija(carrera, caso) {
    const carreraNorm = normalizarTexto(carrera);

    const preciosFijos = {
        'administracionymarketing': 650,
        'administracionynegociosinternacionales': 650,
        'psicologia': 650,
        'comunicacionymarketingdigital': 690,
        'disenodigitaldeinteriores': 690,
        'disenografico': 690,
        'marketingdigital': 690
    };

    if (preciosFijos[carreraNorm] !== undefined) return preciosFijos[carreraNorm];

    // Diseño Gráfico Publicitario: precio fijo Virtual SOLO si es Extraordinario con Convalidación (caso 2)
    if (carreraNorm === 'disenograficopublicitario' && caso === 2) return 690;

    return null;
}

// Arma las opciones de un dropdown de Beneficio (Adicional o Enganche) desde el catálogo BENEFICIOS.
// value = "VALOR||MODO" (MODO solo importa para ADICIONAL: 'PORCENTAJE' o 'FIJO')
function opcionesBeneficioPorTipo(catalogo, tipo) {
    return (catalogo || [])
        .filter(fila => normalizarTexto(fila['TIPO']) === normalizarTexto(tipo))
        .map(fila => ({
            value: `${fila['VALOR']}||${fila['MODO'] || ''}`,
            label: fila['LABEL'] || String(fila['VALOR'])
        }));
}

// Filtra las filas del catálogo BOLETAS por TIPO_INGRESO exacto, tomando TODOS los rangos
// por DEBAJO del que le corresponde a la referencia del lead (para solicitudes de escala menor,
// que requieren aprobación del admin). Si no hay rango match o ya es el más bajo, devuelve [].
function filasCatalogoRangosInferiores(catalogo, tipoIngresoCatalogo, referencia) {
    const tipoNorm = normalizarTexto(tipoIngresoCatalogo);
    const ref = parseNumero(referencia);
    if (isNaN(ref)) return [];

    const filasTipo = (catalogo || []).filter(fila => normalizarTexto(fila['TIPO_INGRESO'] || '') === tipoNorm);

    const rangosMap = new Map();
    filasTipo.forEach(fila => {
        const min = parseNumero(fila['BOLETA_PROCEDENCIA_MIN']);
        const max = parseNumero(fila['BOLETA_PROCEDENCIA_MAX']);
        if (isNaN(min) || isNaN(max)) return;
        const key = min + '-' + max;
        if (!rangosMap.has(key)) rangosMap.set(key, { min, max });
    });
    const rangosOrdenados = Array.from(rangosMap.values()).sort((a, b) => a.min - b.min);

    const indiceMatch = rangosOrdenados.findIndex(r => ref >= r.min && ref <= r.max);
    if (indiceMatch <= 0) return []; // sin match, o ya está en el rango más bajo posible

    const rangosInferiores = rangosOrdenados.slice(0, indiceMatch);

    return filasTipo.filter(fila => {
        const min = parseNumero(fila['BOLETA_PROCEDENCIA_MIN']);
        const max = parseNumero(fila['BOLETA_PROCEDENCIA_MAX']);
        return rangosInferiores.some(r => r.min === min && r.max === max);
    });
}

// Filtra las filas del catálogo BOLETAS por TIPO_INGRESO exacto, incluyendo el rango
// que corresponde a la referencia MÁS hasta 2 rangos superiores (el asesor puede
// ofrecer boletas más altas, hasta 2 rangos por encima del que le toca al lead).
function filasCatalogoFiltradas(catalogo, tipoIngresoCatalogo, referencia) {
    const normalizar = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
    const tipoNorm = normalizar(tipoIngresoCatalogo);
    const ref = parseNumero(referencia);
    if (isNaN(ref)) return [];

    // Todas las filas de ese Tipo de Ingreso
    const filasTipo = (catalogo || []).filter(fila => normalizar(fila['TIPO_INGRESO'] || '') === tipoNorm);

    // Rangos únicos (MIN, MAX) ordenados de menor a mayor
    const rangosMap = new Map();
    filasTipo.forEach(fila => {
        const min = parseNumero(fila['BOLETA_PROCEDENCIA_MIN']);
        const max = parseNumero(fila['BOLETA_PROCEDENCIA_MAX']);
        if (isNaN(min) || isNaN(max)) return;
        const key = min + '-' + max;
        if (!rangosMap.has(key)) rangosMap.set(key, { min, max });
    });
    const rangosOrdenados = Array.from(rangosMap.values()).sort((a, b) => a.min - b.min);

    // Ubicar el rango exacto que le corresponde a la referencia del lead
    const indiceMatch = rangosOrdenados.findIndex(r => ref >= r.min && ref <= r.max);
    if (indiceMatch === -1) return [];

    // Ese rango + hasta 2 rangos superiores
    const rangosPermitidos = rangosOrdenados.slice(indiceMatch, indiceMatch + 3);

    return filasTipo.filter(fila => {
        const min = parseNumero(fila['BOLETA_PROCEDENCIA_MIN']);
        const max = parseNumero(fila['BOLETA_PROCEDENCIA_MAX']);
        return rangosPermitidos.some(r => r.min === min && r.max === max);
    });
}

// Arma el dropdown combinado Boleta/Beneficio a partir de las filas ya filtradas
// (Tipo Ingreso + rango). Cada opción representa UNA fila completa del catálogo,
// para que Boleta y Beneficio siempre viajen juntos y consistentes entre sí.
// value = "BOLETA_BASE||BECA_APLICABLE||BOLETA_CON_BECA" (en ese orden exacto)
function opcionesBoletaBeneficioCatalogo(filasFiltradas) {
    const vistos = new Set();
    const opciones = [];
    (filasFiltradas || []).forEach(fila => {
        const boletaBase = fila['BOLETA_BASE'];
        const beca = fila['BECA_APLICABLE'];
        const boletaConBeca = fila['BOLETA_CON_BECA'];
        if (boletaBase === undefined || boletaBase === '') return;

        const value = `${boletaBase}||${beca || ''}||${boletaConBeca || ''}`;
        if (vistos.has(value)) return;
        vistos.add(value);

        const label = beca
            ? `S/ ${boletaBase} - S/ ${boletaConBeca} ${beca}`
            : `S/ ${boletaBase} - Sin beca`;
        opciones.push({ value, label });
    });
    return opciones;
}

// Recalcula y pinta el bloque "Monto a pagar" según las selecciones actuales del asesor
function actualizarMontoAPagar() {
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

    const admision = +(PRECIOS_BASE.admision * (1 - descuento / 100)).toFixed(2);
    const matricula = +(PRECIOS_BASE.matricula * (1 - descuento / 100)).toFixed(2);

    // Si hay beca aplicada, la boleta a pagar es el monto con beca; si no, la boleta base.
    const boletaAPagar = montoConBeca !== null ? montoConBeca : boleta;
    const beneficioAdicionalMonto = adicionalModo === 'EXACTO'
        ? +(boletaAPagar - adicionalValor).toFixed(2)
        : adicionalModo === 'FIJO'
            ? +adicionalValor.toFixed(2)
            : adicionalModo === 'CICLO'
                ? +(boletaAPagar * 5 * (adicionalValor / 100)).toFixed(2)
                : +(boletaAPagar * (adicionalValor / 100)).toFixed(2);

    const total = +(admision + matricula + boletaAPagar - beneficioAdicionalMonto).toFixed(2);

    // Guarda el último cálculo para que guardarFicha() lo persista sin depender del DOM/texto renderizado
    ultimoCalculoMonto = { descuento, admision, matricula, boletaAPagar, beneficioAdicionalMonto, total };

    function fila(label, valor, destacado) {
        return `<div style="display:flex; justify-content:space-between; padding:6px 0; ${destacado ? '' : 'border-bottom:1px solid #f0f0f0;'}">
            <span style="color:#555; font-size:14px;">${label}</span>
            <strong style="color:${destacado ? '#1a237e' : '#222'}; font-size:${destacado ? '17px' : '14px'};">${valor}</strong>
        </div>`;
    }

    box.innerHTML = `
        <div style="background:white; padding:24px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.05); max-width:420px;">
            <h3 style="color:#1a237e; margin-bottom:12px; font-size:16px; border-bottom:2px solid #e8eaf6; padding-bottom:8px;">Monto a pagar</h3>
            ${fila('Admisión', 'S/ ' + admision)}
            ${fila('Matrícula', 'S/ ' + matricula)}
            ${fila('Boleta', 'S/ ' + boleta)}
            ${fila('Beneficio','S/ ' + (montoConBeca !== null ? montoConBeca : 0))}
            ${fila('Beneficio Adicional', 'S/ ' + beneficioAdicionalMonto)}
            <div style="border-top:2px solid #1a237e; margin-top:6px;"></div>
            ${fila('Total', 'S/ ' + total, true)}
            <div style="margin-top:10px; padding-top:10px; border-top:1px dashed #ddd; font-size:13px; color:#888;">
                Beneficio de Enganche : <strong style="color:#555;">${engancheLabel}</strong>
            </div>
        </div>`;
}

async function solicitarEscalaMenor(idPrometeo) {
    const sel = document.getElementById('selectEscalaMenor');
    const msgEl = document.getElementById('solicitudMsg');
    if (!sel || !sel.value) {
        alert('Selecciona una boleta para solicitar.');
        return;
    }

    const [boletaSolicitada, beneficioSolicitado, boletaConBecaSolicitada] = sel.value.split('||');
    const user = getCurrentUser();

    const payload = {
        idPrometeo: idPrometeo,
        campana: currentCampana,
        asesorEmail: user.email,
        asesorNombre: user.nombre,
        boletaActual: obtenerCampo(currentLead, 'BOLETA') || '',
        beneficioActual: obtenerCampo(currentLead, 'BENEFICIO') || '',
        boletaConBecaActual: obtenerCampo(currentLead, 'BOLETA_CON_BECA') || '',
        boletaSolicitada: boletaSolicitada,
        beneficioSolicitado: beneficioSolicitado,
        boletaConBecaSolicitada: boletaConBecaSolicitada
    };

    if (msgEl) msgEl.textContent = 'Enviando...';

    try {
        const result = await createSolicitud(payload);
        if (result && result.success) {
            solicitudPendiente = {
                ID_SOLICITUD: result.idSolicitud,
                BOLETA_ACTUAL: payload.boletaActual,
                BOLETA_SOLICITADA: boletaSolicitada,
                BENEFICIO_SOLICITADO: beneficioSolicitado,
                ASESOR_NOMBRE: user.nombre,
                ASESOR_EMAIL: user.email
            };
            renderFicha(currentLead);
        } else {
            if (msgEl) msgEl.textContent = '';
            alert('Error al enviar la solicitud: ' + (result?.error || 'Error desconocido'));
        }
    } catch (error) {
        if (msgEl) msgEl.textContent = '';
        alert('Error de conexión: ' + error.message);
    }
}

async function resolverSolicitud(idSolicitud, status) {
    const user = getCurrentUser();
    const confirmMsg = status === 'APROBADO'
        ? '¿Confirmas aprobar esta solicitud? Se aplicará la nueva boleta al lead.'
        : '¿Confirmas rechazar esta solicitud?';
    if (!confirm(confirmMsg)) return;

    try {
        const result = await resolveSolicitud(idSolicitud, status, user.email);
        if (result && result.success) {
            solicitudPendiente = null;
            const idPrometeoActual = obtenerCampo(currentLead, 'ID PROMETEO');
            if (status === 'APROBADO') {
                // Recargamos el lead desde el backend para traer la boleta ya actualizada
                await cargarLead(idPrometeoActual);
            } else {
                renderFicha(currentLead);
            }
        } else {
            alert('Error al resolver la solicitud: ' + (result?.error || 'Error desconocido'));
        }
    } catch (error) {
        alert('Error de conexión: ' + error.message);
    }
}

// Borra la lista de leads cacheada del dashboard (bl_leads_raw_...) para esta campaña,
// así al volver al dashboard se trae la data fresca en vez de la caché desactualizada.
function invalidarCacheDashboard() {
    const user = getCurrentUser();
    if (!user) return;
    sessionStorage.removeItem(`bl_leads_raw_${user.email}_${user.rol}_${currentCampana}`);
}

/** BUG DE CACHÉ: había dos cachés de detalle de lead que no se sincronizaban.
 *  - `bl_selected_*` la escribe dashboard.js al hacer clic en un lead, y la
 *    actualizan guardarFicha()/guardarPerfilamiento() al guardar.
 *  - `bl_detail_*` la maneja getLeadDetail() en api.js, para cuando se entra
 *    a un lead por URL directa (sin pasar por la tabla del dashboard) o para
 *    ADMIN (que siempre recarga por historialAsesores).
 *  Guardar solo actualizaba la primera. Si después se entraba a ese mismo
 *  lead por URL directa, `cargarLead()` caía al fallback de getLeadDetail(),
 *  que servía la versión vieja cacheada en `bl_detail_*` — mostrando datos
 *  desactualizados hasta el logout (que era lo único que la limpiaba).
 *  Esta función mantiene ambas sincronizadas en cada guardado. */
function sincronizarCacheDetalle(idPrometeo) {
    const user = getCurrentUser();
    if (!user) return;
    sessionStorage.setItem(`bl_selected_${idPrometeo}_${currentCampana}`, JSON.stringify(currentLead));
    sessionStorage.removeItem(`bl_detail_${idPrometeo}_${currentCampana}_${user.email}`);
}

async function guardarFicha(idPrometeo) {
    const data = {};

    const getVal = id => {
        const el = document.getElementById(id);
        return el ? el.value : undefined;
    };

    if (getVal('selectDescuento') !== undefined) data['DESCUENTO_PRECIOS'] = getVal('selectDescuento');

    if (getVal('selectBoletaBeneficio') !== undefined) {
        const raw = getVal('selectBoletaBeneficio');
        const [boletaBase, beca, boletaConBeca] = raw.includes('||') ? raw.split('||') : [raw, '', ''];
        data['BOLETA'] = boletaBase;
        data['BENEFICIO'] = beca;
        data['BOLETA_CON_BECA'] = boletaConBeca;
    }

    if (getVal('selectBeneficioAdicional') !== undefined) {
        data['BENEFICIO_ADICIONAL'] = getVal('selectBeneficioAdicional').split('||')[0];
    }
    if (getVal('selectBeneficioEnganche') !== undefined) {
        data['BENEFICIO_ENGANCHE'] = getVal('selectBeneficioEnganche').split('||')[0];
    }
    if (getVal('selectInstitucion') !== undefined) data['INSTITUCION_PROCEDENCIA'] = getVal('selectInstitucion');
    if (getVal('inputBoletaProcedencia') !== undefined) data['BOLETA_PROCEDENCIA'] = getVal('inputBoletaProcedencia');
    if (getVal('selectTiempoOfrecido') !== undefined) data['TIEMPO_OFRECIDO'] = getVal('selectTiempoOfrecido');

    // Montos finales calculados automáticamente (no editables por el asesor).
    // Se leen del último cálculo en memoria (ultimoCalculoMonto), no del DOM,
    // para no depender de parsear texto renderizado.
    if (ultimoCalculoMonto.total !== undefined) {
        data['BOLETA_FINAL'] = ultimoCalculoMonto.total;
        data['DESCUENTO_MATRICULA'] = ultimoCalculoMonto.descuento;
        data['MATRICULA_FINAL'] = ultimoCalculoMonto.matricula;
        data['DESCUENTO_ADMISION'] = ultimoCalculoMonto.descuento;
        data['ADMISION_FINAL'] = ultimoCalculoMonto.admision;
    }

    data['FECHA_ULT_MODIFICACION'] = new Date().toISOString();

    const user = getCurrentUser();
    const msgEl = document.getElementById('fichaGuardadoMsg');
    if (msgEl) msgEl.textContent = 'Guardando...';

    try {
        const result = await saveBottom(idPrometeo, currentCampana, data, user ? user.email : '');
        if (result && result.success) {
            Object.assign(currentLead, data);
            sincronizarCacheDetalle(idPrometeo);
            invalidarCacheDashboard();
            if (msgEl) msgEl.textContent = '✅ Guardado correctamente';
            renderFicha(currentLead);
        } else {
            if (msgEl) msgEl.textContent = '';
            alert('Error al guardar: ' + (result?.error || 'Error desconocido'));
        }
    } catch (error) {
        if (msgEl) msgEl.textContent = '';
        alert('Error de conexión al guardar: ' + error.message);
    }
}

function renderBoletaElectronica(boleta, beneficio, beneficioAdicional, beneficioEnganche, boletaFinal) {
    const safe = v => (v !== undefined && v !== null && String(v).trim() !== '') ? v : '-';
    function lineaBoleta(label, value, destacado) {
        return `
            <div style="display:flex; justify-content:space-between; padding:8px 0; ${destacado ? '' : 'border-bottom:1px dashed #d0d0d0;'}">
                <span style="color:#666; font-size:13px;">${label}</span>
                <strong style="color:${destacado ? '#1a237e' : '#222'}; font-size:${destacado ? '17px' : '14px'};">${safe(value)}</strong>
            </div>`;
    }

    return `
        <div style="background:white; padding:24px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.05); margin-top:20px; max-width:420px; font-family:'Courier New', monospace;">
            <div style="text-align:center; border-bottom:2px dashed #1a237e; padding-bottom:10px; margin-bottom:6px;">
                <strong style="color:#1a237e; font-size:15px; letter-spacing:1px;">🧾 BOLETA ELECTRÓNICA</strong>
            </div>
            ${lineaBoleta('Boleta', boleta)}
            ${lineaBoleta('Beneficio', beneficio)}
            ${lineaBoleta('Beneficio Adicional', beneficioAdicional)}
            ${lineaBoleta('Beneficio Enganche', beneficioEnganche)}
            <div style="border-top:2px dashed #1a237e; margin-top:6px;"></div>
            ${lineaBoleta('BOLETA FINAL', boletaFinal, true)}
        </div>`;
}

function campoPerfil(label, value, full) {
    const safeValue = (value !== undefined && value !== null && String(value).trim() !== '') ? value : 'Sin registrar';
    return `
        <div class="perfil-campo ficha-campo color-verde ${full ? 'campo-full' : ''}">
            <span class="ficha-label">${escapeHtml(label)}</span>
            <strong class="ficha-valor">${escapeHtml(safeValue)}</strong>
        </div>`;
}

function renderPerfilamiento() {
    const container = document.getElementById('vista2Content');
    if (!container || !currentLead) return;

    const idPrometeo = obtenerCampo(currentLead, 'ID PROMETEO');
    const statusGestion = currentLead['STATUS DE GESTION'] || '';
    const esPromesaDePago = statusGestion === 'VALORES_PROMESA_DE_PAGO_VIVA' || statusGestion === 'VALORES_PROMESA_DE_PAGO_MUERTA';
    const statusLabel = (typeof STATUS_LABELS !== 'undefined' && STATUS_LABELS[statusGestion]) ? STATUS_LABELS[statusGestion] : (currentLead['STATUS_WEB'] || statusGestion || 'Sin status');

    // Status: NO editable (se jala de la hoja de campaña)
    let statusHTML = `<p><strong>Status:</strong> ${statusLabel}</p>`;
    if (esPromesaDePago) {
        // Fecha de Promesa de Pago: NO editable, se jala directamente de la hoja base
        const fechaPromesaRaw = obtenerCampo(currentLead, 'FECHA COMPROMISO DE PAGO');
        const fechaPromesa = formatearFechaSimple(fechaPromesaRaw) || 'No registrada';
        statusHTML += `<p><strong>Fecha de Promesa de Pago:</strong> ${fechaPromesa}</p>`;
    }

    function textareaPerfil(id, valorActual) {
        const safe = (valorActual !== undefined && valorActual !== null) ? String(valorActual) : '';
        // Un textarea también puede "romperse" con </textarea><script>...; hay que escapar igual.
        return `<textarea id="${id}" class="campo-editable-input" style="width:100%; min-height:60px; padding:10px 12px; border:1px solid #e0e0e0; border-radius:6px; font-size:14px; font-family:inherit; resize:vertical;">${escapeHtml(safe)}</textarea>`;
    }

    container.innerHTML = `
        <div style="background:white; padding:24px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.05); margin-bottom:16px;">
            ${statusHTML}
        </div>

        <div style="background:white; padding:24px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.05); margin-bottom:16px;">
            <h3 style="color:#ff6f00; margin-bottom:16px; font-size:18px;">Perfilamiento</h3>
            <div style="display:flex; flex-direction:column; gap:16px;">
                <div>
                    <label style="font-size:13px; font-weight:600; color:#555; display:block; margin-bottom:4px;">¿Por qué eligió la carrera?</label>
                    ${textareaPerfil('inputPorQueEligio', currentLead['POR_QUE_ELIGIO_CARRERA'])}
                </div>
                <div>
                    <label style="font-size:13px; font-weight:600; color:#555; display:block; margin-bottom:4px;">¿Qué busca en una universidad?</label>
                    ${textareaPerfil('inputQueBusca', currentLead['QUE_BUSCA_UNIVERSIDAD'])}
                </div>
                <div>
                    <label style="font-size:13px; font-weight:600; color:#555; display:block; margin-bottom:4px;">¿Quién financiará la carrera?</label>
                    ${textareaPerfil('inputQuienFinancia', currentLead['QUIEN_FINANCIARA'])}
                </div>
                <div>
                    <label style="font-size:13px; font-weight:600; color:#555; display:block; margin-bottom:4px;">Acciones Definidas</label>
                    ${textareaPerfil('inputAccionesDefinidas', currentLead['ACCIONES_DEFINIDAS'])}
                </div>
                <div>
                    <label style="font-size:13px; font-weight:600; color:#555; display:block; margin-bottom:4px;">¿Qué le falta para tomar una decisión?</label>
                    ${textareaPerfil('inputQueLeFalta', currentLead['QUE_LE_FALTA'])}
                </div>
                <div>
                    <label style="font-size:13px; font-weight:600; color:#555; display:block; margin-bottom:4px;">¿Cuáles son sus otras opciones?</label>
                    ${textareaPerfil('inputOtrasOpciones', currentLead['OTRAS_OPCIONES'])}
                </div>
                <div>
                    <label style="font-size:13px; font-weight:600; color:#555; display:block; margin-bottom:4px;">Comentarios</label>
                    ${textareaPerfil('inputComentariosPerfil', currentLead['COMENTARIOS_PERFIL'])}
                </div>
            </div>
            <button class="btn-guardar" onclick="guardarPerfilamiento('${idPrometeo}')">💾 Guardar cambios</button>
            <span id="perfilGuardadoMsg" style="margin-left:12px; font-size:13px; color:#1b5e20;"></span>
        </div>

        <div style="background:white; padding:16px 24px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.05); color:#777; font-size:13px;">
            Última fecha bottom: ${formatearFechaBottom(currentLead['FECHA_ULT_MODIFICACION'])}
        </div>
    `;
}

async function guardarPerfilamiento(idPrometeo) {
    const getVal = id => {
        const el = document.getElementById(id);
        return el ? el.value : undefined;
    };

    const data = {
        POR_QUE_ELIGIO_CARRERA: getVal('inputPorQueEligio') || '',
        QUE_BUSCA_UNIVERSIDAD: getVal('inputQueBusca') || '',
        QUIEN_FINANCIARA: getVal('inputQuienFinancia') || '',
        ACCIONES_DEFINIDAS: getVal('inputAccionesDefinidas') || '',
        QUE_LE_FALTA: getVal('inputQueLeFalta') || '',
        OTRAS_OPCIONES: getVal('inputOtrasOpciones') || '',
        COMENTARIOS_PERFIL: getVal('inputComentariosPerfil') || '',
        FECHA_ULT_MODIFICACION: new Date().toISOString()
    };

    const user = getCurrentUser();
    const msgEl = document.getElementById('perfilGuardadoMsg');
    if (msgEl) msgEl.textContent = 'Guardando...';

    try {
        const result = await saveBottom(idPrometeo, currentCampana, data, user ? user.email : '');
        if (result && result.success) {
            Object.assign(currentLead, data);
            sincronizarCacheDetalle(idPrometeo);
            invalidarCacheDashboard();
            if (msgEl) msgEl.textContent = '✅ Guardado correctamente';
            renderPerfilamiento();
        } else {
            if (msgEl) msgEl.textContent = '';
            alert('Error al guardar: ' + (result?.error || 'Error desconocido'));
        }
    } catch (error) {
        if (msgEl) msgEl.textContent = '';
        alert('Error de conexión al guardar: ' + error.message);
    }
}

function formatearFechaBottom(valor) {
    let fecha = valor ? new Date(valor) : new Date();
    if (isNaN(fecha.getTime())) fecha = new Date();
    const dd = String(fecha.getDate()).padStart(2, '0');
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    const yyyy = fecha.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

// Formatea una fecha para mostrar en modo lectura; si no hay valor o no es fecha válida, no revienta.
function formatearFechaSimple(valor) {
    if (!valor) return '';
    const fecha = new Date(valor);
    if (isNaN(fecha.getTime())) return String(valor);
    const dd = String(fecha.getDate()).padStart(2, '0');
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    const yyyy = fecha.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

// Vista de historial:
// - ASESOR: ve solo su propio historial (currentLead ya viene filtrado a su fila desde el backend).
// - ADMIN: ve TODAS las filas de gestión de este lead, una por cada asesor que lo ha trabajado,
//   ordenadas de la más reciente a la más antigua.
function renderHistorial() {
    const container = document.getElementById('historialContent');
    if (!container || !currentLead) return;

    const user = getCurrentUser();

    if (user.rol === 'ADMIN' && historialAsesores) {
        if (historialAsesores.length === 0) {
            container.innerHTML = '<p style="padding:20px;color:#888;">Ningún asesor ha registrado gestión sobre este lead todavía.</p>';
            return;
        }
        let html = '';
        historialAsesores
            .slice()
            .sort((a, b) => new Date(b.FECHA_ULT_MODIFICACION || 0) - new Date(a.FECHA_ULT_MODIFICACION || 0))
            .forEach(fila => {
                const historialTexto = fila.COMENTARIOS_HISTORIAL || 'Sin comentarios registrados.';
                const comentPerfil = fila.COMENTARIOS_PERFIL || '';
                html += `
                    <div style="background:white; padding:20px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.05); margin-bottom:16px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #eee; padding-bottom:8px;">
                            <strong style="color:#1a237e;">👤 ${escapeHtml(fila.ASESOR_NOMBRE || fila.ASESOR_EMAIL || 'Asesor desconocido')}</strong>
                            <span style="font-size:12px;color:#888;">Última actualización: ${escapeHtml(formatearFechaBottom(fila.FECHA_ULT_MODIFICACION))}</span>
                        </div>
                        ${comentPerfil ? `<p style="margin-bottom:10px;"><strong style="font-size:13px;color:#555;">Comentarios de perfilamiento:</strong><br>${escapeHtml(comentPerfil)}</p>` : ''}
                        <div style="white-space:pre-wrap; font-size:14px; line-height:1.6; color:#333;">${escapeHtml(historialTexto)}</div>
                    </div>`;
            });
        container.innerHTML = html;
        return;
    }

    const historial = currentLead['COMENTARIOS_HISTORIAL'] || 'Sin comentarios ni interacciones registradas en la bitácora.';
    container.innerHTML = `
        <div style="background:white; padding:24px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.05); white-space:pre-wrap; font-size:14px; line-height:1.6; color:#333;">
            ${escapeHtml(historial)}
        </div>
    `;
}

async function cargarPagos() {
    const container = document.getElementById('tab-pagos');
    if (!container) return;
    container.innerHTML = '<div class="loading" style="padding:20px;">Cargando historial de pagos...</div>';

    const id = currentLead['ID PROMETEO'] || currentLead['ID_PROMETEO'] || currentLead['id_prometeo'];
    const result = await getLeadPayments(id, currentCampana);

    if (!result.success || !result.data || result.data.length === 0) {
        container.innerHTML = '<p style="color:#888; padding:20px; background:white; border-radius:8px;">Sin registros de pago financieros para este alumno.</p>';
        return;
    }

    const campos = ['FECHA DE PAGO', 'BOLETA CAMPUS', 'ESCALA FINAL', 'TIPO DE DESCUENTO', 'DETALLE TIPO DE DESCUENTO', 'STATUS DE PAGO FINAL', 'MEDIO DE PAGO'];
    let html = '<div style="overflow-x:auto; background:white; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.05);"><table style="width:100%; border-collapse:collapse; min-width:800px;">';
    html += '<thead><tr style="background:#1a237e; color:white; text-align:left;">' + campos.map(c => `<th style="padding:12px 16px; font-size:13px; font-weight:600;">${c}</th>`).join('') + '</tr></thead><tbody>';

    result.data.forEach(p => {
        html += '<tr style="border-bottom:1px solid #eee; font-size:14px; color:#444;">' + campos.map(c => `<td style="padding:12px 16px;">${p[c] || p[c.toLowerCase()] || '-'}</td>`).join('') + '</tr>';
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
}

function volver() {
    window.location.href = 'dashboard.html';
}