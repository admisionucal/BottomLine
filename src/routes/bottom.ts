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
  'dolor_necesidad',
  // Montos y aprobación (columnas nuevas de bottom{campaña})
  'descuento_matricula', 'matricula_final',
  'descuento_admision', 'admision_final', 'rinde_examen_suficiencia',
  'estado_aprobacion', 'aprobado_por', 'fecha_aprobacion',
] as const;

// Mismo array CAMPOS_PERFIL que en code.gs: si se toca cualquiera de estos,
// se guarda una "foto" completa en el historial (perfil_snapshot).
const CAMPOS_PERFIL = [
  'por_que_eligio_carrera', 'que_busca_universidad', 'quien_financiara',
  'acciones_definidas', 'que_le_falta', 'otras_opciones', 'comentarios_perfil',
  'dolor_necesidad',
] as const;

function esRolSupervisorOAdmision(rol: string) {
  return rol === 'SUPERVISOR' || rol === 'ADMISION';
}

function normalizarCatalogo(v: string) {
  return v.trim().toUpperCase().replace(/\s+/g, ' ');
}

export async function saveBottom(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ASESOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const idPrometeo = String(body.idPrometeo || '').trim();
  const campana = String(body.campana || '').trim();
  if (!idPrometeo || !campana) return jsonError('Falta id o campaña.');

  const asesorEmail = esRolSupervisorOAdmision(sesion.rol)
    ? String(body.asesorEmail || sesion.email).trim()
    : sesion.email.trim();
  if (!asesorEmail) return jsonError('Falta el email del asesor.');

  const data = body.data || {};

  // Igual que validarTipoInstitucionProcedencia() real.
  if (data.TIPO_INSTITUCION_PROCEDENCIA !== undefined && String(data.TIPO_INSTITUCION_PROCEDENCIA).trim() !== '') {
    const valor = String(data.TIPO_INSTITUCION_PROCEDENCIA).trim().toUpperCase();
    if (valor !== 'UNIVERSIDAD' && valor !== 'INSTITUTO') {
      return jsonError('TIPO_INSTITUCION_PROCEDENCIA debe ser UNIVERSIDAD o INSTITUTO');
    }
    data.TIPO_INSTITUCION_PROCEDENCIA = valor;
  }

  // Igual que upsertInstitucionProcedencia()/upsertCarreraProcedencia().
  if (data.INSTITUCION_PROCEDENCIA !== undefined && String(data.INSTITUCION_PROCEDENCIA).trim() !== '') {
    const nombreNorm = normalizarCatalogo(String(data.INSTITUCION_PROCEDENCIA));
    await client.query(
      `insert into catalogo_instituciones_procedencia (nombre, tipo) values ($1, $2)
       on conflict (nombre) do nothing`,
      [nombreNorm, data.TIPO_INSTITUCION_PROCEDENCIA || '']
    );
    data.INSTITUCION_PROCEDENCIA = nombreNorm;
  }
  if (data.CARRERA_PROCEDENCIA !== undefined && String(data.CARRERA_PROCEDENCIA).trim() !== '') {
    const nombreNorm = normalizarCatalogo(String(data.CARRERA_PROCEDENCIA));
    await client.query(
      `insert into catalogo_carreras_procedencia (nombre) values ($1) on conflict (nombre) do nothing`,
      [nombreNorm]
    );
    data.CARRERA_PROCEDENCIA = nombreNorm;
  }

  // Igual que upsertDolorNecesidad(): si ya existe en el catálogo, se reusa
  // tal cual; si es nuevo, exige descripción y máximo 5 palabras.
  if (data.DOLOR_NECESIDAD !== undefined && String(data.DOLOR_NECESIDAD).trim() !== '') {
    const nombreNorm = normalizarCatalogo(String(data.DOLOR_NECESIDAD));
    const existente = await client.query(`select nombre from catalogo_dolor_necesidad where nombre = $1`, [
      nombreNorm,
    ]);
    if (existente.rows.length === 0) {
      const cantidadPalabras = nombreNorm.split(/\s+/).filter(Boolean).length;
      if (cantidadPalabras > 5) {
        return jsonError('El nombre de Dolor/Necesidad debe tener máximo 5 palabras.');
      }
      const descripcionNueva = String(data.DOLOR_DESCRIPCION_NUEVA || '').trim();
      if (!descripcionNueva) {
        return jsonError('Debes indicar una descripción para el nuevo Dolor/Necesidad.');
      }
      await client.query(`insert into catalogo_dolor_necesidad (nombre, descripcion) values ($1, $2)`, [
        nombreNorm,
        descripcionNueva,
      ]);
    }
    data.DOLOR_NECESIDAD = nombreNorm;
  }

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
  // completo, leyendo primero los valores actuales para los campos que
  // NO vinieron en este guardado.
  const tocaPerfil = CAMPOS_PERFIL.some((c) => Object.prototype.hasOwnProperty.call(data, c.toUpperCase()));
  let historialAppend: any = null;

  if (tocaPerfil) {
    // OJO: leads_bottom ahora tiene una fila POR ASESOR (id_prometeo, campana,
    // asesor_email), así que hay que filtrar también por asesor_email o
    // se podría leer (y pisar) el snapshot de otro asesor.
    const actual = await client.query(
      `select ${CAMPOS_PERFIL.join(', ')} from leads_bottom
       where id_prometeo = $1 and campana = $2 and asesor_email = $3`,
      [idPrometeo, campana, asesorEmail]
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
    `insert into leads_bottom (id_prometeo, campana, asesor_email, ${columnas.join(', ')}, fecha_ult_modificacion)
     values ($1, $2, $3, ${placeholders.join(', ')}, now())
     on conflict (id_prometeo, campana, asesor_email) do update set
       ${sets.join(', ')},
       actualizado_en = now(), fecha_ult_modificacion = now()`,
    [idPrometeo, campana, asesorEmail, ...valores]
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

  // leads_bottom exige asesor_email (es parte de la llave primaria y es
  // NOT NULL). Mismo criterio de resolución que saveBottom: un
  // SUPERVISOR/ADMISION puede comentar en nombre de otro asesor si lo manda
  // explícito; un ASESOR siempre comenta en su propia fila.
  const asesorEmail = esRolSupervisorOAdmision(sesion.rol)
    ? String(body.asesorEmail || sesion.email).trim()
    : sesion.email.trim();
  if (!asesorEmail) return jsonError('Falta el email del asesor.');

  const nuevoComentario = {
    tipo: 'comentario',
    fecha: new Date().toISOString(),
    usuario: body.usuario || sesion.nombre || sesion.usuario,
    usuarioEmail: sesion.email,
    texto,
  };

  const result = await client.query(
    `insert into leads_bottom (id_prometeo, campana, asesor_email, comentarios_historial)
     values ($1, $2, $3, jsonb_build_array($4::jsonb))
     on conflict (id_prometeo, campana, asesor_email) do update set
       comentarios_historial = coalesce(leads_bottom.comentarios_historial, '[]'::jsonb) || jsonb_build_array($4::jsonb),
       actualizado_en = now()
     returning comentarios_historial`,
    [idPrometeo, campana, asesorEmail, JSON.stringify(nuevoComentario)]
  );

  return jsonOk({ data: { COMENTARIOS_HISTORIAL: JSON.stringify(result.rows[0].comentarios_historial) } });
}