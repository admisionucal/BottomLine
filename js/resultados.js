// ================================================================
// RESULTADOS - "Usuarios > Resultados" (solo SUPERVISOR / ADMISION)
// ================================================================

import { API_URL, ROLES } from '../core/constants.js';
import { getCurrentUser, getSessionToken, escapeHtml, formatearFecha } from '../core/utils.js';
import { Sidebar, renderTable } from '../core/components.js';

let modoEmbebido = false;
const state = { evaluaciones: [], codigoActual: null, filas: [] };

async function callAPI(action, data = {}) {
    const payload = { action, sessionToken: getSessionToken(), ...data };
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload),
        });
        return JSON.parse(await response.text());
    } catch (error) {
        return { success: false, error: error.message };
    }
}

document.addEventListener('DOMContentLoaded', () => initResultados());

// Punto de entrada cuando se embebe dentro de dashboard.html.
// `codigoInicial` permite abrir directo en una evaluación (ej. desde la
// tarjeta "Ver resultados" en la vista Evaluaciones).
window.initResultadosEmbebido = function (codigoInicial) {
    initResultados(codigoInicial);
};

async function initResultados(codigoInicial) {
    const user = getCurrentUser();
    if (!user) {
        window.location.href = 'index.html';
        return;
    }

    if (user.rol !== ROLES.SUPERVISOR && user.rol !== ROLES.ADMISION) {
        alert('Acceso denegado: esta sección es solo para Supervisor y Admisión.');
        if (typeof window.mostrarUsuario === 'function') {
            window.mostrarUsuario();
        } else {
            window.location.href = 'usuario.html';
        }
        return;
    }

    modoEmbebido = !!document.querySelector('.sidebar-nav');
    if (!modoEmbebido) {
        new Sidebar({ active: 'usuario', activeSubitem: 'navUsuarioResultados' });
    }

    if (!codigoInicial) {
        const params = new URLSearchParams(window.location.search);
        codigoInicial = params.get('codigo') || null;
    }

    await cargarEvaluacionesDisponibles(codigoInicial);

    document.getElementById('resEvaluacionSelect').addEventListener('change', (e) => {
        cargarResultados(e.target.value);
    });
    document.getElementById('resBtnExportar').addEventListener('click', exportarExcel);

    inicializarModalDetalle();
}

async function cargarEvaluacionesDisponibles(codigoInicial) {
    const result = await callAPI('getEvaluaciones');
    if (!result.success) {
        document.getElementById('resTablaContainer').innerHTML =
            `<div class="loading">Error: ${escapeHtml(result.error || 'No se pudo cargar')}</div>`;
        return;
    }

    state.evaluaciones = result.data || [];
    const select = document.getElementById('resEvaluacionSelect');
    select.innerHTML = state.evaluaciones.map((ev) =>
        `<option value="${escapeHtml(ev.codigo)}">${escapeHtml(ev.titulo)}</option>`
    ).join('');

    const codigo = (codigoInicial && state.evaluaciones.some((e) => e.codigo === codigoInicial))
        ? codigoInicial
        : (state.evaluaciones[0] && state.evaluaciones[0].codigo);

    if (codigo) {
        select.value = codigo;
        await cargarResultados(codigo);
    } else {
        document.getElementById('resTablaContainer').innerHTML = '<div class="loading">No hay evaluaciones registradas.</div>';
    }
}

async function cargarResultados(codigo) {
    state.codigoActual = codigo;
    const cont = document.getElementById('resTablaContainer');
    cont.innerHTML = '<div class="loading">Cargando resultados…</div>';

    const result = await callAPI('getResultadosEvaluacion', { codigo });
    if (!result.success) {
        cont.innerHTML = `<div class="loading">Error: ${escapeHtml(result.error || 'No se pudo cargar')}</div>`;
        return;
    }

    state.filas = result.data || [];
    cont.innerHTML = '<div id="resTabla"></div>';

    const headers = ['Asesor', 'Campaña', 'Estado', 'Puntaje', 'Fecha', 'Duración'];
    const rows = state.filas.map((f) => {
        const badgeClass = f.estado === 'Completado' ? 'completado' : 'pendiente';
        const scoreClass = f.porcentaje >= 80 ? 'sc-alta' : f.porcentaje >= 60 ? 'sc-media' : 'sc-baja';
        const score = f.estado === 'Completado'
            ? `<span class="res-link" onclick="window.__verDetalleResultado('${escapeHtml(f.usuario)}')"><span class="res-score ${scoreClass}">${Number(f.porcentaje).toFixed(0)}%</span></span>`
            : '—';
        return [
            escapeHtml(f.nombre || f.usuario),
            escapeHtml(f.campana || '—'),
            `<span class="res-badge ${badgeClass}">${escapeHtml(f.estado)}</span>`,
            score,
            f.finalizadoEn ? escapeHtml(formatearFecha(f.finalizadoEn)) : '—',
            f.duracionSegundos ? `${Math.round(f.duracionSegundos / 60)} min` : '—',
        ];
    });

    renderTable('resTabla', headers, rows);
}

// ================================================================
// MODAL DE DETALLE: Pregunta + Respuesta + Nota + Consejo
// ================================================================

let __resDetalleListenersAtados = false;

function inicializarModalDetalle() {
    if (__resDetalleListenersAtados) return;
    const modal = document.getElementById('resDetalleModal');
    const btnClose = document.getElementById('resDetalleModalClose');
    if (!modal || !btnClose) return;

    btnClose.addEventListener('click', cerrarModalDetalle);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) cerrarModalDetalle();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('show')) cerrarModalDetalle();
    });

    __resDetalleListenersAtados = true;
}

function abrirModalDetalle() {
    const modal = document.getElementById('resDetalleModal');
    if (modal) modal.classList.add('show');
}

function cerrarModalDetalle() {
    const modal = document.getElementById('resDetalleModal');
    if (modal) modal.classList.remove('show');
}

window.__verDetalleResultado = async function (usuario) {
    inicializarModalDetalle();
    abrirModalDetalle();

    const titulo = document.getElementById('resDetalleTitulo');
    const sub = document.getElementById('resDetalleSub');
    const cont = document.getElementById('resDetalleContenido');

    titulo.textContent = 'Cargando…';
    sub.textContent = '';
    cont.innerHTML = '<div class="loading">Cargando detalle…</div>';

    const result = await callAPI('getDetalleIntentoEvaluacion', { codigo: state.codigoActual, usuario });
    if (!result.success) {
        titulo.textContent = 'Error';
        cont.innerHTML = `<div class="loading">${escapeHtml(result.error || 'No se pudo cargar el detalle.')}</div>`;
        return;
    }

    const data = result.data;
    titulo.textContent = data.nombre || usuario;
    sub.textContent = `${Number(data.porcentaje).toFixed(0)}% (${data.puntaje_obtenido}/${data.puntaje_maximo})`
        + (data.finalizado_en ? ` · ${formatearFecha(data.finalizado_en)}` : '');

    const filas = construirFilasDetalle(data.detalle);
    if (!filas.length) {
        cont.innerHTML = '<div class="loading">No hay desglose por pregunta disponible para este intento.</div>';
        return;
    }

    cont.innerHTML = filas.map((f) => `
        <div class="det-preg-row">
            <div class="det-preg-label">${escapeHtml(f.pregunta)}<span class="det-preg-nota ${f.notaClass}">${escapeHtml(f.nota)}</span></div>
            <div class="det-preg-respuesta">${escapeHtml(f.respuesta)}</div>
            ${f.consejo ? `<div class="det-preg-consejo"><b>Consejo:</b> ${escapeHtml(f.consejo)}</div>` : ''}
        </div>
    `).join('');
};

// Normaliza el jsonb `detalle` (guardado por evaluacion-marca-ucal.html,
// ver EVAL.questions / gradeLocal / mergeAI) a filas simples de
// Pregunta + Respuesta + Nota + Consejo para pintarlas en el modal.
//
// - Preguntas abiertas (type: "open"): una fila por pregunta.
// - Verdadero/Falso (type: "tf"): una fila por cada afirmación del grupo,
//   porque cada una tiene su propia respuesta/nota/justificación.
function construirFilasDetalle(detalle) {
    if (!detalle || !Array.isArray(detalle.per)) return [];
    const filas = [];

    detalle.per.forEach((item, idx) => {
        if (item.type === 'tf') {
            (item.items || []).forEach((sub, i) => {
                const marcado = sub.given === 'V' ? 'Verdadero' : sub.given === 'F' ? 'Falso' : 'Sin responder';
                filas.push({
                    pregunta: sub.stmt || `Afirmación ${i + 1}`,
                    respuesta: `Marcó: ${marcado}` + (sub.justification ? ` — "${sub.justification}"` : ''),
                    nota: sub.ok ? 'Correcto' : 'Incorrecto',
                    notaClass: sub.ok ? 'full' : 'none',
                    consejo: sub.why || '',
                });
            });
        } else {
            const earned = Number(item.earned ?? 0);
            const points = Number(item.points ?? 0);
            const notaClass = points > 0 && earned >= points ? 'full' : (earned > 0 ? 'part' : 'none');
            const consejoPartes = [];
            if (item.advice) consejoPartes.push(item.advice);
            if (item.miss && item.miss.length) consejoPartes.push('Le faltó: ' + item.miss.join('; ') + '.');

            filas.push({
                // `prompt` viaja en el detalle desde evaluacion-marca-ucal.html;
                // si el intento es viejo y no lo tiene, se usa un rótulo genérico.
                pregunta: item.prompt || `Pregunta ${idx + 1}`,
                respuesta: (item.answer || '').trim() || '(no respondió esta pregunta)',
                nota: `${earned} / ${points}`,
                notaClass,
                consejo: consejoPartes.join(' '),
            });
        }
    });

    return filas;
}

function exportarExcel() {
    if (!state.filas.length || typeof XLSX === 'undefined') return;
    const evalActual = state.evaluaciones.find((e) => e.codigo === state.codigoActual);
    const data = state.filas.map((f) => ({
        Asesor: f.nombre || f.usuario,
        Campaña: f.campana || '',
        Estado: f.estado,
        'Puntaje (%)': f.porcentaje ?? '',
        Fecha: f.finalizadoEn ? formatearFecha(f.finalizadoEn) : '',
        'Duración (min)': f.duracionSegundos ? Math.round(f.duracionSegundos / 60) : '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Resultados');
    XLSX.writeFile(wb, `Resultados_${(evalActual?.titulo || 'evaluacion').replace(/\s+/g, '_')}.xlsx`);
}