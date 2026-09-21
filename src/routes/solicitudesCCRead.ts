import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody } from '../types';
import { exigirSesion } from '../lib/session';

function filaASolicitudCCObj(r: any) {
  return {
    ID_SOLICITUD: r.id_solicitud,
    FECHA_SOLICITUD: r.fecha_solicitud,
    CAMPANA: r.campana,
    ID_PROMETEO: r.id_prometeo,
    ASESOR_EMAIL: r.asesor_email,
    ASESOR_NOMBRE: r.asesor_nombre,
    CORREOS_ADICIONALES: r.correos_adicionales,
    DNI_FILE_ID: r.dni_file_id,
    DNI_FILE_NOMBRE: r.dni_file_nombre,
    CERTIFICADO_FILE_ID: r.certificado_file_id,
    CERTIFICADO_FILE_NOMBRE: r.certificado_file_nombre,
    BOLETA_PROCEDENCIA_FILE_ID: r.boleta_procedencia_file_id,
    BOLETA_PROCEDENCIA_FILE_NOMBRE: r.boleta_procedencia_file_nombre,
    STATUS: r.status,
    FECHA_RESOLUCION: r.fecha_resolucion,
    ADMIN_EMAIL: r.admin_email,
    MOTIVO_RECHAZO: r.motivo_rechazo,
    TIPO_REFERIDO: r.tipo_referido,
    PERSONAS_REFERIDO_JSON: r.personas_referido_json,
    HISTORIAL_ENVIOS: r.historial_envios,
  };
}

// Igual que capturarIdentidadBase() real, versión simplificada usando "leads".
async function capturarIdentidadBase(client: Client, campana: string, idPrometeo: string) {
  const r = await client.query(
    `select nombres, programa, modalidad, modalidad_ingreso, telefono2
     from leads where id_prometeo = $1 and campana = $2`,
    [idPrometeo, campana]
  );
  const row = r.rows[0];
  return {
    nombre: row?.nombres || '',
    carrera: row?.programa || '',
    modalidad: row?.modalidad || '',
    modalidadIngreso: row?.modalidad_ingreso || '',
    celular: row?.telefono2 || '',
  };
}

export async function getSolicitudesCC(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const params: any[] = [];
  const condiciones: string[] = [`s.status <> 'CANCELADO'`];

  if (sesion.rol === 'SUPERVISOR') {
    const campanasPermitidas = (body.campanas || []).map((c: any) => String(c).trim());
    if (campanasPermitidas.length > 0) {
      condiciones.push(`s.campana = any($${params.push(campanasPermitidas)})`);
    }
  }

  // Filtro por estados (ej. ['PENDIENTE','PROCESANDO'])
  if (Array.isArray(body.estados) && body.estados.length > 0) {
    condiciones.push(`s.status = any($${params.push(body.estados.map((e: any) => String(e)))})`);
  }

  // Una sola solicitud (para abrir el detalle sin bajar toda la lista)
  if (body.idSolicitud) {
    condiciones.push(`s.id_solicitud = $${params.push(String(body.idSolicitud))}`);
  }

  const result = await client.query(
    `select s.*,
            l.nombres as nombre_lead,
            l.programa as carrera_lead,
            l.modalidad as modalidad_lead,
            l.modalidad_ingreso as modalidad_ingreso_lead,
            l.telefono2 as celular_lead
       from solicitudes_cc s
       left join leads l on l.id_prometeo = s.id_prometeo and l.campana = s.campana
      where ${condiciones.join(' and ')}
      order by s.fecha_solicitud desc`,
    params
  );

  const data = result.rows.map((r) => ({
    ...filaASolicitudCCObj(r),
    NOMBRE_LEAD: r.nombre_lead || '',
    CARRERA_LEAD: r.carrera_lead || '',
    MODALIDAD_LEAD: r.modalidad_lead || '',
    MODALIDAD_INGRESO_LEAD: r.modalidad_ingreso_lead || '',
    CELULAR_LEAD: r.celular_lead || '',
  }));

  return jsonOk({ data });
}

export async function getSolicitudCC(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ASESOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const idPrometeo = String(body.idPrometeo || '').trim();
  const campana = String(body.campana || '').trim();

  const result = await client.query(
    `select * from solicitudes_cc
     where id_prometeo = $1 and campana = $2 and status <> 'CANCELADO'
     order by fecha_solicitud desc limit 1`,
    [idPrometeo, campana]
  );

  return jsonOk({ data: result.rows[0] ? filaASolicitudCCObj(result.rows[0]) : null });
}

export async function getSolicitudesCCCount(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const params: any[] = [];
  const condiciones: string[] = [`status = 'PENDIENTE'`];

  if (sesion.rol === 'SUPERVISOR') {
    const campanasPermitidas = (body.campanas || []).map((c: any) => String(c).trim());
    if (campanasPermitidas.length > 0) {
      condiciones.push(`campana = any($${params.push(campanasPermitidas)})`);
    }
  }

  const result = await client.query(
    `select count(*)::int as count from solicitudes_cc where ${condiciones.join(' and ')}`,
    params
  );

  return jsonOk({ count: result.rows[0].count });
}
