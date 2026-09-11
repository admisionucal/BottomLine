// ================================================================
// EVALUACIONES - "Usuarios > Evaluaciones"
// ASESOR: resuelve sus evaluaciones pendientes.
// SUPERVISOR / ADMISION: visualiza el avance del equipo (solo lectura;
// el detalle fino vive en "Usuarios > Resultados").
// ================================================================

import { API_URL, ROLES } from '../core/constants.js';
import { getCurrentUser, getSessionToken, escapeHtml, formatearFecha } from '../core/utils.js';
import { Sidebar } from '../core/components.js';

let modoEmbebido = false;

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

document.addEventListener('DOMContentLoaded', () => initEvaluaciones());

// Punto de entrada cuando se embebe dentro de dashboard.html
window.initEvaluacionesEmbebido = function () {
    initEvaluaciones();
};

async function initEvaluaciones() {
    const user = getCurrentUser();
    if (!user) {
        window.location.href = 'index.html';
        return;
    }

    modoEmbebido = !!document.querySelector('.sidebar-nav');
    if (!modoEmbebido) {
        new Sidebar({ active: 'usuario', activeSubitem: 'navUsuarioEvaluaciones' });
    }

    const esAdmin = user.rol === ROLES.SUPERVISOR || user.rol === ROLES.ADMISION;
    const subtitulo = document.getElementById('evalSubtitulo');
    if (subtitulo) {
        subtitulo.textContent = esAdmin
            ? 'Avance del equipo en cada evaluación. Para ver el detalle por asesor, ve a "Resultados".'
            : 'Resuelve las evaluaciones asignadas. Una vez enviada, no se puede volver a repetir.';
    }

    await cargarEvaluaciones(user, esAdmin);
}

async function cargarEvaluaciones(user, esAdmin) {
    const grid = document.getElementById('evalGrid');
    grid.innerHTML = '<div class="loading">Cargando evaluaciones…</div>';

    const result = await callAPI('getEvaluaciones');
    if (!result.success) {
        grid.innerHTML = `<div class="loading">Error: ${escapeHtml(result.error || 'No se pudo cargar')}</div>`;
        return;
    }

    const data = result.data || [];
    if (!data.length) {
        grid.innerHTML = '<div class="eval-empty">No hay evaluaciones disponibles por ahora.</div>';
        return;
    }

    grid.innerHTML = data.map((ev) => esAdmin ? renderCardAdmin(ev) : renderCardAsesor(ev)).join('');
}

function renderCardAsesor(ev) {
    const completado = ev.estado === 'Completado';
    const pillClass = completado ? 'completado' : 'pendiente';
    const pillIcon = completado ? 'check_circle' : 'schedule';
    const boton = completado
        ? `<button type="button" class="btn-export" onclick="window.location.href='${escapeHtml(ev.archivo)}?codigo=${encodeURIComponent(ev.codigo)}'">Ver mi resultado</button>`
        : `<button type="button" class="btn-primary" onclick="window.location.href='${escapeHtml(ev.archivo)}?codigo=${encodeURIComponent(ev.codigo)}'">Resolver evaluación</button>`;

    const score = completado && ev.resultado
        ? `<span class="eval-card-score">${Number(ev.resultado.porcentaje).toFixed(0)}%</span>`
        : '';

    return `
        <div class="eval-card">
            <div class="eval-card-top">
                <div class="eval-card-icon"><span class="material-symbols-outlined">quiz</span></div>
                <span class="eval-pill ${pillClass}"><span class="material-symbols-outlined" style="font-size:14px;">${pillIcon}</span>${escapeHtml(ev.estado)}</span>
            </div>
            <div class="eval-card-titulo">${escapeHtml(ev.titulo)}</div>
            <div class="eval-card-desc">${escapeHtml(ev.descripcion || '')}</div>
            <div class="eval-card-footer">
                ${score}
                ${boton}
            </div>
        </div>
    `;
}

function renderCardAdmin(ev) {
    const pct = ev.totalAsesores > 0 ? Math.round((ev.completados / ev.totalAsesores) * 100) : 0;
    return `
        <div class="eval-card">
            <div class="eval-card-top">
                <div class="eval-card-icon"><span class="material-symbols-outlined">quiz</span></div>
            </div>
            <div class="eval-card-titulo">${escapeHtml(ev.titulo)}</div>
            <div class="eval-card-desc">${escapeHtml(ev.descripcion || '')}</div>
            <div class="eval-card-progress"><b>${ev.completados}</b> de <b>${ev.totalAsesores}</b> asesores completaron (${pct}%)</div>
            <div class="eval-card-footer">
                <span></span>
                <button type="button" class="btn-export" onclick="window.mostrarResultados && window.mostrarResultados('${escapeHtml(ev.codigo)}')">Ver resultados</button>
            </div>
        </div>
    `;
}
