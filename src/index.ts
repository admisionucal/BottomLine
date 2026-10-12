import { getClient } from './lib/db';
import { jsonError, type Env } from './types';
import { login, logout } from './routes/auth';
import {
  marcarAsistencia,
  getAsistenciaRegistroHoy,
  getAsistenciaRegistros,
  getAsistenciaEmpleados,
  actualizarEstadoAsesor,
  actualizarCampanasAsesor,
} from './routes/asistencia';
import { getLeads } from './routes/leads';
import { getLeadDetail, generarPropuestaIA } from './routes/leadDetail';
import { saveBottom, addComment } from './routes/bottom';
import { getCatalogos } from './routes/catalogos';
import { obtenerBottomParaCC } from './routes/obtenerBottomParaCC';
import { getLeadPayments } from './routes/leadPayments';
import { getResumenVpPp } from './routes/resumenVpPp';
import { searchLeads } from './routes/searchLeads';
import { unifyIds } from './routes/unifyIds';
import { actualizarLeadsHoy } from './routes/leadsHoy';
import { actualizarLeadsBase } from './routes/leadsBase';
import {
  getSolicitudPendiente,
  createSolicitud,
  resolveSolicitud,
  cancelarSolicitud,
} from './routes/solicitudes';
import { getSolicitudesCC, getSolicitudCC, getSolicitudesCCCount } from './routes/solicitudesCCRead';
import { actualizarSolicitudCC } from './routes/solicitudCCDualWrite';
import {
  getCampanasConfig,
  guardarCampana,
  toggleCampanaActiva,
  subirArchivoCampana,
  eliminarArchivoCampana,
  obtenerArchivoCampanaBase64,
} from './routes/campanas';
import { getSupervisoresConfig, crearUsuario } from './routes/usuarios';
import {
  getEvaluaciones,
  getEstadoEvaluacion,
  guardarIntentoEvaluacion,
  getResultadosEvaluacion,
  getDetalleIntentoEvaluacion,
  guardarVentanaEvaluacion,
  getAsignacionesEvaluacion,
  guardarAsignacionesEvaluacion,
} from './routes/evaluaciones';
import {
  simGetPanel,
  simIniciar,
  simEnviar,
  simFinalizar,
  simAbandonar,
  simDetalle,
  simResultados,
  simGetEscenarios,
  simGuardarEscenario,
  simGetAsignaciones,
  simGuardarAsignaciones,
} from './routes/simulador';
import { getPropuestaAbordaje, generarPropuestaAbordajeAhora } from './routes/propuestas';
import { generarPropuestasProgramadas } from './lib/propuestaAbordaje';

const ACCIONES_LOCALES: Record<string, (client: any, body: any, env: Env, ctx: ExecutionContext) => Promise<Response>> = {
  login,
  logout,
  marcarAsistencia,
  getAsistenciaRegistroHoy,
  getAsistenciaRegistros,
  getAsistenciaEmpleados,
  actualizarEstadoAsesor,
  actualizarCampanasAsesor,
  getLeads,
  getLeadDetail,
  generarPropuestaIA,
  saveBottom,
  addComment,
  getCatalogos,
  obtenerBottomParaCC,
  getLeadPayments,
  getResumenVpPp,
  searchLeads,
  unifyIds,
  getSolicitudPendiente,
  createSolicitud,
  resolveSolicitud,
  cancelarSolicitud,
  getSolicitudesCC,
  getSolicitudCC,
  getSolicitudesCCCount,
  actualizarSolicitudCC,
  actualizarLeadsHoy,
  actualizarLeadsBase,
  getCampanasConfig,
  guardarCampana,
  toggleCampanaActiva,
  subirArchivoCampana,
  eliminarArchivoCampana,
  obtenerArchivoCampanaBase64,
  getSupervisoresConfig,
  crearUsuario,
  getEvaluaciones,
  getEstadoEvaluacion,
  guardarIntentoEvaluacion,
  getResultadosEvaluacion,
  getDetalleIntentoEvaluacion,
  guardarVentanaEvaluacion,
  getAsignacionesEvaluacion,
  guardarAsignacionesEvaluacion,
  simGetPanel,
  simIniciar,
  simEnviar,
  simFinalizar,
  simAbandonar,
  simDetalle,
  simResultados,
  simGetEscenarios,
  simGuardarEscenario,
  simGetAsignaciones,
  simGuardarAsignaciones,
  getPropuestaAbordaje,
  generarPropuestaAbordajeAhora,
};

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const client = await getClient(env);
        try {
          const r = await generarPropuestasProgramadas(client as any, env);
          console.log('Propuestas de abordaje generadas:', JSON.stringify(r));
        } catch (err: any) {
          console.error('Error generando propuestas de abordaje:', err?.message || err);
        } finally {
          await client.end();
        }
      })()
    );
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/ping') {
      const client = await getClient(env);
      try {
        const r = await client.query('select now() as ahora');
        return Response.json({ success: true, hora_servidor: r.rows[0].ahora });
      } finally {
        await client.end();
      }
    }

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
          return await handler(client, body, env, ctx);
        } catch (err: any) {
          return jsonError('Error interno: ' + err.message, 500);
        } finally {
          await client.end();
        }
      }

      if (!ACCIONES_APPS_SCRIPT.has(action)) {
        return jsonError('Acción desconocida: ' + action);
      }
      return proxyAAppsScript(request, body, env);
    }

    return env.ASSETS.fetch(request);
  },
};

const ACCIONES_APPS_SCRIPT = new Set([
  'solicitarCC',
  'cancelarSolicitudCC',
  'enviarCC',
  'generarPreviewPDF',
  'rechazarCC',
]);

async function proxyAAppsScript(originalRequest: Request, body: any, env: Env): Promise<Response> {
  const resp = await fetch(env.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  return new Response(text, {
    status: resp.status,
    headers: { 'Content-Type': 'application/json' },
  });
}