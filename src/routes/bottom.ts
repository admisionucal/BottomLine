import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody } from '../types';
import { exigirSesion } from '../lib/session';

const CAMPOS_PERFIL = [
  'POR_QUE_ELIGIO_CARRERA', 'QUE_BUSCA_UNIVERSIDAD', 'QUIEN_FINANCIARA',
  'ACCIONES_DEFINIDAS', 'QUE_LE_FALTA', 'OTRAS_OPCIONES', 'COMENTARIOS_PERFIL',
];

// Frontend (clave en MAYÚSCULAS) -> columna real en Postgres.
const MAPEO_CAMPOS: Record<string, string> = {
  BENEFICIO: 'beneficio',
  BENEFICIO_ADICIONAL: 'beneficio_adicional',
  BENEFICIO_ENGANCHE: 'beneficio_enganche',
  BOLETA: 'boleta',
  BOLETA_FINAL: 'boleta_final',
  BOLETA_CON_BECA: 'boleta_con_beca',
  BOLETA_PROCEDENCIA: 'boleta_procedencia',
  INSTITUCION_PROCEDENCIA: 'institucion_procedencia',
  TIPO_INSTITUCION_PROCEDENCIA: 'tipo_institucion_procedencia',
  CARRERA_PROCEDENCIA: 'carrera_procedencia',
  TIEMPO_OFRECIDO: 'tiempo_ofrecido',
  CICLO_QUEDO: 'ciclo_quedo',
  DESCUENTO_PRECIOS: 'descuento_precios',
  TIPO_ALUMNO: 'tipo_alumno',
  NUMERO_CUOTAS: 'numero_cuotas',
  METODO_PAGO: 'metodo_pago',
  RINDE_EXAMEN_SUFICIENCIA: 'rinde_examen_suficiencia',
  DESCUENTO_MATRICULA: 'descuento_matricula',
  MATRICULA_FINAL: 'matricula_final',
  DESCUENTO_ADMISION: 'descuento_admision',
  ADMISION_FINAL: 'admision_final',
  POR_QUE_ELIGIO_CARRERA: 'por_que_eligio_carrera',
  QUE_BUSCA_UNIVERSIDAD: 'que_busca_universidad',
  QUIEN_FINANCIARA: 'quien_financiara',
  ACCIONES_DEFINIDAS: 'acciones_definidas',
  QUE_LE_FALTA: 'que_le_falta',
  OTRAS_OPCIONES: 'otras_opciones',
  COMENTARIOS_PERFIL: 'comentarios_perfil',
  FECHA_ULT_MODIFICACION: 'fecha_ult_modificacion',
};

function esAdmin(rol: string) {
  return rol === 'SUPERVISOR' || rol === 'ADMISION';
}

export async function saveBottom(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ASESOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const idPrometeo = String(body.idPrometeo || '').trim();
  const campana = String(body.campana || '').trim();
  if (!idPrometeo || !campana) return jsonError('Falta idPrometeo o campaña.');

  // Igual que code.gs: un admin puede guardar a nombre de otro asesor
  // (body.asesorEmail); un asesor normal solo guarda lo suyo.
  const asesorEmail = String(esAdmin(sesion.rol) ? body.asesorEmail || sesion.email : sesion.email || '')
    .trim()
    .toLowerCase();
  if (!asesorEmail) return jsonError('Falta el email del asesor.');

  const data = body.data || {};
  const columnas: Record<string, any> = {};
  for (const [claveFrontend, colPg] of Object.entries(MAPEO_CAMPOS)) {
    if (Object.prototype.hasOwnProperty.call(data, claveFrontend)) {
      columnas[colPg] = data[claveFrontend];
    }
  }

  // Snapshot de identidad del lead (igual que capturarIdentidadBase):
  // se refresca con lo que hay en "leads" ahora mismo; si no se encuentra,
  // se conserva lo que ya había guardado antes (COALESCE en el UPDATE).
  const identidad = await client.query(
    `select nombres, numero_documento, telefono2 from leads where id_prometeo = $1 and campana = $2`,
    [idPrometeo, campana]
  );
  const idRow = identidad.rows[0];

  // Snapshot automático de perfilamiento en el historial de comentarios,
  // igual que hace saveBottomInterno cuando se toca algún CAMPOS_PERFIL.
  const tocaPerfil = CAMPOS_PERFIL.some((c) => Object.prototype.hasOwnProperty.call(data, c));

  const cols = Object.keys(columnas);
  const placeholders = cols.map((_, i) => `$${i + 7}`);
  const sets = cols.map((c, i) => `${c} = $${i + 7}`);

  let historialSql = '';
  const params: any[] = [
    idPrometeo,
    campana,
    asesorEmail,
    idRow?.nombres || '',
    idRow?.numero_documento || '',
    idRow?.telefono2 || '',
    ...cols.map((c) => columnas[c]),
  ];

  if (tocaPerfil) {
    const snapshot: Record<string, any> = {};
    for (const campo of CAMPOS_PERFIL) {
      snapshot[campo] = data[campo] !== undefined ? data[campo] : '';
    }
    const entrada = {
      tipo: 'perfil_snapshot',
      fecha: new Date().toISOString(),
      usuario: sesion.nombre || sesion.email,
      datos: snapshot,
    };
    historialSql = `, comentarios_historial = coalesce(leads_bottom.comentarios_historial, '[]'::jsonb) || $${params.length + 1}::jsonb`;
    params.push(JSON.stringify([entrada]));
  }

  await client.query(
    `insert into leads_bottom (id_prometeo, campana, asesor_email, nombre_lead, dni_lead, celular_lead, ${cols.join(', ')})
     values ($1, $2, $3, $4, $5, $6, ${placeholders.join(', ')})
     on conflict (id_prometeo, campana, asesor_email) do update set
       nombre_lead = coalesce(nullif($4, ''), leads_bottom.nombre_lead),
       dni_lead = coalesce(nullif($5, ''), leads_bottom.dni_lead),
       celular_lead = coalesce(nullif($6, ''), leads_bottom.celular_lead),
       ${sets.length ? sets.join(', ') + ',' : ''}
       actualizado_en = now()
       ${historialSql}`,
    params
  );

  return jsonOk();
}

export async function addComment(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ASESOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const idPrometeo = String(body.id || '').trim();
  const campana = String(body.campana || '').trim();
  const texto = String(body.texto || body.comentario || '').trim();
  if (!idPrometeo || !campana || !texto) return jsonError('Falta id, campaña o texto del comentario.');

  const asesorEmail = String(esAdmin(sesion.rol) ? body.asesorEmail || sesion.email : sesion.email || '')
    .trim()
    .toLowerCase();
  if (!asesorEmail) return jsonError('Falta el email del asesor.');

  const nuevoComentario = {
    tipo: 'comentario',
    autor: sesion.nombre || sesion.email,
    texto,
    fecha: new Date().toISOString(),
  };

  const result = await client.query(
    `insert into leads_bottom (id_prometeo, campana, asesor_email, comentarios_historial)
     values ($1, $2, $3, jsonb_build_array($4::jsonb))
     on conflict (id_prometeo, campana, asesor_email) do update set
       comentarios_historial = jsonb_build_array($4::jsonb) || coalesce(leads_bottom.comentarios_historial, '[]'::jsonb),
       actualizado_en = now()
     returning comentarios_historial`,
    [idPrometeo, campana, asesorEmail, JSON.stringify(nuevoComentario)]
  );

  return jsonOk({ data: { COMENTARIOS_HISTORIAL: JSON.stringify(result.rows[0].comentarios_historial) } });
}