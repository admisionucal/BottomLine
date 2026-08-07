// ================================================================
// SIDEBAR / NAVEGACIÓN - Manejo del menú lateral
// ================================================================

import { getCurrentUser } from '../core/utils.js';
import { esRolSupervisorOAdmision } from '../core/constants.js';

// ===== VARIABLES DE ESTADO =====
let __usuarioModuloCargado = false;
let __usuarioCargaEnCurso = null;
let __asistenciaModuloCargado = false;
let __asistenciaCargaEnCurso = null;
let __unifModuloCargado = false;
let __unifCargaEnCurso = null;
let __ccModuloCargado = false;
let __ccCargaEnCurso = null;

// ===== FUNCIONES DEL SIDEBAR =====
function toggleSidebar() {
    if (window.__sidebarInstance) {
        window.__sidebarInstance.toggle();
    }
}

function expandirSidebar() {
    if (window.__sidebarInstance) {
        window.__sidebarInstance.expand();
    }
}

function toggleNavGroup(groupId, btn) {
    expandirSidebar();
    const grupo = document.getElementById(groupId);
    if (!grupo) return;
    const yaAbierto = grupo.classList.contains('open');

    document.querySelectorAll('.nav-group').forEach(g => g.classList.remove('open'));
    document.querySelectorAll('.nav-group-btn').forEach(b => b.classList.remove('active'));

    if (!yaAbierto) {
        grupo.classList.add('open');
        if (btn) btn.classList.add('active');
    }
}

function marcarSubitemActivo(el) {
    document.querySelectorAll('.nav-subitem').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
}

function ocultarTodasLasVistas() {
    ['view-bottomline', 'view-placeholder', 'view-calendario', 'view-asistencia', 'view-usuario', 'view-unificar', 'view-cc']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
}

// ===== VISTA: USUARIO =====
function mostrarUsuario() {
    // Verificar si estamos en dashboard.html (tiene las vistas)
    const viewUsuario = document.getElementById('view-usuario');
    const viewBottomline = document.getElementById('view-bottomline');
    
    // Si NO estamos en dashboard.html, redirigir a usuario.html
    if (!viewUsuario && !viewBottomline) {
        window.location.href = 'usuario.html';
        return;
    }
    
    // Si estamos en dashboard.html, mostrar la vista embebida
    ocultarTodasLasVistas();
    if (viewUsuario) viewUsuario.style.display = 'block';
    
    document.querySelectorAll('.nav-group-btn').forEach(b => b.classList.remove('active'));
    const grupo = document.getElementById('navGroupUsuario');
    if (grupo) grupo.querySelector('.nav-group-btn').classList.add('active');
    document.querySelectorAll('.nav-subitem').forEach(b => b.classList.remove('active'));
    const miPerfil = grupo && grupo.querySelector('.nav-subitem');
    if (miPerfil) miPerfil.classList.add('active');

    if (__usuarioModuloCargado) {
        if (typeof initUsuarioEmbebido === 'function') initUsuarioEmbebido();
        return;
    }
    cargarVistaUsuario();
}

function cargarVistaUsuario() {
    if (__usuarioCargaEnCurso) return __usuarioCargaEnCurso;

    const contenedor = document.getElementById('view-usuario');
    if (!contenedor) {
        window.location.href = 'usuario.html';
        return;
    }

    __usuarioCargaEnCurso = fetch('usuario.html')
        .then(resp => {
            if (!resp.ok) throw new Error('HTTP ' + resp.status + ' al pedir usuario.html');
            return resp.text();
        })
        .then(html => {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const usuarioApp = doc.getElementById('usuarioApp');

            if (!usuarioApp) {
                throw new Error('usuario.html no tiene el elemento #usuarioApp esperado');
            }

            if (!document.querySelector('style[data-usuario-styles]')) {
                doc.querySelectorAll('style').forEach(styleTag => {
                    const clon = styleTag.cloneNode(true);
                    clon.setAttribute('data-usuario-styles', '');
                    document.head.appendChild(clon);
                });
            }

            contenedor.innerHTML = '';
            contenedor.appendChild(usuarioApp.cloneNode(true));

            return asegurarScriptUsuario();
        })
        .then(() => {
            __usuarioModuloCargado = true;
            if (typeof initUsuarioEmbebido === 'function') {
                return initUsuarioEmbebido();
            }
        })
        .catch(err => {
            console.error('cargarVistaUsuario:', err);
            contenedor.innerHTML = '<div class="loading" style="color:#d32f2f;">Error al cargar el módulo de usuario: ' + err.message + '</div>';
        })
        .finally(() => {
            __usuarioCargaEnCurso = null;
        });

    return __usuarioCargaEnCurso;
}

let __usuarioScriptPromise = null;

function asegurarScriptUsuario() {
    if (typeof initUsuarioEmbebido === 'function') return Promise.resolve();
    if (!__usuarioScriptPromise) {
        __usuarioScriptPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.type = 'module';
            script.src = 'js/usuario.js';
            script.onload = resolve;
            script.onerror = () => { __usuarioScriptPromise = null;
                reject(new Error('No se pudo cargar js/usuario.js')); };
            document.body.appendChild(script);
        });
    }
    return __usuarioScriptPromise;
}

function irAMarcarAsistenciaDesdeUsuario() {
    const grupo = document.getElementById('navGroupAsistencia');
    if (!grupo) { window.location.href = 'asistencia.html'; return; }
    document.querySelectorAll('.nav-group').forEach(g => g.classList.remove('open'));
    grupo.classList.add('open');
    mostrarAsistencia('marcacion');
    marcarSubitemActivo(document.getElementById('navAsistenciaMarcacion'));
}

// ===== VISTA: BOTTOM LINE =====
function mostrarBottomLine() {
    // Verificar si estamos en dashboard.html (tiene las vistas)
    const viewUsuario = document.getElementById('view-usuario');
    const viewBottomline = document.getElementById('view-bottomline');
    
    // Si NO estamos en dashboard.html, redirigir a dashboard.html
    if (!viewUsuario && !viewBottomline) {
        window.location.href = 'dashboard.html?view=bottomline';
        return;
    }
    
    // Si estamos en dashboard.html, mostrar la vista embebida
    ocultarTodasLasVistas();
    if (viewBottomline) viewBottomline.style.display = 'block';
    
    document.querySelectorAll('.nav-group-btn').forEach(b => b.classList.remove('active'));
    const grupo = document.getElementById('navGroupBottomLine');
    if (grupo) grupo.querySelector('.nav-group-btn').classList.add('active');

    document.querySelectorAll('.nav-subitem').forEach(b => b.classList.remove('active'));
    const navDash = document.getElementById('navDashboardBL');
    if (navDash) navDash.classList.add('active');
}

// ===== VISTA: ASISTENCIA =====
function mostrarAsistencia(tab) {
    // Verificar si estamos en dashboard.html (tiene las vistas)
    const viewUsuario = document.getElementById('view-usuario');
    const viewBottomline = document.getElementById('view-bottomline');
    const viewAsistencia = document.getElementById('view-asistencia');
    
    // Si NO estamos en dashboard.html, redirigir a asistencia.html
    if (!viewUsuario && !viewBottomline) {
        window.location.href = 'asistencia.html?tab=' + (tab || 'marcacion');
        return;
    }
    
    // Si estamos en dashboard.html, mostrar la vista embebida
    ocultarTodasLasVistas();
    if (viewAsistencia) viewAsistencia.style.display = 'block';
    
    document.querySelectorAll('.nav-group-btn').forEach(b => b.classList.remove('active'));
    const grupo = document.getElementById('navGroupAsistencia');
    if (grupo) grupo.querySelector('.nav-group-btn').classList.add('active');

    if (__asistenciaModuloCargado) {
        if (typeof asisIrATab === 'function') asisIrATab(tab);
        return;
    }
    cargarVistaAsistencia(tab);
}

function cargarVistaAsistencia(tabDeseado) {
    if (__asistenciaCargaEnCurso) return __asistenciaCargaEnCurso;

    const contenedor = document.getElementById('view-asistencia');
    if (!contenedor) {
        window.location.href = 'asistencia.html?tab=' + (tabDeseado || 'marcacion');
        return;
    }

    __asistenciaCargaEnCurso = fetch('asistencia.html')
        .then(resp => {
            if (!resp.ok) throw new Error('HTTP ' + resp.status + ' al pedir asistencia.html');
            return resp.text();
        })
        .then(html => {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const toast = doc.getElementById('toast');
            const modal = doc.getElementById('confirmModal');
            const asisApp = doc.getElementById('asisApp');

            if (!toast || !modal || !asisApp) {
                throw new Error('asistencia.html no tiene los elementos #toast/#confirmModal/#asisApp esperados');
            }

            if (!document.querySelector('style[data-asis-styles]')) {
                doc.querySelectorAll('style').forEach(styleTag => {
                    const clon = styleTag.cloneNode(true);
                    clon.setAttribute('data-asis-styles', '');
                    document.head.appendChild(clon);
                });
            }

            contenedor.innerHTML = '';
            contenedor.appendChild(toast.cloneNode(true));
            contenedor.appendChild(modal.cloneNode(true));
            contenedor.appendChild(asisApp.cloneNode(true));

            return asegurarScriptAsistencia();
        })
        .then(() => {
            __asistenciaModuloCargado = true;
            if (typeof initAsistenciaEmbebido === 'function') {
                return initAsistenciaEmbebido(tabDeseado);
            }
        })
        .catch(err => {
            console.error('cargarVistaAsistencia:', err);
            contenedor.innerHTML = '<div class="loading" style="color:#d32f2f;">Error al cargar el módulo de asistencia: ' + err.message + '</div>';
        })
        .finally(() => {
            __asistenciaCargaEnCurso = null;
        });

    return __asistenciaCargaEnCurso;
}

let __asistenciaScriptPromise = null;

function asegurarScriptAsistencia() {
    if (typeof initAsistenciaEmbebido === 'function') return Promise.resolve();
    if (!__asistenciaScriptPromise) {
        __asistenciaScriptPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.type = 'module';
            script.src = 'js/asistencia.js';
            script.onload = resolve;
            script.onerror = () => { __asistenciaScriptPromise = null;
                reject(new Error('No se pudo cargar js/asistencia.js')); };
            document.body.appendChild(script);
        });
    }
    return __asistenciaScriptPromise;
}

// ===== VISTA: CALENDARIO DE PPs =====
function mostrarCalendario() {
    // Verificar si estamos en dashboard.html (tiene las vistas)
    const viewUsuario = document.getElementById('view-usuario');
    const viewBottomline = document.getElementById('view-bottomline');
    const viewCalendario = document.getElementById('view-calendario');
    
    // Si NO estamos en dashboard.html, redirigir a dashboard.html
    if (!viewUsuario && !viewBottomline) {
        window.location.href = 'dashboard.html?view=calendario';
        return;
    }
    
    // Si estamos en dashboard.html, mostrar la vista embebida
    ocultarTodasLasVistas();
    if (viewCalendario) viewCalendario.style.display = 'block';
    
    document.querySelectorAll('.nav-group-btn').forEach(b => b.classList.remove('active'));
    const grupo = document.getElementById('navGroupBottomLine');
    if (grupo) grupo.querySelector('.nav-group-btn').classList.add('active');

    const user = getCurrentUser();
    const esAdmin = user && esRolSupervisorOAdmision(user.rol);

    if (typeof vistaCalendarioActual !== 'undefined') vistaCalendarioActual = 'mes';
    document.querySelectorAll('#calViewToggle button').forEach(btn => {
        btn.classList.toggle('activo', btn.dataset.vista === 'mes');
    });
    const contenido = document.querySelector('#view-calendario .cal-page-content');
    if (contenido) contenido.classList.remove('vista-anio');

    const leyenda = document.getElementById('calLeyenda');
    if (leyenda) leyenda.style.display = esAdmin ? '' : 'none';

    if (esAdmin && typeof renderLeyendaCalendario === 'function') renderLeyendaCalendario();
    if (typeof renderCalendarioPP === 'function') renderCalendarioPP();
}

// ===== VISTA: UNIFICAR IDS =====
function mostrarUnificar() {
    // Verificar si estamos en dashboard.html (tiene las vistas)
    const viewUsuario = document.getElementById('view-usuario');
    const viewBottomline = document.getElementById('view-bottomline');
    const viewUnificar = document.getElementById('view-unificar');

    // Si NO estamos en dashboard.html, redirigir a dashboard.html
    if (!viewUsuario && !viewBottomline) {
        window.location.href = 'dashboard.html?view=unificar';
        return;
    }

    // Si estamos en dashboard.html, mostrar la vista embebida
    ocultarTodasLasVistas();
    if (viewUnificar) viewUnificar.style.display = 'block';

    document.querySelectorAll('.nav-group-btn').forEach(b => b.classList.remove('active'));
    const grupo = document.getElementById('navGroupBottomLine');
    if (grupo) grupo.querySelector('.nav-group-btn').classList.add('active');

    if (__unifModuloCargado) {
        if (typeof initUnificarEmbebido === 'function') initUnificarEmbebido();
        return;
    }
    cargarVistaUnificar();
}

function cargarVistaUnificar() {
    if (__unifCargaEnCurso) return __unifCargaEnCurso;

    const contenedor = document.getElementById('view-unificar');
    if (!contenedor) {
        window.location.href = 'dashboard.html?view=unificar';
        return;
    }

    __unifCargaEnCurso = fetch('unificar-ids.html')
        .then(resp => {
            if (!resp.ok) throw new Error('HTTP ' + resp.status + ' al pedir unificar-ids.html');
            return resp.text();
        })
        .then(html => {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const unifApp = doc.getElementById('unifApp');

            if (!unifApp) {
                throw new Error('unificar-ids.html no tiene el elemento #unifApp esperado');
            }

            if (!document.querySelector('style[data-unif-styles]')) {
                doc.querySelectorAll('style').forEach(styleTag => {
                    const clon = styleTag.cloneNode(true);
                    clon.setAttribute('data-unif-styles', '');
                    document.head.appendChild(clon);
                });
            }

            contenedor.innerHTML = '';
            contenedor.appendChild(unifApp.cloneNode(true));

            return asegurarScriptUnificar();
        })
        .then(() => {
            __unifModuloCargado = true;
            if (typeof initUnificarEmbebido === 'function') {
                return initUnificarEmbebido();
            }
        })
        .catch(err => {
            console.error('cargarVistaUnificar:', err);
            contenedor.innerHTML = '<div class="loading" style="color:#d32f2f;">Error al cargar el módulo de Unificar IDs: ' + err.message + '</div>';
        })
        .finally(() => {
            __unifCargaEnCurso = null;
        });

    return __unifCargaEnCurso;
}

let __unifScriptPromise = null;

function asegurarScriptUnificar() {
    if (typeof initUnificarEmbebido === 'function') return Promise.resolve();
    if (!__unifScriptPromise) {
        __unifScriptPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.type = 'module';
            script.src = 'js/unificar-ids.js';
            script.onload = resolve;
            script.onerror = () => { __unifScriptPromise = null;
                reject(new Error('No se pudo cargar js/unificar-ids.js')); };
            document.body.appendChild(script);
        });
    }
    return __unifScriptPromise;
}

// ===== VISTA: CONDICIONES COMERCIALES =====
function mostrarCC() {
    // Verificar si estamos en dashboard.html (tiene las vistas)
    const viewUsuario = document.getElementById('view-usuario');
    const viewBottomline = document.getElementById('view-bottomline');
    const viewCC = document.getElementById('view-cc');

    // Si NO estamos en dashboard.html, redirigir a dashboard.html
    if (!viewUsuario && !viewBottomline) {
        window.location.href = 'dashboard.html?view=cc';
        return;
    }

    // Si estamos en dashboard.html, mostrar la vista embebida
    ocultarTodasLasVistas();
    if (viewCC) viewCC.style.display = 'block';

    document.querySelectorAll('.nav-group-btn').forEach(b => b.classList.remove('active'));
    const grupo = document.getElementById('navGroupCargos');
    if (grupo) grupo.querySelector('.nav-group-btn').classList.add('active');

    if (__ccModuloCargado) {
        if (typeof initCCEmbebido === 'function') initCCEmbebido();
        return;
    }
    cargarVistaCC();
}

function cargarVistaCC() {
    if (__ccCargaEnCurso) return __ccCargaEnCurso;

    const contenedor = document.getElementById('view-cc');
    if (!contenedor) {
        window.location.href = 'dashboard.html?view=cc';
        return;
    }

    __ccCargaEnCurso = fetch('condiciones-comerciales.html')
        .then(resp => {
            if (!resp.ok) throw new Error('HTTP ' + resp.status + ' al pedir condiciones-comerciales.html');
            return resp.text();
        })
        .then(html => {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const ccApp = doc.getElementById('ccApp');

            if (!ccApp) {
                throw new Error('condiciones-comerciales.html no tiene el elemento #ccApp esperado');
            }

            if (!document.querySelector('style[data-cc-styles]')) {
                doc.querySelectorAll('style').forEach(styleTag => {
                    const clon = styleTag.cloneNode(true);
                    clon.setAttribute('data-cc-styles', '');
                    document.head.appendChild(clon);
                });
            }

            contenedor.innerHTML = '';
            contenedor.appendChild(ccApp.cloneNode(true));

            return asegurarScriptCC();
        })
        .then(() => {
            __ccModuloCargado = true;
            if (typeof initCCEmbebido === 'function') {
                return initCCEmbebido();
            }
        })
        .catch(err => {
            console.error('cargarVistaCC:', err);
            contenedor.innerHTML = '<div class="loading" style="color:#d32f2f;">Error al cargar el módulo de Condiciones Comerciales: ' + err.message + '</div>';
        })
        .finally(() => {
            __ccCargaEnCurso = null;
        });

    return __ccCargaEnCurso;
}

let __ccScriptPromise = null;

function asegurarScriptCC() {
    if (typeof initCCEmbebido === 'function') return Promise.resolve();
    if (!__ccScriptPromise) {
        __ccScriptPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.type = 'module';
            script.src = 'js/condiciones-comerciales.js';
            script.onload = resolve;
            script.onerror = () => { __ccScriptPromise = null;
                reject(new Error('No se pudo cargar js/condiciones-comerciales.js')); };
            document.body.appendChild(script);
        });
    }
    return __ccScriptPromise;
}

function logout() {
    sessionStorage.removeItem('bl_user');
    window.location.href = 'index.html';
}

// ================================================================
// REGISTRAR FUNCIONES EN WINDOW
// ================================================================

window.toggleSidebar = toggleSidebar;
window.toggleNavGroup = toggleNavGroup;
window.marcarSubitemActivo = marcarSubitemActivo;
window.mostrarUsuario = mostrarUsuario;
window.mostrarAsistencia = mostrarAsistencia;
window.mostrarBottomLine = mostrarBottomLine;
window.mostrarCalendario = mostrarCalendario;
window.mostrarUnificar = mostrarUnificar;
window.mostrarCC = mostrarCC;
window.logout = logout;
window.irAMarcarAsistenciaDesdeUsuario = irAMarcarAsistenciaDesdeUsuario;