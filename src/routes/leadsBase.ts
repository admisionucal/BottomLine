import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody, type Env } from '../types';

// Mismo mapeo que usamos en el script manual de migración (migrar_leads.js).
const MAPEO_LEADS: Record<string, string> = {
  'ID PROMETEO': 'id_prometeo',
  'NOMBRES': 'nombres',
  'TELEFONO 2': 'telefono2',
  'TELEFONO 3': 'telefono3',
  'EMAIL': 'email',
  'NOMBRE DEL COLEGIO': 'colegio',
  'CODIGO MODULAR': 'codigo_modular',
  'CARRERA': 'programa',
  'PROGRAMA': 'programa',
  'NUMERO DE DOCUMENTO': 'numero_documento',
  'MODALIDAD': 'modalidad',
  'MODALIDAD INGRESO': 'modalidad_ingreso',
  'BOLETA DE COLEGIO': 'boleta_colegio',
  'FECHA HORA DE REGISTRO': 'fecha_hora_registro',
  'ASESOR ULT TIP DF SN CONTC': 'asesor',
  'STATUS DE GESTION': 'status_gestion',
  'FECHA COMPROMISO DE PAGO': 'fecha_compromiso_pago',
  '# DE VPs DIF TI INTE': 'vps_dif_ti_inte',
};

// Este endpoint se llama en varios lotes (chunks) desde Apps Script para un
// mismo import diario. `esUltimoChunk` indica cuándo ya se mandaron todas
// las filas, para recién ahí marcar en_base=false a los IDs que no vinieron.
export async function actualizarLeadsBase(client: Client, body: JsonBody, env: Env) {
  if (!env.IMPORT_SECRET || body.secret !== env.IMPORT_SECRET) {
    return jsonError('No autorizado.', 401);
  }

  const campana = String(body.campana || '').trim();
  const filas = Array.isArray(body.filas) ? body.filas : [];
  if (!campana) return jsonError('Falta campaña.');

  let procesados = 0;
  const idsDeEsteLote: string[] = [];
  let primerError: string | null = null;

  for (const fila of filas) {
    const idPrometeo = String(fila['ID PROMETEO'] || '').trim();
    if (!idPrometeo) continue;
    idsDeEsteLote.push(idPrometeo);

    const columnas: Record<string, any> = {};
    const extra: Record<string, any> = {};

    for (const [colSheet, valor] of Object.entries(fila)) {
      const colPg = MAPEO_LEADS[colSheet];
      if (colPg) {
        columnas[colPg] = valor === '' ? null : valor;
      } else if (colSheet !== 'ID PROMETEO') {
        extra[colSheet] = valor;
      }
    }

    const cols = Object.keys(columnas).filter((c) => c !== 'id_prometeo');
    const placeholders = cols.map((_, i) => `$${i + 4}`);
    const sets = cols.map((c, i) => `${c} = $${i + 4}`);

    try {
      await client.query(
        `insert into leads (id_prometeo, campana, en_base, extra, ${cols.join(', ')})
         values ($1, $2, true, $3::jsonb, ${placeholders.join(', ')})
         on conflict (id_prometeo, campana) do update set
           en_base = true, extra = $3::jsonb, ${sets.join(', ')}, actualizado_en = now()`,
        [idPrometeo, campana, JSON.stringify(extra), ...cols.map((c) => columnas[c])]
      );
      procesados++;
    } catch (e: any) {
      // Ya no lo tragamos en silencio: lo dejamos en el log para poder
      // diagnosticar si algo vuelve a fallar.
      console.log(`Error insertando lead ${idPrometeo}: ${e.message}`);
      if (!primerError) primerError = `ID ${idPrometeo}: ${e.message}`;
    }
  }

  // Guardamos temporalmente los IDs vistos hoy para esta campaña, en una
  // tabla auxiliar simple, para poder comparar al final (último chunk)
  // sin tener que mandar TODOS los IDs de golpe en un solo request gigante.
  if (idsDeEsteLote.length > 0) {
    await client.query(
      `insert into import_base_seen (campana, id_prometeo, fecha)
       select $1, unnest($2::text[]), current_date
       on conflict do nothing`,
      [campana, idsDeEsteLote]
    );
  }

  let marcadosAusentes = 0;
  if (body.esUltimoChunk) {
    const result = await client.query(
      `update leads set en_base = false, actualizado_en = now()
       where campana = $1
         and en_base = true
         and id_prometeo not in (
           select id_prometeo from import_base_seen where campana = $1 and fecha = current_date
         )
       returning id_prometeo`,
      [campana]
    );
    marcadosAusentes = result.rowCount || 0;

    // Limpieza: ya no necesitamos el registro de "vistos hoy" de este día.
    await client.query(`delete from import_base_seen where campana = $1 and fecha = current_date`, [campana]);
  }

  return jsonOk({ procesados, marcadosAusentes, total: filas.length, primerError });
}