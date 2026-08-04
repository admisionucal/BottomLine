// ================================================================
// COMPONENTS - Componentes dinámicos inyectados por DOM
// ================================================================

import { ROLES, esRolSupervisorOAdmision } from './constants.js';
import { escapeHtml, getCurrentUser, normalizarUrlFoto } from './utils.js';

// ================================================================
// SIDEBAR
// ================================================================
export class Sidebar {
    // options.active: 'usuario' | 'asistencia' | 'bottomline' — qué grupo debe
    // aparecer abierto/resaltado al construirse (según la página/vista real).
    // options.activeSubitem: id del nav-subitem de Bottom Line a resaltar
    // (ej. 'navUnificarIds', 'navCondicionesCC'), opcional.
    constructor(options = {}) {
        this.sidebar = document.getElementById('sidebar');
        this.overlay = document.getElementById('sidebarOverlay');
        this.isExpanded = false;
        this.active = options.active || 'usuario';
        this.activeSubitem = options.activeSubitem || null;
        this.render();
        this.aplicarVisibilidadPorRol();
        this.initEvents();
        window.__sidebarInstance = this;
    }

    render() {
        if (!this.sidebar) return;
        const abrirUsuario = this.active === 'usuario';
        const abrirAsistencia = this.active === 'asistencia';
        const abrirBottomLine = this.active === 'bottomline';
        const esSub = (id) => this.activeSubitem === id ? 'active' : '';

        this.sidebar.innerHTML = `
            <div class="sidebar-top">
                <button type="button" class="sidebar-toggle" id="sidebarToggle" title="Menú">
                    <span class="material-symbols-outlined">menu</span>
                </button>
                <div class="sidebar-brand">
                    <img src="assets/logo.png" alt="Logo" class="sidebar-brand-logo" onerror="this.style.display='none'">
                    <span class="sidebar-brand-text">Comercial <span>Pregrado</span></span>
                </div>
            </div>
            <nav class="sidebar-nav">
                <div class="nav-group ${abrirUsuario ? 'open' : ''}" id="navGroupUsuario">
                    <button type="button" class="nav-group-btn ${abrirUsuario ? 'active' : ''}" title="Usuario" onclick="window.toggleNavGroup && toggleNavGroup('navGroupUsuario', this)">
                        <span class="nav-icon material-symbols-outlined">person</span>
                        <span class="nav-label">Usuario</span>
                        <span class="nav-caret">›</span>
                    </button>
                    <div class="nav-submenu">
                        <button type="button" class="nav-subitem ${abrirUsuario ? 'active' : ''}" title="Mi Perfil" onclick="window.mostrarUsuario && mostrarUsuario(); window.marcarSubitemActivo && marcarSubitemActivo(this);">
                            <span class="material-symbols-outlined">badge</span> Mi Perfil
                        </button>
                    </div>
                </div>

                <div class="nav-group ${abrirAsistencia ? 'open' : ''}" id="navGroupAsistencia">
                    <button type="button" class="nav-group-btn ${abrirAsistencia ? 'active' : ''}" title="Asistencia" onclick="window.toggleNavGroup && toggleNavGroup('navGroupAsistencia', this)">
                        <span class="nav-icon material-symbols-outlined">fingerprint</span>
                        <span class="nav-label">Asistencia</span>
                        <span class="nav-caret">›</span>
                    </button>
                    <div class="nav-submenu">
                        <button type="button" class="nav-subitem" id="navAsistenciaMarcacion" title="Marcación" onclick="window.mostrarAsistencia && mostrarAsistencia('marcacion'); window.marcarSubitemActivo && marcarSubitemActivo(this);">
                            <span class="material-symbols-outlined">schedule</span> Marcación
                        </button>
                        <button type="button" class="nav-subitem" title="Calendario" onclick="window.mostrarAsistencia && mostrarAsistencia('calendario'); window.marcarSubitemActivo && marcarSubitemActivo(this);">
                            <span class="material-symbols-outlined">calendar_today</span> Calendario
                        </button>
                        <button type="button" class="nav-subitem" id="navAsistenciaKPIs" title="KPIs" style="display:none;" onclick="window.mostrarAsistencia && mostrarAsistencia('kpis'); window.marcarSubitemActivo && marcarSubitemActivo(this);">
                            <span class="material-symbols-outlined">query_stats</span> KPIs
                        </button>
                        <button type="button" class="nav-subitem" id="navAsistenciaAnalisis" title="Análisis" style="display:none;" onclick="window.mostrarAsistencia && mostrarAsistencia('analisis'); window.marcarSubitemActivo && marcarSubitemActivo(this);">
                            <span class="material-symbols-outlined">bar_chart</span> Análisis
                        </button>
                        <button type="button" class="nav-subitem" id="navAsistenciaMantenimiento" title="Mantenimiento" style="display:none;" onclick="window.mostrarAsistencia && mostrarAsistencia('mantenimiento'); window.marcarSubitemActivo && marcarSubitemActivo(this);">
                            <span class="material-symbols-outlined">settings</span> Mantenimiento
                        </button>
                    </div>
                </div>

                <div class="nav-group ${abrirBottomLine ? 'open' : ''}" id="navGroupBottomLine">
                    <button type="button" class="nav-group-btn ${abrirBottomLine ? 'active' : ''}" title="Bottom Line" onclick="window.toggleNavGroup && toggleNavGroup('navGroupBottomLine', this)">
                        <span class="nav-icon material-symbols-outlined">trending_up</span>
                        <span class="nav-label">Bottom Line</span>
                        <span class="nav-caret">›</span>
                    </button>
                    <div class="nav-submenu">
                        <button type="button" class="nav-subitem ${esSub('navDashboardBL')}" id="navDashboardBL" title="Dashboard" onclick="window.mostrarBottomLine && mostrarBottomLine(); window.marcarSubitemActivo && marcarSubitemActivo(this);">
                            <span class="material-symbols-outlined">dashboard</span> Dashboard
                        </button>
                        <button type="button" class="nav-subitem ${esSub('navUnificarIds')}" id="navUnificarIds" title="Unificar IDs" style="display:none;" onclick="window.mostrarUnificar && mostrarUnificar(); window.marcarSubitemActivo && marcarSubitemActivo(this);">
                            <span class="material-symbols-outlined">merge</span> Unificar IDs
                        </button>
                        <button type="button" class="nav-subitem ${esSub('navCondicionesCC')}" id="navCondicionesCC" title="Condiciones Comerciales" style="display:none;" onclick="window.mostrarCC && mostrarCC(); window.marcarSubitemActivo && marcarSubitemActivo(this);">
                            <span class="material-symbols-outlined">request_quote</span>
                            <span style="flex:1;">Condiciones Comerciales</span>
                            <span class="cal-trigger-badge" id="ccTriggerBadge">0</span>
                        </button>
                        <button type="button" class="nav-subitem" id="calendarioTrigger" title="Calendario de PPs" onclick="window.mostrarCalendario && mostrarCalendario(); window.marcarSubitemActivo && marcarSubitemActivo(this);">
                            <span class="material-symbols-outlined">calendar_month</span>
                            <span style="flex:1;">Calendario de PPs</span>
                            <span class="cal-trigger-badge" id="calTriggerBadge">0</span>
                        </button>
                    </div>
                </div>
            </nav>
            <div class="sidebar-footer" id="sidebarFooter"></div>
        `;
        this.renderFooter();
    }

    // Muestra los subitems restringidos a SUPERVISOR/ADMISION.
    aplicarVisibilidadPorRol() {
        const user = getCurrentUser();
        if (!user || !esRolSupervisorOAdmision(user.rol)) return;

        ['navUnificarIds', 'navCondicionesCC', 'navAsistenciaKPIs', 'navAsistenciaAnalisis', 'navAsistenciaMantenimiento']
            .forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = '';
            });
    }

    // Bloque inferior fijo del sidebar: foto, nombre, rol y cerrar sesión.
    renderFooter() {
        const footer = document.getElementById('sidebarFooter');
        if (!footer) return;
        const user = getCurrentUser();
        if (!user) { footer.innerHTML = ''; return; }

        footer.innerHTML = `
            <div class="sidebar-footer-user">
                <img class="sidebar-footer-avatar" src="${escapeHtml(normalizarUrlFoto(user.foto)) || 'assets/logo.png'}" alt="" onerror="this.src='assets/logo.png'">
                <div class="sidebar-footer-info">
                    <span class="sidebar-footer-name">${escapeHtml(user.nombre)}</span>
                    <span class="sidebar-footer-rol">${escapeHtml(user.rol)}</span>
                </div>
            </div>
            <button type="button" class="sidebar-footer-logout" title="Cerrar sesión" onclick="window.logout && window.logout()">
                <span class="material-symbols-outlined">logout</span>
                <span class="sidebar-footer-logout-label">Cerrar sesión</span>
            </button>
        `;
    }

    initEvents() {
        const toggleBtn = document.getElementById('sidebarToggle');
        if (toggleBtn) toggleBtn.addEventListener('click', () => this.toggle());
        if (this.overlay) this.overlay.addEventListener('click', () => this.toggle());
        
        document.querySelectorAll('.nav-subitem, .nav-group-btn:not([onclick])').forEach(el => {
            el.addEventListener('click', () => {
                if (window.innerWidth <= 768) this.toggle(false);
            });
        });
    }

    toggle(forceState) {
        this.isExpanded = forceState !== undefined ? forceState : !this.isExpanded;
        if (this.sidebar) {
            this.sidebar.classList.toggle('expanded', this.isExpanded);
        }
        if (this.overlay) {
            this.overlay.classList.toggle('show', this.isExpanded && window.innerWidth <= 768);
        }
    }

    expand() {
        if (!this.isExpanded) this.toggle(true);
    }
}

// ================================================================
// TOAST (Sistema de notificaciones)
// ================================================================
export class Toast {
    constructor() {
        this.toast = document.getElementById('toast');
        if (!this.toast) {
            this.toast = document.createElement('div');
            this.toast.id = 'toast';
            this.toast.className = 'toast';
            document.body.appendChild(this.toast);
        }
        this.timer = null;
    }

    show(message, type = 'info') {
        if (this.timer) clearTimeout(this.timer);
        this.toast.textContent = message;
        this.toast.className = `toast show ${type}`;
        this.timer = setTimeout(() => this.hide(), 3200);
    }

    hide() {
        this.toast.classList.remove('show');
    }
}

// ================================================================
// MODAL (Genérico)
// ================================================================
export class Modal {
    constructor() {
        this.modal = document.getElementById('modalGlobal');
        if (!this.modal) {
            this.modal = document.createElement('div');
            this.modal.id = 'modalGlobal';
            this.modal.className = 'modal-overlay';
            this.modal.innerHTML = `
                <div class="modal-box">
                    <div class="modal-icon" id="modalIcon"></div>
                    <div class="modal-title" id="modalTitle"></div>
                    <div class="modal-sub" id="modalSub"></div>
                    <div class="modal-buttons" id="modalButtons"></div>
                </div>
            `;
            document.body.appendChild(this.modal);
        }
        this.icon = document.getElementById('modalIcon');
        this.title = document.getElementById('modalTitle');
        this.sub = document.getElementById('modalSub');
        this.buttons = document.getElementById('modalButtons');
    }

    open(config) {
        this.icon.innerHTML = config.icon || '';
        this.title.textContent = config.title || '';
        this.sub.textContent = config.sub || '';
        this.buttons.innerHTML = '';
        
        config.buttons.forEach(btn => {
            const button = document.createElement('button');
            button.className = `modal-btn ${btn.class || ''}`;
            button.textContent = btn.label;
            button.onclick = () => {
                if (btn.action) btn.action();
                this.close();
            };
            this.buttons.appendChild(button);
        });

        this.modal.classList.add('show');
    }

    close() {
        this.modal.classList.remove('show');
    }
}

// ================================================================
// TABLA (Renderizado estandarizado)
// ================================================================
export function renderTable(containerId, headers, rows, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let html = '<div class="table-wrap"><table>';
    html += '<thead><tr>';
    headers.forEach(h => {
        const sortable = options.sortable ? ` onclick="window.sortTable && window.sortTable('${containerId}', ${headers.indexOf(h)})"` : '';
        html += `<th${sortable}>${escapeHtml(h)}</th>`;
    });
    html += '</tr></thead>';

    html += '<tbody>';
    if (rows.length === 0) {
        html += `<tr><td colspan="${headers.length}" style="text-align:center;color:#888;padding:20px;">Sin datos para mostrar</td></tr>`;
    } else {
        rows.forEach(row => {
            html += '<tr>';
            row.forEach(cell => {
                html += `<td>${cell}</td>`;
            });
            html += '</tr>';
        });
    }
    html += '</tbody></table></div>';

    container.innerHTML = html;
}

// ================================================================
// FILTROS MULTI-SELECT
// ================================================================
export function createMultiSelect(containerId, options, selected = [], label = 'Todos', labelsMap = null) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const uniqueOptions = [...new Set(options.filter(v => v && String(v).trim() !== '').map(v => String(v).trim()))].sort();
    const selection = selected.filter(v => uniqueOptions.includes(v));

    if (uniqueOptions.length === 0) {
        container.innerHTML = `<button type="button" class="multiselect-btn" disabled>Sin datos</button>`;
        return;
    }

    const textoBoton = selection.length === 0
        ? label
        : selection.length === 1
            ? (labelsMap && labelsMap[selection[0]] ? labelsMap[selection[0]] : selection[0])
            : `${selection.length} seleccionados`;

    container.innerHTML = `
        <button type="button" class="multiselect-btn${selection.length ? ' has-selection' : ''}" onclick="window.toggleMultiSelect && window.toggleMultiSelect('${containerId}')">
            ${escapeHtml(textoBoton)}
        </button>
        <div class="multiselect-panel">
            <div class="multiselect-options">
                <label class="multiselect-option ms-todos">
                    <input type="checkbox" data-todos="1" ${selection.length === 0 ? 'checked' : ''}>
                    <span>${escapeHtml(label)}</span>
                </label>
                ${uniqueOptions.map(v => {
                    const checked = selection.includes(v) ? 'checked' : '';
                    const labelText = labelsMap && labelsMap[v] ? labelsMap[v] : v;
                    return `<label class="multiselect-option"><input type="checkbox" value="${escapeHtml(v)}" ${checked}><span>${escapeHtml(labelText)}</span></label>`;
                }).join('')}
            </div>
        </div>
    `;

    // Evento para "Todos"
    const chkTodos = container.querySelector('[data-todos]');
    if (chkTodos) {
        chkTodos.addEventListener('change', () => {
            window.dispatchEvent(new CustomEvent('multiselect-change', { 
                detail: { containerId, key: containerId.replace('filter', '').toLowerCase(), values: [] }
            }));
        });
    }

    // Eventos para checkboxes individuales
    container.querySelectorAll('.multiselect-options input[type=checkbox]:not([data-todos])').forEach(chk => {
        chk.addEventListener('change', () => {
            const allChecks = container.querySelectorAll('.multiselect-options input[type=checkbox]:not([data-todos])');
            const values = Array.from(allChecks).filter(c => c.checked).map(c => c.value);
            window.dispatchEvent(new CustomEvent('multiselect-change', {
                detail: { containerId, key: containerId.replace('filter', '').toLowerCase(), values }
            }));
        });
    });
}

// ================================================================
// TOGGLE MULTI-SELECT
// ================================================================
export function toggleMultiSelect(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const panel = container.querySelector('.multiselect-panel');
    if (!panel) return;
    const estaAbierto = panel.classList.contains('open');

    document.querySelectorAll('.multiselect-panel.open').forEach(p => {
        if (p !== panel) {
            p.classList.remove('open');
            const otroGrupo = p.closest('.filter-group');
            if (otroGrupo) otroGrupo.classList.remove('open');
        }
    });

    panel.classList.toggle('open', !estaAbierto);
    const grupo = container.closest('.filter-group');
    if (grupo) grupo.classList.toggle('open', !estaAbierto);

    if (!estaAbierto) {
        setTimeout(() => document.addEventListener('click', cerrarMultiSelectFuera), 0);
    }
}

function cerrarMultiSelectFuera(e) {
    const abiertos = document.querySelectorAll('.multiselect-panel.open');
    if (abiertos.length === 0) {
        document.removeEventListener('click', cerrarMultiSelectFuera);
        return;
    }
    if (e.target && e.target.closest && e.target.closest('.multiselect-btn')) return;
    let clickDentro = false;
    abiertos.forEach(panel => {
        if (panel.contains(e.target) || (panel.closest('.multiselect')?.contains(e.target))) {
            clickDentro = true;
        }
    });
    if (!clickDentro) {
        abiertos.forEach(p => {
            p.classList.remove('open');
            const grupo = p.closest('.filter-group');
            if (grupo) grupo.classList.remove('open');
        });
        document.removeEventListener('click', cerrarMultiSelectFuera);
    }
}

// ================================================================
// SORT TABLE
// ================================================================
export function sortTable(tbodyId, columna) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    const filas = Array.from(tbody.querySelectorAll('tr'));
    const tabla = tbody.closest('table');
    if (!tabla) return;
    const ths = tabla.querySelectorAll('thead th');
    const th = ths[columna];
    if (!th) return;
    
    const asc = !th.classList.contains('asc');
    ths.forEach(h => h.classList.remove('asc', 'desc'));
    
    filas.sort((a, b) => {
        const aVal = a.cells[columna]?.textContent.trim() || '';
        const bVal = b.cells[columna]?.textContent.trim() || '';
        return asc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
    
    filas.forEach(f => tbody.appendChild(f));
    th.classList.add(asc ? 'asc' : 'desc');
}

// ================================================================
// RELOJ EN VIVO (para Asistencia)
// ================================================================
export function startClock(elementId, onTick) {
    let intervalId = null;
    let lastDate = '';

    const tick = () => {
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }));
        const el = document.getElementById(elementId);
        if (el) {
            el.textContent = now.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        }
        
        const today = now.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
        if (lastDate !== today) {
            lastDate = today;
            if (onTick) onTick(now);
        }
    };

    tick();
    intervalId = setInterval(tick, 1000);
    return intervalId;
}

// ================================================================
// REGISTRAR FUNCIONES EN WINDOW (para uso en HTML)
// ================================================================
window.toggleMultiSelect = toggleMultiSelect;
window.sortTable = sortTable;
window.createMultiSelect = createMultiSelect;

// Funciones de navegación (hooks para ser sobrescritos por los módulos)
window.mostrarUsuario = () => console.warn('mostrarUsuario no implementado');
window.mostrarAsistencia = () => console.warn('mostrarAsistencia no implementado');
window.mostrarBottomLine = () => console.warn('mostrarBottomLine no implementado');
window.mostrarCalendario = () => console.warn('mostrarCalendario no implementado');
window.mostrarUnificar = () => console.warn('mostrarUnificar no implementado');
window.mostrarCC = () => console.warn('mostrarCC no implementado');
window.marcarSubitemActivo = (el) => {
    document.querySelectorAll('.nav-subitem').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
};
window.toggleNavGroup = (groupId, btn) => {
    const sidebar = document.getElementById('sidebar');
    if (sidebar && !sidebar.classList.contains('expanded')) {
        sidebar.classList.add('expanded');
        if (window.innerWidth <= 768) {
            const overlay = document.getElementById('sidebarOverlay');
            if (overlay) overlay.classList.add('show');
        }
    }
    const grupo = document.getElementById(groupId);
    if (!grupo) return;
    const yaAbierto = grupo.classList.contains('open');
    document.querySelectorAll('.nav-group').forEach(g => g.classList.remove('open'));
    document.querySelectorAll('.nav-group-btn').forEach(b => b.classList.remove('active'));
    if (!yaAbierto) {
        grupo.classList.add('open');
        if (btn) btn.classList.add('active');
    }
};
window.logout = () => {
    sessionStorage.removeItem('bl_user');
    sessionStorage.clear();
    window.location.href = 'index.html';
};