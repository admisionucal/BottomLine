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

const MODELO_IA_PROPUESTA = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export async function generarPropuestaIA(client: Client, body: JsonBody, env: Env) {
  const { sesion, error } = await exigirSesion(client, body, ['ADMISION']);
  if (!sesion) return jsonError(error!);

  const idTarget = String(body.id || '').trim();
  const campana = String(body.campana || '').trim();
  if (!idTarget || !campana) return jsonError('Falta id o campaña.');

  const bottomResult = await client.query(
    `select * from leads_bottom where id_prometeo = $1 and campana = $2
     order by actualizado_en desc limit 1`,
    [idTarget, campana]
  );
  const bottom = bottomResult.rows[0];
  if (!bottom) return jsonError('Este lead no tiene datos de perfilamiento aún.');

  if (!env.AI) return jsonError('Workers AI no está habilitado en este Worker.');

  // --- Fechas: las calculamos nosotros, no se las dejamos "adivinar" a la IA ---
  const hoy = new Date();
  const fmt = (d: Date) => d.toLocaleDateString('es-PE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const hoyStr = fmt(hoy);
  const anioActual = hoy.getFullYear();

  const limiteContacto = new Date(hoy);
  limiteContacto.setDate(limiteContacto.getDate() + 3);
  const limiteStr = fmt(limiteContacto);

  // --- Historial de comentarios: fechas reales (ISO, guardadas por el sistema) ---
  let historial: any[] = [];
  try {
    historial = Array.isArray(bottom.comentarios_historial)
      ? bottom.comentarios_historial
      : JSON.parse(bottom.comentarios_historial || '[]');
  } catch {
    historial = [];
  }

  const ultimo = historial[historial.length - 1];
  let diasSinContacto: number | null = null;
  if (ultimo?.fecha) {
    diasSinContacto = Math.floor((hoy.getTime() - new Date(ultimo.fecha).getTime()) / 86400000);
  }

  const historialTexto = historial.slice(-5)
    .map((h: any) => `- [${h.fecha ? fmt(new Date(h.fecha)) : 'sin fecha'}] ${h.texto || ''}`)
    .join('\n') || '(sin comentarios previos registrados)';

  const prompt = `
Eres un asistente de un equipo de admisión universitaria. En base a la
siguiente información de un postulante, redacta una PROPUESTA DE ACCIÓN
para que el asesor/supervisor sepa qué hacer con este lead a continuación.

DATOS DE FECHA (usa estos, no los calcules tú mismo):
- Hoy es: ${hoyStr}
- Último contacto registrado: ${ultimo ? fmt(new Date(ultimo.fecha)) : 'sin registro'}${diasSinContacto !== null ? ` (hace ${diasSinContacto} día(s))` : ''}
- Fecha límite para el próximo contacto (máx. 3 días sin contacto): ${limiteStr}

Reglas:
- El seguimiento a un lead nunca debe superar los 3 días sin contacto.
  Indica cuándo debe ser el próximo contacto, usando la fecha límite de
  arriba como referencia (puedes decir "hoy", "mañana", o la fecha exacta).
- Si en el historial de comentarios aparece una fecha SIN año (ej. "25/09"
  o "el 15 de octubre"), asume que corresponde al año actual (${anioActual}),
  salvo que el propio texto indique otro año explícitamente.
- Propón 1 o 2 GANCHOS DE CONTACTO concretos y específicos para ESTE lead
  (no genéricos): usa su dolor/necesidad, sus comentarios, la carrera que
  eligió o la universidad con la que compara, y sugiere qué enviarle o
  decirle (testimonio, comparación de precios, info de becas, foto/video
  del campus, etc.) según corresponda.
- No repitas los datos de perfilamiento tal cual; úsalos para justificar
  el gancho, no los enumeres.
- Máximo 150 palabras, en español, sin viñetas markdown, tono profesional
  y directo.

Historial de comentarios recientes:
${historialTexto}

Por qué eligió la carrera: ${bottom.por_que_eligio_carrera || '(sin dato)'}
Qué busca en una universidad: ${bottom.que_busca_universidad || '(sin dato)'}
Quién financiará: ${bottom.quien_financiara || '(sin dato)'}
Qué le falta para decidir: ${bottom.que_le_falta || '(sin dato)'}
Otras opciones que evalúa: ${bottom.otras_opciones || '(sin dato)'}
Dolor / Necesidad: ${bottom.dolor_necesidad || '(sin dato)'}
Comentarios del asesor: ${bottom.comentarios_perfil || '(sin dato)'}
Acciones ya definidas por el supervisor: ${bottom.acciones_definidas || '(sin dato)'}
`.trim();

  try {
    const salida: any = await env.AI.run(MODELO_IA_PROPUESTA, {
      messages: [
        { role: 'system', content: 'Respondes solo con el texto de la propuesta, sin encabezados ni comillas.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 500,
    });

    const texto = String(salida?.response ?? '').trim();
    if (!texto) return jsonError('La IA no devolvió una propuesta.');

    await client.query(
      `update leads_bottom set propuesta_accion_ia = $3, propuesta_accion_ia_generada_en = now()
       where id_prometeo = $1 and campana = $2`,
      [idTarget, campana, texto]
    );

    return jsonOk({ propuesta: texto });
  } catch (err: any) {
    return jsonError('No se pudo generar la propuesta: ' + err.message);
  }
}