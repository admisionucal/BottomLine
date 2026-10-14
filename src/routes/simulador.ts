import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody, type Env } from '../types';
import { exigirSesion, ROL_SISTEMAS, type Sesion } from '../lib/session';
import { generar, generarJSON, limiteHistorial, proveedorActivo, type MensajeIA } from '../lib/ia';
import {
  CARRERAS,
  CRITERIOS,
  NIVELES,
  COMPORTAMIENTO_LEAD_BASE,
  RUBRICA_BASE,
  FEEDBACK_BASE,
  promptPerfil,
  promptLead,
  FIN_LLAMADA,
  promptAuditor,
  mensajeAuditor,
  calcularPuntajes,
  type PerfilLead,
} from '../lib/simuladorPrompts';

const ROLES_ADMIN = ['SUPERVISOR', 'ADMISION'];

const ROLES_CAPACITACION = [ROL_SISTEMAS];

async function sesionCapacitacion(client: Client, body: JsonBody, soloAdmin = false): Promise<{ sesion: Sesion | null; error?: string }> {
  const { sesion, error } = await exigirSesion(client, body, null);
  if (!sesion) return { sesion: null, error };
  const rolReal = sesion.rolReal || sesion.rol;
  if (!ROLES_CAPACITACION.includes(rolReal) && !ROLES_CAPACITACION.includes(sesion.rol)) {
    return { sesion: null, error: 'Capacitación IA aún no está disponible para tu perfil.' };
  }
  if (soloAdmin && !esAdmin(sesion)) return { sesion: null, error: 'Acceso denegado: privilegios insuficientes.' };
  return { sesion };
}
const MAX_MENSAJES = 160;
const MAX_LARGO_MENSAJE = 2500;
const FRASE_FIN = 'FINALIZAR SIMULACION';
const SIN_RESPUESTA = '[[SIN_RESPUESTA]]';

const esAdmin = (s: Sesion) => ROLES_ADMIN.includes(String(s.rol).toUpperCase());

function normalizar(s: string) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function conocimiento(client: Client): Promise<{ rubrica: string; feedback: string; comportamiento: string }> {
  let filas: any[] = [];
  try {
    filas = (await client.query(`select clave, contenido from sim_conocimiento`)).rows;
  } catch {
    filas = [];
  }
  const m = Object.fromEntries(filas.map((f) => [f.clave, f.contenido]));
  return {
    rubrica: m.rubrica || RUBRICA_BASE,
    feedback: m.feedback || FEEDBACK_BASE,
    comportamiento: m.comportamiento_lead || COMPORTAMIENTO_LEAD_BASE,
  };
}

const VIRTUAL_690 = new Set([
  'comunicacionymarketingdigital',
  'disenodigitaldeinteriores',
  'disenograficopublicitario',
  'disenograficoymarketingdigital',
  'contabilidad',
  'ingenieriadesistemas',
]);
function claveCarrera(c: string) {
  return String(c || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}
function numero(v: any): number | null {
  const s = String(v ?? '').replace(/[^\d.]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function calcularPrecioCorrecto(client: Client, p: PerfilLead) {
  const virtual = p.tipo_ingreso === 'programa_mas2' || p.modalidad_final === 'virtual';
  if (virtual) {
    const escala = VIRTUAL_690.has(claveCarrera(p.carrera_interes)) ? 690 : 650;
    return {
      modalidad: 'virtual',
      tipo_ingreso: p.tipo_ingreso,
      escala_cuota: escala,
      matricula: 0,
      examen_admision: 0,
      becas: 'No hay becas en virtual',
      nota: 'Virtual: escala por carrera, 100% de descuento en matrícula y examen de admisión.',
    };
  }

  const esTraslado = p.tipo_ingreso.startsWith('traslado');
  const monto = esTraslado ? Number(p.institucion_procedencia?.boleta_mensual || 0) : Number(p.colegio?.pension_mensual || 0);
  let filas: any[] = [];
  try {
    filas = (await client.query(`select * from catalogo_boletas`)).rows;
  } catch {
    filas = [];
  }
  const tipoBuscado = esTraslado ? (p.tipo_ingreso.includes('con') ? ['TRASLADO', 'CON'] : ['TRASLADO', 'SIN']) : ['NUEV'];
  const candidatas = filas.filter((f) => {
    const t = normalizar(f.tipo_ingreso);
    if (!esTraslado) return t.includes('NUEV') || t.includes('ORDINARIO') || t.includes('COLEGIO');
    return t.includes('TRASLADO') && (tipoBuscado[1] === 'CON' ? /\bCON\b/.test(t) : /\bSIN\b/.test(t) || !/\bCON\b/.test(t));
  });
  let elegida: any = null;
  for (const f of candidatas) {
    const min = numero(f.boleta_procedencia_min) ?? 0;
    const max = numero(f.boleta_procedencia_max) ?? Number.POSITIVE_INFINITY;
    if (monto >= min && monto <= max) {
      if (!elegida || min > (numero(elegida.boleta_procedencia_min) ?? 0)) elegida = f;
    }
  }
  if (!elegida && candidatas.length) {
    elegida = candidatas
      .filter((f) => (numero(f.boleta_procedencia_min) ?? 0) <= monto)
      .sort((a, b) => (numero(b.boleta_procedencia_min) ?? 0) - (numero(a.boleta_procedencia_min) ?? 0))[0] || null;
  }

  return {
    modalidad: 'semipresencial',
    tipo_ingreso: p.tipo_ingreso,
    monto_referencia: esTraslado ? `boleta en institución de procedencia: S/ ${monto}` : `pensión del colegio (${p.colegio?.tipo}): S/ ${monto}`,
    escala_cuota: elegida ? numero(elegida.boleta_base) : null,
    beca_aplicable: elegida?.beca_aplicable || null,
    cuota_con_beca: elegida ? numero(elegida.boleta_con_beca) : null,
    matricula: esTraslado ? 0 : 95,
    examen_admision: esTraslado ? 0 : 50,
    becas: 'Solo si el lead la pide o hay inconveniente económico',
    nota: elegida
      ? 'Fila tomada de catalogo_boletas.'
      : 'No se encontró la fila en catalogo_boletas; evalúa el precio con criterio y no marques EC-1 salvo error evidente.',
  };
}

export async function simGetPanel(client: Client, body: JsonBody, env: Env) {
  const { sesion, error } = await sesionCapacitacion(client, body);
  if (!sesion) return jsonError(error!);

  const escenarios = (
    await client.query(
      `select id, codigo, titulo, nivel, objetivo, orden from sim_escenarios where activo = true order by orden, id`
    )
  ).rows;

  const asignaciones = (
    await client.query(
      `select a.id, a.escenario_id as "escenarioId", e.titulo, e.nivel, e.objetivo, a.fecha_limite as "fechaLimite",
              s.id as "sesionId", s.puntaje_conversacion as "conversacion", s.puntaje_precision as "precision",
              s.habilitado, s.finalizado_en as "finalizadoEn"
       from sim_asignaciones a
       join sim_escenarios e on e.id = a.escenario_id and e.activo = true
       left join lateral (
         select * from sim_sesiones s
         where s.asignacion_id = a.id and s.estado = 'finalizada'
         order by s.finalizado_en desc limit 1
       ) s on true
       where a.usuario = $1
       order by a.creado_en desc`,
      [sesion.usuario]
    )
  ).rows;

  const historial = (
    await client.query(
      `select s.id, s.canal, s.nivel, s.estado, s.puntaje_conversacion as "conversacion", s.puntaje_precision as "precision",
              s.habilitado, s.iniciado_en as "iniciadoEn", s.finalizado_en as "finalizadoEn",
              coalesce(e.titulo, 'Práctica libre') as titulo, s.perfil_oculto->>'escenario_publico' as "escenarioPublico"
       from sim_sesiones s left join sim_escenarios e on e.id = s.escenario_id
       where s.usuario = $1 and s.estado <> 'abandonada'
       order by s.iniciado_en desc limit 30`,
      [sesion.usuario]
    )
  ).rows;

  const enCurso = historial.find((h) => h.estado === 'en_curso') || null;

  return jsonOk({
    rol: sesion.rol,
    esAdmin: esAdmin(sesion),
    proveedor: proveedorActivo(env),
    niveles: Object.fromEntries(Object.entries(NIVELES).map(([k, v]) => [k, { nombre: v.nombre, detalle: v.detalle }])),
    escenarios,
    asignaciones,
    historial,
    enCurso,
  });
}

async function elegirSemilla(client: Client, filtros: Record<string, any>, interacciones: string[]) {
  const params: any[] = [interacciones];
  const conds: string[] = ['c.activo = true', 'c.n_mensajes_lead >= 3'];
  for (const campo of ['tipo_ingreso', 'carrera', 'modalidad']) {
    if (filtros?.[campo]) {
      params.push(String(filtros[campo]));
      conds.push(`c.${campo} = $${params.length}`);
    }
  }
  const sql = (where: string) => `
    select c.id, c.carrera, c.tipo_ingreso, c.modalidad, c.nivel_interaccion, c.etiqueta, c.telefono, c.mensajes
    from sim_chats_fuente c
    where ${where}
    order by (c.nivel_interaccion = any($1::text[])) desc, random()
    limit 1`;
  let r = await client.query(sql(conds.join(' and ')), params);
  if (!r.rowCount) r = await client.query(sql('c.activo = true and c.n_mensajes_lead >= 3'), [interacciones]);
  return r.rows[0] || null;
}

async function perfilamientoPorTelefono(client: Client, telefono: string) {
  if (!telefono) return null;
  try {
    const r = await client.query(
      `select l.programa, l.modalidad, l.modalidad_ingreso, l.boleta_colegio,
              b.por_que_eligio_carrera, b.que_busca_universidad, b.quien_financiara, b.que_le_falta,
              b.otras_opciones, b.dolor_necesidad, b.tipo_alumno, b.institucion_procedencia,
              b.tipo_institucion_procedencia, b.carrera_procedencia, b.boleta_procedencia
       from leads l
       left join leads_bottom b on b.id_prometeo = l.id_prometeo and b.campana = l.campana
       where right(regexp_replace(coalesce(l.telefono2, ''), '\\D', '', 'g'), 9) = $1
       order by l.actualizado_en desc
       limit 1`,
      [telefono]
    );
    if (!r.rowCount) return null;
    return Object.fromEntries(Object.entries(r.rows[0]).filter(([, v]) => v !== null && String(v).trim() !== ''));
  } catch {
    return null;
  }
}

function muestrasDelLead(mensajes: any[], max = 25): string[] {
  return (Array.isArray(mensajes) ? mensajes : [])
    .filter((m) => m?.r === 'lead' && typeof m.t === 'string' && !m.t.startsWith('[') && m.t.trim().length > 0)
    .map((m) => m.t.replace(/\s+/g, ' ').trim().slice(0, 220))
    .slice(0, max);
}

function validarPerfil(p: any, semilla: any, nivel: number): PerfilLead {
  const nombres = CARRERAS.map((c) => c.nombre);
  const buscar = (n: string) => CARRERAS.find((c) => claveCarrera(c.nombre) === claveCarrera(n));
  let carrera = buscar(p?.carrera_interes) || buscar(semilla?.carrera) || CARRERAS[Math.floor(Math.random() * CARRERAS.length)];
  const tipos = ['nuevo', 'traslado_sin_convalidacion', 'traslado_con_convalidacion', 'programa_mas2'];
  let tipo = tipos.includes(p?.tipo_ingreso) ? p.tipo_ingreso : 'nuevo';
  if (tipo === 'programa_mas2' && !['Diseño Gráfico Publicitario', 'Administración y Marketing', 'Administración y Negocios Internacionales'].includes(carrera.nombre)) {
    tipo = 'traslado_con_convalidacion';
  }
  let modalidad = p?.modalidad_final === 'virtual' ? 'virtual' : 'semipresencial';
  if (tipo === 'programa_mas2') modalidad = 'virtual';
  if (!carrera.modalidades.includes(modalidad as any)) modalidad = carrera.modalidades[0];
  const interacciones = NIVELES[nivel]?.interaccion || ['normal'];
  const interaccion = interacciones.includes(p?.nivel_interaccion) ? p.nivel_interaccion : interacciones[0];
  void nombres;

  return {
    ...p,
    nombre: String(p?.nombre || 'Postulante'),
    edad: Number(p?.edad) || 18,
    distrito: String(p?.distrito || 'Lima'),
    canal_origen: String(p?.canal_origen || 'Formulario web'),
    carrera_interes: carrera.nombre,
    modalidad_interes: ['semipresencial', 'virtual', 'no_sabe'].includes(p?.modalidad_interes) ? p.modalidad_interes : 'no_sabe',
    modalidad_final: modalidad,
    tipo_ingreso: tipo,
    colegio: {
      tipo: p?.colegio?.tipo === 'nacional' ? 'nacional' : 'particular',
      nombre_generico: String(p?.colegio?.nombre_generico || ''),
      pension_mensual: Math.max(0, Number(p?.colegio?.pension_mensual) || 0),
      anio_egreso: Number(p?.colegio?.anio_egreso) || 2025,
    },
    institucion_procedencia: tipo === 'nuevo' ? null : p?.institucion_procedencia || null,
    nivel_interaccion: interaccion,
    nivel_interes: Math.min(10, Math.max(1, Number(p?.nivel_interes) || 5)),
    objecion_principal: {
      declarada: String(p?.objecion_principal?.declarada || ''),
      de_fondo: String(p?.objecion_principal?.de_fondo || ''),
      tipo: ['cabeza', 'pecho', 'pierna'].includes(p?.objecion_principal?.tipo) ? p.objecion_principal.tipo : 'pierna',
    },
    objeciones_secundarias: Array.isArray(p?.objeciones_secundarias) ? p.objeciones_secundarias.slice(0, 2).map(String) : [],
    informacion_oculta: Array.isArray(p?.informacion_oculta) ? p.informacion_oculta.map(String) : [],
    estilo_escritura: String(p?.estilo_escritura || 'mensajes cortos, minúsculas, pocos emojis'),
    escenario_publico: String(p?.escenario_publico || 'Postulante interesado'),
  } as PerfilLead;
}

export async function simIniciar(client: Client, body: JsonBody, env: Env) {
  const { sesion, error } = await sesionCapacitacion(client, body);
  if (!sesion) return jsonError(error!);

  const canal = ['chat', 'llamada', 'video'].includes(body.canal) ? body.canal : 'chat';
  const enfoque = String(body.enfoque || '').slice(0, 300);

  let escenario: any = null;
  let asignacionId: number | null = null;
  if (body.asignacionId) {
    const a = await client.query(
      `select a.id as asignacion_id, a.escenario_id from sim_asignaciones a join sim_escenarios e on e.id = a.escenario_id
       where a.id = $1 and a.usuario = $2 and e.activo = true`,
      [Number(body.asignacionId), sesion.usuario]
    );
    if (!a.rowCount) return jsonError('Esta práctica no está asignada a tu usuario.');
    asignacionId = a.rows[0].asignacion_id;
    escenario = (await client.query(`select * from sim_escenarios where id = $1`, [a.rows[0].escenario_id])).rows[0];
  } else if (body.escenarioId) {
    const e = await client.query(`select * from sim_escenarios where id = $1 and activo = true`, [Number(body.escenarioId)]);
    if (!e.rowCount) return jsonError('El escenario no existe o no está activo.');
    escenario = e.rows[0];
  }
  let nivel = Number(escenario?.nivel || body.nivel || 1);
  if (!NIVELES[nivel]) nivel = 1;
  const objetivo = String(escenario?.objetivo || '');
  const filtros = escenario?.filtros || {};

  await client.query(`update sim_sesiones set estado = 'abandonada' where usuario = $1 and estado = 'en_curso'`, [sesion.usuario]);

  const interacciones = NIVELES[nivel].interaccion;
  const semilla = await elegirSemilla(client, filtros, interacciones);
  const perfilamiento = semilla ? await perfilamientoPorTelefono(client, semilla.telefono) : null;
  const muestras = semilla ? muestrasDelLead(semilla.mensajes) : [];

  let extra: string[] = [];
  try {
    const otro = await client.query(
      `select mensajes from sim_chats_fuente
       where activo = true and nivel_interaccion = any($1::text[]) and id <> $2
       order by random() limit 1`,
      [interacciones, semilla?.id || 0]
    );
    if (otro.rowCount) extra = muestrasDelLead(otro.rows[0].mensajes, 12);
  } catch {
    extra = [];
  }

  const { system, user } = promptPerfil({
    nivel,
    objetivo,
    instruccionesExtra: String(escenario?.instrucciones_extra || ''),
    enfoque,
    filtros,
    semilla: semilla
      ? { carrera: semilla.carrera, tipo_ingreso: semilla.tipo_ingreso, modalidad: semilla.modalidad, nivel_interaccion: semilla.nivel_interaccion, etiqueta: semilla.etiqueta }
      : null,
    perfilamiento,
    muestrasLead: muestras,
  });

  let perfil: PerfilLead;
  let proveedor = '';
  let modelo = '';
  try {
    const r = await generarJSON<any>(env, { system, mensajes: [{ role: 'user', content: user }], maxTokens: 1800, temperatura: 0.95 });
    perfil = validarPerfil(r.data, semilla, nivel);
    proveedor = r.proveedor;
    modelo = r.modelo;
  } catch (e: any) {
    return jsonError('No se pudo generar el cliente simulado: ' + (e?.message || e));
  }

  const ejemplos = [...muestras.slice(0, 14), ...extra.slice(0, 8)];
  const precio = await calcularPrecioCorrecto(client, perfil);
  const usuarioInfo = await client.query(`select campana from usuarios where usuario = $1`, [sesion.usuario]);

  const ins = await client.query(
    `insert into sim_sesiones
       (usuario, nombre, campana, escenario_id, asignacion_id, canal, nivel, enfoque, fuente_chat_id,
        perfil_oculto, precio_correcto, proveedor_ia, modelo_ia)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     returning id, iniciado_en`,
    [
      sesion.usuario, sesion.nombre, usuarioInfo.rows[0]?.campana || null,
      escenario?.id || null, asignacionId, canal, nivel, enfoque, semilla?.id || null,
      JSON.stringify({ ...perfil, _ejemplos: ejemplos }), JSON.stringify(precio), proveedor, modelo,
    ]
  );

  return jsonOk({
    sesionId: ins.rows[0].id,
    encabezado: {
      escenario: perfil.escenario_publico,
      titulo: escenario?.titulo || 'Práctica libre',
      nivel,
      nivelNombre: NIVELES[nivel].nombre,
      objetivo: objetivo || (enfoque ? `Reforzar: ${enfoque}` : 'Conversación comercial completa'),
    },
    ficha: fichaPublica(perfil),
    proveedor,
  });
}

function fichaPublica(p: PerfilLead) {
  return {
    nombre: String(p.nombre || '').split(' ')[0],
    carrera: p.carrera_interes,
    canal: p.canal_origen,
    mensajeFormulario: p.primer_mensaje_formulario || '',
  };
}

async function cargarSesionPropia(client: Client, sesion: Sesion, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
  const r = await client.query(`select * from sim_sesiones where id = $1`, [id]);
  if (!r.rowCount) return null;
  const s = r.rows[0];
  if (s.usuario !== sesion.usuario && !esAdmin(sesion)) return null;
  return s;
}

function recortarHistorial(mensajes: any[], limiteChars: number): any[] {
  let total = 0;
  const out: any[] = [];
  for (let i = mensajes.length - 1; i >= 0; i--) {
    total += String(mensajes[i].t || '').length + 4;
    if (total > limiteChars && out.length > 6) break;
    out.unshift(mensajes[i]);
  }
  return out;
}

export async function simEnviar(client: Client, body: JsonBody, env: Env) {
  const { sesion, error } = await sesionCapacitacion(client, body);
  if (!sesion) return jsonError(error!);

  const s = await cargarSesionPropia(client, sesion, body.sesionId);
  if (!s || s.usuario !== sesion.usuario) return jsonError('Práctica no encontrada.');
  if (s.estado !== 'en_curso') return jsonError('Esta práctica ya terminó.');

  const textos: string[] = (Array.isArray(body.textos) ? body.textos : [body.texto])
    .map((t: any) => String(t ?? '').trim())
    .filter(Boolean)
    .map((t: string) => t.slice(0, MAX_LARGO_MENSAJE));
  if (!textos.length) return jsonError('Mensaje vacío.');

  if (textos.some((t) => normalizar(t) === FRASE_FIN)) {
    const previos = textos.filter((t) => normalizar(t) !== FRASE_FIN);
    if (previos.length) await agregarMensajes(client, s.id, previos.map((t) => ({ r: 'asesor', t })));
    return simFinalizar(client, { ...body, sesionId: s.id }, env);
  }

  const historial: any[] = Array.isArray(s.mensajes) ? s.mensajes : [];
  if (historial.length + textos.length > MAX_MENSAJES) {
    return jsonError('La práctica llegó al máximo de mensajes. Escribe FINALIZAR SIMULACIÓN para ver tu evaluación.');
  }

  const ahora = new Date().toISOString();
  const nuevosAsesor = textos.map((t) => ({ r: 'asesor', t, ts: ahora }));
  const conversacion = recortarHistorial([...historial, ...nuevosAsesor], limiteHistorial(env));

  const perfil = s.perfil_oculto as PerfilLead & { _ejemplos?: string[] };
  const k = await conocimiento(client);
  const esLlamada = s.canal === 'llamada';
  const system = promptLead(perfil, perfil._ejemplos || [], k.comportamiento, s.canal);
  const mensajesIA: MensajeIA[] = conversacion.map((m) => ({
    role: m.r === 'asesor' ? 'user' : 'assistant',
    content: m.t === SIN_RESPUESTA ? '(no respondiste)' : m.t,
  }));

  let texto = '';
  try {
    const r = await generar(env, { system, mensajes: mensajesIA, maxTokens: 350, temperatura: 0.85 });
    texto = r.texto;
  } catch (e: any) {
    await agregarMensajes(client, s.id, nuevosAsesor);
    return jsonError('El cliente no pudo responder (IA): ' + (e?.message || e));
  }

  const colgo = esLlamada && texto.includes(FIN_LLAMADA);
  if (esLlamada) texto = texto.split(FIN_LLAMADA).join(' ').replace(/\[\[SIN_RESPUESTA\]\]/g, '').replace(/\s*\|\|\|\s*/g, ' ').trim();
  const respuestas = esLlamada
    ? limpiarRespuestaLead(texto, perfil.nombre).slice(0, 1)
    : limpiarRespuestaLead(texto, perfil.nombre);
  if (esLlamada && !respuestas.length) respuestas.push(colgo ? 'Ya, gracias. Chau.' : '¿Aló? ¿Sigue ahí?');
  const nuevosLead = respuestas.length
    ? respuestas.map((t) => ({ r: 'lead', t, ts: new Date().toISOString() }))
    : [{ r: 'lead', t: SIN_RESPUESTA, ts: new Date().toISOString() }];

  await agregarMensajes(client, s.id, [...nuevosAsesor, ...nuevosLead]);

  return jsonOk({ respuestas, sinRespuesta: respuestas.length === 0, colgo });
}

function escaparRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function limpiarRespuestaLead(texto: string, nombre: string): string[] {
  if (!texto || texto.includes(SIN_RESPUESTA)) return [];
  const primerNombre = String(nombre || '').split(' ')[0];
  return texto
    .split(/\n?\s*\|\|\|\s*\n?/)
    .map((t) =>
      t
        .replace(new RegExp(`^\\s*(${escaparRegex(primerNombre)}|lead|cliente|L)\\s*:\\s*`, 'i'), '')
        .replace(/^\*[^*]{1,60}\*\s*/g, '')
        .replace(/^\s*["“”]+|["“”]+\s*$/g, '')
        .trim()
    )
    .filter(Boolean)
    .slice(0, 3);
}

async function agregarMensajes(client: Client, id: string, mensajes: any[]) {
  await client.query(`update sim_sesiones set mensajes = mensajes || $2::jsonb where id = $1`, [id, JSON.stringify(mensajes)]);
}

export async function simAbandonar(client: Client, body: JsonBody) {
  const { sesion, error } = await sesionCapacitacion(client, body);
  if (!sesion) return jsonError(error!);
  await client.query(
    `update sim_sesiones set estado = 'abandonada' where id = $1 and usuario = $2 and estado = 'en_curso'`,
    [String(body.sesionId || ''), sesion.usuario]
  );
  return jsonOk();
}

export async function simFinalizar(client: Client, body: JsonBody, env: Env) {
  const { sesion, error } = await sesionCapacitacion(client, body);
  if (!sesion) return jsonError(error!);

  const s0 = await cargarSesionPropia(client, sesion, body.sesionId);
  if (!s0 || s0.usuario !== sesion.usuario) return jsonError('Práctica no encontrada.');
  if (s0.estado === 'finalizada') return simDetalle(client, body);
  if (s0.estado !== 'en_curso') return jsonError('Esta práctica ya no está activa.');

  const s = (await client.query(`select * from sim_sesiones where id = $1`, [s0.id])).rows[0];
  const mensajes: any[] = Array.isArray(s.mensajes) ? s.mensajes : [];
  const delAsesor = mensajes.filter((m) => m.r === 'asesor').length;
  if (delAsesor < 2) return jsonError('La conversación es muy corta para evaluarla. Escribe al menos un par de mensajes.');

  const transcripcionCompleta = mensajes
    .map((m, i) => `${i + 1}. ${m.r === 'asesor' ? 'A' : 'L'}: ${m.t === SIN_RESPUESTA ? '(el lead no respondió)' : m.t}`)
    .join('\n');
  const limite = limiteHistorial(env) - 6000;
  const transcripcion =
    transcripcionCompleta.length > limite
      ? transcripcionCompleta.slice(0, Math.floor(limite * 0.35)) +
        '\n[... parte media omitida por longitud ...]\n' +
        transcripcionCompleta.slice(-Math.floor(limite * 0.65))
      : transcripcionCompleta;

  const escenario = s.escenario_id
    ? (await client.query(`select objetivo from sim_escenarios where id = $1`, [s.escenario_id])).rows[0]
    : null;

  const k = await conocimiento(client);
  let evalIA: any;
  let proveedor = '';
  let modelo = '';
  try {
    const r = await generarJSON<any>(env, {
      system: promptAuditor(k.rubrica, k.feedback),
      mensajes: [
        {
          role: 'user',
          content: mensajeAuditor({
            perfil: s.perfil_oculto,
            precioCorrecto: s.precio_correcto,
            transcripcion,
            nivel: s.nivel,
            objetivo: escenario?.objetivo || s.enfoque || '',
            canal: s.canal,
          }),
        },
      ],
      maxTokens: 3500,
      temperatura: 0.2,
    });
    evalIA = r.data;
    proveedor = r.proveedor;
    modelo = r.modelo;
  } catch (e: any) {
    return jsonError('No se pudo generar la evaluación (IA). Intenta de nuevo en un momento: ' + (e?.message || e));
  }

  const p = calcularPuntajes(evalIA);
  const evaluacion = {
    ...p,
    diagnostico: evalIA?.diagnostico || {},
    ejecutivo: evalIA?.ejecutivo || {},
    perfil_revelado: evalIA?.perfil_revelado || {},
    proveedor,
    modelo,
  };

  await client.query(
    `update sim_sesiones set
       estado = 'finalizada', evaluacion = $2, puntaje_conversacion = $3, puntaje_precision = $4, habilitado = $5,
       finalizado_en = now(), duracion_segundos = extract(epoch from (now() - iniciado_en))::int,
       proveedor_ia = coalesce(nullif(proveedor_ia, ''), $6), modelo_ia = coalesce(nullif(modelo_ia, ''), $7)
     where id = $1`,
    [s.id, JSON.stringify(evaluacion), p.conversacion, p.precision, p.habilitado, proveedor, modelo]
  );

  return simDetalle(client, { ...body, sesionId: s.id });
}

export async function simDetalle(client: Client, body: JsonBody) {
  const { sesion, error } = await sesionCapacitacion(client, body);
  if (!sesion) return jsonError(error!);

  const s = await cargarSesionPropia(client, sesion, body.sesionId);
  if (!s) return jsonError('Práctica no encontrada.');

  const perfil = { ...(s.perfil_oculto || {}) };
  delete perfil._ejemplos;
  const finalizada = s.estado === 'finalizada';
  const escenario = s.escenario_id
    ? (await client.query(`select titulo, objetivo from sim_escenarios where id = $1`, [s.escenario_id])).rows[0]
    : null;

  return jsonOk({
    data: {
      id: s.id,
      usuario: s.usuario,
      nombre: s.nombre,
      canal: s.canal,
      nivel: s.nivel,
      nivelNombre: NIVELES[s.nivel]?.nombre || '',
      titulo: escenario?.titulo || 'Práctica libre',
      objetivo: escenario?.objetivo || (s.enfoque ? `Reforzar: ${s.enfoque}` : ''),
      escenarioPublico: perfil.escenario_publico || '',
      estado: s.estado,
      mensajes: (s.mensajes || []).map((m: any) => ({ r: m.r, t: m.t === SIN_RESPUESTA ? '' : m.t, sinRespuesta: m.t === SIN_RESPUESTA })),
      ficha: fichaPublica(perfil as PerfilLead),
      perfilOculto: finalizada ? perfil : null,
      precioCorrecto: finalizada ? s.precio_correcto : null,
      evaluacion: s.evaluacion,
      conversacion: s.puntaje_conversacion,
      precision: s.puntaje_precision,
      habilitado: s.habilitado,
      iniciadoEn: s.iniciado_en,
      finalizadoEn: s.finalizado_en,
      duracionSegundos: s.duracion_segundos,
      criterios: CRITERIOS,
    },
  });
}

export async function simResultados(client: Client, body: JsonBody) {
  const { sesion, error } = await sesionCapacitacion(client, body, true);
  if (!sesion) return jsonError(error!);

  const params: any[] = [];
  const conds = [`s.estado = 'finalizada'`];
  if (body.desde) { params.push(body.desde); conds.push(`s.finalizado_en >= $${params.length}::date`); }
  if (body.hasta) { params.push(body.hasta); conds.push(`s.finalizado_en < ($${params.length}::date + 1)`); }
  if (body.usuario) { params.push(String(body.usuario)); conds.push(`s.usuario = $${params.length}`); }
  if (body.escenarioId) { params.push(Number(body.escenarioId)); conds.push(`s.escenario_id = $${params.length}`); }

  const r = await client.query(
    `select s.id, s.usuario, coalesce(nullif(u.nombre_aux, ''), u.nombre, s.nombre) as nombre, s.campana, s.canal, s.nivel,
            coalesce(e.titulo, 'Práctica libre') as titulo, (s.asignacion_id is not null) as asignada,
            s.puntaje_conversacion as conversacion, s.puntaje_precision as precision, s.habilitado,
            s.finalizado_en as "finalizadoEn", s.duracion_segundos as "duracionSegundos",
            jsonb_array_length(coalesce(s.evaluacion->'errores', '[]'::jsonb)) as "erroresCriticos"
     from sim_sesiones s
     left join usuarios u on u.usuario = s.usuario
     left join sim_escenarios e on e.id = s.escenario_id
     where ${conds.join(' and ')}
     order by s.finalizado_en desc
     limit 500`,
    params
  );
  return jsonOk({ data: r.rows });
}

export async function simGetEscenarios(client: Client, body: JsonBody) {
  const { sesion, error } = await sesionCapacitacion(client, body, true);
  if (!sesion) return jsonError(error!);
  const r = await client.query(
    `select e.*, (select count(*) from sim_asignaciones a where a.escenario_id = e.id)::int as asignados
     from sim_escenarios e order by e.orden, e.id`
  );
  const chats = await client.query(
    `select tipo_ingreso, count(*)::int as n from sim_chats_fuente where activo = true group by tipo_ingreso order by n desc`
  ).catch(() => ({ rows: [] as any[] }));
  return jsonOk({ data: r.rows, chats: chats.rows, carreras: CARRERAS.map((c) => c.nombre) });
}

export async function simGuardarEscenario(client: Client, body: JsonBody) {
  const { sesion, error } = await sesionCapacitacion(client, body, true);
  if (!sesion) return jsonError(error!);

  const titulo = String(body.titulo || '').trim().slice(0, 200);
  const nivel = Number(body.nivel);
  if (!titulo) return jsonError('Falta el título.');
  if (!NIVELES[nivel]) return jsonError('El nivel debe ser 1, 2, 3 o 4.');

  const filtros: Record<string, string> = {};
  for (const campo of ['tipo_ingreso', 'carrera', 'modalidad']) {
    const v = String(body.filtros?.[campo] || '').trim();
    if (v) filtros[campo] = v;
  }
  const valores = [
    titulo, nivel, String(body.objetivo || '').slice(0, 500), String(body.descripcion || '').slice(0, 1000),
    JSON.stringify(filtros), String(body.instruccionesExtra || '').slice(0, 2000), body.activo !== false,
    Number(body.orden) || 0,
  ];

  if (body.id) {
    const r = await client.query(
      `update sim_escenarios set titulo=$2, nivel=$3, objetivo=$4, descripcion=$5, filtros=$6, instrucciones_extra=$7, activo=$8, orden=$9
       where id=$1 returning id`,
      [Number(body.id), ...valores]
    );
    if (!r.rowCount) return jsonError('El escenario no existe.');
    return jsonOk({ id: r.rows[0].id });
  }
  const codigo = 'esc_' + Date.now().toString(36);
  const r = await client.query(
    `insert into sim_escenarios (codigo, titulo, nivel, objetivo, descripcion, filtros, instrucciones_extra, activo, orden, creado_por)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [codigo, ...valores, sesion.usuario]
  );
  return jsonOk({ id: r.rows[0].id });
}

export async function simGetAsignaciones(client: Client, body: JsonBody) {
  const { sesion, error } = await sesionCapacitacion(client, body, true);
  if (!sesion) return jsonError(error!);
  const escenarioId = Number(body.escenarioId);
  if (!escenarioId) return jsonError('Falta el escenario.');

  const asesores = await client.query(
    `select usuario, coalesce(nullif(nombre_aux, ''), nombre) as nombre, campana from usuarios
     where upper(rol) in ('ASESOR', '${ROL_SISTEMAS}') and coalesce(activo, true) = true order by nombre`
  );
  const asignados = await client.query(
    `select a.usuario, a.fecha_limite as "fechaLimite",
            exists(select 1 from sim_sesiones s where s.asignacion_id = a.id and s.estado = 'finalizada') as completado
     from sim_asignaciones a where a.escenario_id = $1`,
    [escenarioId]
  );
  return jsonOk({ asesores: asesores.rows, asignados: asignados.rows });
}

export async function simGuardarAsignaciones(client: Client, body: JsonBody) {
  const { sesion, error } = await sesionCapacitacion(client, body, true);
  if (!sesion) return jsonError(error!);
  const escenarioId = Number(body.escenarioId);
  if (!escenarioId) return jsonError('Falta el escenario.');

  const usuarios: string[] = Array.from(
    new Set((Array.isArray(body.usuarios) ? body.usuarios : []).map((u: any) => String(u).trim()).filter(Boolean))
  );
  const fechaLimite = body.fechaLimite ? new Date(`${String(body.fechaLimite).slice(0, 10)}T23:59:59-05:00`) : null;
  if (fechaLimite && isNaN(fechaLimite.getTime())) return jsonError('La fecha límite no es válida.');

  try {
    await client.query('begin');
    await client.query(`delete from sim_asignaciones where escenario_id = $1 and not (usuario = any($2::text[]))`, [escenarioId, usuarios]);
    for (const u of usuarios) {
      await client.query(
        `insert into sim_asignaciones (escenario_id, usuario, asignado_por, fecha_limite) values ($1,$2,$3,$4)
         on conflict (escenario_id, usuario) do update set fecha_limite = excluded.fecha_limite`,
        [escenarioId, u, sesion.usuario, fechaLimite]
      );
    }
    await client.query('commit');
  } catch (e: any) {
    await client.query('rollback');
    return jsonError('No se pudo guardar la asignación: ' + (e?.message || e));
  }
  return jsonOk({ asignados: usuarios.length });
}
