import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody } from '../types';
import { exigirSesion } from '../lib/session';
import { saveBottom } from './bottom';

function esRolSupervisorOAdmision(rol: string) {
  return rol === 'SUPERVISOR' || rol === 'ADMISION';
}

function filaASolicitudObj(r: any) {
  return {
    ID_SOLICITUD: r.id_solicitud,
    ID_PROMETEO: r.id_prometeo,
    CAMPANA: r.campana,
    ASESOR_EMAIL: r.asesor_email,
    ASESOR_NOMBRE: r.asesor_nombre,
    BOLETA_ACTUAL: r.boleta_actual,
    BENEFICIO_ACTUAL: r.beneficio_actual,
    BOLETA_CON_BECA_ACTUAL: r.boleta_con_beca_actual,
    BOLETA_SOLICITADA: r.boleta_solicitada,
    BENEFICIO_SOLICITADO: r.beneficio_solicitado,
    BOLETA_CON_BECA_SOLICITADA: r.boleta_con_beca_solicitada,
    STATUS: r.status,
    FECHA_SOLICITUD: r.fecha_solicitud,
    FECHA_RESOLUCION: r.fecha_resolucion,
    ADMIN_EMAIL: r.admin_email,
  };
}

export async function getSolicitudPendiente(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ASESOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const idPrometeo = String(body.idPrometeo || '').trim();
  const campana = String(body.campana || '').trim();

  const result = await client.query(
    `select * from solicitudes
     where id_prometeo = $1 and campana = $2 and status in ('PENDIENTE', 'RECHAZADO')
     order by fecha_solicitud desc limit 1`,
    [idPrometeo, campana]
  );

  return jsonOk({ data: result.rows[0] ? filaASolicitudObj(result.rows[0]) : null });
}

export async function getSolicitudesPendientesCampana(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const campana = String(body.campana || '').trim();

  const result = await client.query(
    `select * from solicitudes where campana = $1 and status = 'PENDIENTE' order by fecha_solicitud desc`,
    [campana]
  );

  return jsonOk({ data: result.rows.map(filaASolicitudObj) });
}

export async function createSolicitud(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ASESOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  if (!body.boletaActual || String(body.boletaActual).trim() === '') {
    return jsonError('Debes guardar la boleta del lead antes de solicitar una recategorización.');
  }

  const asesorEmail = esRolSupervisorOAdmision(sesion.rol) ? body.asesorEmail || sesion.email : sesion.email;
  const asesorNombre = esRolSupervisorOAdmision(sesion.rol) ? body.asesorNombre || sesion.nombre : sesion.nombre;

  const idSolicitud = crypto.randomUUID();

  try {
    await client.query(
      `insert into solicitudes (
         id_solicitud, id_prometeo, campana, asesor_email, asesor_nombre,
         boleta_actual, beneficio_actual, boleta_con_beca_actual,
         boleta_solicitada, beneficio_solicitado, boleta_con_beca_solicitada,
         status
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PENDIENTE')`,
      [
        idSolicitud,
        body.idPrometeo,
        body.campana,
        asesorEmail,
        asesorNombre || '',
        body.boletaActual,
        body.beneficioActual,
        body.boletaConBecaActual,
        body.boletaSolicitada,
        body.beneficioSolicitado,
        body.boletaConBecaSolicitada,
      ]
    );
  } catch (e: any) {
    // Código 23505 = unique_violation -> chocó con el índice único parcial
    // (ya hay una solicitud PENDIENTE para este lead).
    if (e.code === '23505') {
      return jsonError('Ya existe una solicitud pendiente para este lead.');
    }
    throw e;
  }

  return jsonOk({ idSolicitud });
}

export async function resolveSolicitud(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const id = String(body.id || '').trim();
  const nuevoStatus = String(body.status || '').trim();
  if (!id || !nuevoStatus) return jsonError('Falta id o status.');

  const result = await client.query(
    `update solicitudes set status = $1, fecha_resolucion = now(), admin_email = $2
     where id_solicitud = $3
     returning *`,
    [nuevoStatus, sesion.email, id]
  );

  const solicitud = result.rows[0];
  if (!solicitud) return jsonError('Solicitud no encontrada');

  if (nuevoStatus === 'APROBADO') {
    // Igual que resolveSolicitudInterno real: aplica lo solicitado directo
    // sobre la ficha del lead, reusando el mismo saveBottom ya migrado.
    await saveBottom(client, {
      idPrometeo: solicitud.id_prometeo,
      campana: solicitud.campana,
      sessionToken: body.sessionToken,
      asesorEmail: solicitud.asesor_email,
      data: {
        BOLETA: solicitud.boleta_solicitada,
        BENEFICIO: solicitud.beneficio_solicitado,
        BOLETA_CON_BECA: solicitud.boleta_con_beca_solicitada,
      },
    });
  }

  return jsonOk();
}

export async function cancelarSolicitud(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ASESOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const id = String(body.id || '').trim();
  const actual = await client.query(`select asesor_email, status from solicitudes where id_solicitud = $1`, [id]);
  const fila = actual.rows[0];
  if (!fila) return jsonError('Solicitud no encontrada');

  const esDueno = String(fila.asesor_email || '').trim().toLowerCase() === sesion.email.trim().toLowerCase();
  if (!esRolSupervisorOAdmision(sesion.rol) && !esDueno) {
    return jsonError('No puedes cancelar una solicitud que no es tuya');
  }
  if (fila.status !== 'PENDIENTE') {
    return jsonError('Esta solicitud ya fue resuelta y no se puede cancelar');
  }

  await client.query(`update solicitudes set status = 'CANCELADO', fecha_resolucion = now() where id_solicitud = $1`, [
    id,
  ]);

  return jsonOk();
}
