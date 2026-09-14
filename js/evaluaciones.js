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

    const puedeEditarVentana = user.rol === ROLES.ADMISION;
    grid.innerHTML = data.map((ev) => esAdmin ? renderCardAdmin(ev, puedeEditarVentana) : renderCardAsesor(ev)).join('');
}

function renderCardAsesor(ev) {
    const completado = ev.estado === 'Completado';
    const bloqueado = ev.estado === 'No disponible aún' || ev.estado === 'Cerrada';
    const pillClass = completado ? 'completado' : (bloqueado ? 'bloqueado' : 'pendiente');
    const pillIcon = completado ? 'check_circle' : (bloqueado ? 'lock' : 'schedule');

    let boton;
    if (completado) {
        boton = `<button type="button" class="btn-export" onclick="window.location.href='${escapeHtml(ev.archivo)}?codigo=${encodeURIComponent(ev.codigo)}'">Ver mi resultado</button>`;
    } else if (bloqueado) {
        boton = `<button type="button" class="btn-export" disabled>${ev.estado === 'Cerrada' ? 'Cerrada' : 'Aún no disponible'}</button>`;
    } else {
        boton = `<button type="button" class="btn-primary" onclick="window.location.href='${escapeHtml(ev.archivo)}?codigo=${encodeURIComponent(ev.codigo)}'">Resolver evaluación</button>`;
    }

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

function renderCardAdmin(ev, puedeEditarVentana) {
    const pct = ev.totalAsesores > 0 ? Math.round((ev.completados / ev.totalAsesores) * 100) : 0;
    const editorVentana = puedeEditarVentana ? `
        <button type="button" class="btn-link" onclick="window.editarVentana && window.editarVentana('${escapeHtml(ev.codigo)}')">Editar</button>
    ` : '';

    return `
        <div class="eval-card">
            <div class="eval-card-top">
                <div class="eval-card-icon"><span class="material-symbols-outlined">quiz</span></div>
            </div>
            <div class="eval-card-titulo">${escapeHtml(ev.titulo)}</div>
            <div class="eval-card-desc">${escapeHtml(ev.descripcion || '')}</div>
            <div class="eval-card-progress"><b>${ev.completados}</b> de <b>${ev.totalAsesores}</b> asesores completaron (${pct}%)</div>

            <div class="eval-card-ventana" id="ventanaView-${ev.codigo}">
                <span class="material-symbols-outlined" style="font-size:15px;vertical-align:-3px;">event</span>
                ${escapeHtml(renderVentanaTexto(ev))} ${editorVentana}
            </div>
            <div class="eval-card-ventana-edit" id="ventanaEdit-${ev.codigo}" style="display:none;">
                <label>Activo desde<br><input type="datetime-local" id="desde-${ev.codigo}" value="${toDatetimeLocalValue(ev.activoDesde)}"></label>
                <label>Activo hasta<br><input type="datetime-local" id="hasta-${ev.codigo}" value="${toDatetimeLocalValue(ev.activoHasta)}"></label>
                <div style="display:flex; gap:8px; margin-top:8px;">
                    <button type="button" class="btn-primary" onclick="window.guardarVentana && window.guardarVentana('${escapeHtml(ev.codigo)}')">Guardar</button>
                    <button type="button" class="btn-export" onclick="window.cancelarVentana && window.cancelarVentana('${escapeHtml(ev.codigo)}')">Cancelar</button>
                </div>
            </div>

            <div class="eval-card-footer">
                <span></span>
                <button type="button" class="btn-export" onclick="window.mostrarResultados && window.mostrarResultados('${escapeHtml(ev.codigo)}')">Ver resultados</button>
            </div>
        </div>
    `;
}

window.editarVentana = (codigo) => {
    document.getElementById(`ventanaView-${codigo}`).style.display = 'none';
    document.getElementById(`ventanaEdit-${codigo}`).style.display = 'block';
};
window.cancelarVentana = (codigo) => {
    document.getElementById(`ventanaEdit-${codigo}`).style.display = 'none';
    document.getElementById(`ventanaView-${codigo}`).style.display = 'block';
};
window.guardarVentana = async (codigo) => {
    const desde = document.getElementById(`desde-${codigo}`).value;
    const hasta = document.getElementById(`hasta-${codigo}`).value;
    const result = await callAPI('guardarVentanaEvaluacion', {
        codigo,
        activoDesde: desde || null,
        activoHasta: hasta || null,
    });
    if (!result.success) {
        alert(result.error || 'No se pudo guardar la ventana de disponibilidad.');
        return;
    }
    await cargarEvaluaciones(getCurrentUser(), true);
};

function formatearFechaHora(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
}

function toDatetimeLocalValue(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderVentanaTexto(ev) {
    if (!ev.activoDesde && !ev.activoHasta) return 'Sin restricción de fechas';
    const desde = ev.activoDesde ? formatearFechaHora(ev.activoDesde) : '—';
    const hasta = ev.activoHasta ? formatearFechaHora(ev.activoHasta) : '—';
    return `Activo: ${desde} → ${hasta}`;
}