import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody, type Env } from '../types';

export async function obtenerBottomParaCC(client: Client, body: JsonBody, env: Env) {
  if (!env.IMPORT_SECRET || body.secret !== env.IMPORT_SECRET) {
    return jsonError('No autorizado.', 401);
  }

  const idPrometeo = String(body.idPrometeo || '').trim();
  const campana = String(body.campana || '').trim();
  if (!idPrometeo || !campana) return jsonError('Falta idPrometeo o campaña.');

  const asesorEmail = String(body.asesorEmail || '').trim();
  const result = await client.query(
    `select * from leads_bottom
     where id_prometeo = $1 and campana = $2
     order by (asesor_email = $3) desc, actualizado_en desc
     limit 1`,
    [idPrometeo, campana, asesorEmail]
  );

  const row = result.rows[0];
  if (!row) return jsonOk({ data: {} });

  const OMITIR = new Set(['id_prometeo', 'campana', 'creado_en', 'comentarios_historial']);
  const data: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    if (OMITIR.has(k)) continue;
    data[k.toUpperCase()] = v;
  }

  return jsonOk({ data });
}