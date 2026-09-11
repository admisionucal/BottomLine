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

window.__verDetalleResultado = async function (usuario) {
    const result = await callAPI('getDetalleIntentoEvaluacion', { codigo: state.codigoActual, usuario });
    if (!result.success) {
        alert(result.error || 'No se pudo cargar el detalle.');
        return;
    }
    // El detalle (respuestas + desglose por pregunta) viaja completo en
    // result.data; aquí se deja un hook simple para no acoplar el modal
    // de detalle a esta vista. Ajusta a un modal propio si lo necesitas.
    console.log('Detalle de la evaluación:', result.data);
    alert(`${result.data.nombre}: ${Number(result.data.porcentaje).toFixed(0)}% (${result.data.puntaje_obtenido}/${result.data.puntaje_maximo})`);
};

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
