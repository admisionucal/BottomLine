// UNIFICAR IDS ===============================================

let resultadosActuales = [];
let seleccionados = new Map();

function initUnificar() {
    const user = requireAuth();
    if (!user) return;

    if (user.rol !== 'ADMIN') {
        alert('Acceso denegado: Privilegios insuficientes.');
        window.location.href = 'dashboard.html';
        return;
    }

    const campanas = getUserCampanas();
    const sel = document.getElementById('selectCampana');
    if (sel) {
        sel.innerHTML = '';
        campanas.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c; opt.textContent = c;
            sel.appendChild(opt);
        });
    }

    document.getElementById('userBadge').innerHTML =
        '👤 ' + user.nombre + ' <span class="rol admin">ADMIN</span>';
}

async function buscar() {
    const campana = document.getElementById('selectCampana').value;
    const searchType = document.getElementById('searchType').value;
    const searchValue = document.getElementById('searchValue').value.trim();

    if (!searchValue) {
        alert('Ingresa un valor para buscar');
        return;
    }

    const container = document.getElementById('resultadosContainer');
    container.innerHTML = '<div class="loading">Buscando...</div>';

    const res = await searchLeads(campana, searchType, searchValue);

    if (!res || !res.success) {
        container.innerHTML = `<p style="color:red">Error: ${res?.error || 'No se pudo completar la búsqueda'}</p>`;
        return;
    }

    resultadosActuales = res.data || [];
    renderResultados();
}

function renderResultados() {
    const container = document.getElementById('resultadosContainer');

    if (resultadosActuales.length === 0) {
        container.innerHTML = '<p style="color:#888;">No se encontraron registros.</p>';
        return;
    }

    let html = '';
    resultadosActuales.forEach(item => {
        const id = item['ID PROMETEO'];
        const nombre = item['NOMBRES'] || 'Sin Nombre';
        const dni = item['NUMERO DE DOCUMENTO'] || '-';
        const celular = item['TELEFONO 2'] || '-';
        const activo = !!item.activo;
        const marcado = seleccionados.has(id);
        const idAttr = String(id).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const nombreAttr = String(nombre).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

        html += `
            <div class="resultado-item ${marcado ? 'marcado' : ''}">
                <input type="checkbox" class="check" ${marcado ? 'checked' : ''}
                    onchange="toggleSeleccion('${idAttr}', '${nombreAttr}', ${activo}, this.checked)">
                <div class="info">
                    <strong>${escapeHtml(id)}</strong> - ${escapeHtml(nombre)}
                    <div class="meta">DNI: ${escapeHtml(dni)} | Celular: ${escapeHtml(celular)}</div>
                </div>
                <span class="badge-estado ${activo ? 'activo' : 'huerfano'}">${activo ? 'Activo (base)' : 'Huérfano (bottom)'}</span>
            </div>`;
    });

    container.innerHTML = html;
}

function toggleSeleccion(id, nombre, activo, marcado) {
    if (marcado) {
        seleccionados.set(id, { id, nombre, activo });
    } else {
        seleccionados.delete(id);
    }
    renderResultados();
    actualizarPanelSeleccion();
}

function actualizarPanelSeleccion() {
    const panel = document.getElementById('seleccionCard');
    const resumen = document.getElementById('resumenSeleccion');
    const errorDiv = document.getElementById('errorValidacion');
    const btnUnificar = document.getElementById('btnUnificar');
    const predominanteContainer = document.getElementById('predominanteContainer');

    if (seleccionados.size === 0) {
        panel.style.display = 'none';
        return;
    }

    panel.style.display = 'block';

    const items = Array.from(seleccionados.values());
    const activos = items.filter(i => i.activo);
    const huerfanos = items.filter(i => !i.activo);

    resumen.innerHTML = items.map(i =>
        `<strong>${escapeHtml(i.id)}</strong> (${escapeHtml(i.nombre)}) — ${i.activo ? '✅ Activo' : '⚠️ Huérfano'}`
    ).join('<br>');

    errorDiv.innerHTML = '';
    btnUnificar.disabled = true;
    predominanteContainer.style.display = 'none';

    if (seleccionados.size < 2) {
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

    predominanteContainer.style.display = 'block';
    btnUnificar.disabled = false;
}

function cancelarSeleccion() {
    seleccionados.clear();
    renderResultados();
    document.getElementById('seleccionCard').style.display = 'none';
}

async function unificarIDs() {
    const items = Array.from(seleccionados.values());
    const activo = items.find(i => i.activo);
    const huerfanos = items.filter(i => !i.activo);

    if (!activo || huerfanos.length === 0) return;

    const listaHuerfanos = huerfanos.map(h => `${h.id} (${h.nombre})`).join('\n');
    if (!confirm(`¿Confirmas la unificación definitiva?\n\nPrincipal (se mantiene): ${activo.id} (${activo.nombre})\n\nSe fusionará y archivará el historial de:\n${listaHuerfanos}`)) return;

    const datosPredominantes = {
        historial: document.getElementById('historialSelect')?.value || 'ambos'
    };

    const campana = document.getElementById('selectCampana').value;
    const currentUser = getCurrentUser();
    const btn = document.getElementById('btnUnificar');
    if (btn) { btn.disabled = true; btn.textContent = 'Unificando...'; }

    try {
        const idsSecundarios = huerfanos.map(h => h.id);
        const result = await unifyIds(activo.id, idsSecundarios, campana, datosPredominantes, currentUser.email);

        if (result.success) {
            alert(`✅ Unificación completada.\nPrincipal: ${activo.id}\n${huerfanos.length} registro(s) huérfano(s) archivado(s).`);
            cancelarSeleccion();
            document.getElementById('resultadosContainer').innerHTML = '<div class="loading">Realiza una búsqueda para encontrar leads</div>';
            document.getElementById('searchValue').value = '';
            resultadosActuales = [];
        } else {
            alert('Error del servidor: ' + (result.error || 'Operación fallida'));
        }
    } catch (error) {
        alert('Fallo de red: ' + error.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔗 Unificar seleccionados'; }
    }
}

function volver() {
    window.location.href = 'dashboard.html';
}