import { CACHE_KEYS, CARRERAS_ETU } from './constants.js';

export function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function normalizarTexto(s) {
    return String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');
}

export function parseNumero(v) {
    if (v === undefined || v === null || v === '') return NaN;
    if (typeof v === 'number') return v;
    const limpio = String(v).replace(/[^0-9.\-]/g, '');
    return limpio === '' ? NaN : Number(limpio);
}

export function horaAMinutos(horaStr) {
    if (!horaStr) return null;
    const partes = String(horaStr).split(':');
    if (partes.length < 2) return null;
    const h = Number(partes[0]);
    const m = Number(partes[1]);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
}

export function minutosAHora(totalMin) {
    const h = Math.floor(totalMin / 60).toString().padStart(2, '0');
    const m = (totalMin % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
}

export function diffHoras(t1, t2) {
    if (!t1 || !t2) return 0;
    const p = s => {
        const [h, m, sec] = (s || '').split(':').map(Number);
        return h * 3600 + m * 60 + (sec || 0);
    };
    return Math.max(0, (p(t2) - p(t1)) / 3600);
}

export function horasLabel(h) {
    if (!h || isNaN(h) || h <= 0) return '--';
    const hrs = Math.floor(h);
    const min = Math.round((h - hrs) * 60);
    return `${hrs}h ${String(min).padStart(2, '0')}m`;
}

export function parsearFechaFlexible(valor) {
    if (!valor) return null;
    if (valor instanceof Date) return isNaN(valor.getTime()) ? null : valor;
    const str = String(valor).trim();
    if (!str) return null;

    let m = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
        const d = new Date(
            Number(m[1]), Number(m[2]) - 1, Number(m[3]),
            Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)
        );
        return isNaN(d.getTime()) ? null : d;
    }
    m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
        const d = new Date(
            Number(m[3]), Number(m[2]) - 1, Number(m[1]),
            Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)
        );
        return isNaN(d.getTime()) ? null : d;
    }
    const fallback = new Date(str);
    return isNaN(fallback.getTime()) ? null : fallback;
}

export function limpiarEspacios(s) {
    return String(s ?? '')
        .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function sumarCategoria(mapa, valorCrudo, inc = 1) {
    const limpio = limpiarEspacios(valorCrudo);
    if (!limpio) return null;
    const clave = limpio.toLowerCase();
    if (!mapa[clave]) mapa[clave] = { label: limpio, total: 0 };
    mapa[clave].total += inc;
    return clave;
}

export function fechaAClaveISO(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

export function fechaDDMMYYYY(date) {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

export function hoyDDMMYYYY() {
    return fechaDDMMYYYY(new Date());
}

export function nowPeru() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }));
}

export function formato12h(hhmm) {
    if (!hhmm || hhmm === '—') return '—';
    const [h, m] = hhmm.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return '—';
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function formatearFecha(valor) {
    if (!valor) return '';
    const fecha = new Date(valor);
    if (isNaN(fecha.getTime())) return String(valor);
    const dd = String(fecha.getDate()).padStart(2, '0');
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    const yyyy = fecha.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

export function parsearHistorial(raw) {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

export function getEspecializacionETU(carrera) {
    const norm = normalizarTexto(carrera);
    const clave = Object.keys(CARRERAS_ETU).find(k => normalizarTexto(k) === norm);
    return clave ? CARRERAS_ETU[clave] : '';
}

export function cacheGet(key) {
    const data = sessionStorage.getItem(key);
    if (!data) return null;
    try { return JSON.parse(data); } catch { return null; }
}

export function cacheSet(key, value) {
    try {
        sessionStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.warn('cacheSet: no se pudo guardar en sessionStorage', key, e);
    }
}

export function cacheRemove(key) {
    sessionStorage.removeItem(key);
}

export function getCurrentUser() {
    return cacheGet(CACHE_KEYS.USER);
}

export function setUser(user) {
    cacheSet(CACHE_KEYS.USER, user);
}

export function getSessionToken() {
    const user = getCurrentUser();
    return user ? (user.token || '') : '';
}

export function getUserCampanas() {
    const user = getCurrentUser();
    if (!user || !user.campanas) return [];
    if (Array.isArray(user.campanas)) return user.campanas.map(c => String(c).trim());
    if (typeof user.campanas === 'string') return user.campanas.split(',').map(c => c.trim()).filter(Boolean);
    return [];
}

export function normalizarUrlFoto(foto) {
    const url = String(foto || '').trim();
    if (!url) return '';
    if (/^(https?:)?\/\//i.test(url) || /^data:/i.test(url)) return url;
    return 'https://' + url;
}

export function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function getIP() {
    try {
        const r = await fetch('https://api.ipify.org?format=json');
        return (await r.json()).ip;
    } catch (e) {
        return '0.0.0.0';
    }
}