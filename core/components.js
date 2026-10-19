import { esRolSupervisorOAdmision, esRolAdmision, puedeVerCapacitacionIA } from './constants.js';
import { escapeHtml, getCurrentUser, normalizarUrlFoto } from './utils.js';

function obtenerIniciales(nombre) {
    return String(nombre || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(p => p[0].toUpperCase())
        .join('');
}

export class Sidebar {
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
        iniciarControlInactividad();
    }

    render() {
        if (!this.sidebar) return;
        const abrirUsuario = this.active === 'usuario';
        const abrirAsistencia = this.active === 'asistencia';
        const abrirBottomLine = this.active === 'bottomline';
        const abrirCargos = this.active === 'cargos';
        const esSub = (id) => this.activeSubitem === id ? 'active' : '';

        this.sidebar.innerHTML = `
            <div class="sidebar-top">
                <button type="button" class="sidebar-toggle" id="sidebarToggle" title="Menú">
                    <span class="material-symbols-outlined">menu</span>
                </button>
                <div class="sidebar-brand">
                    <span class="sidebar-brand-text">RUMBO <span>GAC</span></span>
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
                        <button type="button" class="nav-subitem ${esSub('navUsuarioEvaluaciones')}" id="navUsuarioEvaluaciones" title="Evaluaciones" onclick="window.mostrarEvaluaciones && mostrarEvaluaciones(); window.marcarSubitemActivo && marcarSubitemActivo(this);">
                            <span class="material-symbols-outlined">quiz</span> Evaluaciones
                        </button>
                        <button type="button" class="nav-subitem ${esSub('navUsuarioCapacitacion')}" id="navUsuarioCapacitacion" title="Capacitación IA" style="display:none;" onclick="window.mostrarCapacitacion ? mostrarCapacitacion() : (window.location.href='capacitacion-chat.html'); window.marcarSubitemActivo && marcarSubitemActivo(this);">
                            <span class="material-symbols-outlined">smart_toy</span> Capacitación IA
                        </button>
                        <button type="button" class="nav-subitem ${esSub('navUsuarioResultados')}" id="navUsuarioResultados" title="Resultados" style="display:none;" onclick="window.mostrarResultados && mostrarResultados(); window.marcarSubitemActivo && marcarSubitemActivo(this);">
                            <span class="material-symbols-outlined">leaderboard</span> Resultados
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
                        <button type="button" class="nav-subitem ${esSub('navIndicadoresBL')}" id="navIndicadoresBL" title="Análisis" style="display:none;" onclick="window.mostrarIndicadores && mostrarIndicadores(); window.marcarSubitemActivo && marcarSubitemActivo(this);">
                            <span class="material-symbols-outlined">insights</span>
                            <span style="flex:1;">Análisis</span>
                        </button>
                        <button type="button" class="nav-subitem ${esSub('navUnificarIds')}" id="navUnificarIds" title="Unificar IDs" style="display:none;" onclick="window.mostrarUnificar && mostrarUnificar(); window.marcarSubitemActivo && marcarSubitemActivo(this);">
                            <span class="material-symbols-outlined">merge</span> Unificar IDs
                        </button>
                        <button type="button" class="nav-subitem" id="calendarioTrigger" title="Calendario" onclick="window.mostrarCalendario && mostrarCalendario(); window.marcarSubitemActivo && marcarSubitemActivo(this);">
                            <span class="material-symbols-outlined">calendar_month</span>
                            <span style="flex:1;">Calendario</span>
                            <span class="cal-trigger-badge" id="calTriggerBadge">0</span>
                        </button>
                    </div>
                </div>
                
                <div class="nav-group ${abrirCargos ? 'open' : ''}" id="navGroupCargos">
                    <button type="button" class="nav-group-btn ${abrirCargos ? 'active' : ''}" title="Cargos" onclick="window.toggleNavGroup && toggleNavGroup('navGroupCargos', this)">
                        <span class="nav-icon material-symbols-outlined">request_quote</span>
                        <span class="nav-label">Cargos</span>
                        <span class="nav-caret">›</span>
                    </button>
                    <div class="nav-submenu">
                        <button type="button" class="nav-subitem ${esSub('navCondicionesCC')}" id="navCondicionesCC" title="Condiciones Comerciales" style="display:none;" onclick="window.mostrarCC && mostrarCC(); window.marcarSubitemActivo && marcarSubitemActivo(this);">
                            <span class="material-symbols-outlined">request_quote</span>
                            <span style="flex:1;">Condiciones Comerciales</span>
                            <span class="cal-trigger-badge" id="ccTriggerBadge">0</span>
                        </button>
                    </div>
                </div>
            </nav>
            <div class="sidebar-footer" id="sidebarFooter"></div>
        `;
        this.renderFooter();
    }

    aplicarVisibilidadPorRol() {
        const user = getCurrentUser();
        if (!user) return;

        if (esRolSupervisorOAdmision(user.rol)) {
            ['navIndicadoresBL', 'navUnificarIds', 'navCondicionesCC', 'navAsistenciaAnalisis', 'navAsistenciaMantenimiento', 'navUsuarioResultados']
                .forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.style.display = '';
                });
        }

        if (esRolAdmision(user.rol)) {
            const el = document.getElementById('sidebarFooterConfig');
            if (el) el.style.display = '';
        }

        if (puedeVerCapacitacionIA(user.rol)) {
            const el = document.getElementById('navUsuarioCapacitacion');
            if (el) el.style.display = '';
        }
    }

    renderFooter() {
        const footer = document.getElementById('sidebarFooter');
        if (!footer) return;
        const user = getCurrentUser();
        if (!user) { footer.innerHTML = ''; return; }

        footer.innerHTML = `
            <div class="sidebar-footer-user">
                <img class="sidebar-footer-avatar" src="${escapeHtml(normalizarUrlFoto(user.foto)) || 'assets/logo.png'}" alt="" onerror="this.src='assets/logo.png'">
                <span class="sidebar-footer-initials">${escapeHtml(obtenerIniciales(user.nombre))}</span>
                <div class="sidebar-footer-info">
                    <span class="sidebar-footer-name">${escapeHtml(user.nombre)}</span>
                    <span class="sidebar-footer-rol">${escapeHtml(user.rol)}</span>
                </div>
            </div>
            <button type="button" class="sidebar-footer-logout" id="sidebarFooterConfig" title="Configuración" style="display:none;" onclick="window.mostrarConfiguracion && mostrarConfiguracion()">
                <span class="material-symbols-outlined">settings</span>
                <span class="sidebar-footer-logout-label">Configuración</span>
            </button>
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

export function createMultiSelect(containerId, options, selected = [], label = 'Todos', labelsMap = null, opciones = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const permitirTodos = opciones.permitirTodos !== false;
    const mostrarValores = opciones.mostrarValores === true;

    const uniqueOptions = [...new Set(options.filter(v => v && String(v).trim() !== '').map(v => String(v).trim()))].sort();
    const subopciones = {};
    Object.entries(opciones.subopciones || {}).forEach(([padre, hijos]) => {
        if (uniqueOptions.includes(padre) && Array.isArray(hijos) && hijos.length) subopciones[padre] = hijos;
    });
    labelsMap = { ...(labelsMap || {}) };
    Object.entries(subopciones).forEach(([padre, hijos]) => hijos.forEach(h => {
        labelsMap[h.value] = `${labelsMap[padre] || padre} · ${h.label}`;
    }));
    const valoresValidos = uniqueOptions.concat(...Object.values(subopciones).map(hs => hs.map(h => h.value)));
    let selection = selected.filter(v => valoresValidos.includes(v));
    if (!permitirTodos && selection.length === 0) {
        selection = uniqueOptions.slice();
    }

    if (uniqueOptions.length === 0) {
        container.innerHTML = `<button type="button" class="multiselect-btn" disabled>Sin datos</button>`;
        return;
    }

    function formatoTexto(values) {
        if (values.length === 0) return label;
        if (values.length === 1) {
            return (labelsMap && labelsMap[values[0]]) ? labelsMap[values[0]] : values[0];
        }
        if (mostrarValores) {
            return values.map(v => (labelsMap && labelsMap[v]) ? labelsMap[v] : v).join(', ');
        }
        return `${values.length} seleccionados`;
    }

    const textoBoton = formatoTexto(selection);

    container.innerHTML = `
        <button type="button" class="multiselect-btn${selection.length ? ' has-selection' : ''}" onclick="window.toggleMultiSelect && window.toggleMultiSelect('${containerId}')">
            ${escapeHtml(textoBoton)}
        </button>
        <div class="multiselect-panel">
            <div class="multiselect-options">
                ${permitirTodos ? `
                <label class="multiselect-option ms-todos">
                    <input type="checkbox" data-todos="1" ${selection.length === 0 ? 'checked' : ''}>
                    <span>${escapeHtml(label)}</span>
                </label>` : ''}
                ${uniqueOptions.map(v => {
                    const checked = selection.includes(v) ? 'checked' : '';
                    const labelText = labelsMap && labelsMap[v] ? labelsMap[v] : v;
                    const hijos = subopciones[v];
                    if (!hijos) {
                        return `<label class="multiselect-option"><input type="checkbox" value="${escapeHtml(v)}" ${checked}><span>${escapeHtml(labelText)}</span></label>`;
                    }
                    return `<label class="multiselect-option ms-padre"><input type="checkbox" value="${escapeHtml(v)}" data-padre="${escapeHtml(v)}" ${checked}><span>${escapeHtml(labelText)}</span></label>`
                        + hijos.map(h => `<label class="multiselect-option ms-hijo"><input type="checkbox" value="${escapeHtml(h.value)}" data-hijo-de="${escapeHtml(v)}" ${selection.includes(v) || selection.includes(h.value) ? 'checked' : ''}><span>${escapeHtml(h.label)}</span></label>`).join('');
                }).join('')}
            </div>
        </div>
    `;

    const btn = container.querySelector('.multiselect-btn');
    const getIndividualChecks = () => container.querySelectorAll('.multiselect-options input[type=checkbox]:not([data-todos])');
    const hijosDe = (padre) => Array.from(container.querySelectorAll('input[data-hijo-de]')).filter(c => c.dataset.hijoDe === padre);
    const padreDe = (padre) => Array.from(container.querySelectorAll('input[data-padre]')).find(c => c.dataset.padre === padre);

    function sincronizarPadre(padre) {
        const chkPadre = padreDe(padre);
        if (!chkPadre) return;
        const hijos = hijosDe(padre);
        const marcados = hijos.filter(c => c.checked).length;
        chkPadre.checked = marcados === hijos.length;
        chkPadre.indeterminate = marcados > 0 && marcados < hijos.length;
    }
    Object.keys(subopciones).forEach(sincronizarPadre);

    function valoresSeleccionados() {
        const values = [];
        uniqueOptions.forEach(v => {
            if (subopciones[v]) {
                const chkPadre = padreDe(v);
                if (chkPadre && chkPadre.checked) values.push(v);
                else hijosDe(v).filter(c => c.checked).forEach(c => values.push(c.value));
            } else {
                const chk = Array.from(getIndividualChecks()).find(c => c.value === v && !c.dataset.hijoDe);
                if (chk && chk.checked) values.push(v);
            }
        });
        return values;
    }

    function actualizarBoton(values) {
        const texto = formatoTexto(values);
        if (btn) {
            btn.textContent = texto;
            btn.classList.toggle('has-selection', values.length > 0);
        }
    }

    const chkTodos = container.querySelector('[data-todos]');
    if (chkTodos) {
        chkTodos.addEventListener('change', () => {
            if (chkTodos.checked) {
                getIndividualChecks().forEach(c => { c.checked = false; });
                actualizarBoton([]);
                window.dispatchEvent(new CustomEvent('multiselect-change', { 
                    detail: { containerId, key: containerId.replace('filter', '').toLowerCase(), values: [] }
                }));
            } else {
                chkTodos.checked = true;
            }
        });
    }

    getIndividualChecks().forEach(chk => {
        chk.addEventListener('change', () => {
            if (chk.dataset.padre) hijosDe(chk.dataset.padre).forEach(c => { c.checked = chk.checked; });
            if (chk.dataset.padre || chk.dataset.hijoDe) sincronizarPadre(chk.dataset.padre || chk.dataset.hijoDe);
            let values = valoresSeleccionados();
            if (!permitirTodos && values.length === 0) {
                chk.checked = true;
                if (chk.dataset.padre || chk.dataset.hijoDe) sincronizarPadre(chk.dataset.padre || chk.dataset.hijoDe);
                values = valoresSeleccionados();
            }
            if (chkTodos) chkTodos.checked = values.length === 0;
            actualizarBoton(values);
            window.dispatchEvent(new CustomEvent('multiselect-change', {
                detail: { containerId, key: containerId.replace('filter', '').toLowerCase(), values }
            }));
        });
    });
}

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

window.toggleMultiSelect = toggleMultiSelect;
window.sortTable = sortTable;
window.createMultiSelect = createMultiSelect;

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

const INACTIVIDAD_LIMITE_MS = 1 * 60 * 60 * 1000;

function iniciarControlInactividad() {
    if (window.__inactividadIniciada) return;
    window.__inactividadIniciada = true;

    let ultimaActividad = Date.now();
    const registrarActividad = () => { ultimaActividad = Date.now(); };
    ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'].forEach(evt => {
        window.addEventListener(evt, registrarActividad, { passive: true });
    });

    setInterval(() => {
        if (Date.now() - ultimaActividad >= INACTIVIDAD_LIMITE_MS) {
            alert('Tu sesión se cerró por inactividad. Vuelve a iniciar sesión.');
            window.logout();
        }
    }, 60 * 1000);
}

const DIAS_SEMANA_CAL = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function claveFechaCal(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fechaDesdeClaveCal(clave) {
    const [y, m, d] = String(clave).split('-').map(Number);
    return new Date(y, m - 1, d);
}

export function formatoRangoFechas(desde, hasta) {
    if (!desde) return '';
    const f = (c) => { const [y, m, d] = c.split('-'); return `${d}/${m}/${y}`; };
    return !hasta || hasta === desde ? f(desde) : `${f(desde)} – ${f(hasta)}`;
}

export function fechasEnRango(desde, hasta) {
    if (!desde) return [];
    const fin = fechaDesdeClaveCal(hasta || desde);
    const lista = [];
    for (let d = fechaDesdeClaveCal(desde); d <= fin; d.setDate(d.getDate() + 1)) lista.push(claveFechaCal(d));
    return lista;
}

export function crearCalendarioRango(contenedor, opciones = {}) {
    if (!contenedor) return null;
    const estado = {
        desde: opciones.desde || '',
        hasta: opciones.hasta || opciones.desde || '',
        esperandoFin: false,
        mes: fechaDesdeClaveCal(opciones.hasta || opciones.desde || claveFechaCal(new Date())),
    };
    estado.mes.setDate(1);
    const hoy = claveFechaCal(new Date());

    function clasesDia(clave, previewHasta) {
        let ini = estado.desde;
        let fin = estado.hasta;
        if (estado.esperandoFin && previewHasta) {
            ini = previewHasta < estado.desde ? previewHasta : estado.desde;
            fin = previewHasta < estado.desde ? estado.desde : previewHasta;
        }
        const c = [];
        if (ini && clave === ini) c.push('cr-inicio');
        if (fin && clave === fin) c.push('cr-fin');
        if (ini && fin && clave > ini && clave < fin) c.push('cr-medio');
        if (ini && fin && ini !== fin && (clave === ini || clave === fin)) c.push('cr-con-rango');
        if (clave === hoy) c.push('cr-hoy');
        return c;
    }

    function render() {
        const conteos = typeof opciones.conteos === 'function' ? (opciones.conteos() || {}) : null;
        const y = estado.mes.getFullYear();
        const m = estado.mes.getMonth();
        const ultimo = new Date(y, m + 1, 0).getDate();
        const offset = (new Date(y, m, 1).getDay() + 6) % 7;
        const nombreMes = estado.mes.toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });

        let celdas = '';
        for (let i = 0; i < offset; i++) celdas += '<div class="cr-vacio"></div>';
        for (let d = 1; d <= ultimo; d++) {
            const clave = claveFechaCal(new Date(y, m, d));
            const n = conteos ? (conteos[clave] || 0) : 0;
            celdas += `<button type="button" class="cr-dia ${clasesDia(clave).join(' ')}${conteos && n ? ' cr-con-datos' : ''}" data-fecha="${clave}">`
                + `<span class="cr-num">${d}</span>${conteos ? `<span class="cr-cant">${n || ''}</span>` : ''}</button>`;
        }

        contenedor.innerHTML = `
            <div class="cr">
                <div class="cr-head">
                    <button type="button" class="cr-nav" data-nav="-1" aria-label="Mes anterior">‹</button>
                    <span class="cr-mes">${nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1)}</span>
                    <button type="button" class="cr-nav" data-nav="1" aria-label="Mes siguiente">›</button>
                </div>
                <div class="cr-semana">${DIAS_SEMANA_CAL.map(n => `<span>${n}</span>`).join('')}</div>
                <div class="cr-grid">${celdas}</div>
                <div class="cr-pie">
                    <span class="cr-texto">${estado.desde ? formatoRangoFechas(estado.desde, estado.hasta) : 'Elige un día o un rango'}${estado.esperandoFin ? ' · elige el día final' : ''}</span>
                    <button type="button" class="cr-limpiar" ${estado.desde ? '' : 'disabled'}>Limpiar</button>
                </div>
            </div>`;
    }

    function avisar() {
        if (typeof opciones.onChange === 'function') opciones.onChange(estado.desde, estado.hasta);
    }

    contenedor.addEventListener('click', (e) => {
        e.stopPropagation();
        const nav = e.target.closest('[data-nav]');
        if (nav) {
            estado.mes.setMonth(estado.mes.getMonth() + Number(nav.dataset.nav));
            render();
            return;
        }
        if (e.target.closest('.cr-limpiar')) {
            estado.desde = '';
            estado.hasta = '';
            estado.esperandoFin = false;
            render();
            avisar();
            return;
        }
        const dia = e.target.closest('.cr-dia');
        if (!dia) return;
        const clave = dia.dataset.fecha;
        if (!estado.esperandoFin) {
            estado.desde = clave;
            estado.hasta = clave;
            estado.esperandoFin = true;
        } else {
            if (clave < estado.desde) {
                estado.hasta = estado.desde;
                estado.desde = clave;
            } else {
                estado.hasta = clave;
            }
            estado.esperandoFin = false;
        }
        render();
        avisar();
    });

    contenedor.addEventListener('mouseover', (e) => {
        if (!estado.esperandoFin) return;
        const dia = e.target.closest('.cr-dia');
        if (!dia) return;
        contenedor.querySelectorAll('.cr-dia').forEach(b => {
            b.classList.remove('cr-inicio', 'cr-fin', 'cr-medio', 'cr-con-rango');
            b.classList.add(...clasesDia(b.dataset.fecha, dia.dataset.fecha).filter(c => c !== 'cr-hoy'));
        });
    });

    render();

    return {
        render,
        valor: () => ({ desde: estado.desde, hasta: estado.hasta }),
        set(desde, hasta) {
            estado.desde = desde || '';
            estado.hasta = hasta || desde || '';
            estado.esperandoFin = false;
            if (estado.desde) {
                estado.mes = fechaDesdeClaveCal(estado.hasta);
                estado.mes.setDate(1);
            }
            render();
        },
    };
}

export function crearSelectorRango(contenedor, { inputDesde, inputHasta, textoVacio = 'Todas las fechas', alCambiar } = {}) {
    if (!contenedor) return null;
    const elDesde = typeof inputDesde === 'string' ? document.getElementById(inputDesde) : inputDesde;
    const elHasta = typeof inputHasta === 'string' ? document.getElementById(inputHasta) : inputHasta;
    contenedor.classList.add('selector-rango');
    contenedor.innerHTML = `
        <button type="button" class="selector-rango-btn"><span class="material-symbols-outlined">calendar_month</span><span class="selector-rango-texto"></span></button>
        <div class="selector-rango-panel"></div>`;
    const btn = contenedor.querySelector('.selector-rango-btn');
    const texto = contenedor.querySelector('.selector-rango-texto');
    const panel = contenedor.querySelector('.selector-rango-panel');

    const pintarBoton = () => {
        const d = elDesde?.value || '';
        const h = elHasta?.value || '';
        texto.textContent = d ? formatoRangoFechas(d, h) : textoVacio;
        btn.classList.toggle('has-selection', !!d);
    };

    const cal = crearCalendarioRango(panel, {
        desde: elDesde?.value || '',
        hasta: elHasta?.value || '',
        onChange(desde, hasta) {
            if (elDesde) elDesde.value = desde;
            if (elHasta) elHasta.value = hasta;
            pintarBoton();
            elDesde?.dispatchEvent(new Event('change', { bubbles: true }));
            if (typeof alCambiar === 'function') alCambiar(desde, hasta);
        },
    });

    const cerrarFuera = (e) => {
        if (contenedor.contains(e.target)) return;
        panel.classList.remove('open');
        document.removeEventListener('click', cerrarFuera);
    };
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const abrir = !panel.classList.contains('open');
        document.querySelectorAll('.selector-rango-panel.open').forEach(p => p.classList.remove('open'));
        if (abrir) {
            cal.set(elDesde?.value || '', elHasta?.value || '');
            panel.classList.add('open');
            setTimeout(() => document.addEventListener('click', cerrarFuera), 0);
        }
    });

    pintarBoton();
    return {
        actualizar() { pintarBoton(); cal.set(elDesde?.value || '', elHasta?.value || ''); },
    };
}
