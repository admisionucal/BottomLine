// ================================================================
// DUPLICADOS SUGERIDOS - Detecta candidatos a unificar reutilizando
// la misma búsqueda de Unificar IDs (por DNI, con celular de respaldo)
// ================================================================
import { COLUMNAS } from '../core/constants.js';
import { buscarLeads } from './unificar-core.js';

const cache = new Map();

// ===== Normalización =====
function normalizarDigitos(v) {
    return String(v || '').replace(/\D/g, '');
}

function normalizarTexto(v) {
    return String(v || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita tildes
        .replace(/\s+/g, ' ')
        .trim();
}

// ===== Similitud de nombres (distancia de Levenshtein normalizada) =====
function distanciaLevenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const costo = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + costo);
        }
    }
    return dp[m][n];
}

function similitudNombres(a, b) {
    const s1 = normalizarTexto(a);
    const s2 = normalizarTexto(b);
    if (!s1 || !s2) return 0;
    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return 1;
    return 1 - distanciaLevenshtein(s1, s2) / maxLen;
}

const UMBRAL_NOMBRE = 0.8; // 80% de similitud mínima

// ===== Búsqueda de duplicados =====
export async function buscarDuplicados({ idPrometeo, dni, celular, nombre }) {
    const criterios = [];
    if (dni) criterios.push({ tipo: 'dni', valor: dni, motivo: 'Mismo DNI' });
    if (celular) criterios.push({ tipo: 'celular', valor: celular, motivo: 'Mismo celular' });
    if (nombre) criterios.push({ tipo: 'nombre', valor: nombre, motivo: 'Nombre similar' });

    const mapa = new Map(); // id -> { data, motivos: Set }

    for (const c of criterios) {
        const cacheKey = `${c.tipo}:${c.valor}`;
        let data = cache.get(cacheKey);
        if (!data) {
            data = await buscarLeads({ searchType: c.tipo, searchValue: c.valor, campana: 'TODAS' });
            cache.set(cacheKey, data);
        }

        data.forEach(r => {
            const rid = String(r[COLUMNAS.ID_PROMETEO] || '');
            if (!rid || rid === String(idPrometeo)) return;

            let coincide = false;
            if (c.tipo === 'dni') {
                const a = normalizarDigitos(r[COLUMNAS.DNI]);
                const b = normalizarDigitos(c.valor);
                coincide = !!a && !!b && a === b;
            } else if (c.tipo === 'celular') {
                const a = normalizarDigitos(r[COLUMNAS.TELEFONO_2]);
                const b = normalizarDigitos(c.valor);
                coincide = !!a && !!b && a === b;
            } else if (c.tipo === 'nombre') {
                coincide = similitudNombres(r[COLUMNAS.NOMBRES], c.valor) >= UMBRAL_NOMBRE;
            }
            if (!coincide) return;

            if (!mapa.has(rid)) mapa.set(rid, { data: r, motivos: new Set() });
            mapa.get(rid).motivos.add(c.motivo);
        });
    }

    return Array.from(mapa.values()).map(v => ({ ...v.data, _motivos: Array.from(v.motivos) }));
}

export function limpiarCacheDuplicados() {
    cache.clear();
}