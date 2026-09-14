import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody, type Env } from '../types';
import { exigirSesion } from '../lib/session';

// ================================================================
// EVALUACIONES - "Usuarios > Evaluaciones" (resolver: ASESOR,
// visualizar: SUPERVISOR/ADMISION) y "Usuarios > Resultados"
// (SUPERVISOR/ADMISION).
// ================================================================

// ===== Listado para la pantalla "Evaluaciones" =====
// ASESOR: ve cada evaluación activa con su propio estado (Pendiente/Completado).
// SUPERVISOR/ADMISION: ve cada evaluación activa con el avance del equipo
// (cuántos asesores de su campaña ya la completaron).
export async function getEvaluaciones(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, null);
  if (!sesion) return jsonError(error!);

  const result = await client.query(
    `select e.id, e.codigo, e.titulo, e.descripcion, e.archivo, e.orden,
            e.activo_desde as "activoDesde", e.activo_hasta as "activoHasta",
            i.puntaje_obtenido, i.puntaje_maximo, i.porcentaje, i.finalizado_en
     from evaluaciones e
     left join evaluacion_intentos i
       on i.evaluacion_id = e.id and i.usuario = $1
     where e.activo = true
     order by e.orden, e.id`,
    [sesion.usuario]
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
      estado,
      resultado: completado
        ? {
            puntaje_obtenido: ev.puntaje_obtenido,
            puntaje_maximo: ev.puntaje_maximo,
            porcentaje: ev.porcentaje,
            finalizado_en: ev.finalizado_en,
          }
        : null,
    };
  });

  return jsonOk({ data, rol: sesion.rol });
}

// ===== Estado de una evaluación puntual, para el .html que la resuelve =====
// Devuelve si el asesor ya tiene un intento guardado (para no dejarlo repetir
// y mostrarle directamente su resultado, igual que hacía el localStorage).
export async function getEstadoEvaluacion(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, null);
  if (!sesion) return jsonError(error!);

  const codigo = String(body.codigo || '').trim();
  if (!codigo) return jsonError('Falta el código de la evaluación.');

  const ev = await client.query(
    `select id, titulo, activo_desde as "activoDesde", activo_hasta as "activoHasta"
    from evaluaciones where codigo = $1 and activo = true`,
    [codigo]
  );

  if (!ev.rowCount) {
    return jsonError('La evaluación no existe o no está activa.');
  }

  const intento = await client.query(
    `select puntaje_obtenido, puntaje_maximo, porcentaje, respuestas, detalle, finalizado_en, duracion_segundos, por_tiempo
    from evaluacion_intentos where evaluacion_id = $1 and usuario = $2`,
    [ev.rows[0].id, sesion.usuario]
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

// ===== Guardar el intento (solo ASESOR, solo una vez) =====
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

// ===== Pantalla "Resultados" (solo SUPERVISOR/ADMISION) =====
export async function getResultadosEvaluacion(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const codigo = String(body.codigo || '').trim();
  if (!codigo) return jsonError('Falta el código de la evaluación.');

  const ev = await client.query(`select id, titulo from evaluaciones where codigo = $1`, [codigo]);
  if (!ev.rowCount) return jsonError('La evaluación no existe.');

  // Todos los asesores activos, con su intento si lo tienen (left join para
  // que se vea también a quienes aún no la resuelven -> "Pendiente").
  const result = await client.query(
    `select u.usuario, coalesce(u.nombre_aux, u.nombre) as nombre, u.campana,
            i.puntaje_obtenido, i.puntaje_maximo, i.porcentaje, i.finalizado_en, i.duracion_segundos, i.por_tiempo
     from usuarios u
     left join evaluacion_intentos i on i.evaluacion_id = $1 and i.usuario = u.usuario
     where upper(u.rol) = 'ASESOR' and u.activo = true
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

// ===== Detalle de un intento (respuesta por respuesta) para Resultados =====
// ===== Calificación asistida por IA (solo ASESOR, y solo mientras resuelve) =====
// El .html arma el prompt (usa la misma rúbrica que la calificación local) y
// aquí lo corremos contra Cloudflare Workers AI (binding "AI" del Worker,
// sin API key ni cuenta aparte — entra en el tier gratis de 10,000
// Neurons/día). Si algo falla, el frontend cae solo a la calificación local.
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

// ===== Ventana de disponibilidad =====
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

// ===== Configurar ventana de disponibilidad (solo ADMISION) =====
export async function guardarVentanaEvaluacion(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['ADMISION']);
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

  const result = await client.query(
    `update evaluaciones set activo_desde = $2, activo_hasta = $3 where codigo = $1`,
    [codigo, activoDesde, activoHasta]
  );
  if (!result.rowCount) return jsonError('La evaluación no existe.');

  return jsonOk();
}