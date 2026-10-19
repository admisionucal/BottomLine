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

  const ultima = await client.query(
    `select * from solicitudes
     where id_prometeo = $1 and campana = $2 and status in ('PENDIENTE', 'RECHAZADO', 'APROBADO')
     order by fecha_solicitud desc limit 1`,
    [idPrometeo, campana]
  );
  const fila = ultima.rows[0];
  const data = fila && (fila.status === 'PENDIENTE' || fila.status === 'RECHAZADO') ? filaASolicitudObj(fila) : null;

  const aprobada = await client.query(
    `select s.*, coalesce(nullif(u.nombre_aux, ''), u.nombre, s.admin_email) as admin_nombre
     from solicitudes s
     left join usuarios u on lower(u.email) = lower(s.admin_email)
     where s.id_prometeo = $1 and s.campana = $2 and s.status = 'APROBADO'
     order by s.fecha_resolucion desc nulls last limit 1`,
    [idPrometeo, campana]
  );
  const a = aprobada.rows[0];

  return jsonOk({
    data,
    aprobada: a ? { ...filaASolicitudObj(a), ADMIN_NOMBRE: a.admin_nombre || a.admin_email } : null,
  });
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
  const nuevoStatus = String(body.status || '').trim().toUpperCase();
  if (!id) return jsonError('Falta id de la solicitud.');
  if (nuevoStatus !== 'APROBADO' && nuevoStatus !== 'RECHAZADO') return jsonError('Estado inválido.');

  const previa = await client.query(`select * from solicitudes where id_solicitud = $1`, [id]);
  const pendiente = previa.rows[0];
  if (!pendiente) return jsonError('Solicitud no encontrada');
  if (pendiente.status !== 'PENDIENTE') return jsonError('Esta solicitud ya fue resuelta o cancelada.');
  if (nuevoStatus === 'APROBADO' && String(pendiente.asesor_email || '').trim().toLowerCase() === sesion.email.trim().toLowerCase()) {
    return jsonError('No puedes aprobar una solicitud hecha por ti. Debe aprobarla otro supervisor o Admisión.');
  }

  const result = await client.query(
    `update solicitudes set status = $1, fecha_resolucion = now(), admin_email = $2
     where id_solicitud = $3 and status = 'PENDIENTE'
     returning *`,
    [nuevoStatus, sesion.email, id]
  );
  const solicitud = result.rows[0];
  if (!solicitud) return jsonError('Esta solicitud ya fue resuelta o cancelada.');

  if (nuevoStatus === 'APROBADO') {
    const filaBottom = (
      await client.query(
        `select asesor_email, admision_final, matricula_final, beneficio_adicional from leads_bottom
         where id_prometeo = $1 and campana = $2
         order by fecha_ult_modificacion desc nulls last limit 1`,
        [solicitud.id_prometeo, solicitud.campana]
      )
    ).rows[0];

    const data: Record<string, any> = {
      BOLETA: solicitud.boleta_solicitada,
      BENEFICIO: solicitud.beneficio_solicitado,
      BOLETA_CON_BECA: solicitud.boleta_con_beca_solicitada,
      ESTADO_APROBACION: 'RECATEGORIZACION_APROBADA',
      APROBADO_POR: sesion.nombre || sesion.email,
      FECHA_APROBACION: new Date().toISOString(),
    };
    const boletaFinal = calcularBoletaFinal(filaBottom, solicitud.boleta_con_beca_solicitada || solicitud.boleta_solicitada);
    if (boletaFinal !== null) data.BOLETA_FINAL = boletaFinal;

    const r = await saveBottom(client, {
      idPrometeo: solicitud.id_prometeo,
      campana: solicitud.campana,
      sessionToken: body.sessionToken,
      asesorEmail: filaBottom?.asesor_email || solicitud.asesor_email,
      data,
    });
    const respuesta: any = await r.json().catch(() => ({ success: false }));
    if (!respuesta?.success) {
      await client.query(
        `update solicitudes set status = 'PENDIENTE', fecha_resolucion = null, admin_email = ''
         where id_solicitud = $1`,
        [id]
      );
      return jsonError('No se pudo aplicar la nueva boleta al lead: ' + (respuesta?.error || 'error desconocido') + '. La solicitud sigue pendiente.');
    }
  }

  return jsonOk();
}

function numero(v: any): number {
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function calcularBoletaFinal(fila: any, boletaAPagarRaw: any): number | null {
  if (!fila || fila.admision_final === null || fila.admision_final === undefined || String(fila.admision_final).trim() === '') return null;
  const boletaAPagar = numero(boletaAPagarRaw);
  const [valorStr, modoRaw] = String(fila.beneficio_adicional || '0').split('||');
  const valor = numero(valorStr);
  const modo = String(modoRaw || 'PORCENTAJE').toUpperCase();
  const descuentoAdicional =
    modo === 'EXACTO' ? boletaAPagar - valor
    : modo === 'FIJO' ? valor
    : modo === 'CICLO' ? boletaAPagar * 5 * (valor / 100)
    : boletaAPagar * (valor / 100);
  return +(numero(fila.admision_final) + numero(fila.matricula_final) + boletaAPagar - +descuentoAdicional.toFixed(2)).toFixed(2);
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
