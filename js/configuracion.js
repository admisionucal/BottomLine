// ================================================================
// CONFIGURACIÓN - Gestión de campañas y sus archivos (solo ADMISION)
// ================================================================

import { API_URL, ROLES } from '../core/constants.js';
import { getCurrentUser, getSessionToken, escapeHtml } from '../core/utils.js';
import { Sidebar, Toast } from '../core/components.js';
import { createMultiSelect } from '../core/components.js';

const TIPOS_ARCHIVO = [
    { tipo: 'lineamientos_5c', titulo: 'Lineamientos de Admisión (5 cuotas)' },
    { tipo: 'lineamientos_6c', titulo: 'Lineamientos de Admisión (6 cuotas)' },
    { tipo: 'terminos_referido', titulo: 'T&C - Referido' },
    { tipo: 'terminos_referente_alumno', titulo: 'T&C - Referente (Alumno Stock)' },
    { tipo: 'terminos_referente_ingresante', titulo: 'T&C - Referente (Alumno Nuevo)' },
];

const state = {
    campanas: [],
    seleccionada: null,
    supervisores: [],
    nuevoUsuarioCampanas: []
};

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

// Acepta '2026-09-06' o '2026-09-06T00:00:00.000Z' y devuelve 'YYYY-MM-DD'
function soloFecha(v) {
    return v ? String(v).slice(0, 10) : '';
}
// '2026-09-06' -> '06/09/2026'
function fechaLegible(v) {
    const f = soloFecha(v);
    if (!f) return 'sin definir';
    const [y, m, d] = f.split('-');
    return `${d}/${m}/${y}`;
}

// ===== INICIALIZACIÓN =====
document.addEventListener('DOMContentLoaded', () => initConfiguracion());

// Punto de entrada cuando se embebe dentro de dashboard.html
window.initConfiguracionEmbebido = function () {
    initConfiguracion();
};

async function initConfiguracion() {
    const user = getCurrentUser();
    if (!user) {
        window.location.href = 'index.html';
        return;
    }

    // Estrictamente ADMISION — a diferencia del resto del panel admin
    // (que usa esRolSupervisorOAdmision), esta sección es únicamente
    // para el perfil ADMISION.
    if (user.rol !== ROLES.ADMISION) {
        alert('Acceso denegado: esta sección es solo para el perfil Admisión.');
        if (typeof window.mostrarBottomLine === 'function') {
            window.mostrarBottomLine();
        } else {
            window.location.href = 'dashboard.html?view=bottomline';
        }
        return;
    }

    modoEmbebido = !!document.querySelector('.sidebar-nav');
    if (!modoEmbebido) {
        new Sidebar({ active: 'configuracion' });
    }

    await cargarCampanas();
    await cargarSupervisores();
    renderNuevoUsuarioForm();
}

// ===== CARGA =====
async function cargarCampanas() {
    const grid = document.getElementById('cfgCampanasGrid');
    grid.innerHTML = '<div class="loading">Cargando campañas…</div>';

    const result = await callAPI('getCampanasConfig');
    if (!result.success) {
        grid.innerHTML = `<div class="loading">Error: ${escapeHtml(result.error || 'No se pudo cargar')}</div>`;
        return;
    }

    state.campanas = result.data || [];
    renderGrid();

    // Si había una campaña seleccionada, refresca su detalle con datos frescos.
    if (state.seleccionada) {
        const actualizada = state.campanas.find((c) => c.codigo === state.seleccionada);
        if (actualizada) seleccionarCampana(actualizada.codigo);
    }
}

// ===== GRID DE CAMPAÑAS =====
function renderGrid() {
    const grid = document.getElementById('cfgCampanasGrid');

    const cards = state.campanas
        .map((c) => `
            <div class="cfg-campana-card ${c.activa ? '' : 'inactiva'} ${state.seleccionada === c.codigo ? 'selected' : ''}"
                 data-codigo="${escapeHtml(c.codigo)}">
                <div class="cfg-campana-top">
                    <span class="cfg-campana-codigo">${escapeHtml(c.codigo)}</span>
                    <label class="cfg-switch" title="${c.activa ? 'Desactivar' : 'Activar'} campaña" onclick="event.stopPropagation();">
                        <input type="checkbox" ${c.activa ? 'checked' : ''} data-toggle="${escapeHtml(c.codigo)}">
                        <span class="cfg-switch-slider"></span>
                    </label>
                </div>
                <div class="cfg-campana-meta">Periodo ${escapeHtml(c.periodo)} · Vence: ${fechaLegible(c.fechaFinPeriodo)}</div>
                <div class="cfg-campana-meta">${Object.keys(c.archivos || {}).length} / ${TIPOS_ARCHIVO.length} archivos cargados</div>
            </div>
        `)
        .join('');

    grid.innerHTML = cards + `
        <button type="button" class="cfg-nueva-campana-btn" id="cfgBtnNuevaCampana">
            <span class="material-symbols-outlined">add</span> Nueva campaña
        </button>
    `;

    grid.querySelectorAll('.cfg-campana-card').forEach((el) => {
        el.addEventListener('click', () => seleccionarCampana(el.dataset.codigo));
    });
    grid.querySelectorAll('[data-toggle]').forEach((el) => {
        el.addEventListener('change', (e) => toggleActiva(el.dataset.toggle, e.target.checked));
    });
    document.getElementById('cfgBtnNuevaCampana')?.addEventListener('click', abrirFormularioNuevaCampana);
}

async function toggleActiva(codigo, activa) {
    const result = await callAPI('toggleCampanaActiva', { codigo, activa });
    if (!result.success) {
        Toast?.show ? Toast.show(result.error || 'No se pudo actualizar', 'error') : alert(result.error);
        cargarCampanas(); // revierte el switch visualmente
        return;
    }
    const c = state.campanas.find((x) => x.codigo === codigo);
    if (c) c.activa = activa;
}

// ===== NUEVA CAMPAÑA =====
function abrirFormularioNuevaCampana() {
    state.seleccionada = null;
    renderDetalle({ codigo: '', periodo: '', perC: '', inicioClases: '', activa: true, bccDefault: [], archivos: {} }, true);
}

// ===== SELECCIONAR / EDITAR CAMPAÑA EXISTENTE =====
function seleccionarCampana(codigo) {
    state.seleccionada = codigo;
    renderGrid();
    const c = state.campanas.find((x) => x.codigo === codigo);
    if (c) renderDetalle(c, false);
}

function renderDetalle(c, esNueva) {
    const detalle = document.getElementById('cfgDetalle');
    detalle.style.display = 'block';

    const archivosHtml = esNueva
        ? '<p style="color:#888; font-size:13px;">Guarda la campaña primero para poder subir sus archivos.</p>'
        : `<div class="cfg-archivos-grid">${TIPOS_ARCHIVO.map((t) => renderArchivoCard(c, t)).join('')}</div>`;

    detalle.innerHTML = `
        <h3 style="margin-bottom:16px;">${esNueva ? 'Nueva campaña' : `Campaña ${escapeHtml(c.codigo)}`}</h3>
        <div class="cfg-form-row">
            <label class="cfg-campo">Código (ej. 27.2)
                <input type="text" id="cfgCodigo" value="${escapeHtml(c.codigo)}" ${esNueva ? '' : 'readonly'}>
            </label>
            <label class="cfg-campo">Periodo (ej. 2027-2)
                <input type="text" id="cfgPeriodo" value="${escapeHtml(c.periodo)}">
            </label>
            <label class="cfg-campo">Per. corto (ej. 27-2)
                <input type="text" id="cfgPerC" value="${escapeHtml(c.perC || '')}">
            </label>
            <label class="cfg-campo">Inicio de clases (ej. Agosto)
                <input type="text" id="cfgInicioClases" value="${escapeHtml(c.inicioClases || '')}">
            </label>
            <label class="cfg-campo">Inicio del periodo
                <input type="date" id="cfgFechaInicioPeriodo" value="${soloFecha(c.fechaInicioPeriodo)}">
            </label>
            <label class="cfg-campo">Fin del periodo
                <input type="date" id="cfgFechaFinPeriodo" value="${soloFecha(c.fechaFinPeriodo)}">
            </label>
        </div>
        <div class="cfg-form-row">
            <label class="cfg-campo" style="flex-basis:100%;">Correos en copia oculta (BCC), separados por coma
                <input type="text" id="cfgBcc" value="${escapeHtml((c.bccDefault || []).join(', '))}">
            </label>
        </div>
        <button type="button" class="btn-export" id="cfgBtnGuardar">
            <span class="material-symbols-outlined" style="font-size:16px;">save</span> Guardar campaña
        </button>

        <h4 style="margin:24px 0 10px;">Archivos</h4>
        ${archivosHtml}
    `;

    document.getElementById('cfgBtnGuardar')?.addEventListener('click', () => guardarCampana(esNueva));

    if (!esNueva) {
        TIPOS_ARCHIVO.forEach((t) => {
            document.getElementById(`cfgInput_${t.tipo}`)?.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) subirArchivo(c.codigo, t.tipo, file);
            });
            document.getElementById(`cfgEliminar_${t.tipo}`)?.addEventListener('click', () => eliminarArchivo(c.codigo, t.tipo));
        });
    }
}

function renderArchivoCard(c, t) {
    const info = (c.archivos || {})[t.tipo];
    const cargado = !!info;
    return `
        <div class="cfg-archivo-card">
            <span class="cfg-archivo-titulo">${escapeHtml(t.titulo)}</span>
            <span class="cfg-archivo-estado ${cargado ? 'cargado' : ''}">
                <span class="material-symbols-outlined" style="font-size:16px;">${cargado ? 'check_circle' : 'radio_button_unchecked'}</span>
                ${cargado ? escapeHtml(info.nombreArchivo) : 'Sin archivo'}
            </span>
            <div class="cfg-archivo-acciones">
                <label class="btn-export" style="cursor:pointer;">
                    <span class="material-symbols-outlined" style="font-size:16px;">upload</span>
                    ${cargado ? 'Reemplazar' : 'Subir'} PDF
                    <input type="file" accept="application/pdf" id="cfgInput_${t.tipo}" style="display:none;">
                </label>
                ${cargado ? `
                    <button type="button" class="btn-export" id="cfgEliminar_${t.tipo}" style="color:#d32f2f;">
                        <span class="material-symbols-outlined" style="font-size:16px;">delete</span> Eliminar
                    </button>
                ` : ''}
            </div>
        </div>
    `;
}

async function guardarCampana(esNueva) {
    const codigo = document.getElementById('cfgCodigo').value.trim();
    const periodo = document.getElementById('cfgPeriodo').value.trim();
    const perC = document.getElementById('cfgPerC').value.trim();
    const inicioClases = document.getElementById('cfgInicioClases').value.trim();
    const fechaInicioPeriodo = document.getElementById('cfgFechaInicioPeriodo').value;
    const fechaFinPeriodo = document.getElementById('cfgFechaFinPeriodo').value;
    const bccDefault = document.getElementById('cfgBcc').value
        .split(',').map((s) => s.trim()).filter(Boolean);

    if (!codigo || !periodo || !perC) {
        alert('Código, periodo y per. corto son obligatorios.');
        return;
    }
    if (fechaInicioPeriodo && fechaFinPeriodo && fechaInicioPeriodo > fechaFinPeriodo) {
        alert('La fecha de inicio del periodo no puede ser posterior a la de fin.');
        return;
    }

    const result = await callAPI('guardarCampana', {
        codigo, periodo, perC, inicioClases, fechaInicioPeriodo, fechaFinPeriodo,
        activa: true, bccDefault,
    });
    if (!result.success) {
        alert(result.error || 'No se pudo guardar la campaña.');
        return;
    }

    state.seleccionada = codigo;
    await cargarCampanas();
}

// ===== SUBIR / ELIMINAR ARCHIVO =====
function subirArchivo(campana, tipo, file) {
    const reader = new FileReader();
    reader.onload = async () => {
        const result = await callAPI('subirArchivoCampana', {
            campana, tipo, archivoBase64: reader.result,
        });
        if (!result.success) {
            alert(result.error || 'No se pudo subir el archivo.');
            return;
        }
        await cargarCampanas();
    };
    reader.readAsDataURL(file);
}

async function eliminarArchivo(campana, tipo) {
    if (!confirm('¿Eliminar este archivo? Dejará de adjuntarse en las Condiciones Comerciales hasta que subas uno nuevo.')) return;
    const result = await callAPI('eliminarArchivoCampana', { campana, tipo });
    if (!result.success) {
        alert(result.error || 'No se pudo eliminar el archivo.');
        return;
    }
    await cargarCampanas();
}

// ===== SUPERVISORES: CAMPAÑAS =====
async function cargarSupervisores() {
    const cont = document.getElementById('cfgSupervisoresLista');
    const result = await callAPI('getSupervisoresConfig');
    if (!result.success) {
        cont.innerHTML = `<p style="color:#d32f2f;font-size:13px;">${escapeHtml(result.error || 'No se pudo cargar')}</p>`;
        return;
    }
    state.supervisores = result.data || [];
    if (!state.supervisores.length) {
        cont.innerHTML = '<p style="color:#888;font-size:13px;">Sin Supervisores registrados.</p>';
        return;
    }
    cont.innerHTML = state.supervisores.map((u) => `
        <div class="colab-cfg-fila" style="grid-template-columns:200px 1fr;">
            <div class="colab-cfg-nombre" title="${escapeHtml(u.nombre)}">${escapeHtml(u.nombre)}</div>
            <div class="multiselect" id="supCampanas-${escapeHtml(u.usuario)}"></div>
        </div>
    `).join('');

    const codigosActivos = state.campanas.filter((c) => c.activa).map((c) => c.codigo);
    state.supervisores.forEach((u) => {
        createMultiSelect(`supCampanas-${u.usuario}`, codigosActivos, u.campanas || [], 'Sin campañas', null, { permitirTodos: true, mostrarValores: true });
    });
}

window.addEventListener('multiselect-change', async (e) => {
    if (e.detail.containerId.startsWith('supCampanas-')) {
        const usuario = e.detail.containerId.replace('supCampanas-', '');
        const result = await callAPI('actualizarCampanasAsesor', { usuario, campanas: e.detail.values });
        if (!result.success) {
            Toast?.show ? Toast.show(result.error || 'No se pudo actualizar', 'error') : alert(result.error);
            return;
        }
        const u = state.supervisores.find((s) => s.usuario === usuario);
        if (u) u.campanas = e.detail.values;
        Toast?.show?.('Campañas actualizadas', 'ok');
        return;
    }
    if (e.detail.containerId === 'cfgNuevoUsuarioCampanas') {
        state.nuevoUsuarioCampanas = e.detail.values;
    }
});

// ===== NUEVO USUARIO =====
function renderNuevoUsuarioForm() {
    const codigosActivos = state.campanas.filter((c) => c.activa).map((c) => c.codigo);
    createMultiSelect('cfgNuevoUsuarioCampanas', codigosActivos, [], 'Sin campañas', null, { permitirTodos: true, mostrarValores: true });
    document.getElementById('cfgBtnCrearUsuario').addEventListener('click', crearUsuarioSubmit);
}

async function crearUsuarioSubmit() {
    const usuario = document.getElementById('cfgNuevoUsuario').value.trim();
    const nombre = document.getElementById('cfgNuevoNombre').value.trim();
    const nombreCorto = document.getElementById('cfgNuevoNombreCorto').value.trim();
    const password = document.getElementById('cfgNuevoPassword').value;
    const rol = document.getElementById('cfgNuevoRol').value;
    const cargo = document.getElementById('cfgNuevoCargo').value.trim();
    const dni = document.getElementById('cfgNuevoDni').value.trim();
    const email = document.getElementById('cfgNuevoEmail').value.trim();
    const campanas = state.nuevoUsuarioCampanas || [];

    if (!usuario || !nombre || !password) {
        alert('Usuario, nombre y contraseña son obligatorios.');
        return;
    }

    const result = await callAPI('crearUsuario', { usuario, nombre, nombreCorto, password, rol, cargo, dni, email, campanas });
    if (!result.success) {
        alert(result.error || 'No se pudo crear el usuario.');
        return;
    }
    Toast?.show?.('Usuario creado', 'ok');
    ['cfgNuevoUsuario','cfgNuevoNombre','cfgNuevoNombreCorto','cfgNuevoPassword','cfgNuevoCargo','cfgNuevoDni','cfgNuevoEmail']
        .forEach((id) => document.getElementById(id).value = '');
    document.getElementById('cfgNuevoRol').value = 'ASESOR';
    if (rol === 'SUPERVISOR') await cargarSupervisores(); // refresca la lista si creaste un supervisor
}