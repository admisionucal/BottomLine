// ================================================================
// UTILS - Funciones utilitarias reutilizables y caché
// ================================================================

import { CACHE_KEYS } from './constants.js';

// ================================================================
// FORMATEO Y PARSING
// ================================================================

/** Escapa texto para inserción HTML (previene XSS) */
export function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Normaliza texto: minúsculas, sin tildes, sin caracteres especiales, sin espacios */
export function normalizarTexto(s) {
    return String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');
}

/** Parsea un número desde un string (elimina S/, comas, etc.) */
export function parseNumero(v) {
    if (v === undefined || v === null || v === '') return NaN;
    if (typeof v === 'number') return v;
    const limpio = String(v).replace(/[^0-9.\-]/g, '');
    return limpio === '' ? NaN : Number(limpio);
}

/** Formatea horas: "HH:MM" a minutos desde medianoche */
export function horaAMinutos(horaStr) {
    if (!horaStr) return null;
    const partes = String(horaStr).split(':');
    if (partes.length < 2) return null;
    const h = Number(partes[0]);
    const m = Number(partes[1]);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
}

/** Convierte minutos a formato "HH:MM" */
export function minutosAHora(totalMin) {
    const h = Math.floor(totalMin / 60).toString().padStart(2, '0');
    const m = (totalMin % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
}

/** Calcula diferencia en horas entre dos strings "HH:MM" (t2 - t1) */
export function diffHoras(t1, t2) {
    if (!t1 || !t2) return 0;
    const p = s => {
        const [h, m, sec] = (s || '').split(':').map(Number);
        return h * 3600 + m * 60 + (sec || 0);
    };
    return Math.max(0, (p(t2) - p(t1)) / 3600);
}

/** Formatea horas decimales a "Xh YYm" */
export function horasLabel(h) {
    if (!h || isNaN(h) || h <= 0) return '--';
    const hrs = Math.floor(h);
    const min = Math.round((h - hrs) * 60);
    return `${hrs}h ${String(min).padStart(2, '0')}m`;
}

/** Parsea una fecha flexible (ISO, DD/MM/YYYY, etc.) a objeto Date */
export function parsearFechaFlexible(valor) {
    if (!valor) return null;
    if (valor instanceof Date) return isNaN(valor.getTime()) ? null : valor;
    const str = String(valor).trim();
    if (!str) return null;

    let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        return isNaN(d.getTime()) ? null : d;
    }
    m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (m) {
        const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        return isNaN(d.getTime()) ? null : d;
    }
    const fallback = new Date(str);
    return isNaN(fallback.getTime()) ? null : fallback;
}

/** Convierte Date a "YYYY-MM-DD" */
export function fechaAClaveISO(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

/** Convierte Date a "DD/MM/YYYY" (formato usado en Asistencia) */
export function fechaDDMMYYYY(date) {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

/** Obtiene la fecha de hoy en "DD/MM/YYYY" */
export function hoyDDMMYYYY() {
    return fechaDDMMYYYY(new Date());
}

/** Fecha actual en zona horaria Perú (UTC-5) */
export function nowPeru() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }));
}

/** Formatea "HH:MM" a formato 12h (AM/PM) */
export function formato12h(hhmm) {
    if (!hhmm || hhmm === '—') return '—';
    const [h, m] = hhmm.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return '—';
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** Formatea una fecha para mostrar en modo lectura */
export function formatearFecha(valor) {
    if (!valor) return '';
    const fecha = new Date(valor);
    if (isNaN(fecha.getTime())) return String(valor);
    const dd = String(fecha.getDate()).padStart(2, '0');
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    const yyyy = fecha.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

/** Parsea el historial de comentarios/snapshots (array JSON) */
export function parsearHistorial(raw) {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

// ================================================================
// CACHÉ LOCAL (sessionStorage)
// ================================================================

/** Obtiene un valor del caché, parseándolo como JSON */
export function cacheGet(key) {
    const data = sessionStorage.getItem(key);
    if (!data) return null;
    try { return JSON.parse(data); } catch { return null; }
}

/** Guarda un valor en el caché (lo serializa a JSON) */
export function cacheSet(key, value) {
    sessionStorage.setItem(key, JSON.stringify(value));
}

/** Elimina una clave del caché */
export function cacheRemove(key) {
    sessionStorage.removeItem(key);
}

/** Obtiene el usuario actual del caché */
export function getCurrentUser() {
    return cacheGet(CACHE_KEYS.USER);
}

/** Guarda el usuario en el caché */
export function setUser(user) {
    cacheSet(CACHE_KEYS.USER, user);
}

/** Obtiene el token de sesión del usuario actual */
export function getSessionToken() {
    const user = getCurrentUser();
    return user ? (user.token || '') : '';
}

/** Obtiene las campañas del usuario actual */
export function getUserCampanas() {
    const user = getCurrentUser();
    if (!user || !user.campanas) return [];
    if (Array.isArray(user.campanas)) return user.campanas.map(c => String(c).trim());
    if (typeof user.campanas === 'string') return user.campanas.split(',').map(c => c.trim()).filter(Boolean);
    return [];
}

/** Obtiene el nombre del asesor del usuario actual */
export function getUserNombreAsesor() {
    const user = getCurrentUser();
    return user ? (user.nombre_asesor || user.nombre || '') : '';
}

/** Obtiene las campañas del usuario (alias para compatibilidad) */
export function getUserCampanasAlias() {
    return getUserCampanas();
}

// ================================================================
// VALIDACIONES DE LEADS
// ================================================================

/** Verifica si el lead tiene un estado que indica PP Viva */
export function esPPViva(lead) {
    return lead?.['STATUS DE GESTION'] === 'VALORES_PROMESA_DE_PAGO_VIVA';
}

/** Verifica si el lead tiene un estado que indica VP Viva */
export function esVPViva(lead) {
    return lead?.['STATUS DE GESTION'] === 'VALORES_VALORACIONES_POSITIVAS_VIVA';
}

/** Verifica si el lead está en estado de pago (Completo o Fraccionado) */
export function esPago(lead) {
    const s = lead?.['STATUS DE GESTION'];
    return s === 'PAGO COMPLETO' || s === 'PAGO FRACCIONADO';
}

/** Clasifica un lead por su estado */
export function clasificarLead(lead) {
    const status = lead?.['STATUS DE GESTION'];
    const completo = !!(lead?.PERFILAMIENTO_COMPLETO?.completo);
    return {
        esVp: status === 'VALORES_VALORACIONES_POSITIVAS_VIVA',
        esPp: status === 'VALORES_PROMESA_DE_PAGO_VIVA',
        completo
    };
}

// ================================================================
// GEOLOCALIZACIÓN
// ================================================================

/**
 * Normaliza una URL de foto pegada "a mano" en Sheets. Es común que quede
 * guardada sin esquema (ej. "i.imgur.com/SipWTmf.png") porque Sheets la
 * autolinkea y le agrega el https:// solo al momento de abrirla como link
 * — pero como texto plano en un <img src>, el navegador la trataría como
 * una ruta relativa del propio sitio y jamás cargaría. Si ya trae
 * http(s):// o es un data URI, se deja tal cual.
 */
export function normalizarUrlFoto(foto) {
    const url = String(foto || '').trim();
    if (!url) return '';
    if (/^(https?:)?\/\//i.test(url) || /^data:/i.test(url)) return url;
    return 'https://' + url;
}

/** Calcula la distancia en metros entre dos coordenadas */
export function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Obtiene la IP pública del usuario */
export async function getIP() {
    try {
        const r = await fetch('https://api.ipify.org?format=json');
        return (await r.json()).ip;
    } catch (e) {
        return '0.0.0.0';
    }
}

// ================================================================
// FUNCIONES DE NAVEGACIÓN (hooks para sidebar)
// ================================================================

/** Registra una función para mostrar la vista de Usuario */
export function registrarMostrarUsuario(fn) {
    window.mostrarUsuario = fn;
}

/** Registra una función para mostrar la vista de Asistencia */
export function registrarMostrarAsistencia(fn) {
    window.mostrarAsistencia = fn;
}

/** Registra una función para mostrar la vista de Bottom Line */
export function registrarMostrarBottomLine(fn) {
    window.mostrarBottomLine = fn;
}

/** Registra una función para mostrar la vista de Calendario */
export function registrarMostrarCalendario(fn) {
    window.mostrarCalendario = fn;
}

/** Registra una función para ir a Unificar IDs */
export function registrarIrAUnificar(fn) {
    window.irAUnificar = fn;
}