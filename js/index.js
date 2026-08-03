// ================================================================
// INDEX - Módulo de Login
// ================================================================

import { API_URL, CACHE_KEYS } from '../core/constants.js';
import { getCurrentUser, setUser, cacheRemove } from '../core/utils.js';

// Elementos DOM
const form = document.getElementById('loginForm');
const usuarioInput = document.getElementById('usuario');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const errorMsg = document.getElementById('errorMsg');
const togglePassword = document.getElementById('togglePassword');

// ----- Mostrar/Ocultar contraseña -----
togglePassword.addEventListener('click', () => {
    const isHidden = passwordInput.type === 'password';
    passwordInput.type = isHidden ? 'text' : 'password';
    togglePassword.textContent = isHidden ? 'visibility_off' : 'visibility';
});

// ----- Manejar Login -----
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const usuario = usuarioInput.value.trim();
    const password = passwordInput.value.trim();

    if (!usuario || !password) {
        showError('Ingresa usuario y contraseña');
        return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = 'Verificando...';
    hideError();

    try {
        const result = await callAPI('login', { usuario, password });

        if (result.success && result.user) {
            setUser(result.user);
            window.location.href = 'dashboard.html';
        } else {
            showError(result.error || 'Credenciales incorrectas');
        }
    } catch (error) {
        showError('Error de conexión: ' + error.message);
    } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Ingresar';
    }
});

// ----- API Call (versión simplificada para login) -----
async function callAPI(action, data = {}) {
    const payload = { action, ...data };
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

// ----- UI Helpers -----
function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.style.display = 'block';
}

function hideError() {
    errorMsg.style.display = 'none';
}

// ----- Verificar sesión activa -----
(function checkSession() {
    const user = getCurrentUser();
    if (user) {
        window.location.href = 'dashboard.html';
    }
})();