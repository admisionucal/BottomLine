import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody } from '../types';
import { exigirSesion } from '../lib/session';

export async function searchLeads(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  // La búsqueda no está limitada a una campaña — la unificación ya
  // no exige que principal y secundarios estén en la misma campaña.
  const campanaUnica = String(body.campana || '').trim();
  const campanasExplicitas: string[] = Array.isArray(body.campanas)
    ? body.campanas.map((c: any) => String(c).trim()).filter(Boolean)
    : [];
  const buscarTodas = campanaUnica.toUpperCase() === 'TODAS' || (campanasExplicitas.length === 0 && !campanaUnica && body.todasCampanas === true);

  const searchType = String(body.searchType || '').trim();
  const searchValue = String(body.searchValue || '').trim();
  if (!searchType || !searchValue) return jsonError('Faltan parámetros de búsqueda.');
  if (!buscarTodas && campanasExplicitas.length === 0 && !campanaUnica) return jsonError('Falta la campaña.');

  const columnaPorTipo: Record<string, string> = {
    nombre: 'nombres',
    dni: 'numero_documento',
    celular: 'telefono2',
  };
  const columna = columnaPorTipo[searchType];
  if (!columna) return jsonError('searchType inválido.');

  // A diferencia de Sheets, aquí no hace falta buscar por separado en "base"
  // y en "bottom": los leads que solo existen por referencia
  let where = `${columna} ilike '%' || $1 || '%'`;
  const params: any[] = [searchValue];

  if (!buscarTodas) {
    const campanas = campanasExplicitas.length > 0 ? campanasExplicitas : [campanaUnica];
    where += ` and campana = any($2::text[])`;
    params.push(campanas);
  }

  const result = await client.query(
    `select id_prometeo, campana, nombres, numero_documento, telefono2, en_base
     from leads
     where ${where}
     order by en_base desc, nombres nulls last
     limit 50`,
    params
  );

  const data = result.rows.map((r) => ({
    'ID PROMETEO': r.id_prometeo,
    ID_PROMETEO: r.id_prometeo,
    CAMPANA: r.campana,
    NOMBRES: r.nombres || (r.en_base ? '' : '[Sin nombre registrado]'),
    'NUMERO DE DOCUMENTO': r.numero_documento || '',
    'TELEFONO 2': r.telefono2 || '',
    activo: r.en_base,
  }));

  return jsonOk({ data });
}