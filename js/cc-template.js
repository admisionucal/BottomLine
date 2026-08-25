// ================================================================
// CC TEMPLATE - Construcción de datos y render del PDF de Condiciones Comerciales
// ================================================================

import { COLUMNAS } from '../core/constants.js';
import { escapeHtml, parseNumero, normalizarTexto, getEspecializacionETU } from '../core/utils.js';

let logoDataUri = null;

export async function precargarLogoCC() {
    if (logoDataUri) return logoDataUri;
    try {
        const resp = await fetch('assets/LogoUCALDoc.png');
        const blob = await resp.blob();
        logoDataUri = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        logoDataUri = null;
    }
    return logoDataUri;
}

function logoSrcCC() {
    return logoDataUri || 'assets/LogoUCALDoc.png';
}

// Config por campaña
export const CONFIG_CC = {
    '26.2': { periodo: '2026-2', perC: '26-2', inicioClases: 'Agosto' },
    '27.1': { periodo: '2027-1', perC: '27-1', inicioClases: 'Marzo' }
};

// Detecta si el beneficio de primera boleta corresponde a un caso de Referidos
export function detectarTipoReferido(label) {
    const l = String(label || '').toLowerCase();
    if (l.indexOf('referente') !== -1) return 'REFERENTE';
    if (l.indexOf('referido') !== -1) return 'REFERIDO';
    return null;
}

// Arma el objeto de datos para el PDF de Condiciones Comerciales
export function construirDatosCC(lead, campana, overrides = {}) {
    const cfg = CONFIG_CC[campana] || { periodo: campana, perC: campana, inicioClases: '' };

    const d = {};
    d.periodo = cfg.periodo;
    d.inicioClases = cfg.inicioClases;

    d.nombreCompleto = overrides.nombreCompleto ?? (lead[COLUMNAS.NOMBRES] || '');
    d.dni = lead[COLUMNAS.DNI] || '';
    d.carrera = overrides.carrera ?? (lead[COLUMNAS.CARRERA] || lead[COLUMNAS.PROGRAMA] || '');
    d.modalidadEstudio = overrides.modalidadEstudio ?? (lead[COLUMNAS.MODALIDAD] || '');

    // ===== TIPO DE ALUMNO (ETU) =====
    d.tipoAlumno = overrides.tipoAlumno ?? (lead[COLUMNAS.TIPO_ALUMNO] || 'ALUMNO REGULAR');
    d.carreraETU = getEspecializacionETU(d.carrera);
    d.programaETU = d.tipoAlumno === 'ALUMNO ETU' && !!d.carreraETU;

    // ===== NÚMERO DE CUOTAS =====
    d.numeroCuotas = overrides.cuotas ?? (lead[COLUMNAS.NUMERO_CUOTAS] || '5 cuotas');
    d.mostrar6Cuotas = d.numeroCuotas === '6 cuotas';

    // Tipo de ingreso
    const modalidadIngresoOverride = overrides.tipoIngresoOverride;
    const modalidadIngreso = String(
        modalidadIngresoOverride !== undefined ? '' : (lead[COLUMNAS.MODALIDAD_INGRESO] || '')
    ).toLowerCase();

    if (modalidadIngresoOverride !== undefined) {
        d.mostrarTrasladoConvalidacion = modalidadIngresoOverride === 'con_convalidacion';
        d.mostrarTrasladoSinConvalidacion = modalidadIngresoOverride === 'sin_convalidacion';
        d.tipoIngresoActual = modalidadIngresoOverride;
    } else {
        d.mostrarTrasladoConvalidacion = modalidadIngreso.indexOf('con conva') !== -1;
        d.mostrarTrasladoSinConvalidacion = modalidadIngreso.indexOf('sin conva') !== -1;
        d.tipoIngresoActual = d.mostrarTrasladoConvalidacion
            ? 'con_convalidacion'
            : d.mostrarTrasladoSinConvalidacion
                ? 'sin_convalidacion'
                : 'regular';
    }

    // ===== MATRÍCULA (editable) =====
    const montoMatricula = parseNumero(overrides.montoMatricula ?? lead['MATRICULA_FINAL'] ?? '') || 0;
    d.montoMatricula = montoMatricula;
    if (montoMatricula === 0) {
        d.matriDescuentoTexto = 'S/0';
        d.matriDescuentoDetalle = 'Descuento del 100% por única vez y sólo por este ciclo.';
    } else if (montoMatricula === 95) {
        d.matriDescuentoTexto = 'S/95';
        d.matriDescuentoDetalle = 'Descuento del 80% por única vez y sólo por este ciclo.';
    } else {
        d.matriDescuentoTexto = '';
        d.matriDescuentoDetalle = '';
    }

    // ===== EXAMEN DE ADMISIÓN (editable) =====
    const montoExamen = parseNumero(overrides.montoExamen ?? lead['ADMISION_FINAL'] ?? '') || 0;
    d.montoExamen = montoExamen;
    if (montoExamen === 0) {
        d.admiDescuentoTexto = 'S/0';
        d.admiDescuentoDetalle = 'Descuento del 100% por única vez.';
    } else if (montoExamen === 50) {
        d.admiDescuentoTexto = 'S/50';
        d.admiDescuentoDetalle = 'Descuento del 80% por única vez.';
    } else {
        d.admiDescuentoTexto = '';
        d.admiDescuentoDetalle = '';
    }

    // ===== ESCALAS (editables) =====
    const escalaRegular = parseNumero(overrides.escalaRegular ?? lead[COLUMNAS.BOLETA] ?? '');
    const escalaFinal = parseNumero(overrides.escalaFinal ?? lead[COLUMNAS.BOLETA_CON_BECA] ?? '');
    d.escalaRegular = escalaRegular;
    d.escalaFinal = escalaFinal;

    // ===== BECA (editable) =====
    const tipoBeca = String(overrides.tipoBeca ?? lead[COLUMNAS.BENEFICIO] ?? '').trim();
    d.tipoBeca = tipoBeca;
    const tipoBecaNormParaMostrar = tipoBeca.toUpperCase();
    d.becaMostrar = !!tipoBeca &&
        tipoBecaNormParaMostrar !== 'NO' &&
        tipoBecaNormParaMostrar !== 'ESCALA REGULAR' &&
        tipoBecaNormParaMostrar !== 'RECATEGORIZACIÓN' &&
        tipoBecaNormParaMostrar !== 'RECATEGORIZACION';

    d.porcentajeBeca = '';
    if (d.becaMostrar && escalaRegular && escalaFinal) {
        d.porcentajeBeca = (Math.round(((escalaRegular - escalaFinal) / escalaRegular) * 1000) / 10) + '%';
    }

    // ===== BENEFICIO DE PRIMERA BOLETA (editable) =====
    const rawAdicional = String(overrides.beneficioPrimeraRaw ?? lead[COLUMNAS.BENEFICIO_ADICIONAL] ?? '').trim();
    const [adicValorStr, adicModo, adicLabel] = rawAdicional.split('||');
    const adicValor = Number(adicValorStr || 0);
    const beneficioPrimera = (adicLabel || '').trim();

    d.beneficioPrimera = beneficioPrimera;
    const beneficioPrimeraLower = beneficioPrimera.toLowerCase();

    // Comparación por palabras clave
    d.beneficioMostrar = !!beneficioPrimera &&
        beneficioPrimeraLower.indexOf('ninguno') === -1 &&
        beneficioPrimeraLower.indexOf('sin descuento') === -1 &&
        beneficioPrimeraLower.indexOf('ciclo completo') === -1 &&
        beneficioPrimeraLower.indexOf('5ta boleta') === -1;

    d.beneficioTipo = '';
    d.beneficioValor = '';
    d.beneficioTexto = '';

    if (d.beneficioMostrar) {
        d.beneficioTipo = tipoTextoBeneficio(beneficioPrimera);
        const baseParaBeneficio = d.becaMostrar ? escalaFinal : escalaRegular;
        const montoFinal = calcularBeneficioValor(baseParaBeneficio, adicValor, adicModo);
        d.beneficioValor = 'S/' + montoFinal;
        d.beneficioTexto = textoDetalleBeneficio(adicValor, adicModo);
    }

    // ===== FINANCIAMIENTO A NUMERO_CUOTAS =====
    d.boleta6C = '';
    d.boleta6CLabel = '';
    if (d.mostrar6Cuotas) {
        const valorCuotaNormal = d.becaMostrar ? escalaFinal : escalaRegular;
        let total5Cuotas;
        if (d.beneficioMostrar && d.beneficioValor) {
            const valorPrimeraCuota = parseFloat(String(d.beneficioValor).replace('S/', ''));
            total5Cuotas = valorPrimeraCuota + (valorCuotaNormal * 4);
        } else {
            total5Cuotas = valorCuotaNormal * 5;
        }
        if (!isNaN(total5Cuotas) && total5Cuotas > 0) {
            const cuotaCalculada = total5Cuotas / 6;
            d.boleta6C = 'S/' + Math.ceil(cuotaCalculada);
            d.boleta6CLabel = 'Financiamiento de seis cuotas en la ' + (d.becaMostrar ? d.tipoBeca : 'Escala Regular');
        }
    }

    // ===== Helpers =====
    function calcularBeneficioValor(escalaFinalBase, valor, modo) {
        switch (String(modo || '').trim().toUpperCase()) {
            case 'PORCENTAJE':
                return Math.round(escalaFinalBase * (1 - valor / 100));
            case 'FIJO':
                return escalaFinalBase - valor;
            case 'EXACTO':
                return valor;
            default:
                return escalaFinalBase;
        }
    }

    function tipoTextoBeneficio(label) {
        const l = String(label).toLowerCase();
        if (l.indexOf('referid') !== -1) return 'Boleta con Beneficio de Referidos aplicado en Primera Boleta: ';
        if (l.indexOf('visita') !== -1) return 'Boleta con Bono por Visita: ';
        return 'Boleta con Beneficio aplicado en Primera Boleta: ';
    }

    function textoDetalleBeneficio(valor, modo) {
        const m = String(modo || '').trim().toUpperCase();
        if (m === 'PORCENTAJE') return ` Descuento del ${valor}% por única vez.`;
        if (m === 'FIJO' || m === 'EXACTO') return ` Descuento de S/${valor} por única vez.`;
        return ' Beneficio aplicado por única vez.';
    }

    // ===== CONSIDERACIONES (banderas) =====
    const tipoBecaNorm = tipoBeca.trim().toUpperCase();
    d.mostrarBecaImpacto = tipoBecaNorm === 'BECA IMPACTO';
    d.mostrarBecaPotencia = tipoBecaNorm === 'BECA POTENCIA';
    d.mostrarBecaColaborador = tipoBecaNorm === 'BECA COLABORADOR';
    d.mostrarConsidSP = d.modalidadEstudio === 'Semi-Presencial';

    // Recalibrado contra las etiquetas reales
    d.mostrar50Primera = beneficioPrimeraLower.indexOf('50%') !== -1;
    d.mostrar100Primera = beneficioPrimeraLower.indexOf('reconocemos') !== -1;
    d.mostrarBeneficio500 = beneficioPrimeraLower.indexOf('500') !== -1;

    // ===== HORARIOS (solo Semi-Presencial / Remoto) =====
    d.horarioHTML = construirHorarioHTML(d);

    // ===== VALIDACIÓN MÍNIMA PARA HABILITAR "ENVIAR" =====
    d.datosCompletos = !!(d.nombreCompleto && d.carrera && d.modalidadEstudio && escalaRegular);

    return d;
}

function construirHorarioHTML(d) {
    if (d.modalidadEstudio === 'Semi-Presencial') {
        const esCachimbo = d.tipoIngresoActual === 'regular' || d.mostrarTrasladoSinConvalidacion;
        const carreraNorm = normalizarTexto(d.carrera);
        let horario;
        if (esCachimbo && carreraNorm === 'psicologia') {
            horario = '8:00 a.m. - 11:00 p.m.';
        } else if (esCachimbo && carreraNorm === 'disenograficopublicitario') {
            horario = '8:00 a.m. - 10:00 p.m.';
        } else {
            horario = d.mostrarTrasladoConvalidacion ? '8:00 a.m. - 10:00 p.m.' : '8:00 a.m. - 6:00 p.m.';
        }
        return `
            <p>
              <span style="font-size:11px;">Los porcentajes de presencialidad y virtualidad se ejecutan acorde a la normativa de SUNEDU.</span><br>
              <span><b>Horario:</b> Diurno ${horario}</span>
            </p>`;
    }
    if (d.modalidadEstudio === 'Remoto' && d.carrera === 'Diseño Digital de Interiores') {
        return `<p><b>Horario:</b> Nocturno<br>Lunes a viernes: 6:00 p.m. - 10:00 p.m.<br>Sábado: 4:00 p.m. - 10:00 p.m.</p>`;
    }
    if (d.modalidadEstudio === 'Remoto') {
        return `<p><b>Horario:</b> Nocturno<br>Lunes a viernes: 7:00 p.m. - 10:00 p.m.<br>Sábado: 4:00 p.m. - 10:00 p.m.</p>`;
    }
    return '';
}

function buildBodyContentHTML(d) {
    const consideraciones = construirConsideracionesHTML(d);

    return `
  <h1>CONDICIONES COMERCIALES</h1>
  <h2>Universidad de Ciencias y Artes de América Latina</h2>

  <p class="principal">Tu oferta comercial para el inicio de clases en ${escapeHtml(d.inicioClases)} correspondiente al semestre ${escapeHtml(d.periodo)} incluye única y exclusivamente las condiciones detalladas a continuación:</p>

  <p><b>Nombres y Apellidos: ${escapeHtml(d.nombreCompleto)}</b></p>
  <p><b>Carrera:</b> ${escapeHtml(d.carrera)}</p>
  ${d.programaETU ? `<p><b>Especialización técnica universitaria:</b> ${escapeHtml(d.carreraETU)}</p>` : ''}

  <p><b>Matrícula (cada ciclo): </b>
    ${d.matriDescuentoTexto
        ? `<s>S/475</s> ${d.matriDescuentoTexto} - <span class="detalleDSCTO">${escapeHtml(d.matriDescuentoDetalle)}</span>`
        : 'S/475'}
  </p>

  <p><b>Examen de Admisión: </b>
    ${d.admiDescuentoTexto
        ? `<s>S/250</s> ${d.admiDescuentoTexto} (pago único) - <span class="detalleDSCTO">${escapeHtml(d.admiDescuentoDetalle)}</span>`
        : 'S/250 (pago único)'}
  </p>

  <p><b>Escala Regular:</b> S/${d.escalaRegular || 0} (por cuota)</p>

  ${d.becaMostrar ? `
  <p><b>Beca (%): </b> ${escapeHtml(d.porcentajeBeca)}</p>
  <p><b>Boleta con ${escapeHtml(d.tipoBeca)}:</b> S/${d.escalaFinal || 0} (por cuota)</p>` : ''}

  ${d.beneficioMostrar ? `
  <p><strong>${escapeHtml(d.beneficioTipo)}</strong>${escapeHtml(d.beneficioValor)}
    ${d.beneficioTexto ? `<span class="detalleDSCTO">-${escapeHtml(d.beneficioTexto)}</span>` : ''}
  </p>` : ''}

  ${d.mostrar6Cuotas && d.boleta6C ? `
  <p><b>${escapeHtml(d.boleta6CLabel)}:</b> ${escapeHtml(d.boleta6C)} (por cuota)</p>` : ''}

  <p><b>Modalidad:</b> ${escapeHtml(d.modalidadEstudio === "Remoto" ? "Virtual" : d.modalidadEstudio)}</p>

  ${d.horarioHTML}

  <div class="Consideraciones">Consideraciones:</div>
  <ul>${consideraciones}</ul>`;
}

const CC_ESTILOS_BASE = `
  p { margin:1px; line-height:1.15; font-size:16px; }
  h1 { text-align:center; font-size:28px; color:#01b39e; font-weight:bold; margin-bottom:0; margin-top:-10px; }
  h2 { margin-top:0; text-align:center; font-size:16px; font-weight:bold; }
  ul { margin-top:3px; padding-left:16px; font-size:14px; line-height:1.4; }
  .principal { margin-top:10px; margin-bottom:10px; }
  .detalleDSCTO { color:#01b39e; font-size:14px; font-style:italic; }
  .Consideraciones { font-weight:bold; margin-top:11px; margin-bottom:3px; }
  .header-container { text-align:right; }
  .header-container img { height:80px; display:inline-block; margin-top:0; }
`;

// Devuelve el HTML completo del PDF 
export function renderPlantillaCC(d) {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Rubik:ital,wght@0,300..900;1,300..900&display=swap" rel="stylesheet">
<style>
  @page {
    margin: 0;
    size: A4;
    margin-bottom: 70px;
    @bottom-center {
      content: "——————————————————————————————————————————————————\\A Universidad de Ciencias y Artes de América Latina";
      white-space: pre;
      font-size: 14px;
      color: #01b39e;
      text-align: center;
      font-weight: bold;
      line-height: 1.2;
    }
  }
  ${CC_ESTILOS_BASE}
  body { font-family:'Rubik', sans-serif; margin:0; }
  .pagina-completa { width:100%; border-collapse:collapse; }
  .pagina-completa thead td { height:100px; vertical-align:top; padding:0 1.2cm; }
  .pagina-completa tbody td { padding:0 1.2cm; vertical-align:top; }
</style>
</head>
<body>
<table class="pagina-completa">
  <thead>
    <tr><td><div class="header-container"><img src="${logoSrcCC()}" alt="UCAL"></div></td></tr>
  </thead>
  <tbody>
    <tr><td>${buildBodyContentHTML(d)}</td></tr>
  </tbody>
</table>
</body>
</html>`;
}

// Devuelve el HTML para la VISTA PREVIA
export function renderPlantillaCCPreview(d) {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Rubik:ital,wght@0,300..900;1,300..900&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  html, body {
    margin:0; padding:0; height:100%; overflow:hidden;
    background:#525659; font-family:'Rubik', sans-serif;
    display:flex; flex-direction:column;
  }
  #contenido-fuente { position:absolute; visibility:hidden; pointer-events:none; width:calc(210mm - 3.2cm); left:-9999px; top:0; }
  #paginas-scroll { flex:1; min-height:0; width:100%; overflow:auto; }
  #paginas { padding:20px 0; display:flex; flex-direction:column; align-items:center; gap:20px; transform-origin: top center; }
  .hoja {
    width:210mm;
    height:297mm;
    background:white;
    box-shadow:0 2px 10px rgba(0,0,0,0.35);
    position:relative;
    overflow:hidden;
    flex-shrink:0;
  }
  .hoja-header { position:absolute; top:8px; right:1.2cm; text-align:right; }
  .hoja-header img { height:80px; }
  .hoja-contenido { position:absolute; top:90px; left:1.2cm; right:1.2cm; bottom:70px; overflow:hidden; }
  .hoja-footer {
    position:absolute; bottom:20px; left:0; right:0; text-align:center;
    color:#01b39e; font-weight:bold; font-size:14px; line-height:1.2; white-space:pre;
  }
  #numero-hojas { flex-shrink:0; text-align:center; color:#ccc; font-family:sans-serif; font-size:12px; padding-bottom:10px; }
  ${CC_ESTILOS_BASE}
  .hoja-contenido h1 { margin-top: 0; }
</style>
</head>
<body>
  <div id="contenido-fuente">${buildBodyContentHTML(d)}</div>
  <div id="numero-hojas"></div>
  <div id="paginas-scroll">
    <div id="paginas"></div>
  </div>

  <script>
    (function () {
      var FOOTER_TEXT = '——————————————————————————————————————————————————\\nUniversidad de Ciencias y Artes de América Latina';

      function crearHoja() {
        var hoja = document.createElement('div');
        hoja.className = 'hoja';

        var header = document.createElement('div');
        header.className = 'hoja-header';
        header.innerHTML = ${JSON.stringify('<img src="' + logoSrcCC() + '" alt="UCAL">')};

        var contenido = document.createElement('div');
        contenido.className = 'hoja-contenido';

        var footer = document.createElement('div');
        footer.className = 'hoja-footer';
        footer.textContent = FOOTER_TEXT;

        hoja.appendChild(header);
        hoja.appendChild(contenido);
        hoja.appendChild(footer);
        return { hoja: hoja, contenido: contenido };
      }

      function paginar() {
        var fuente = document.getElementById('contenido-fuente');
        var contenedorPaginas = document.getElementById('paginas');
        contenedorPaginas.innerHTML = '';

        var actual = crearHoja();
        contenedorPaginas.appendChild(actual.hoja);

        function cabe() {
          return actual.contenido.scrollHeight <= actual.contenido.clientHeight;
        }

        function nuevaHoja() {
          actual = crearHoja();
          contenedorPaginas.appendChild(actual.hoja);
        }

        function agregarBloque(nodo) {
          var clon = nodo.cloneNode(true);
          actual.contenido.appendChild(clon);
          if (!cabe()) {
            actual.contenido.removeChild(clon);
            nuevaHoja();
            actual.contenido.appendChild(clon);
          }
        }

        function agregarLista(ulNodo) {
          var ulActual = document.createElement('ul');
          actual.contenido.appendChild(ulActual);

          Array.prototype.slice.call(ulNodo.children).forEach(function (li) {
            var restante = li.textContent;

            while (restante) {
              var liEl = document.createElement('li');
              liEl.textContent = restante;
              ulActual.appendChild(liEl);

              if (cabe()) { restante = ''; continue; }

              var palabras = restante.split(' ');
              var lo = 0, hi = palabras.length, mejor = 0;
              while (lo <= hi) {
                var mid = (lo + hi) >> 1;
                liEl.textContent = palabras.slice(0, mid).join(' ');
                if (cabe()) { mejor = mid; lo = mid + 1; } else { hi = mid - 1; }
              }

              if (mejor === 0) {
                ulActual.removeChild(liEl);
                if (!ulActual.children.length) actual.contenido.removeChild(ulActual);
                nuevaHoja();
                ulActual = document.createElement('ul');
                actual.contenido.appendChild(ulActual);
                continue; // reintenta el texto completo en la hoja nueva
              }

              liEl.textContent = palabras.slice(0, mejor).join(' ');
              restante = palabras.slice(mejor).join(' ');
              nuevaHoja();
              ulActual = document.createElement('ul');
              actual.contenido.appendChild(ulActual);
            }
          });
        }

        var nodos = Array.prototype.slice.call(fuente.children);
        for (var i = 0; i < nodos.length; i++) {
          var nodo = nodos[i];

          if (nodo.tagName === 'UL') {
            agregarLista(nodo);
            continue;
          }

          var esTituloConsideraciones = nodo.className === 'Consideraciones';
          var primerNodoLista = esTituloConsideraciones && nodos[i + 1] && nodos[i + 1].tagName === 'UL'
            ? nodos[i + 1].children[0] : null;

          if (primerNodoLista) {
            var clonTitulo = nodo.cloneNode(true);
            var ulPrueba = document.createElement('ul');
            var clonLi = primerNodoLista.cloneNode(true);
            ulPrueba.appendChild(clonLi);

            actual.contenido.appendChild(clonTitulo);
            actual.contenido.appendChild(ulPrueba);
            var entranJuntos = cabe();
            actual.contenido.removeChild(clonTitulo);
            actual.contenido.removeChild(ulPrueba);

            if (!entranJuntos) nuevaHoja();
            actual.contenido.appendChild(nodo.cloneNode(true));
            continue;
          }

          agregarBloque(nodo);
        }

        var numHojas = document.getElementById('numero-hojas');
        var total = contenedorPaginas.children.length;
        numHojas.textContent = total + (total === 1 ? ' hoja' : ' hojas');

        ajustarEscala();
      }

      function ajustarEscala() {
        var paginas = document.getElementById('paginas');
        var primeraHoja = paginas.querySelector('.hoja');
        if (!primeraHoja) return;

        paginas.style.transform = 'none';
        var anchoHoja = primeraHoja.getBoundingClientRect().width;
        var anchoDisponible = document.documentElement.clientWidth - 20;
        var escala = Math.min(1, anchoDisponible / anchoHoja);

        paginas.style.transform = 'scale(' + escala + ')';
        // El transform no reduce el espacio que el elemento ocupa en el
        // flujo del documento; compensamos con un margin-bottom negativo
        // para que #paginas-scroll no reserve el alto sin escalar.
        var alturaReal = primeraHoja.offsetHeight * paginas.children.length +
          20 * (paginas.children.length - 1) + 40; // gaps + padding vertical
        paginas.style.marginBottom = (alturaReal * escala - alturaReal) + 'px';
      }

      window.addEventListener('resize', ajustarEscala);

      if (document.readyState === 'complete') {
        paginar();
      } else {
        window.addEventListener('load', paginar);
      }
    })();
  </script>
</body>
</html>`;
}

function construirConsideracionesHTML(d) {
    const items = [];
    const esCachimbo = d.tipoIngresoActual === 'regular' || d.mostrarTrasladoSinConvalidacion;
    const esSemipresencial = d.modalidadEstudio === 'Semi-Presencial';
    const carreraNorm = normalizarTexto(d.carrera);
    const esCachimboSemipresencialCarrera = esCachimbo && esSemipresencial &&
        (carreraNorm === 'psicologia' || carreraNorm === 'disenograficopublicitario');

    if (d.programaETU) {
        items.push(`El alumno se matricula en la carrera de ${escapeHtml(d.carrera)}, a la cual pertenece la especialización técnica universitaria ${escapeHtml(d.carreraETU)}.`);
        items.push(`Al aprobar todos los créditos de los cursos correspondientes del 1er al 6to ciclo, el estudiante recibe una especialización técnica universitaria a nombre de UCAL. Al término del 10mo ciclo y cumplidos los requisitos del reglamento de estudios, recibe el grado de Bachiller en ${escapeHtml(d.carrera)}. Cumplidos los requisitos de titulación recibe el título de Licenciado en ${escapeHtml(d.carrera)}.`);
    }

    if (d.mostrarBecaColaborador) {
        items.push(`El descuento de beca del 50% sobre la escala regular se mantiene siempre y cuando el colaborador se mantenga trabajando en UCAL. Si ocurre una desvinculación por motivos atribuibles a la empresa (UCAL), el alumno seguirá manteniendo el beneficio. Si ocurre una desvinculación por motivos atribuibles al colaborador, el alumno perderá el beneficio de 50% de descuento y contará solo con un 30% de descuento a partir del momento de la desvinculación.`);
        items.push(`En caso el alumno se retire 1 o más ciclos, pierde el beneficio.`);
    }
    if (d.mostrarBecaImpacto) {
        items.push(`Para conservar la beca impacto, el estudiante deberá estar debidamente matriculado en cada periodo académico y no haber sido sancionado por la Universidad por motivos disciplinarios durante el desarrollo de la carrera. En caso el estudiante no curse el periodo académico inmediato superior, perderá definitivamente la beca. Revisar el documento "Convenio de Beca" para mayor información sobre sus términos y alcances.`);
        items.push(`El porcentaje de beca otorgado al estudiante se mantendrá sin cambios siempre que cumpla con los requisitos para su renovación. En caso de que el estudiante pierda la beca, no será posible recuperarla y deberá pagar según la escala de pago regular y los ajustes correspondientes. Sin embargo, el estudiante podrá aplicar a otras becas vigentes.`);
    }
    if (d.mostrarBecaPotencia) {
        items.push(`La beca se renueva automáticamente cada ciclo siempre y cuando se cumplan las condiciones establecidas. Las principales son mantener un promedio ponderado mínimo de 15 en el ciclo inmediato anterior y pertenecer al tercio superior de la carrera.`);
        items.push(`El porcentaje de beca otorgado al estudiante se mantendrá sin cambios siempre que cumpla con los requisitos para su renovación. En caso de que el estudiante pierda la beca, no será posible recuperarla y deberá pagar según la escala de pago regular y los ajustes correspondientes. Sin embargo, el estudiante podrá aplicar a otras becas vigentes.`);
    }
    if (d.mostrar6Cuotas && d.boleta6C) {
        items.push(`De acuerdo con lo conversado con el postulante, se opta por un financiamiento de pago en seis cuotas. Sin embargo, el postulante podrá cambiar el pago de seis cuotas a cinco cuotas al inicio de cada ciclo académico. En caso de pérdida del beneficio de beca, se conservará el financiamiento de pago en seis cuotas. El valor de cada cuota será determinado tomando como base el costo regular del ciclo académico, distribuido en seis pagos.`);
    }
    if (d.mostrar50Primera || d.mostrar100Primera) {
        const pct = d.mostrar50Primera ? '50%' : '100%';
        items.push(`Si el estudiante ha sido admitido en la Universidad para el periodo académico ${escapeHtml(d.periodo)} y ha sido beneficiado con el descuento promocional de ${pct} en su primera boleta de pago, reconoce y acepta que dicho beneficio está condicionado a su permanencia activa en el ciclo académico correspondiente. En caso el estudiante solicite el retiro del ciclo académico ${escapeHtml(d.periodo)} luego de haber sido beneficiado con el descuento antes señalado, se compromete a abonar a la Universidad el importe equivalente al descuento otorgado conforme al valor regular de las boletas sin descuento. La no cancelación de dicho importe generará una deuda pendiente a su cargo, la cual será exigible conforme a los procedimientos y condiciones establecidas por la Universidad.`);
    }
    if (d.mostrarBeneficio500) {
        items.push(`Si el estudiante ha sido admitido en la Universidad para el periodo académico ${escapeHtml(d.periodo)} y ha sido beneficiado con el beneficio promocional de primera boleta de pago S/500, reconoce y acepta que dicho beneficio está condicionado a su permanencia activa en el ciclo académico correspondiente. En caso el estudiante solicite el retiro del ciclo académico ${escapeHtml(d.periodo)} luego de haber sido beneficiado con el descuento antes señalado, se compromete a abonar a la Universidad el importe equivalente al descuento otorgado conforme al valor regular de las boletas sin descuento. La no cancelación de dicho importe generará una deuda pendiente a su cargo, la cual será exigible conforme a los procedimientos y condiciones establecidas por la Universidad.`);
    }
    if (d.mostrarTrasladoSinConvalidacion) {
        items.push(`El examen de suficiencia y la evaluación de aptitudes están dirigidos únicamente para los prospectos de traslado que no han participado del proceso de convalidación y buscan exonerar cursos generales.`);
    }

    items.push(!d.becaMostrar
        ? `La escala regular de pago podrá ajustarse según lo determine la universidad, lo que será comunicado de manera oportuna.`
        : `La escala regular de pago podrá ajustarse según lo determine la universidad, lo que será comunicado de manera oportuna. En consecuencia, si esta variase, esto implicaría una variación en la escala de pago con beca ya que esta se determina como un porcentaje de descuento sobre la escala regular vigente.`);

    if (d.mostrarTrasladoConvalidacion) {
        if (d.mostrarConsidSP) {
            items.push(`Como beneficio para los ingresos por traslado, la universidad realizará el proceso de convalidación con dos mallas académicas distintas, con la finalidad de convalidar la mayor cantidad posible de cursos y reducir el tiempo de estudios del alumno; dichas mallas corresponden a modalidades académicas diferentes —una presencial (80% presencial y 20% virtual) y otra semipresencial (60% presencial y 40% virtual)—, por lo que la modalidad de inscripción final estará sujeta a la malla que otorgue el mayor beneficio en número de cursos convalidados.`);
        }
        items.push(`La institución podrá realizar mejoras o ajustes al programa según las disposiciones de la autoridad, siempre orientados a garantizar la mejor experiencia académica para los estudiantes.`);
    }

    if (d.mostrarTrasladoConvalidacion) {
        items.push(`Los postulantes que ingresan bajo la modalidad de traslado deberán presentar la documentación requerida (como Certificados de Estudios Secundarios y Certificados de Estudios Superiores, Sílabos u otros documentos solicitados) dentro de los plazos establecidos por la universidad. Si no cuenta con alguno de estos documentos al momento de la inscripción, el postulante podrá continuar su proceso de manera condicional, comprometiéndose a regularizar la entrega en el plazo de 30 días calendarios a partir del pago de la primera cuota. Es importante considerar que la evaluación de cursos, convalidaciones y la asignación académica estarán sujetas a la entrega completa y validación de la documentación. El incumplimiento en la regularización dentro del plazo establecido afectará dichos procesos, así como la continuidad del alumno en la universidad. En caso de que el ingresante no presente su Certificado de Estudios Secundarios dentro del plazo de 30 días calendarios contado desde el inicio de clases, autoriza expresamente a la Universidad a gestionar la obtención de dicho documento en su representación. El costo de este servicio asciende a S/ 410.00 y será cargado automáticamente en su estado de cuenta. No obstante, cuando el ingresante haya realizado sus estudios secundarios en una institución educativa ubicada fuera de Lima Metropolitana o en una institución educativa que ya no se encuentre en funcionamiento, será de su exclusiva responsabilidad realizar las gestiones necesarias ante las autoridades o entidades correspondientes para obtener su Certificado de Estudios Secundarios y presentarlo ante la Universidad dentro del plazo establecido. En estos casos, la Universidad no realizará la gestión de obtención del Certificado ni se aplicará el cobro de S/ 410.00.`);
    } else {
        items.push(`Para completar el proceso de admisión, todos los postulantes deben presentar el Certificado de Estudios Secundarios. Si no cuentan con este documento al momento de la inscripción, podrán continuar con el proceso de manera condicional, comprometiéndose a regularizar su presentación dentro del plazo establecido por la Universidad. En caso de que el ingresante no presente el Certificado de Estudios Secundarios dentro del plazo de 30 días calendarios contado desde el inicio de clases, autoriza expresamente a la Universidad a realizar las gestiones necesarias para obtener dicho documento en su representación. El costo de esta gestión asciende a S/ 410.00 (cuatrocientos diez y 00/100 soles) y será cargado automáticamente en su estado de cuenta. No obstante, cuando el ingresante haya realizado sus estudios secundarios en una institución educativa ubicada fuera de Lima Metropolitana o en una institución educativa que ya no se encuentre en funcionamiento, será de su exclusiva responsabilidad realizar las gestiones necesarias ante las autoridades o entidades correspondientes para obtener su Certificado de Estudios Secundarios y presentarlo ante la Universidad dentro del plazo establecido. En estos casos, la Universidad no realizará la gestión de obtención del certificado ni se aplicará el cobro de S/ 410.00. Es importante considerar que el incumplimiento de la presentación del Certificado de Estudios Secundarios dentro del plazo establecido podrá afectar la continuidad del proceso de admisión o la permanencia del estudiante en la Universidad.`);
    }

    if (esCachimboSemipresencialCarrera) {
        items.push(`La matrícula puede contemplar ajustes en el itinerario académico con el objetivo de asegurar una adecuada experiencia de aprendizaje.`);
    }

    if (d.modalidadEstudio === 'Remoto') {
        items.push(`En casos excepcionales y por necesidades académicas, la Universidad podrá realizar ajustes en el horario informado, comunicándolo de manera oportuna al estudiante.`);
    }

    if (!d.mostrarTrasladoConvalidacion) {
        items.push(`Aquellos alumnos que cuenten con exoneración parcial o total del examen de admisión deberán rendirlo dentro de los treinta (30) días calendario posteriores al pago de la primera cuota. De no cumplir con ello, el monto correspondiente al examen será cobrado íntegramente en la tercera cuota.`);
    }
    
    items.push(`Los horarios del primer ciclo son asignados por la universidad sin opción a cambios o ajustes. A partir del segundo ciclo, los alumnos podrán elegir sus horarios en función a la apertura de cursos y disponibilidad de horarios.`);
    items.push(`Los descuentos sobre los conceptos de examen de admisión, matrícula y/o primera boleta solo aplicarán para el primer período académico regular del semestre de ingreso del alumno.`);
    items.push(`Los buses son exclusivos para estudiantes y operan con horarios y paraderos fijos según las rutas establecidas. Para el semestre ${escapeHtml(d.periodo)}, los horarios y paraderos serán confirmados antes del inicio de clases.`);
    items.push(`La universidad no brinda acceso directo a vacantes ni convenios de trabajo o prácticas con las empresas asociadas a nuestros talleres académicos. Sin embargo, en UCAL, preparamos a profesionales destacados a través de programas como Acciona UCAL, que potencian la empleabilidad de los estudiantes al resolver casos reales con empresas reconocidas a lo largo de su carrera generando experiencia en diversos sectores.`);
    items.push(`El acceso a las instalaciones de la universidad y el uso de los estacionamientos están reservados exclusivamente para los alumnos matriculados. En este sentido, se prohíbe el ingreso de padres, familiares o terceros ajenos a la institución salvo en casos excepcionales que deberán ser solicitados por escrito y aprobados previamente por el Jefe de Sede. Esta medida tiene como objetivo garantizar la seguridad y el adecuado funcionamiento de las actividades académicas dentro del campus universitario.`);
    items.push(`Para aquellos alumnos que no cuenten con un seguro contra accidentes, la universidad brinda un seguro por un valor S/70 por semestre académico y este se divide en tres cuotas: dos de S/ 25 y una de S/ 20. Este monto será incluido en la boleta de pago a partir de la segunda cuota del ciclo académico (de la cuota 2 a la 4).`);
    items.push(`El estudiante tiene el deber de conocer y cumplir el Reglamento de Estudios y Administrativo Financiero de UCAL, ya que, en ellos, se regula la gestión académica – administrativa y las relaciones entre la Institución y el estudiante. El Reglamento de Estudios y Administrativo Financiero se encuentran publicados en nuestro Portal de Transparencia UCAL: transparencia.ucal.edu.pe.`);
    items.push(`Para mayor información, puedes revisar los Términos y Condiciones disponibles en el siguiente enlace: https://ucal.edu.pe/carreras-universitarias/terminos-y-condiciones/`);
    items.push(`Ante cualquier inconveniente durante su proceso de inscripción, podrá comunicarse al siguiente número: 942 632 791.`);

    return items.map(txt => `<li>${txt}</li>`).join('');
}