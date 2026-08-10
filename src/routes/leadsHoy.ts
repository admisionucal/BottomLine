import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody, type Env } from '../types';

// Mapea las claves que manda actualizar_leads_hoy.gs (COLUMNAS_HOY) a columnas reales.
const MAPEO_HOY: Record<string, string> = {
  'NOMBRES': 'nombres',
  'TELEFONO 2': 'telefono2',
  'TELEFONO 3': 'telefono3',
  'EMAIL': 'email',
  'NOMBRE DEL COLEGIO': 'colegio',
  'CODIGO MODULAR': 'codigo_modular',
  'PROGRAMA': 'programa',
  'NUMERO DE DOCUMENTO': 'numero_documento',
  'MODALIDAD': 'modalidad',
  'MODALIDAD INGRESO': 'modalidad_ingreso',
  'BOLETA DE COLEGIO': 'boleta_colegio',
  'FECHA HORA DE REGISTRO': 'fecha_hora_registro',
  'ASESOR ULT TIP DF SN CONTC': 'asesor',
  'STATUS DE GESTION': 'status_gestion',
  'FECHA COMPROMISO DE PAGO': 'fecha_compromiso_pago',
};

// Este endpoint no usa sesión de usuario (lo llama un script server-to-server,
// no un navegador), así que se protege con un secreto compartido simple.
export async function actualizarLeadsHoy(client: Client, body: JsonBody, env: Env) {
  if (!env.IMPORT_SECRET || body.secret !== env.IMPORT_SECRET) {
    return jsonError('No autorizado.', 401);
  }

  const campana = String(body.campana || '').trim();
  const leads = Array.isArray(body.leads) ? body.leads : [];
  if (!campana || leads.length === 0) {
    return jsonError('Falta campaña o el arreglo de leads viene vacío.');
  }

  let actualizados = 0;
  let errores = 0;
  let primerError: string | null = null;

  for (const leadRaw of leads) {
    const idPrometeo = String(leadRaw['ID PROMETEO'] || '').trim();
    if (!idPrometeo) continue;

    const columnas: Record<string, any> = {};
    for (const [claveSheet, valor] of Object.entries(leadRaw)) {
      const colPg = MAPEO_HOY[claveSheet];
      if (colPg) columnas[colPg] = valor === '' ? null : valor;
    }

    const cols = Object.keys(columnas);
    // Solo 2 parámetros fijos preceden a las columnas aquí (idPrometeo=$1,
    // campana=$2), así que las columnas dinámicas empiezan en $3, no en $4.
    const sets = cols.map((c, i) => `${c} = $${i + 3}`);

    try {
      // Igual patrón que en la migración manual: si el lead no existe en la
      // base todavía, se crea un registro mínimo (en_base=false) para no
      // perder la actualización del scraper.
      await client.query(
        `insert into leads (id_prometeo, campana, en_base)
         values ($1, $2, false)
         on conflict (id_prometeo, campana) do nothing`,
        [idPrometeo, campana]
      );

      await client.query(
        `update leads set
           ${sets.length ? sets.join(', ') + ',' : ''}
           actualizado_hoy_en = now(),
           actualizado_en = now()
         where id_prometeo = $1 and campana = $2`,
        [idPrometeo, campana, ...cols.map((c) => columnas[c])]
      );
      actualizados++;
    } catch (e: any) {
      errores++;
      console.log(`Error actualizando lead ${idPrometeo}: ${e.message}`);
      if (!primerError) primerError = `ID ${idPrometeo}: ${e.message}`;
    }
  }

  return jsonOk({ actualizados, errores, total: leads.length, primerError });
}