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
  // Agregados: montos y aprobación (columnas nuevas de bottom{campaña})
  'descuento_matricula', 'matricula_final',
  'descuento_admision', 'admision_final', 'rinde_examen_suficiencia',
  'estado_aprobacion', 'aprobado_por', 'fecha_aprobacion',
] as const;

// Mismo array CAMPOS_PERFIL que en code.gs: si se toca cualquiera de estos,
// se guarda una "foto" completa de los 7 en el historial (perfil_snapshot).
const CAMPOS_PERFIL = [
  'por_que_eligio_carrera', 'que_busca_universidad', 'quien_financiara',
  'acciones_definidas', 'que_le_falta', 'otras_opciones', 'comentarios_perfil',
] as const;

function esRolSupervisorOAdmision(rol: string) {
  return rol === 'SUPERVISOR' || rol === 'ADMISION';
}

export async function saveBottom(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ASESOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  // El frontend manda "idPrometeo", no "id" — igual que body.idPrometeo en saveBottomInterno.
  const idPrometeo = String(body.idPrometeo || '').trim();
  const campana = String(body.campana || '').trim();
  if (!idPrometeo || !campana) return jsonError('Falta id o campaña.');

  // Misma regla que el código real: un SUPERVISOR/ADMISION puede guardar a
  // nombre de otro asesor (body.asesorEmail); un ASESOR siempre usa su propio email.
  const asesorEmail = esRolSupervisorOAdmision(sesion.rol)
    ? String(body.asesorEmail || sesion.email).trim()
    : sesion.email.trim();
  if (!asesorEmail) return jsonError('Falta el email del asesor.');

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

  // ¿Se tocó algún campo de perfilamiento? Si sí, armamos el snapshot
  // completo (igual que saveBottomInterno), leyendo primero los valores
  // actuales para los campos del perfil que NO vinieron en este guardado.
  const tocaPerfil = CAMPOS_PERFIL.some((c) => Object.prototype.hasOwnProperty.call(data, c.toUpperCase()));
  let historialAppend: any = null;

  if (tocaPerfil) {
    const actual = await client.query(
      `select ${CAMPOS_PERFIL.join(', ')} from leads_bottom where id_prometeo = $1 and campana = $2`,
      [idPrometeo, campana]
    );
    const filaActual = actual.rows[0] || {};

    const snapshotNuevo: Record<string, any> = {};
    for (const campo of CAMPOS_PERFIL) {
      const claveFrontend = campo.toUpperCase();
      snapshotNuevo[claveFrontend] = Object.prototype.hasOwnProperty.call(data, claveFrontend)
        ? data[claveFrontend]
        : filaActual[campo] || '';
    }

    historialAppend = {
      tipo: 'perfil_snapshot',
      fecha: new Date().toISOString(),
      usuario: sesion.nombre || sesion.email,
      usuarioEmail: sesion.email,
      datos: snapshotNuevo,
    };
  }

  if (columnas.length === 0 && !historialAppend) return jsonError('No hay campos para guardar.');

  const placeholders = columnas.map((_, i) => `$${i + 4}`);
  const sets = columnas.map((c, i) => `${c} = $${i + 4}`);

  if (historialAppend) {
    columnas.push('comentarios_historial');
    sets.push(
      `comentarios_historial = coalesce(leads_bottom.comentarios_historial, '[]'::jsonb) || jsonb_build_array($${columnas.length + 3}::jsonb)`
    );
    placeholders.push(`jsonb_build_array($${columnas.length + 3}::jsonb)`);
    valores.push(JSON.stringify(historialAppend));
  }

  await client.query(
    `insert into leads_bottom (id_prometeo, campana, asesor, asesor_email, ${columnas.join(', ')}, fecha_ult_modificacion)
     values ($1, $2, $3, $${columnas.length + 4}, ${placeholders.join(', ')}, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
     on conflict (id_prometeo, campana) do update set
       asesor_email = $${columnas.length + 4}, ${sets.join(', ')},
       actualizado_en = now(), fecha_ult_modificacion = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')`,
    [idPrometeo, campana, sesion.nombre || '', ...valores, asesorEmail]
  );

  return jsonOk({ message: 'Guardado correctamente.' });
}

export async function addComment(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ASESOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const idPrometeo = String(body.id || '').trim();
  const campana = String(body.campana || '').trim();
  const texto = String(body.comentario || '').trim();
  if (!idPrometeo || !campana || !texto) return jsonError('Falta id, campaña o texto del comentario.');

  // Misma estructura exacta que genera addComment() en code.gs, para que
  // getLeadDetail (todavía en Apps Script) y el futuro getLeadDetail en
  // Postgres puedan leer el historial sin diferencias de formato.
  const nuevoComentario = {
    tipo: 'comentario',
    fecha: new Date().toISOString(),
    usuario: body.usuario || sesion.nombre || sesion.usuario,
    usuarioEmail: sesion.email,
    texto,
  };

  // Se agrega al FINAL del array (orden cronológico), igual que
  // historial.push(...) en el código real — no al inicio.
  const result = await client.query(
    `insert into leads_bottom (id_prometeo, campana, asesor, comentarios_historial)
     values ($1, $2, $3, jsonb_build_array($4::jsonb))
     on conflict (id_prometeo, campana) do update set
       comentarios_historial = coalesce(leads_bottom.comentarios_historial, '[]'::jsonb) || jsonb_build_array($4::jsonb),
       actualizado_en = now()
     returning comentarios_historial`,
    [idPrometeo, campana, sesion.nombre || '', JSON.stringify(nuevoComentario)]
  );

  return jsonOk({ data: { COMENTARIOS_HISTORIAL: JSON.stringify(result.rows[0].comentarios_historial) } });
}