import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody } from '../types';
import { exigirSesion } from '../lib/session';

const CAMPOS_BOTTOM_EDITABLES = [
  'beneficio', 'beneficio_adicional', 'beneficio_enganche',
  'boleta', 'boleta_final', 'boleta_con_beca', 'boleta_procedencia',
  'institucion_procedencia', 'tipo_institucion_procedencia', 'carrera_procedencia',
  'tiempo_ofrecido', 'ciclo_quedo', 'descuento_precios', 'tipo_alumno',
  'numero_cuotas', 'metodo_pago',
  'por_que_eligio_carrera', 'que_busca_universidad', 'quien_financiara',
  'acciones_definidas', 'que_le_falta', 'otras_opciones', 'comentarios_perfil',
] as const;

export async function saveBottom(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ASESOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const idPrometeo = String(body.id || '').trim();
  const campana = String(body.campana || '').trim();
  if (!idPrometeo || !campana) return jsonError('Falta id o campaña.');

  // Solo se guardan los campos que el frontend realmente mandó (igual que
  // saveBottomInterno, que solo escribe las columnas presentes en body.data).
  const data = body.data || {};
  const columnas: string[] = [];
  const valores: any[] = [];

  for (const campo of CAMPOS_BOTTOM_EDITABLES) {
    const claveFrontend = campo.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(data, claveFrontend)) {
      columnas.push(campo);
      valores.push(data[claveFrontend]);
    }
  }

  if (columnas.length === 0) return jsonError('No hay campos para guardar.');

  // Upsert dinámico: crea la fila si no existe, o actualiza solo las columnas enviadas.
  const placeholders = columnas.map((_, i) => `$${i + 4}`);
  const sets = columnas.map((c, i) => `${c} = $${i + 4}`).join(', ');

  await client.query(
    `insert into leads_bottom (id_prometeo, campana, asesor, ${columnas.join(', ')})
     values ($1, $2, $3, ${placeholders.join(', ')})
     on conflict (id_prometeo, campana) do update set
       ${sets}, actualizado_en = now()`,
    [idPrometeo, campana, sesion.nombre || '', ...valores]
  );

  return jsonOk({ message: 'Guardado correctamente.' });
}

export async function addComment(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ASESOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const idPrometeo = String(body.id || '').trim();
  const campana = String(body.campana || '').trim();
  const texto = String(body.texto || body.comentario || '').trim();
  if (!idPrometeo || !campana || !texto) return jsonError('Falta id, campaña o texto del comentario.');

  const nuevoComentario = {
    autor: sesion.nombre || sesion.usuario,
    texto,
    fecha: new Date().toISOString(),
  };

  // jsonb_insert al inicio del array (equivalente a unshift en el historial).
  const result = await client.query(
    `insert into leads_bottom (id_prometeo, campana, asesor, comentarios_historial)
     values ($1, $2, $3, jsonb_build_array($4::jsonb))
     on conflict (id_prometeo, campana) do update set
       comentarios_historial = jsonb_build_array($4::jsonb) || coalesce(leads_bottom.comentarios_historial, '[]'::jsonb),
       actualizado_en = now()
     returning comentarios_historial`,
    [idPrometeo, campana, sesion.nombre || '', JSON.stringify(nuevoComentario)]
  );

  return jsonOk({ data: { COMENTARIOS_HISTORIAL: JSON.stringify(result.rows[0].comentarios_historial) } });
}
