// ================================================================
// USUARIO - Módulo de perfil y KPIs
// ================================================================

import {
    API_URL, COLUMNAS, STATUS, CACHE_KEYS,
    esRolSupervisorOAdmision
} from '../core/constants.js';

import {
    getCurrentUser, getUserCampanas, getSessionToken,
    cacheGet, cacheSet,
    escapeHtml, horaAMinutos, minutosAHora,
    hoyDDMMYYYY, normalizarUrlFoto
} from '../core/utils.js';

import { Sidebar } from '../core/components.js';

// ===== INICIALIZACIÓN =====
document.addEventListener('DOMContentLoaded', () => {
    const user = getCurrentUser();
    if (!user) {
        window.location.href = 'index.html';
        return;
    }

    new Sidebar();
    initUsuario();
});

// ===== PUNTO DE ENTRADA (para embebido en dashboard) =====
window.initUsuarioEmbebido = function() {
    initUsuario();
};

function initUsuario() {
    const user = getCurrentUser();
    if (!user) return;

    // Perfil
    document.getElementById('userProfileNombre').textContent = user.nombre || '—';
    document.getElementById('userProfileCargo').textContent = user.cargo || '—';
    document.getElementById('userProfileRol').textContent = user.rol || '—';
    document.getElementById('userProfileDni').textContent = user.dni || '—';
    document.getElementById('userProfileEmail').textContent = user.email || '—';

    // Campañas
    const campanas = getUserCampanas();
    const contCampanas = document.getElementById('userProfileCampanas');
    if (contCampanas) {
        contCampanas.innerHTML = campanas.length
            ? campanas.map(c => `<span class="campana-tag">${escapeHtml(c)}</span>`).join('')
            : '—';
    }

    // Foto
    const fotoEl = document.getElementById('userProfileFoto');
    if (fotoEl) fotoEl.src = normalizarUrlFoto(user.foto) || 'assets/logo.png';

    // Asistencia: ocultar/mostrar según rol
    const esAdmin = esRolSupervisorOAdmision(user.rol);
    const cardMarcar = document.getElementById('kpiMarcarAsistencia');
    const cardHora = document.getElementById('kpiHoraEntrada');
    const cardAdmin = document.getElementById('kpiResumenAsistenciaAdmin');

    if (cardMarcar) cardMarcar.style.display = esAdmin ? 'none' : '';
    if (cardHora) cardHora.style.display = esAdmin ? 'none' : '';
    if (cardAdmin) cardAdmin.style.display = esAdmin ? '' : 'none';

    // Evento para Marcar Asistencia
    const marcarBtn = document.getElementById('kpiMarcarAsistencia');
    if (marcarBtn) {
        marcarBtn.addEventListener('click', () => {
            if (typeof window.irAMarcarAsistenciaDesdeUsuario === 'function') {
                window.irAMarcarAsistenciaDesdeUsuario();
            } else {
                window.location.href = 'asistencia.html';
            }
        });
    }

    // Cargar datos
    if (esAdmin) {
        cargarResumenAsistenciaAdmin();
        cargarVpPpPorCampanaAdmin(user);
    } else {
        cargarHoraEntradaPromedio();
        cargarVpPpAsesor(user);
    }
}

// ===== ASISTENCIA ADMIN =====
async function cargarResumenAsistenciaAdmin() {
    const valorEl = document.getElementById('userKpiAsistenciaHoyValor');
    const subEl = document.getElementById('userKpiAsistenciaHoySub');
    if (!valorEl) return;
    valorEl.textContent = '...';

    try {
        const [empleadosResult, registrosResult] = await Promise.all([
            callAPI('getAsistenciaEmpleados'),
            callAPI('getAsistenciaRegistros', {})
        ]);

        const totalEmpleados = empleadosResult.success
            ? (empleadosResult.data || []).filter(u => u.activo !== false).length
            : 0;
        const hoy = hoyDDMMYYYY();

        const presentesHoy = new Set(
            (registrosResult.success ? (registrosResult.data || []) : [])
                .filter(r => r.fecha === hoy && r.entrada)
                .map(r => r.usuario)
        ).size;

        valorEl.textContent = totalEmpleados ? `${presentesHoy} / ${totalEmpleados}` : String(presentesHoy);
        if (subEl) subEl.textContent = 'Asesores marcaron entrada hoy';
    } catch (e) {
        valorEl.textContent = '—';
    }
}

// ===== HORA ENTRADA PROMEDIO =====
async function cargarHoraEntradaPromedio() {
    const valorEl = document.getElementById('userKpiHoraEntradaValor');
    if (!valorEl) return;
    valorEl.textContent = '...';

    try {
        const result = await callAPI('getAsistenciaRegistros', {});
        if (!result.success) { valorEl.textContent = '--:--'; return; }

        const minutos = (result.data || [])
            .map(r => horaAMinutos(r.entrada))
            .filter(m => m !== null);

        if (minutos.length === 0) { valorEl.textContent = 'Sin registros'; return; }

        const promedioMin = Math.round(minutos.reduce((a, b) => a + b, 0) / minutos.length);
        valorEl.textContent = minutosAHora(promedioMin);
    } catch (e) {
        valorEl.textContent = '--:--';
    }
}

// ===== VP/PP ASESOR =====
async function cargarVpPpAsesor(user) {
    const cont = document.getElementById('userKpiVpPpContainer');
    if (!cont) return;
    cont.innerHTML = '<div class="user-kpi-loading">Cargando VP/PP…</div>';

    const campanas = getUserCampanas();
    if (campanas.length === 0) {
        cont.innerHTML = renderTarjetaVpPp('Valoraciones Positivas (VP)', 0, 0, 'trending_up') +
                        renderTarjetaVpPp('Promesas de Pago (PP)', 0, 0, 'handshake');
        return;
    }

    const resumen = await obtenerResumenVpPpCacheado(user, campanas);

    let vpTotal = 0, vpCompletos = 0, ppTotal = 0, ppCompletos = 0;
    campanas.forEach(c => {
        const r = resumen[c] || { vpTotal: 0, vpCompleto: 0, ppTotal: 0, ppCompleto: 0 };
        vpTotal += r.vpTotal; vpCompletos += r.vpCompleto;
        ppTotal += r.ppTotal; ppCompletos += r.ppCompleto;
    });

    cont.innerHTML = renderTarjetaVpPp('Valoraciones Positivas (VP)', vpTotal, vpCompletos, 'trending_up') +
                    renderTarjetaVpPp('Promesas de Pago (PP)', ppTotal, ppCompletos, 'handshake');
}

// ===== VP/PP ADMIN (por campaña) =====
async function cargarVpPpPorCampanaAdmin(user) {
    const cont = document.getElementById('userKpiVpPpContainer');
    if (!cont) return;
    cont.innerHTML = '<div class="user-kpi-loading">Cargando VP/PP por campaña…</div>';

    const campanas = getUserCampanas();
    if (campanas.length === 0) { cont.innerHTML = ''; return; }

    const resumen = await obtenerResumenVpPpCacheado(user, campanas);

    let html = '';
    campanas.forEach(campana => {
        const r = resumen[campana] || {
            vpTotal: 0, vpCompleto: 0, vpPendienteSupervisor: 0, vpPendienteAsesor: 0,
            ppTotal: 0, ppCompleto: 0, ppPendienteSupervisor: 0, ppPendienteAsesor: 0
        };
        html += renderTarjetaCampana(campana, r);
    });

    cont.innerHTML = html;
}

// ===== HELPER =====
async function obtenerResumenVpPpCacheado(user, campanas) {
    const cacheKey = CACHE_KEYS.VPPP_RESUMEN(user.email, user.rol, campanas);
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const result = await callAPI('getResumenVpPp', { campanas });
    if (result.success) {
        cacheSet(cacheKey, result.data);
        return result.data;
    }
    return {};
}

function renderTarjetaVpPp(titulo, total, completos, icono) {
    return `
        <div class="user-kpi-card">
            <span class="material-symbols-outlined user-kpi-icon">${icono}</span>
            <div class="user-kpi-body">
                <span class="user-kpi-title">${escapeHtml(titulo)}</span>
                <span class="user-kpi-value">${total}</span>
                <span class="user-kpi-sub">${completos} con datos completos</span>
            </div>
        </div>
    `;
}

function renderTarjetaCampana(campana, r) {
    return `
        <div class="user-kpi-card user-kpi-card-campana">
            <div class="ukc-header">
                <span class="material-symbols-outlined user-kpi-icon">apartment</span>
                <span class="user-kpi-title">${escapeHtml(campana)}</span>
            </div>
            <div class="ukc-stats-col">
                <div class="ukc-group">
                    <div class="ukc-group-head">
                        <span class="ukc-group-label">VPs</span>
                        <span class="ukc-group-total">${r.vpTotal}</span>
                    </div>
                    <div class="ukc-detail-row"><span>Perfilamiento Completo</span><span class="ukc-detail-value">${r.vpCompleto}</span></div>
                    <div class="ukc-detail-row"><span>Pendiente por Supervisor</span><span class="ukc-detail-value">${r.vpPendienteSupervisor}</span></div>
                    <div class="ukc-detail-row"><span>Pendiente por Asesor</span><span class="ukc-detail-value">${r.vpPendienteAsesor}</span></div>
                </div>
                <div class="ukc-group">
                    <div class="ukc-group-head">
                        <span class="ukc-group-label">PPs</span>
                        <span class="ukc-group-total">${r.ppTotal}</span>
                    </div>
                    <div class="ukc-detail-row"><span>Perfilamiento Completo</span><span class="ukc-detail-value">${r.ppCompleto}</span></div>
                    <div class="ukc-detail-row"><span>Pendiente por Supervisor</span><span class="ukc-detail-value">${r.ppPendienteSupervisor}</span></div>
                    <div class="ukc-detail-row"><span>Pendiente por Asesor</span><span class="ukc-detail-value">${r.ppPendienteAsesor}</span></div>
                </div>
            </div>
        </div>
    `;
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