import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody, type Env } from '../types';

// Mapea las claves que manda actualizar_leads_hoy.gs (COLUMNAS_HOY) a columnas reales.
const MAPEO_HOY: Record<string, string> = {
  'NOMBRES': 'nombres',
  'TELEFONO 3': 'telefono3',
  'EMAIL': 'email',
  'NOMBRE DEL COLEGIO': 'colegio',
  'PROGRAMA': 'programa',
  'MODALIDAD': 'modalidad',
  'MODALIDAD INGRESO': 'modalidad_ingreso',
  'BOLETA DE COLEGIO': 'boleta_colegio',
  'NUMERO DE DOCUMENTO': 'numero_documento',
  'CODIGO MODULAR': 'codigo_modular',
};

const ESTADOS_VIVOS = new Set(['VALORES_VALORACIONES_POSITIVAS_VIVA', 'VALORES_PROMESA_DE_PAGO_VIVA']);
const VALORES_NO_MERGE = new Set(['', 'NO DEFINIDO', '-', 'SIN INFORMACION', 'SIN INFORMACIÓN']);

function statusEsVivo(status: any): boolean {
  return ESTADOS_VIVOS.has(String(status || '').trim());
}

function esValorMerge(valor: any): boolean {
  if (valor === undefined || valor === null) return false;
  return !VALORES_NO_MERGE.has(String(valor).trim().toUpperCase());
}

// Idénticas a hoyOverrideEsConfiable() / permitirActualizarAsignacionDetail() en code.gs.
function hoyOverrideEsConfiable(
  statusHoy: any,
  asesorBase: string,
  encontradoEnBase: boolean,
  statusBase: any,
  asesorHoy: any
): boolean {
  if (!statusEsVivo(statusHoy)) return false;
  if (!encontradoEnBase) return true;
  if (!statusEsVivo(statusBase)) return true;

  const aBase = String(asesorBase || '').trim().toLowerCase();
  if (!aBase) return false;

  const aHoy = String(asesorHoy || '').trim().toLowerCase();
  return aHoy !== '' && aHoy === aBase;
}

function permitirActualizarAsignacion(
  statusHoy: any,
  asesorBase: string,
  encontradoEnBase: boolean,
  statusBase: any,
  asesorHoy: any
): boolean {
  if (!statusEsVivo(statusHoy)) return true;
  if (!encontradoEnBase) return true;
  if (!statusEsVivo(statusBase)) return true;

  const aBase = String(asesorBase || '').trim().toLowerCase();
  const aHoy = String(asesorHoy || '').trim().toLowerCase();
  return aHoy !== '' && aHoy === aBase;
}

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

      // Traemos la referencia ESTABLE (asesor_base/status_base, que solo
      // toca el import diario) — no el asesor/status actual, que puede ya
      // estar modificado por una corrida anterior de este mismo scraper.
      const ref = await client.query(
        `select en_base, asesor_base, status_base from leads where id_prometeo = $1 and campana = $2`,
        [idPrometeo, campana]
      );
      const encontradoEnBase = !!ref.rows[0]?.en_base;
      const asesorBase = ref.rows[0]?.asesor_base || '';
      const statusBase = ref.rows[0]?.status_base || '';

      const statusHoy = leadRaw['STATUS DE GESTION'];
      const asesorHoy = leadRaw['ASESOR ULT TIP DF SN CONTC'];

      const confiable = hoyOverrideEsConfiable(statusHoy, asesorBase, encontradoEnBase, statusBase, asesorHoy);
      const permitirAsesor = permitirActualizarAsignacion(statusHoy, asesorBase, encontradoEnBase, statusBase, asesorHoy);

      const columnas: Record<string, any> = {};

      // STATUS: se mergea siempre que venga un valor válido (igual que el código real).
      if (esValorMerge(statusHoy)) columnas.status_gestion = statusHoy;

      // ASESOR: solo si la regla de asignación lo permite.
      if (permitirAsesor && esValorMerge(asesorHoy)) columnas.asesor = asesorHoy;

      // Resto de campos "simples": se mergean siempre que el valor sea válido,
      // sin depender de "confiable" (igual que getLeads real).
      for (const [claveSheet, colPg] of Object.entries(MAPEO_HOY)) {
        const valor = leadRaw[claveSheet];
        if (esValorMerge(valor)) columnas[colPg] = valor;
      }

      // FECHA COMPROMISO DE PAGO Y DE VISITA: caso especial, solo si "confiable".
      if (confiable && esValorMerge(leadRaw['FECHA COMPROMISO DE PAGO'])) {
        columnas.fecha_compromiso_pago = leadRaw['FECHA COMPROMISO DE PAGO'];
      }

      if (confiable && esValorMerge(leadRaw['FECHA VISITA GUIADA'])) {
        columnas.fecha_visita_guiada = leadRaw['FECHA VISITA GUIADA'];
      }

      const cols = Object.keys(columnas);
      const sets = cols.map((c, i) => `${c} = $${i + 3}`);

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
