import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody } from '../types';
import { exigirSesion } from '../lib/session';

export async function searchLeads(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const campana = String(body.campana || '').trim();
  const searchType = String(body.searchType || '').trim();
  const searchValue = String(body.searchValue || '').trim();
  if (!campana || !searchType || !searchValue) return jsonError('Faltan parámetros de búsqueda.');

  const columnaPorTipo: Record<string, string> = {
    nombre: 'nombres',
    dni: 'numero_documento',
    celular: 'telefono2',
  };
  const columna = columnaPorTipo[searchType];
  if (!columna) return jsonError('searchType inválido.');

  // A diferencia de Sheets, aquí no hace falta buscar por separado en "base"
  // y en "bottom": los leads que solo existen por referencia (en_base=false,
  // ej. creados por el scraper de hoy) ya están en la misma tabla "leads".
  const result = await client.query(
    `select id_prometeo, nombres, numero_documento, telefono2, en_base
     from leads
     where campana = $1 and ${columna} ilike '%' || $2 || '%'
     order by en_base desc, nombres nulls last
     limit 50`,
    [campana, searchValue]
  );

  const data = result.rows.map((r) => ({
    'ID PROMETEO': r.id_prometeo,
    ID_PROMETEO: r.id_prometeo,
    NOMBRES: r.nombres || (r.en_base ? '' : '[Sin nombre registrado]'),
    'NUMERO DE DOCUMENTO': r.numero_documento || '',
    'TELEFONO 2': r.telefono2 || '',
    activo: r.en_base,
  }));

  return jsonOk({ data });
}
