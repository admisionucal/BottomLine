// API ===============================================

/** Ejecuta una acción en el backend. Adjunta automáticamente el token de sesión
 *  (si existe) para que el backend pueda validar quién hace la llamada. */
async function callAPI(action, data = {}) {
  try {
    const sessionToken = (typeof getSessionToken === 'function') ? getSessionToken() : '';
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action, sessionToken, ...data })
    });
    return await response.json();
  } catch (error) {
    console.error('API Error:', error);
    return { success: false, error: error.message };
  }
}

// AUTENTICACIÓN Y CATÁLOGOS ==================================

/** Login de usuario */
async function login(email, password) {
  return await callAPI('login', { email, password });
}

/** Obtiene catálogos (boletas, beneficios) */
async function getCatalogos() {
  return await callAPI('getCatalogos');
}

// LEADS ======================================================

/** Obtiene lista de leads con filtros */
async function getLeads(email, rol, campana, filtros = {}) {
  if (rol === 'ADMIN') {
    return await callAPI('getLeadsConAprobacion', { email, campana, filtros });
  }
  return await callAPI('getLeads', { 
    email, 
    rol, 
    campana, 
    filtros, 
    nombreAsesor: getUserNombreAsesor() 
  });
}

/** Obtiene detalle de un lead (con caché por usuario) */
async function getLeadDetail(id, campana, email, rol) {
  const cacheKey = `bl_detail_${id}_${campana}_${email}`;
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) return JSON.parse(cached);

  const result = await callAPI('getLeadDetail', { id, campana, email, rol });
  if (result.success) {
    sessionStorage.setItem(cacheKey, JSON.stringify(result));
  }
  return result;
}

/** Obtiene pagos de un lead (con caché) */
async function getLeadPayments(idPrometeo, campana) {
  const cacheKey = `bl_payments_${idPrometeo}_${campana}`;
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) return JSON.parse(cached);

  const result = await callAPI('getLeadPayments', { idPrometeo, campana });
  if (result.success) {
    sessionStorage.setItem(cacheKey, JSON.stringify(result));
  }
  return result;
}

// GESTIÓN BOTTOM ==============================================

/** Guarda/actualiza datos de gestión de un lead */
async function saveBottom(idPrometeo, campana, data, asesorEmail) {
  return await callAPI('saveBottom', { idPrometeo, campana, data, asesorEmail });
}

/** Agrega un comentario al historial del lead */
async function addComment(id, campana, comentario, usuario, asesorEmail) {
  return await callAPI('addComment', { id, campana, comentario, usuario, asesorEmail });
}

// BÚSQUEDA Y UNIFICACIÓN =====================================

/** Busca leads por nombre, DNI o celular */
async function searchLeads(campana, searchType, searchValue) {
  return await callAPI('searchLeads', { campana, searchType, searchValue });
}

/** Unifica múltiples IDs en uno principal (solo ADMIN) */
async function unifyIds(idPrincipal, idsSecundarios, campana, datosPredominantes, adminEmail) {
  return await callAPI('unifyIds', { 
    idPrincipal, 
    idsSecundarios, 
    campana, 
    datosPredominantes, 
    adminEmail 
  });
}

// SOLICITUDES DE CAMBIO DE BOLETA ============================

/** Crea una solicitud de cambio de escala */
/** Crea una solicitud de cambio de escala.
 *  Recibe el payload ya armado por lead-detail.js (idPrometeo, campana, asesorEmail,
 *  asesorNombre, boletaActual, beneficioActual, boletaConBecaActual, boletaSolicitada,
 *  beneficioSolicitado, boletaConBecaSolicitada) y lo reenvía tal cual — antes esta
 *  función esperaba parámetros posicionales que no coincidían con cómo se la llamaba,
 *  por lo que ID_PROMETEO y CAMPANA llegaban corruptos/vacíos al backend. */
async function createSolicitud(payload) {
  return await callAPI('createSolicitud', payload);
}

/** Resuelve una solicitud (APROBADO/RECHAZADO) */
async function resolveSolicitud(id, status, adminEmail) {
  return await callAPI('resolveSolicitud', { id, status, adminEmail });
}

/** Obtiene solicitudes pendientes de una campaña */
async function getSolicitudesPendientesCampana(campana) {
  return await callAPI('getSolicitudesPendientesCampana', { campana });
}

/** Obtiene la solicitud pendiente (si existe) de un lead específico.
 *  NOTA: esta función faltaba por completo — lead-detail.js la llamaba
 *  sin que existiera, por lo que cargarSolicitudPendiente() nunca funcionaba. */
async function getSolicitudPendiente(idPrometeo, campana) {
  return await callAPI('getSolicitudPendiente', { idPrometeo, campana });
}

async function cancelarSolicitud(idSolicitud) {
  return await callAPI('cancelarSolicitud', { id: idSolicitud });
}