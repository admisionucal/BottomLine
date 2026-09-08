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
  'dolor_necesidad', 'opcion_institucion', 'opcion_nombre_institucion',
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
  'dolor_necesidad', 'opcion_institucion', 'opcion_nombre_institucion',
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

  const asesorVigente = await resolverAsesorVigente(client, idPrometeo, campana);
  const asesorEmail = esRolSupervisorOAdmision(sesion.rol)
    ? String(body.asesorEmail || asesorVigente || sesion.email).trim().toLowerCase()
    : sesion.email.trim().toLowerCase();
  if (!asesorEmail) return jsonError('Falta el email del asesor.');

  const data = body.data || {};

  if (data.TIPO_INSTITUCION_PROCEDENCIA !== undefined && String(data.TIPO_INSTITUCION_PROCEDENCIA).trim() !== '') {
    const valor = String(data.TIPO_INSTITUCION_PROCEDENCIA).trim().toUpperCase();
    if (valor !== 'UNIVERSIDAD' && valor !== 'INSTITUTO') {
      return jsonError('TIPO_INSTITUCION_PROCEDENCIA debe ser UNIVERSIDAD o INSTITUTO');
    }
    data.TIPO_INSTITUCION_PROCEDENCIA = valor;
  }

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

  // Institución de "Otras opciones" del Perfilamiento (independiente de
  // TIPO_INSTITUCION_PROCEDENCIA/INSTITUCION_PROCEDENCIA de traslados,
  // pero comparten el mismo catálogo).
  if (data.OPCION_NOMBRE_INSTITUCION !== undefined && String(data.OPCION_NOMBRE_INSTITUCION).trim() !== '') {
    const nombreNorm = normalizarCatalogo(String(data.OPCION_NOMBRE_INSTITUCION));
    await client.query(
      `insert into catalogo_instituciones_procedencia (nombre, tipo) values ($1, $2)
       on conflict (nombre) do nothing`,
      [nombreNorm, data.OPCION_INSTITUCION || '']
    );
    data.OPCION_NOMBRE_INSTITUCION = nombreNorm;
  }

  if (data.DOLOR_NECESIDAD !== undefined && String(data.DOLOR_NECESIDAD).trim() !== '') {
    const nombreNorm = normalizarCatalogo(String(data.DOLOR_NECESIDAD));
    const existente = await client.query(
      `select nombre from catalogo_perfilamiento where tipo = 'dolor_necesidad' and nombre = $1`,
      [nombreNorm]
    );
    if (existente.rows.length === 0) {
      const cantidadPalabras = nombreNorm.split(/\s+/).filter(Boolean).length;
      if (cantidadPalabras > 5) {
        return jsonError('El nombre de Dolor/Necesidad debe tener máximo 5 palabras.');
      }
      const descripcionNueva = String(data.DOLOR_DESCRIPCION_NUEVA || '').trim();
      if (!descripcionNueva) {
        return jsonError('Debes indicar una descripción para el nuevo Dolor/Necesidad.');
      }
      await client.query(
        `insert into catalogo_perfilamiento (tipo, nombre, descripcion) values ('dolor_necesidad', $1, $2)`,
        [nombreNorm, descripcionNueva]
      );
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

  const tocaPerfil = CAMPOS_PERFIL.some((c) => Object.prototype.hasOwnProperty.call(data, c.toUpperCase()));
  let historialAppend: any = null;

  try {
    await client.query('begin');

    await consolidarFilaBottom(client, idPrometeo, campana, asesorEmail);

    if (tocaPerfil) {
      const actual = await client.query(
        `select ${CAMPOS_PERFIL.join(', ')} from leads_bottom
         where id_prometeo = $1 and campana = $2 and lower(asesor_email) = $3`,
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

    if (columnas.length === 0 && !historialAppend) {
      await client.query('rollback');
      return jsonError('No hay campos para guardar.');
    }

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

    await client.query('commit');
  } catch (e: any) {
    await client.query('rollback');
    return jsonError('Error al guardar: ' + (e?.message || String(e)));
  }

  return jsonOk({ message: 'Guardado correctamente.' });
}

export async function addComment(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ASESOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const idPrometeo = String(body.id || '').trim();
  const campana = String(body.campana || '').trim();
  const texto = String(body.comentario || '').trim();
  if (!idPrometeo || !campana || !texto) return jsonError('Falta id, campaña o texto del comentario.');

  const asesorVigente = await resolverAsesorVigente(client, idPrometeo, campana);
  const asesorEmail = esRolSupervisorOAdmision(sesion.rol)
    ? String(body.asesorEmail || asesorVigente || sesion.email).trim().toLowerCase()
    : sesion.email.trim().toLowerCase();
  if (!asesorEmail) return jsonError('Falta el email del asesor.');

  const nuevoComentario = {
    tipo: 'comentario',
    fecha: new Date().toISOString(),
    usuario: body.usuario || sesion.nombre || sesion.usuario,
    usuarioEmail: sesion.email,
    texto,
  };

  try {
    await client.query('begin');

    await consolidarFilaBottom(client, idPrometeo, campana, asesorEmail);

    const result = await client.query(
      `insert into leads_bottom (id_prometeo, campana, asesor_email, comentarios_historial)
       values ($1, $2, $3, jsonb_build_array($4::jsonb))
       on conflict (id_prometeo, campana, asesor_email) do update set
         comentarios_historial = coalesce(leads_bottom.comentarios_historial, '[]'::jsonb) || jsonb_build_array($4::jsonb),
         actualizado_en = now()
       returning comentarios_historial`,
      [idPrometeo, campana, asesorEmail, JSON.stringify(nuevoComentario)]
    );

    await client.query('commit');
    return jsonOk({ data: { COMENTARIOS_HISTORIAL: JSON.stringify(result.rows[0].comentarios_historial) } });
  } catch (e: any) {
    await client.query('rollback');
    return jsonError('Error al comentar: ' + (e?.message || String(e)));
  }
}

// Igual que en unifyIds.ts: nunca truena si el JSON viene mal.
function parsearHistorial(raw: any): any[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

// El asesor "vigente" de un lead: mismo criterio que usa el JOIN de getLeads.
async function resolverAsesorVigente(client: Client, idPrometeo: string, campana: string): Promise<string | null> {
  const r = await client.query(
    `select u.email
     from leads l
     join usuarios u on lower(u.usuario) = lower(l.asesor) or lower(u.nombre) = lower(l.asesor)
     where l.id_prometeo = $1 and l.campana = $2
     limit 1`,
    [idPrometeo, campana]
  );
  const email = r.rows[0]?.email;
  return email ? String(email).trim().toLowerCase() : null;
}

// Garantiza que, antes de guardar, exista COMO MÁXIMO una fila de leads_bottom para este lead, y que sea la del asesor vigente.
async function consolidarFilaBottom(client: Client, idPrometeo: string, campana: string, asesorVigente: string) {
  const filas = await client.query(
    `select * from leads_bottom where id_prometeo = $1 and campana = $2`,
    [idPrometeo, campana]
  );
  if (filas.rows.length <= 1) return;

  const yaTieneVigente = filas.rows.some((f: any) => String(f.asesor_email).toLowerCase() === asesorVigente);
  let otras = filas.rows.filter((f: any) => String(f.asesor_email).toLowerCase() !== asesorVigente);
  if (otras.length === 0) return;

  if (!yaTieneVigente) {
    // Renombra la primera huérfana en vez de crear una fila nueva.
    const primera = otras[0];
    await client.query(
      `update leads_bottom set asesor_email = $1, actualizado_en = now()
       where id_prometeo = $2 and campana = $3 and asesor_email = $4`,
      [asesorVigente, idPrometeo, campana, primera.asesor_email]
    );
    otras = otras.slice(1);
    if (otras.length === 0) return;
  }

  const destino = (
    await client.query(
      `select * from leads_bottom where id_prometeo = $1 and campana = $2 and lower(asesor_email) = $3`,
      [idPrometeo, campana, asesorVigente]
    )
  ).rows[0];

  // Fusiona historial y rellena solo los campos que el destino tenía vacíos.
  let historialFinal = parsearHistorial(destino.comentarios_historial);
  const relleno: Record<string, any> = {};

  for (const fila of otras) {
    historialFinal = historialFinal.concat(parsearHistorial(fila.comentarios_historial));
    for (const campo of CAMPOS_BOTTOM_EDITABLES) {
      const valorActual = Object.prototype.hasOwnProperty.call(relleno, campo) ? relleno[campo] : destino[campo];
      const vacioActual = valorActual === null || valorActual === undefined || String(valorActual).trim() === '';
      const valorOtra = fila[campo];
      const otraTieneValor = valorOtra !== null && valorOtra !== undefined && String(valorOtra).trim() !== '';
      if (vacioActual && otraTieneValor) relleno[campo] = valorOtra;
    }
  }
  historialFinal.sort((a: any, b: any) => new Date(a.fecha || 0).getTime() - new Date(b.fecha || 0).getTime());

  const params: any[] = [idPrometeo, campana, JSON.stringify(historialFinal)];
  const camposRelleno = Object.keys(relleno);
  const sets = camposRelleno.map((c) => {
    params.push(relleno[c]);
    return `${c} = $${params.length}`;
  });
  params.push(asesorVigente);
  const asesorParamIdx = params.length;

  await client.query(
    `update leads_bottom set comentarios_historial = $3::jsonb${sets.length ? ', ' + sets.join(', ') : ''}, actualizado_en = now()
     where id_prometeo = $1 and campana = $2 and lower(asesor_email) = $${asesorParamIdx}`,
    params
  );

  await client.query(
    `delete from leads_bottom where id_prometeo = $1 and campana = $2 and lower(asesor_email) <> $3`,
    [idPrometeo, campana, asesorVigente]
  );
}