// ================================================================
// DUPLICADOS SUGERIDOS - Detecta candidatos a unificar reutilizando
// la misma búsqueda de Unificar IDs (por DNI, con celular de respaldo)
// ================================================================
import { COLUMNAS } from '../core/constants.js';
import { buscarLeads } from './unificar-core.js';

const cache = new Map();

export async function buscarDuplicados({ idPrometeo, dni, celular }) {
    const searchType = dni ? 'dni' : (celular ? 'celular' : null);
    const searchValue = dni || celular;
    if (!searchType || !searchValue) return [];

    const cacheKey = `${searchType}:${searchValue}`;
    let data = cache.get(cacheKey);
    if (!data) {
        data = await buscarLeads({ searchType, searchValue, campana: 'TODAS' });
        cache.set(cacheKey, data);
    }
    return data.filter(r => String(r[COLUMNAS.ID_PROMETEO] || '') !== String(idPrometeo));
}