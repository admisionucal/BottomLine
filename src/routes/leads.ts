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

  // Igual que getNombreAsesorPorEmail() en code.gs: se resuelve el NOMBRE
  // COMPLETO (no nombre_aux) buscando por email, en cada request — no se
  // confía en lo que quedó guardado en la sesión al momento del login.
  let nombreAsesor: string | null = null;
  if (!esAdmin && sesion.email) {
    const r = await client.query(`select nombre from usuarios where lower(email) = lower($1) limit 1`, [
      sesion.email,
    ]);
    nombreAsesor = r.rows[0]?.nombre || null;
  }

  // Igual que tu código: un ASESOR solo ve sus propios leads en VP/PP;
  // un admin ve todo lo "visible" (con vps_dif != 0 o en VP/PP hoy).
  const params: any[] = [campana];
  const condiciones: string[] = ['l.campana = $1'];

  // Un lead se muestra si: sigue en la base actual (en_base=true), O si el
  // scraper de Prometeo lo tocó HOY MISMO (leads "solo hoy", legítimos aunque
  // aún no estén en la base). Si ya no está en base y no se tocó hoy, es un
  // lead viejo que salió del extracto — se deja de mostrar (equivalente a que
  // Sheets ya no lo tenga en la hoja base), pero su bottom/historial no se pierde.
  condiciones.push(`(l.en_base = true or l.actualizado_hoy_en::date = current_date)`);

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

  // pagos solo se aplica (y solo se selecciona) para roles admin, igual que hoy.
  const selectPagos = esAdmin
    ? `p.status_pago_final, p.fecha_pago_completo, p.fecha_promesa_pago,`
    : `null as status_pago_final, null as fecha_pago_completo, null as fecha_promesa_pago,`;

  const sql = `
    select
      l.id_prometeo, l.campana, l.nombres, l.telefono2, l.telefono3, l.email,
      l.colegio, l.codigo_modular, l.programa, l.numero_documento, l.modalidad,
      l.modalidad_ingreso, l.boleta_colegio, l.fecha_hora_registro, l.asesor,
      coalesce(u.nombre_aux, l.asesor, '-') as asesor_nombre,
      -- Si hay pago con status final, prevalece sobre el status normal
      -- (misma regla que "statusPagoFinal === 'PAGO COMPLETO' ...").
      case when ${esAdmin} and p.status_pago_final in ('PAGO COMPLETO', 'PAGO FRACCIONADO')
           then p.status_pago_final else l.status_gestion end as status_gestion,
      l.fecha_compromiso_pago,
      (l.actualizado_hoy_en is not null) as actualizado_hoy,
      l.extra,
      ${selectPagos}
      coalesce(b.beneficio, 'NO') as beneficio,
      coalesce(b.beneficio_adicional, 'NO') as beneficio_adicional,
      b.por_que_eligio_carrera, b.que_busca_universidad, b.quien_financiara,
      b.acciones_definidas, b.que_le_falta, b.otras_opciones,
      (
        (case when nullif(trim(b.por_que_eligio_carrera), '') is not null then 1 else 0 end) +
        (case when nullif(trim(b.que_busca_universidad), '') is not null then 1 else 0 end) +
        (case when nullif(trim(b.quien_financiara), '') is not null then 1 else 0 end) +
        (case when nullif(trim(b.que_le_falta), '') is not null then 1 else 0 end) +
        (case when nullif(trim(b.otras_opciones), '') is not null then 1 else 0 end)
      ) as perfil_asesor_respondidas,
      (nullif(trim(b.acciones_definidas), '') is not null) as perfil_supervisor_completo
    from leads l
    left join usuarios u on lower(u.usuario) = lower(l.asesor) or lower(u.nombre) = lower(l.asesor)
    -- leads_bottom ahora es por (id_prometeo, campana, asesor_email): mostramos
    -- la fila del asesor ACTUALMENTE asignado al lead (resuelto por nombre -> email).
    left join leads_bottom b on b.id_prometeo = l.id_prometeo and b.campana = l.campana
      and lower(b.asesor_email) = lower(u.email)
    left join leads_pagos p on p.id_prometeo = l.id_prometeo and p.campana = l.campana
    where ${condiciones.join(' and ')}
    order by l.actualizado_en desc
  `;

  const result = await client.query(sql, params);

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
      const asesorCompleto = asesorResp === 5;
      const estado = !asesorCompleto ? 'Pendiente Asesor' : !supCompleto ? 'Pendiente Supervisor' : 'Completo';
      return {
        respondidas: asesorResp + (supCompleto ? 1 : 0),
        total: 6,
        completo: estado === 'Completo',
        estado,
      };
    })(),
    ...(r.extra || {}),
  }));

  return jsonOk({ data });
}