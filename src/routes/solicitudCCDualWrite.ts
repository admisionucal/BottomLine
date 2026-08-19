import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody, type Env } from '../types';

// Mapea las claves que manda code.gs (headers reales de SOLICITUDES_CC) a columnas.
const MAPEO_CC: Record<string, string> = {
  ID_SOLICITUD: 'id_solicitud',
  FECHA_SOLICITUD: 'fecha_solicitud',
  CAMPANA: 'campana',
  ID_PROMETEO: 'id_prometeo',
  ASESOR_EMAIL: 'asesor_email',
  ASESOR_NOMBRE: 'asesor_nombre',
  CORREOS_ADICIONALES: 'correos_adicionales',
  DNI_FILE_ID: 'dni_file_id',
  DNI_FILE_NOMBRE: 'dni_file_nombre',
  CERTIFICADO_FILE_ID: 'certificado_file_id',
  CERTIFICADO_FILE_NOMBRE: 'certificado_file_nombre',
  BOLETA_PROCEDENCIA_FILE_ID: 'boleta_procedencia_file_id',
  BOLETA_PROCEDENCIA_FILE_NOMBRE: 'boleta_procedencia_file_nombre',
  STATUS: 'status',
  FECHA_RESOLUCION: 'fecha_resolucion',
  ADMIN_EMAIL: 'admin_email',
  MOTIVO_RECHAZO: 'motivo_rechazo',
  TIPO_REFERIDO: 'tipo_referido',
  PERSONAS_REFERIDO_JSON: 'personas_referido_json',
  HISTORIAL_ENVIOS: 'historial_envios',
};

// Este endpoint no usa sesión de usuario (lo llama code.gs server-to-server),
// se protege con el mismo secreto compartido que actualizarLeadsHoy/Base.
export async function actualizarSolicitudCC(client: Client, body: JsonBody, env: Env) {
  if (!env.IMPORT_SECRET || body.secret !== env.IMPORT_SECRET) {
    return jsonError('No autorizado.', 401);
  }

  const solicitud = body.solicitud || {};
  const idSolicitud = String(solicitud.ID_SOLICITUD || '').trim();
  if (!idSolicitud) return jsonError('Falta ID_SOLICITUD.');

  const columnas: string[] = [];
  const valores: any[] = [];

  for (const [claveSheet, colPg] of Object.entries(MAPEO_CC)) {
    if (colPg === 'id_solicitud') continue;
    if (Object.prototype.hasOwnProperty.call(solicitud, claveSheet)) {
      columnas.push(colPg);
      valores.push(solicitud[claveSheet] === '' ? null : solicitud[claveSheet]);
    }
  }

  if (columnas.length === 0) return jsonError('No hay campos para guardar.');

  const placeholders = columnas.map((_, i) => `$${i + 2}`);
  const sets = columnas.map((c, i) => `${c} = $${i + 2}`);

  try {
    await client.query(
      `insert into solicitudes_cc (id_solicitud, ${columnas.join(', ')})
       values ($1, ${placeholders.join(', ')})
       on conflict (id_solicitud) do update set
         ${sets.join(', ')}, actualizado_en = now()`,
      [idSolicitud, ...valores]
    );
  } catch (e: any) {
    return jsonError('Error al guardar: ' + e.message, 500);
  }

  return jsonOk();
}
