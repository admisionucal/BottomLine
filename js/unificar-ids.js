// ================================================================
// UNIFICAR IDS - Módulo de unificación de leads duplicados
// ================================================================

import {
    COLUMNAS, esRolSupervisorOAdmision
} from '../core/constants.js';
import {
    getCurrentUser, getUserCampanas, escapeHtml
} from '../core/utils.js';
import { Sidebar, Toast } from '../core/components.js';
import { buscarLeads, unificarLeads } from './unificar-core.js';

// ===== ESTADO =====
const state = {
    resultados: [],
    seleccionados: new Map(),
    campana: ''
};

// ===== INICIALIZACIÓN =====
document.addEventListener('DOMContentLoaded', () => {
    initUnificar();
});

// ===== PUNTO DE ENTRADA (para embebido en dashboard) =====
window.initUnificarEmbebido = function() {
    initUnificar();
};

let __unifListenersAtados = false;

function initUnificar() {
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
    const modoEmbebido = !!document.querySelector('.sidebar-nav');
    if (!modoEmbebido) {
        new Sidebar({ active: 'bottomline', activeSubitem: 'navUnificarIds' });
    }

    // Cargar campañas. Se agrega "TODAS" al inicio: la unificación ya no
    // exige que principal y secundarios estén en la misma campaña, así
    // que la búsqueda tiene que poder abarcar todas de una vez.
    const campanas = getUserCampanas();
    const sel = document.getElementById('selectCampana');
    if (sel) {
        sel.innerHTML = '';

        const optTodas = document.createElement('option');
        optTodas.value = 'TODAS';
        optTodas.textContent = 'Todas las campañas';
        sel.appendChild(optTodas);

        campanas.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            sel.appendChild(opt);
        });
        if (campanas.length > 0) state.campana = campanas[0];
    }

    // Los listeners solo se atan una vez: los elementos del DOM persisten
    // entre reingresos a esta vista (embebida o standalone).
    if (!__unifListenersAtados) {
        document.getElementById('btnBuscar').addEventListener('click', buscar);
        document.getElementById('searchValue').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') buscar();
        });
        document.getElementById('btnUnificar').addEventListener('click', unificar);
        document.getElementById('btnCancelar').addEventListener('click', cancelarSeleccion);
        __unifListenersAtados = true;
    }
}

// ===== BÚSQUEDA =====
async function buscar() {
    const campana = document.getElementById('selectCampana').value;
    const searchType = document.getElementById('searchType').value;
    const searchValue = document.getElementById('searchValue').value.trim();

    if (!searchValue) {
        alert('Ingresa un valor para buscar');
        return;
    }

    const empty = document.getElementById('resultadosEmpty');
    const tableWrap = document.getElementById('resultadosTableWrap');
    empty.style.display = 'block';
    empty.textContent = 'Buscando...';
    tableWrap.style.display = 'none';

    try {
        const payload = {
            searchType: searchType,
            searchValue: searchValue,
            campana: campana
        };
        if (campana !== 'TODAS') {
            state.campana = campana; // campaña por defecto de esta búsqueda
        }

        const data = await buscarLeads(payload);
        state.resultados = data.map(r => ({ ...r, CAMPANA: r.CAMPANA || campana }));

        renderResultados();
    } catch (e) {
        empty.textContent = 'Error de conexión: ' + e.message;
    }
}

function claveSeleccion(id, campana) {
    return id + '|' + campana;
}

function renderResultados() {
    const empty = document.getElementById('resultadosEmpty');
    const tableWrap = document.getElementById('resultadosTableWrap');
    const tbody = document.getElementById('resultadosBody');

    if (state.resultados.length === 0) {
        tableWrap.style.display = 'none';
        empty.style.display = 'block';
        empty.textContent = 'No se encontraron registros.';
        return;
    }

    empty.style.display = 'none';
    tableWrap.style.display = 'block';

    let html = '';
    state.resultados.forEach(item => {
        const id = item[COLUMNAS.ID_PROMETEO];
        const campanaItem = item.CAMPANA || state.campana;
        const nombre = item[COLUMNAS.NOMBRES] || 'Sin Nombre';
        const dni = item[COLUMNAS.DNI] || '-';
        const celular = item[COLUMNAS.TELEFONO_2] || '-';
        const activo = !!item.activo;
        const key = claveSeleccion(id, campanaItem);
        const marcado = state.seleccionados.has(key);

        html += `
            <tr class="${marcado ? 'marcado' : ''}">
                <td><input type="checkbox" class="check" ${marcado ? 'checked' : ''}
                    data-id="${escapeHtml(id)}" data-campana="${escapeHtml(campanaItem)}"
                    data-nombre="${escapeHtml(nombre)}" data-activo="${activo}"></td>
                <td><strong>${escapeHtml(id)}</strong></td>
                <td><span class="badge-campana">${escapeHtml(campanaItem)}</span></td>
                <td>${escapeHtml(nombre)}</td>
                <td>${escapeHtml(dni)}</td>
                <td>${escapeHtml(celular)}</td>
                <td><span class="badge-estado ${activo ? 'activo' : 'huerfano'}">${activo ? 'Activo (base)' : 'Huérfano (bottom)'}</span></td>
            </tr>
        `;
    });

    tbody.innerHTML = html;

    // Eventos de checkboxes
    tbody.querySelectorAll('.check').forEach(chk => {
        chk.addEventListener('change', () => {
            const id = chk.dataset.id;
            const campana = chk.dataset.campana;
            const nombre = chk.dataset.nombre;
            const activo = chk.dataset.activo === 'true';
            const key = claveSeleccion(id, campana);
            if (chk.checked) {
                state.seleccionados.set(key, { id, campana, nombre, activo });
            } else {
                state.seleccionados.delete(key);
            }
            renderResultados();
            actualizarPanelSeleccion();
        });
    });
}

// ===== PANEL DE SELECCIÓN =====
function actualizarPanelSeleccion() {
    const panel = document.getElementById('seleccionCard');
    const resumen = document.getElementById('resumenSeleccion');
    const errorDiv = document.getElementById('errorValidacion');
    const btnUnificar = document.getElementById('btnUnificar');
    const predominanteContainer = document.getElementById('predominanteContainer');

    if (state.seleccionados.size === 0) {
        panel.style.display = 'none';
        return;
    }

    panel.style.display = 'block';

    const items = Array.from(state.seleccionados.values());
    const activos = items.filter(i => i.activo);
    const huerfanos = items.filter(i => !i.activo);

    resumen.innerHTML = items.map(i =>
        `<div class="sel-item ${i.activo ? 'base' : ''}">
            ${i.activo ? '<span class="tag-base">Base</span>' : ''}
            <strong>${escapeHtml(i.id)}</strong>
            <span class="campana-tag">${escapeHtml(i.campana)}</span>
            <span class="nombre">${escapeHtml(i.nombre)} — ${i.activo ? '✓ Activo' : '⚠ Huérfano'}</span>
        </div>`
    ).join('');

    errorDiv.innerHTML = '';
    btnUnificar.disabled = true;
    predominanteContainer.style.display = 'none';

    if (state.seleccionados.size < 2) {
        errorDiv.innerHTML = '<div class="error-validacion">Selecciona al menos 2 registros para unificar.</div>';
        return;
    }

    if (activos.length > 1) {
        errorDiv.innerHTML = '<div class="error-validacion">Hay más de un registro ACTIVO seleccionado. Solo puede haber un lead activo en la unificación (deselecciona uno).</div>';
        return;
    }

    if (activos.length === 0) {
        errorDiv.innerHTML = '<div class="error-validacion">No hay ningún registro ACTIVO seleccionado. Al menos uno de los seleccionados debe existir actualmente en la hoja base — no se puede unificar dejando como sobreviviente un registro huérfano.</div>';
        return;
    }

    // La campaña ya no importa para habilitar el botón: se puede unificar
    // entre campañas distintas sin restricción.
    predominanteContainer.style.display = 'block';
    btnUnificar.disabled = false;
}

function cancelarSeleccion() {
    state.seleccionados.clear();
    renderResultados();
    document.getElementById('seleccionCard').style.display = 'none';
}

// ===== UNIFICAR =====
async function unificar() {
    const items = Array.from(state.seleccionados.values());
    const activo = items.find(i => i.activo);
    const huerfanos = items.filter(i => !i.activo);

    if (!activo || huerfanos.length === 0) return;

    const listaHuerfanos = huerfanos.map(h => `${h.id} (${h.campana}) — ${h.nombre}`).join('\n');
    if (!confirm(`¿Confirmas la unificación definitiva?\n\nPrincipal (se mantiene): ${activo.id} (${activo.campana}) — ${activo.nombre}\n\nSe fusionará y se eliminará de leads:\n${listaHuerfanos}`)) return;

    const datosPredominantes = {
        historial: document.getElementById('historialSelect')?.value || 'ambos'
    };

    const user = getCurrentUser();
    const btn = document.getElementById('btnUnificar');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">hourglass_empty</span> Unificando...';
    }

    try {
        const result = await unificarLeads({
            idPrincipal: activo.id,
            campanaPrincipal: activo.campana,
            idsSecundarios: huerfanos.map(h => ({ id: h.id, campana: h.campana })),
            datosPredominantes,
            adminEmail: user.email
        });

        // Si el usuario canceló ahí, no mostramos error.
        if (result.cancelado) {
            return;
        }

        if (result.success) {
            alert(`Unificación completada.\nPrincipal: ${activo.id} (${activo.campana})\n${huerfanos.length} registro(s) fusionado(s) y eliminado(s) de leads.`);
            cancelarSeleccion();
            document.getElementById('resultadosTableWrap').style.display = 'none';
            document.getElementById('resultadosEmpty').style.display = 'block';
            document.getElementById('resultadosEmpty').textContent = 'Realiza una búsqueda para encontrar leads';
            document.getElementById('searchValue').value = '';
            state.resultados = [];
        } else {
            alert('Error del servidor: ' + (result.error || 'Operación fallida'));
        }
    } catch (error) {
        alert('Fallo de red: ' + error.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">link</span> Unificar seleccionados';
        }
    }
}