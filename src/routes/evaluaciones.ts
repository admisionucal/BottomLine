import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody, type Env } from '../types';
import { exigirSesion } from '../lib/session';

const SQL_ASIGNADA_A = (evalAlias: string, evaluacionIdExpr: string, usuarioParam: string) => `(
  not ${evalAlias}.asignado_a_nadie
  and (
    not exists (select 1 from evaluacion_asignaciones ea where ea.evaluacion_id = ${evaluacionIdExpr})
    or exists (
      select 1 from evaluacion_asignaciones ea
      where ea.evaluacion_id = ${evaluacionIdExpr} and ea.usuario = ${usuarioParam}
    )
  )
)`;

export async function getEvaluaciones(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, null);
  if (!sesion) return jsonError(error!);

  const esAdmin = sesion.rol === 'SUPERVISOR' || sesion.rol === 'ADMISION';

  const result = await client.query(
    `select e.id, e.codigo, e.titulo, e.descripcion, e.archivo, e.orden,
          e.activo_desde as "activoDesde", e.activo_hasta as "activoHasta",
          e.duracion_minutos as "duracionMinutos",
          e.asignado_a_nadie as "asignadoANadie",
          i.puntaje_obtenido, i.puntaje_maximo, i.porcentaje, i.finalizado_en,
          (select count(*) from evaluacion_asignaciones ea where ea.evaluacion_id = e.id) as "totalAsignados",
          (select count(*) from usuarios u
            where upper(u.rol) = 'ASESOR' and u.activo = true
              and ${SQL_ASIGNADA_A('e', 'e.id', 'u.usuario')}) as "totalAsesores",
          (select count(*) from evaluacion_intentos i2
            join usuarios u2 on u2.usuario = i2.usuario
            where i2.evaluacion_id = e.id
              and upper(u2.rol) = 'ASESOR' and u2.activo = true
              and ${SQL_ASIGNADA_A('e', 'e.id', 'u2.usuario')}) as "completados"
    from evaluaciones e
    left join evaluacion_intentos i on i.evaluacion_id = e.id and i.usuario = $1
    where e.activo = true
      and ($2::boolean = true or ${SQL_ASIGNADA_A('e', 'e.id', '$1')})
    order by e.orden, e.id`,
    [sesion.usuario, esAdmin]
  );

  const data = result.rows.map((ev) => {
    const completado = ev.finalizado_en !== null;
    let estado = 'Pendiente';

    if (completado) {
      estado = 'Completado';
    } else {
      const v = estadoVentana(ev.activoDesde, ev.activoHasta);
      if (v === 'no_iniciada') estado = 'No disponible aún';
      else if (v === 'cerrada') estado = 'Cerrada';
    }

    return {
      id: ev.id,
      codigo: ev.codigo,
      titulo: ev.titulo,
      descripcion: ev.descripcion,
      archivo: ev.archivo,
      orden: ev.orden,
      activoDesde: ev.activoDesde,
      activoHasta: ev.activoHasta,
      duracionMinutos: ev.duracionMinutos,
      estado,
      resultado: completado
        ? {
            puntaje_obtenido: ev.puntaje_obtenido,
            puntaje_maximo: ev.puntaje_maximo,
            porcentaje: ev.porcentaje,
            finalizado_en: ev.finalizado_en,
          }
        : null,
      ...(esAdmin
        ? {
            totalAsesores: Number(ev.totalAsesores) || 0,
            completados: Number(ev.completados) || 0,
            totalAsignados: Number(ev.totalAsignados) || 0,
            asignadoATodos: Number(ev.totalAsignados) === 0 && !ev.asignadoANadie,
            asignadoANadie: !!ev.asignadoANadie,
          }
        : {}),
    };
  });

  return jsonOk({ data, rol: sesion.rol });
}

export async function getEstadoEvaluacion(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, null);
  if (!sesion) return jsonError(error!);

  const codigo = String(body.codigo || '').trim();
  if (!codigo) return jsonError('Falta el código de la evaluación.');

  const ev = await client.query(
    `select id, titulo, activo_desde as "activoDesde", activo_hasta as "activoHasta",
            duracion_minutos as "duracionMinutos"
    from evaluaciones where codigo = $1 and activo = true`,
    [codigo]
  );

  if (!ev.rowCount) {
    return jsonError('La evaluación no existe o no está activa.');
  }

  const evaluacionId = ev.rows[0].id;

  if (sesion.rol === 'ASESOR') {
    const asignada = await client.query(
      `select ${SQL_ASIGNADA_A('e', '$1', '$2')} as "leToca" from evaluaciones e where e.id = $1`,
      [evaluacionId, sesion.usuario]
    );
    if (!asignada.rows[0].leToca) {
      return jsonError('Esta evaluación no está asignada a tu usuario.');
    }
  }

  const intento = await client.query(
    `select puntaje_obtenido, puntaje_maximo, porcentaje, respuestas, detalle, finalizado_en, duracion_segundos, por_tiempo
    from evaluacion_intentos where evaluacion_id = $1 and usuario = $2`,
    [evaluacionId, sesion.usuario]
  );

  if (!intento.rowCount) {
    const v = estadoVentana(
      ev.rows[0].activoDesde,
      ev.rows[0].activoHasta
    );

    if (v === 'no_iniciada') {
      return jsonError(
        `Esta evaluación estará disponible a partir del ${new Date(
          ev.rows[0].activoDesde
        ).toLocaleString('es-PE')}.`
      );
    }

    if (v === 'cerrada') {
      return jsonError(
        `Esta evaluación cerró el ${new Date(
          ev.rows[0].activoHasta
        ).toLocaleString('es-PE')}.`
      );
    }
  }

  return jsonOk({
    evaluacion: ev.rows[0],
    intento: intento.rowCount ? intento.rows[0] : null,
  });
}

export async function guardarIntentoEvaluacion(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['ASESOR']);
  if (!sesion) return jsonError(error!);

  const codigo = String(body.codigo || '').trim();
  if (!codigo) return jsonError('Falta el código de la evaluación.');

  const ev = await client.query(
    `select id, activo_desde as "activoDesde", activo_hasta as "activoHasta"
    from evaluaciones where codigo = $1 and activo = true`,
    [codigo]
  );
  if (!ev.rowCount) return jsonError('La evaluación no existe o no está activa.');

  const v = estadoVentana(ev.rows[0].activoDesde, ev.rows[0].activoHasta);
  if (v !== 'disponible') {
    return jsonError('Esta evaluación no está disponible en este momento (fuera de la ventana de fechas configurada).');
  }
  const evaluacionId = ev.rows[0].id;

  const asignada = await client.query(
    `select ${SQL_ASIGNADA_A('e', '$1', '$2')} as "leToca" from evaluaciones e where e.id = $1`,
    [evaluacionId, sesion.usuario]
  );
  if (!asignada.rows[0].leToca) {
    return jsonError('Esta evaluación no está asignada a tu usuario.');
  }

  const yaExiste = await client.query(
    `select 1 from evaluacion_intentos where evaluacion_id = $1 and usuario = $2`,
    [evaluacionId, sesion.usuario]
  );
  if (yaExiste.rowCount) return jsonError('Esta evaluación ya fue enviada. No se puede volver a resolver.');

  const usuarioInfo = await client.query(`select campana from usuarios where usuario = $1`, [sesion.usuario]);
  const campana = usuarioInfo.rows[0]?.campana || null;

  const puntajeObtenido = Number(body.puntajeObtenido) || 0;
  const puntajeMaximo = Number(body.puntajeMaximo) || 0;
  const porcentaje = puntajeMaximo > 0 ? Math.round((puntajeObtenido / puntajeMaximo) * 10000) / 100 : 0;

  await client.query(
    `insert into evaluacion_intentos
       (evaluacion_id, usuario, nombre, campana, puntaje_obtenido, puntaje_maximo, porcentaje,
        respuestas, detalle, iniciado_en, finalizado_en, duracion_segundos, por_tiempo)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      evaluacionId, sesion.usuario, sesion.nombre, campana,
      puntajeObtenido, puntajeMaximo, porcentaje,
      JSON.stringify(body.respuestas || {}), JSON.stringify(body.detalle || null),
      body.iniciadoEn ? new Date(body.iniciadoEn) : null,
      body.finalizadoEn ? new Date(body.finalizadoEn) : new Date(),
      body.duracionSegundos ? Number(body.duracionSegundos) : null,
      !!body.porTiempo,
    ]
  );

  return jsonOk({ guardado: true, porcentaje });
}

export async function getResultadosEvaluacion(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const codigo = String(body.codigo || '').trim();
  if (!codigo) return jsonError('Falta el código de la evaluación.');

  const ev = await client.query(`select id, titulo from evaluaciones where codigo = $1`, [codigo]);
  if (!ev.rowCount) return jsonError('La evaluación no existe.');

  const result = await client.query(
    `select u.usuario, coalesce(u.nombre_aux, u.nombre) as nombre, u.campana,
            i.puntaje_obtenido, i.puntaje_maximo, i.porcentaje, i.finalizado_en, i.duracion_segundos, i.por_tiempo
    from usuarios u
    cross join evaluaciones e
    left join evaluacion_intentos i on i.evaluacion_id = $1 and i.usuario = u.usuario
    where e.id = $1 and upper(u.rol) = 'ASESOR' and u.activo = true
      and ${SQL_ASIGNADA_A('e', '$1', 'u.usuario')}
    order by nombre`,
    [ev.rows[0].id]
  );

  const data = result.rows.map((r) => ({
    usuario: r.usuario,
    nombre: r.nombre,
    campana: r.campana,
    estado: r.finalizado_en ? 'Completado' : 'Pendiente',
    puntajeObtenido: r.puntaje_obtenido,
    puntajeMaximo: r.puntaje_maximo,
    porcentaje: r.porcentaje,
    finalizadoEn: r.finalizado_en,
    duracionSegundos: r.duracion_segundos,
    porTiempo: r.por_tiempo,
  }));

  return jsonOk({ evaluacion: ev.rows[0], data });
}

export async function getDetalleIntentoEvaluacion(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const codigo = String(body.codigo || '').trim();
  const usuario = String(body.usuario || '').trim();
  if (!codigo || !usuario) return jsonError('Faltan datos para obtener el detalle.');

  const result = await client.query(
    `select i.respuestas, i.detalle, i.puntaje_obtenido, i.puntaje_maximo, i.porcentaje,
            i.finalizado_en, i.duracion_segundos, i.por_tiempo,
            coalesce(u.nombre_aux, u.nombre) as nombre
     from evaluacion_intentos i
     join evaluaciones e on e.id = i.evaluacion_id
     join usuarios u on u.usuario = i.usuario
     where e.codigo = $1 and i.usuario = $2`,
    [codigo, usuario]
  );
  if (!result.rowCount) return jsonError('Este asesor todavía no resolvió la evaluación.');

  return jsonOk({ data: result.rows[0] });
}

export async function getAsignacionesEvaluacion(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const codigo = String(body.codigo || '').trim();
  if (!codigo) return jsonError('Falta el código de la evaluación.');

  const ev = await client.query(`select id, asignado_a_nadie from evaluaciones where codigo = $1`, [codigo]);
  if (!ev.rowCount) return jsonError('La evaluación no existe.');

  const result = await client.query(
    `select usuario from evaluacion_asignaciones where evaluacion_id = $1 order by usuario`,
    [ev.rows[0].id]
  );

  return jsonOk({ usuarios: result.rows.map((r) => r.usuario), asignadoANadie: ev.rows[0].asignado_a_nadie });
}

export async function guardarAsignacionesEvaluacion(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const codigo = String(body.codigo || '').trim();
  if (!codigo) return jsonError('Falta el código de la evaluación.');

  const ev = await client.query(`select id from evaluaciones where codigo = $1`, [codigo]);
  if (!ev.rowCount) return jsonError('La evaluación no existe.');
  const evaluacionId = ev.rows[0].id;

  const asignadoANadie = !!body.asignadoANadie;
  const usuarios = asignadoANadie
    ? []
    : Array.isArray(body.usuarios)
      ? Array.from(new Set(body.usuarios.map((u: any) => String(u).trim()).filter(Boolean)))
      : [];

  try {
    await client.query('begin');
    await client.query(`update evaluaciones set asignado_a_nadie = $2 where id = $1`, [evaluacionId, asignadoANadie]);
    await client.query(`delete from evaluacion_asignaciones where evaluacion_id = $1`, [evaluacionId]);
    for (const usuario of usuarios) {
      await client.query(
        `insert into evaluacion_asignaciones (evaluacion_id, usuario, asignado_por)
         values ($1, $2, $3)
         on conflict (evaluacion_id, usuario) do nothing`,
        [evaluacionId, usuario, sesion.email || sesion.usuario]
      );
    }
    await client.query('commit');
  } catch (e: any) {
    await client.query('rollback');
    return jsonError('Error al guardar la asignación: ' + (e?.message || String(e)));
  }

  return jsonOk({
    asignados: usuarios.length,
    asignadoATodos: !asignadoANadie && usuarios.length === 0,
    asignadoANadie,
  });
}

const MODELO_IA = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export async function calificarConIA(client: Client, body: JsonBody, env: Env) {
  const { sesion, error } = await exigirSesion(client, body, ['ASESOR']);
  if (!sesion) return jsonError(error!);

  const codigo = String(body.codigo || '').trim();
  const prompt = String(body.prompt || '').trim();
  if (!codigo || !prompt) return jsonError('Faltan datos para calificar.');
  if (prompt.length > 20000) return jsonError('La respuesta a calificar es demasiado larga.');

  const ev = await client.query(`select id from evaluaciones where codigo = $1 and activo = true`, [codigo]);
  if (!ev.rowCount) return jsonError('La evaluación no existe o no está activa.');

  if (!env.AI) return jsonError('Workers AI no está habilitado en este Worker.');

  try {
    const salida: any = await env.AI.run(MODELO_IA, {
      messages: [
        { role: 'system', content: 'Respondes ÚNICAMENTE con JSON válido, sin texto adicional ni bloques de código.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 1500,
    });

    const texto = String(salida?.response ?? '').trim();
    const limpio = texto.replace(/^```json\s*|^```\s*|```\s*$/gm, '').trim();
    const parsed = JSON.parse(limpio);
    if (!Array.isArray(parsed)) return jsonError('La IA no devolvió el formato esperado.');

    return jsonOk({ data: parsed });
  } catch (err: any) {
    return jsonError('No se pudo calificar con IA: ' + err.message);
  }
}

type EstadoVentana = 'disponible' | 'no_iniciada' | 'cerrada';

function estadoVentana(activoDesde: Date | null, activoHasta: Date | null): EstadoVentana {
  const ahora = new Date();
  if (activoDesde && ahora < activoDesde) return 'no_iniciada';
  if (activoHasta && ahora > activoHasta) return 'cerrada';
  return 'disponible';
}

function parseFechaLima(valor: unknown): Date | null {
  if (!valor) return null;
  const str = String(valor).trim();
  if (!str) return null;

  const tieneOffset = /Z$|[+-]\d{2}:\d{2}$/.test(str);
  const fecha = new Date(tieneOffset ? str : `${str}-05:00`);

  if (isNaN(fecha.getTime())) return null;
  return fecha;
}

export async function guardarVentanaEvaluacion(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const codigo = String(body.codigo || '').trim();
  if (!codigo) return jsonError('Falta el código de la evaluación.');

  if (body.activoDesde && !parseFechaLima(body.activoDesde)) {
    return jsonError('La fecha de inicio no es válida.');
  }
  if (body.activoHasta && !parseFechaLima(body.activoHasta)) {
    return jsonError('La fecha de cierre no es válida.');
  }

  const activoDesde = parseFechaLima(body.activoDesde);
  const activoHasta = parseFechaLima(body.activoHasta);
  if (activoDesde && activoHasta && activoDesde >= activoHasta) {
    return jsonError('"Activo desde" debe ser anterior a "Activo hasta".');
  }

  const duracionMinutos = Number(body.duracionMinutos);
  if (!Number.isInteger(duracionMinutos) || duracionMinutos < 1 || duracionMinutos > 480) {
    return jsonError('La duración debe ser un número entero de minutos, entre 1 y 480.');
  }

  const result = await client.query(
    `update evaluaciones set activo_desde = $2, activo_hasta = $3, duracion_minutos = $4 where codigo = $1`,
    [codigo, activoDesde, activoHasta, duracionMinutos]
  );
  if (!result.rowCount) return jsonError('La evaluación no existe.');

  return jsonOk();
}