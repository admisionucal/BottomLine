import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody } from '../types';
import { exigirSesion } from '../lib/session';
import { calcularPerfilamientoCompleto } from '../lib/perfilamiento';

function esRolSupervisorOAdmision(rol: string) {
  return rol === 'SUPERVISOR' || rol === 'ADMISION';
}

// Columnas internas del bottom que NO deben exponerse tal cual en el objeto
// de salida (uso interno / ya representadas con otro nombre).
const OMITIR_DEL_BOTTOM = new Set(['id_prometeo', 'campana', 'creado_en']);

export async function getLeadDetail(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ASESOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const idTarget = String(body.id || '').trim();
  const campana = String(body.campana || '').trim();
  if (!idTarget || !campana) return jsonError('Falta id o campaña.');

  const email = sesion.email.trim().toLowerCase();
  const esAdmin = esRolSupervisorOAdmision(sesion.rol);

  const leadResult = await client.query(`select * from leads where id_prometeo = $1 and campana = $2`, [
    idTarget,
    campana,
  ]);
  const leadRow = leadResult.rows[0];

  // Igual que el código real: si no está en base, igual se arma un objeto
  // mínimo (puede existir solo por bottom/hoy). No es un error todavía.
  const leadObj: Record<string, any> = leadRow
    ? {
        'ID PROMETEO': leadRow.id_prometeo,
        ID_PROMETEO: leadRow.id_prometeo,
        CAMPAÑA: leadRow.campana,
        NOMBRES: leadRow.nombres,
        TELEFONO: leadRow.telefono2,
        'TELEFONO 2': leadRow.telefono2,
        'TELEFONO 3': leadRow.telefono3,
        EMAIL: leadRow.email,
        'NOMBRE DEL COLEGIO': leadRow.colegio,
        COLEGIO: leadRow.colegio,
        'CODIGO MODULAR': leadRow.codigo_modular,
        PROGRAMA: leadRow.programa,
        CARRERA: leadRow.programa,
        'NUMERO DE DOCUMENTO': leadRow.numero_documento,
        MODALIDAD: leadRow.modalidad,
        'MODALIDAD INGRESO': leadRow.modalidad_ingreso,
        'BOLETA DE COLEGIO': leadRow.boleta_colegio,
        'FECHA HORA DE REGISTRO': leadRow.fecha_hora_registro,
        ASESOR_NOMBRE_RAW: leadRow.asesor || '',
        'STATUS DE GESTION': leadRow.status_gestion,
        'FECHA COMPROMISO DE PAGO': leadRow.fecha_compromiso_pago,
        ...(leadRow.extra || {}),
      }
    : { 'ID PROMETEO': idTarget, ID_PROMETEO: idTarget, CAMPAÑA: campana };

  // Nombre a mostrar del asesor (Nombre_Aux), buscando por el nombre completo guardado.
  if (leadObj.ASESOR_NOMBRE_RAW) {
    const r = await client.query(
      `select nombre_aux, nombre from usuarios where lower(nombre) = lower($1) limit 1`,
      [leadObj.ASESOR_NOMBRE_RAW]
    );
    const nombreMostrar = r.rows[0]?.nombre_aux || r.rows[0]?.nombre || leadObj.ASESOR_NOMBRE_RAW;
    leadObj['ASESOR ULT TIP DF SN CONTC'] = nombreMostrar;
  } else {
    leadObj['ASESOR ULT TIP DF SN CONTC'] = '-';
  }

  // Pagos: solo visibles para SUPERVISOR/ADMISION, igual que el código real.
  if (esAdmin) {
    const pagoResult = await client.query(`select * from leads_pagos where id_prometeo = $1 and campana = $2`, [
      idTarget,
      campana,
    ]);
    const pagoInfo = pagoResult.rows[0];
    const statusPagoFinal = String(pagoInfo?.status_pago_final || '').trim().toUpperCase();

    if (statusPagoFinal === 'PAGO COMPLETO') {
      leadObj['STATUS DE GESTION'] = statusPagoFinal;
      if (pagoInfo.fecha_pago_completo) leadObj['FECHA DE PAGO COMPLETO'] = pagoInfo.fecha_pago_completo;
    } else if (statusPagoFinal === 'PAGO FRACCIONADO') {
      leadObj['STATUS DE GESTION'] = statusPagoFinal;
      if (pagoInfo.fecha_promesa_pago) leadObj['FECHA DE PROMESA DE PAGO'] = pagoInfo.fecha_promesa_pago;
    } else {
      leadObj['FECHA DE PROMESA DE PAGO'] = leadObj['FECHA COMPROMISO DE PAGO'];
    }
  }

  // Bottom: desde el fix de esquema (04_fix_leads_bottom_asesor.sql) puede
  // haber una fila POR ASESOR para el mismo lead. Priorizamos la fila del
  // asesor de la sesión actual (si existe); si no existe (p.ej. un
  // SUPERVISOR/ADMISION viendo un lead que nunca tocó, o un asesor nuevo
  // heredando el lead), caemos a la fila más reciente como snapshot general.
  const bottomResult = await client.query(
    `select * from leads_bottom
     where id_prometeo = $1 and campana = $2
     order by (asesor_email = $3) desc, actualizado_en desc
     limit 1`,
    [idTarget, campana, email]
  );
  const bottomRow = bottomResult.rows[0] || {};

  const bottomUpper: Record<string, any> = {};
  for (const [k, v] of Object.entries(bottomRow)) {
    if (OMITIR_DEL_BOTTOM.has(k)) continue;
    if (k === 'comentarios_historial') continue; // se procesa aparte abajo
    bottomUpper[k.toUpperCase()] = v;
  }
  Object.assign(leadObj, bottomUpper);
  leadObj['PERFILAMIENTO_COMPLETO'] = calcularPerfilamientoCompleto(bottomUpper, esAdmin);

  // Historial de comentarios: un ASESOR solo ve sus propios comentarios/snapshots.
  let historial: any[] = [];
  const rawHistorial = bottomRow.comentarios_historial;
  try {
    historial = Array.isArray(rawHistorial) ? rawHistorial : JSON.parse(rawHistorial || '[]');
  } catch (_e) {
    historial = [];
  }
  if (!esAdmin) {
    historial = historial.filter((it: any) => String(it.usuarioEmail || '').trim().toLowerCase() === email);
  }
  leadObj['COMENTARIOS_HISTORIAL'] = JSON.stringify(historial);

  if (esAdmin) {
    leadObj['ASESOR_NOMBRE'] = leadObj['ASESOR ULT TIP DF SN CONTC'];
  }

  return jsonOk({ data: leadObj });
}