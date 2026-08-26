import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody } from '../types';
import { exigirSesion } from '../lib/session';

const ESTADOS_VP_PP = ['VALORES_VALORACIONES_POSITIVAS_VIVA', 'VALORES_PROMESA_DE_PAGO_VIVA'];

export async function getLeads(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ASESOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const esAdmin = sesion.rol === 'SUPERVISOR' || sesion.rol === 'ADMISION';
  const campana = body.campana;
  if (!campana) return jsonError('Falta especificar la campaña.');

  const filtros = body.filtros || {};

  let nombreAsesor: string | null = null;
  if (!esAdmin && sesion.email) {
    const r = await client.query(`select nombre from usuarios where lower(email) = lower($1) limit 1`, [
      sesion.email,
    ]);
    nombreAsesor = r.rows[0]?.nombre || null;
  }

  const params: any[] = [campana];
  const condiciones: string[] = ['l.campana = $1'];

  condiciones.push(`(l.en_base = true or (l.actualizado_hoy_en at time zone 'America/Lima')::date = (now() at time zone 'America/Lima')::date)`);

  if (esAdmin) {
    condiciones.push(`(l.vps_dif_ti_inte <> 0 or (l.actualizado_hoy_en is not null and l.status_gestion = any($${params.push(ESTADOS_VP_PP)})))`);
  } else {
    condiciones.push(`l.status_gestion = any($${params.push(ESTADOS_VP_PP)})`);
    if (nombreAsesor) {
      condiciones.push(`lower(l.asesor) = lower($${params.push(nombreAsesor)})`);
    }
  }

  if (filtros.carrera && filtros.carrera !== 'Todas') {
    condiciones.push(`l.programa = $${params.push(filtros.carrera)}`);
  }
  if (filtros.ingreso && filtros.ingreso !== 'Todos') {
    condiciones.push(`l.modalidad_ingreso = $${params.push(filtros.ingreso)}`);
  }
  if (filtros.modalidad && filtros.modalidad !== 'Todas') {
    condiciones.push(`l.modalidad = $${params.push(filtros.modalidad)}`);
  }
  if (filtros.status && filtros.status !== 'Todos') {
    condiciones.push(`l.status_gestion = $${params.push(filtros.status)}`);
  }
  if (filtros.beneficio && filtros.beneficio !== 'Todos') {
    condiciones.push(`coalesce(b.beneficio, 'NO') = $${params.push(filtros.beneficio)}`);
  }

  const selectPagos = esAdmin
    ? `p.status_pago_final, p.fecha_pago_completo, p.fecha_promesa_pago,`
    : `null as status_pago_final, null as fecha_pago_completo, null as fecha_promesa_pago,`;

  const sql = `
    select
      l.id_prometeo, l.campana, l.nombres, l.telefono2, l.telefono3, l.email,
      l.colegio, l.codigo_modular, l.programa, l.numero_documento, l.modalidad,
      l.modalidad_ingreso, l.boleta_colegio, l.fecha_hora_registro, l.asesor,
      coalesce(u.nombre_aux, l.asesor, '-') as asesor_nombre,
      case when ${esAdmin} and p.status_pago_final in ('PAGO COMPLETO', 'PAGO FRACCIONADO')
           then p.status_pago_final else l.status_gestion end as status_gestion,
      l.fecha_compromiso_pago,
      (l.actualizado_hoy_en is not null) as actualizado_hoy,
      ${selectPagos}
      coalesce(b.beneficio, 'NO') as beneficio,
      coalesce(b.beneficio_adicional, 'NO') as beneficio_adicional,
      to_jsonb(b.*) as bottom_data,
      (
        (case when nullif(trim(b.por_que_eligio_carrera), '') is not null then 1 else 0 end) +
        (case when nullif(trim(b.que_busca_universidad), '') is not null then 1 else 0 end) +
        (case when nullif(trim(b.quien_financiara), '') is not null then 1 else 0 end) +
        (case when nullif(trim(b.que_le_falta), '') is not null then 1 else 0 end) +
        (case when nullif(trim(b.otras_opciones), '') is not null then 1 else 0 end) +
        (case when nullif(trim(b.comentarios_perfil), '') is not null then 1 else 0 end) +
        (case when nullif(trim(b.dolor_necesidad), '') is not null then 1 else 0 end)
      ) as perfil_asesor_respondidas,
      (nullif(trim(b.acciones_definidas), '') is not null) as perfil_supervisor_completo
    from leads l
    left join usuarios u on lower(u.usuario) = lower(l.asesor) or lower(u.nombre) = lower(l.asesor)
    left join leads_bottom b on b.id_prometeo = l.id_prometeo and b.campana = l.campana
      and lower(b.asesor_email) = lower(u.email)
    left join leads_pagos p on p.id_prometeo = l.id_prometeo and p.campana = l.campana
    where ${condiciones.join(' and ')}
    order by l.actualizado_en desc
  `;

  const result = await client.query(sql, params);
  const CAMPOS_BOTTOM_YA_MANEJADOS = new Set(['BENEFICIO', 'BENEFICIO_ADICIONAL']);
  const bottomToUpper = (bottom: Record<string, unknown> | null): Record<string, unknown> => {
    if (!bottom) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(bottom)) {
      const clave = k.toUpperCase();
      if (!CAMPOS_BOTTOM_YA_MANEJADOS.has(clave)) out[clave] = v;
    }
    return out;
  };

  const data = result.rows.map((r) => ({
    'ID PROMETEO': r.id_prometeo,
    'CAMPAÑA': r.campana,
    NOMBRES: r.nombres,
    'TELEFONO 2': r.telefono2,
    'TELEFONO 3': r.telefono3,
    EMAIL: r.email,
    'NOMBRE DEL COLEGIO': r.colegio,
    'CODIGO MODULAR': r.codigo_modular,
    PROGRAMA: r.programa,
    CARRERA: r.programa,
    'NUMERO DE DOCUMENTO': r.numero_documento,
    MODALIDAD: r.modalidad,
    'MODALIDAD INGRESO': r.modalidad_ingreso,
    'BOLETA DE COLEGIO': r.boleta_colegio,
    'FECHA HORA DE REGISTRO': r.fecha_hora_registro,
    ASESOR_NOMBRE_RAW: r.asesor || '',
    'ASESOR ULT TIP DF SN CONTC': r.asesor_nombre,
    'STATUS DE GESTION': r.status_gestion,
    'FECHA COMPROMISO DE PAGO': r.fecha_compromiso_pago,
    ACTUALIZADO_HOY: r.actualizado_hoy,
    'FECHA DE PAGO COMPLETO': r.fecha_pago_completo,
    'FECHA DE PROMESA DE PAGO': r.fecha_promesa_pago,
    BENEFICIO: r.beneficio,
    BENEFICIO_ADICIONAL: r.beneficio_adicional,
    PERFILAMIENTO_COMPLETO: (() => {
      const asesorResp = Number(r.perfil_asesor_respondidas);
      const supCompleto = !!r.perfil_supervisor_completo;
      const asesorCompleto = asesorResp === 7;
      const estado = !asesorCompleto ? 'Pendiente Asesor' : !supCompleto ? 'Pendiente Supervisor' : 'Completo';
      return {
        respondidas: asesorResp + (supCompleto ? 1 : 0),
        total: 7,
        completo: estado === 'Completo',
        estado,
      };
    })(),
    ...bottomToUpper(r.bottom_data as Record<string, unknown> | null),
  }));

  return jsonOk({ data });
}