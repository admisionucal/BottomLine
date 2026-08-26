import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody } from '../types';
import { exigirSesion } from '../lib/session';

const ESTADOS_VP_PP = ['VALORES_VALORACIONES_POSITIVAS_VIVA', 'VALORES_PROMESA_DE_PAGO_VIVA'];
const CAMPOS_ASESOR = ['por_que_eligio_carrera', 'que_busca_universidad', 'quien_financiara', 'que_le_falta', 'otras_opciones'];

export async function getResumenVpPp(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ASESOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const esAdmin = sesion.rol === 'SUPERVISOR' || sesion.rol === 'ADMISION';
  const campanas: string[] = Array.isArray(body.campanas) ? body.campanas : body.campana ? [body.campana] : [];

  let nombreAsesor: string | null = null;
  if (!esAdmin && sesion.email) {
    const r = await client.query(`select nombre from usuarios where lower(email) = lower($1) limit 1`, [sesion.email]);
    nombreAsesor = r.rows[0]?.nombre || null;
  }

  const resumen: Record<string, any> = {};

  for (const campana of campanas) {
    const params: any[] = [campana];
    const condiciones: string[] = ['l.campana = $1'];

    // MISMO FILTRO QUE getLeads (Dashboard): solo leads vigentes en la base
    // actual, salvo que se hayan tocado hoy (actualizado_hoy_en).
    condiciones.push(`(l.en_base = true or l.actualizado_hoy_en::date = current_date)`);

    if (esAdmin) {
      condiciones.push(
        `(l.vps_dif_ti_inte <> 0 or (l.actualizado_hoy_en is not null and l.status_gestion = any($${params.push(ESTADOS_VP_PP)})))`
      );
    } else {
      condiciones.push(`l.status_gestion = any($${params.push(ESTADOS_VP_PP)})`);
      if (nombreAsesor) condiciones.push(`lower(l.asesor) = lower($${params.push(nombreAsesor)})`);
    }

    const sql = `
      select
        case when ${esAdmin} and p.status_pago_final in ('PAGO COMPLETO', 'PAGO FRACCIONADO')
             then p.status_pago_final else l.status_gestion end as status_final,
        b.por_que_eligio_carrera, b.que_busca_universidad, b.quien_financiara,
        b.que_le_falta, b.otras_opciones, b.acciones_definidas
      from leads l
      left join leads_bottom b on b.id_prometeo = l.id_prometeo and b.campana = l.campana
      left join leads_pagos p on p.id_prometeo = l.id_prometeo and p.campana = l.campana
      where ${condiciones.join(' and ')}
    `;
    const result = await client.query(sql, params);

    let vpTotal = 0,
      vpCompletos = 0,
      ppTotal = 0,
      ppCompletos = 0;

    for (const r of result.rows) {
      const asesorResp = CAMPOS_ASESOR.filter((c) => r[c] && String(r[c]).trim() !== '').length;
      const supCompleto = !!(r.acciones_definidas && String(r.acciones_definidas).trim() !== '');
      const completo = asesorResp === CAMPOS_ASESOR.length && supCompleto;

      if (r.status_final === 'VALORES_VALORACIONES_POSITIVAS_VIVA') {
        vpTotal++;
        if (completo) vpCompletos++;
      }
      if (r.status_final === 'VALORES_PROMESA_DE_PAGO_VIVA') {
        ppTotal++;
        if (completo) ppCompletos++;
      }
    }

    resumen[campana] = { vpTotal, vpCompletos, ppTotal, ppCompletos };
  }

  return jsonOk({ data: resumen });
}