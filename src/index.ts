import { getClient } from './lib/db';
import { jsonError, type Env } from './types';
import { login, logout } from './routes/auth';
import {
  marcarAsistencia,
  getAsistenciaRegistroHoy,
  getAsistenciaRegistros,
  getAsistenciaEmpleados,
} from './routes/asistencia';
import { getLeads } from './routes/leads';
import { getLeadDetail } from './routes/leadDetail';
import { saveBottom, addComment } from './routes/bottom';
import { getCatalogos } from './routes/catalogos';
import { getLeadPayments } from './routes/leadPayments';
import { getResumenVpPp } from './routes/resumenVpPp';
import { searchLeads } from './routes/searchLeads';
import { unifyIds } from './routes/unifyIds';
import { actualizarLeadsHoy } from './routes/leadsHoy';
import { actualizarLeadsBase } from './routes/leadsBase';
import {
  getSolicitudPendiente,
  getSolicitudesPendientesCampana,
  createSolicitud,
  resolveSolicitud,
  cancelarSolicitud,
} from './routes/solicitudes';
import { getSolicitudesCC, getSolicitudCC, getSolicitudesCCCount } from './routes/solicitudesCCRead';
import { actualizarSolicitudCC } from './routes/solicitudCCDualWrite';
import { exigirSesion } from './lib/session';
import { jsonError } from './types';

// Igual que getLeadsConAprobacion(body) en code.gs: mismo getLeads, pero
// solo accesible para SUPERVISOR/ADMISION.
async function getLeadsConAprobacion(client: any, body: any, env: Env) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);
  return getLeads(client, body);
}

// Acciones ya migradas a Postgres. Todo lo que NO esté aquí se reenvía
// automáticamente a tu Apps Script actual (fallback transparente).
const ACCIONES_LOCALES: Record<string, (client: any, body: any, env: Env) => Promise<Response>> = {
  login,
  logout,
  marcarAsistencia,
  getAsistenciaRegistroHoy,
  getAsistenciaRegistros,
  getAsistenciaEmpleados,
  getLeads,
  getLeadsConAprobacion,
  getLeadDetail,
  saveBottom,
  addComment,
  getCatalogos,
  getLeadPayments,
  getResumenVpPp,
  searchLeads,
  unifyIds,
  getSolicitudPendiente,
  getSolicitudesPendientesCampana,
  createSolicitud,
  resolveSolicitud,
  cancelarSolicitud,
  getSolicitudesCC,
  getSolicitudCC,
  getSolicitudesCCCount,
  actualizarSolicitudCC,
  actualizarLeadsHoy,
  actualizarLeadsBase,
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Prueba de humo de la Fase 1 (la dejamos, no estorba).
    if (url.pathname === '/api/ping') {
      const client = await getClient(env);
      try {
        const r = await client.query('select now() as ahora');
        return Response.json({ success: true, hora_servidor: r.rows[0].ahora });
      } finally {
        await client.end();
      }
    }

    // Único endpoint de la app, mismo contrato que tu doPost actual.
    if (url.pathname === '/api' && request.method === 'POST') {
      let body: any;
      try {
        body = await request.json();
      } catch {
        return jsonError('Body inválido, se esperaba JSON.');
      }

      const action = body?.action;
      const handler = ACCIONES_LOCALES[action];

      if (handler) {
        const client = await getClient(env);
        try {
          return await handler(client, body, env);
        } catch (err: any) {
          return jsonError('Error interno: ' + err.message, 500);
        } finally {
          await client.end();
        }
      }

      // Fallback: acción todavía no migrada -> se reenvía tal cual a Apps Script.
      return proxyAAppsScript(request, body, env);
    }

    // Cualquier otra ruta: sitio estático, igual que siempre.
    return env.ASSETS.fetch(request);
  },
};

async function proxyAAppsScript(originalRequest: Request, body: any, env: Env): Promise<Response> {
  const resp = await fetch(env.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // Se reenvía la respuesta de Apps Script tal cual, para que el frontend
  // no note ninguna diferencia entre acciones locales y las reenviadas.
  const text = await resp.text();
  return new Response(text, {
    status: resp.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
