// ================================================================
// UNIFICAR CORE - Lógica de unificación reutilizable (sin DOM)
// ================================================================
import { API_URL } from '../core/constants.js';
import { getSessionToken } from '../core/utils.js';

async function callAPI(action, data = {}) {
    const payload = { action, sessionToken: getSessionToken(), ...data };
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

export async function buscarLeads({ searchType, searchValue, campana = 'TODAS' }) {
    const result = await callAPI('searchLeads', { searchType, searchValue, campana });
    return (result && result.success) ? (result.data || []) : [];
}

export async function unificarLeads({ idPrincipal, campanaPrincipal, idsSecundarios, datosPredominantes, adminEmail }) {
    const payload = { idPrincipal, campanaPrincipal, idsSecundarios, datosPredominantes, adminEmail };
    let result = await callAPI('unifyIds', payload);
    if (result && result.requiereConfirmacion) {
        const seguir = confirm(result.error + '\n\n¿Deseas continuar de todas formas?');
        if (!seguir) return { success: false, cancelado: true };
        result = await callAPI('unifyIds', { ...payload, confirmado: true });
    }
    return result;
}