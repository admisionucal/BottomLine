import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody, type Env } from '../types';

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
  'FECHA VISITA GUIADA': 'fecha_visita_guiada',
  'FECHA PRIM VP/PP': 'fecha_prim_vp_pp',
  '# DE VPs DIF TI INTE': 'vps_dif_ti_inte',
};

const PORCENTAJE_MINIMO_VISTOS = 0.8;

export async function actualizarLeadsBase(client: Client, body: JsonBody, env: Env) {
  if (!env.IMPORT_SECRET || body.secret !== env.IMPORT_SECRET) {
    return jsonError('No autorizado.', 401);
  }

  const campana = String(body.campana || '').trim();
  const filas = Array.isArray(body.filas) ? body.filas : [];
  if (!campana) return jsonError('Falta campaña.');

  const campanaRes = await client.query(`select activa from campanas where codigo = $1`, [campana]);
  if (campanaRes.rows[0]?.activa !== true) {
    return jsonError(`La campaña "${campana}" no está activa; no se migran leads.`);
  }

  const filasPorId = new Map<string, { columnas: Record<string, any>; extra: Record<string, any> }>();
  for (const fila of filas) {
    const idPrometeo = String(fila['ID PROMETEO'] || '').trim();
    if (!idPrometeo) continue;
    const columnas: Record<string, any> = {};
    const extra: Record<string, any> = {};
    for (const [colSheet, valor] of Object.entries(fila)) {
      const colPg = MAPEO_LEADS[colSheet];
      if (colPg) {
        if (colPg !== 'id_prometeo') columnas[colPg] = valor === '' ? null : valor;
      } else {
        extra[colSheet] = valor;
      }
    }
    filasPorId.set(idPrometeo, { columnas, extra });
  }

  const idsDeEsteLote = Array.from(filasPorId.keys());
  const cols = Array.from(new Set(Array.from(filasPorId.values()).flatMap((f) => Object.keys(f.columnas))));
  let procesados = 0;
  let primerError: string | null = null;

  const upsert = async (ids: string[]) => {
    const params: any[] = [campana];
    const filasSql = ids.map((id) => {
      const { columnas, extra } = filasPorId.get(id)!;
      const valores = [id, JSON.stringify(extra), columnas['asesor'] ?? null, columnas['status_gestion'] ?? null, ...cols.map((c) => columnas[c] ?? null)];
      const marcadores = valores.map((v) => `$${params.push(v)}`);
      return `(${marcadores[0]}, $1, true, ${marcadores[1]}::jsonb, ${marcadores.slice(2).join(', ')})`;
    });
    await client.query(
      `insert into leads (id_prometeo, campana, en_base, extra, asesor_base, status_base${cols.length ? ', ' + cols.join(', ') : ''})
       values ${filasSql.join(', ')}
       on conflict (id_prometeo, campana) do update set
         en_base = true, extra = excluded.extra, asesor_base = excluded.asesor_base, status_base = excluded.status_base,
         ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}${cols.length ? ',' : ''} actualizado_en = now()`,
      params
    );
  };

  if (idsDeEsteLote.length > 0) {
    try {
      await upsert(idsDeEsteLote);
      procesados = idsDeEsteLote.length;
    } catch (e: any) {
      console.log(`Error en carga masiva, se reintenta fila por fila: ${e.message}`);
      for (const id of idsDeEsteLote) {
        try {
          await upsert([id]);
          procesados++;
        } catch (err: any) {
          console.log(`Error insertando lead ${id}: ${err.message}`);
          if (!primerError) primerError = `ID ${id}: ${err.message}`;
        }
      }
    }

    await client.query(
      `insert into import_base_seen (campana, id_prometeo, fecha)
       select $1, unnest($2::text[]), current_date
       on conflict do nothing`,
      [campana, idsDeEsteLote]
    );
  }

  let marcadosAusentes = 0;
  let avisoAusentes: string | null = null;
  if (body.esUltimoChunk) {
    const conteo = await client.query(
      `select
         (select count(*) from import_base_seen where campana = $1 and fecha = current_date)::int as vistos,
         (select count(*) from leads where campana = $1 and en_base = true)::int as en_base`,
      [campana]
    );
    const { vistos, en_base } = conteo.rows[0];
    if (en_base > 0 && vistos < en_base * PORCENTAJE_MINIMO_VISTOS) {
      avisoAusentes = `Solo llegaron ${vistos} de ${en_base} leads; no se marcan ausentes para no sacar leads por una carga incompleta.`;
      await client.query(`delete from import_base_seen where campana = $1 and fecha = current_date`, [campana]);
      return jsonOk({ procesados, marcadosAusentes, total: filas.length, primerError, avisoAusentes });
    }
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

    await client.query(`delete from import_base_seen where campana = $1 and fecha = current_date`, [campana]);
  }

  return jsonOk({ procesados, marcadosAusentes, total: filas.length, primerError, avisoAusentes });
}
