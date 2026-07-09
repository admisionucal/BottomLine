// AUTH - Manejo de sesión y roles ============================

function getCurrentUser() {
    const data = sessionStorage.getItem('bl_user');
    if (!data) return null;
    try {
        return JSON.parse(data);
    } catch {
        return null;
    }
}

function setUser(user) {
    sessionStorage.setItem('bl_user', JSON.stringify(user));
}

/** Token de sesión emitido por el backend en login(). Viaja dentro del objeto user. */
function getSessionToken() {
    const user = getCurrentUser();
    return user ? (user.token || '') : '';
}

async function logout() {
    // Revoca el token en el backend antes de borrar todo localmente
    const token = getSessionToken();
    if (token && typeof callAPI === 'function') {
        try { await callAPI('logout', { sessionToken: token }); } catch (e) { /* no bloquea el logout */ }
    }

    Object.keys(sessionStorage).forEach(key => {
        if (key.startsWith('bl_leads_') || key.startsWith('bl_detail_') ||
            key.startsWith('bl_payments_') || key.startsWith('bl_selected_')) {
            sessionStorage.removeItem(key);
        }
    });
    sessionStorage.removeItem('bl_user');
    window.location.href = 'index.html';
}

function requireAuth() {
    const user = getCurrentUser();
    if (!user) {
        window.location.href = 'index.html';
        return null;
    }
    return user;
}

function isAdmin() {
    const user = getCurrentUser();
    return user && user.rol === 'ADMIN';
}

function isAsesor() {
    const user = getCurrentUser();
    return user && user.rol === 'ASESOR';
}

function getUserName() {
    const user = getCurrentUser();
    return user ? user.nombre : 'Usuario';
}

function getUserEmail() {
    const user = getCurrentUser();
    return user ? user.email : '';
}

function getUserCampanas() {
    const user = getCurrentUser();
    if (!user || !user.campanas) return [];
    if (Array.isArray(user.campanas)) return user.campanas.map(c => String(c).trim());
    if (typeof user.campanas === 'string') return user.campanas.split(',').map(c => c.trim()).filter(Boolean);
    return [];
}

function getUserNombreAsesor() {
    const user = getCurrentUser();
    return user ? (user.nombre_asesor || user.nombre || '') : '';
}