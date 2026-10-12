import type { Client } from 'pg';
import type { Env } from '../types';
import { generarJSON } from './ia';

// ================================================================
// PROPUESTA DE ABORDAJE (Bottom Line > Análisis > Propuesta)
// ================================================================
//
// 1) El SERVIDOR arma los grupos de leads con reglas fijas (listas exactas,
//    nada inventado por la IA).
// 2) La IA recibe solo conteos y contexto resumido de cada grupo y escribe:
//    - macro: qué hacer con toda la campaña
//    - una acción por grupo
//    - una acción por asesor
// 3) Se guarda en propuestas_abordaje. Si la IA falla, igual se guardan los
//    grupos (con el error), para que las listas sigan siendo útiles.

const VP_VIVA = 'VALORES_VALORACIONES_POSITIVAS_VIVA';
const PP_VIVA = 'VALORES_PROMESA_DE_PAGO_VIVA';
const VOLVER = 'VALORES_VOLVER_A_LLAMAR';
const SIN_CONTACTO = 'VALORES_SIN_CONTACTO';
const DIAS_MAX_SIN_CONTACTO = 3;
const MAX_IDS_POR_GRUPO = 300;
const MAX_ASESORES = 30;

export interface LeadMin {
  id: string;
  asesor: string;
  status: string;
  programa: string;
  modalidad: string;
  ingreso: string;
  fechaCompromiso: string | null; // yyyy-mm-dd (hora Lima)
  diasSinContacto: number | null;
  perfilCompleto: boolean;
  dolor: string;
  queLeFalta: string;
  quienFinancia: string;
  otrasOpciones: string;
  ultimoComentario: string;
}

export const GRUPOS: { clave: string; titulo: string; regla: string; filtro: (l: LeadMin, hoy: string, en2dias: string) => boolean }[] = [
  {
    clave: 'pp_vencida',
    titulo: 'PP Viva con compromiso de pago vencido',
    regla: 'PP Viva cuya fecha de compromiso de pago ya pasó.',
    filtro: (l, hoy) => l.status === PP_VIVA && !!l.fechaCompromiso && l.fechaCompromiso < hoy,
  },
  {
    clave: 'pp_por_vencer',
    titulo: 'PP Viva que vence en las próximas 48 h',
    regla: 'PP Viva con fecha de compromiso hoy, mañana o pasado mañana.',
    filtro: (l, hoy, en2dias) => l.status === PP_VIVA && !!l.fechaCompromiso && l.fechaCompromiso >= hoy && l.fechaCompromiso <= en2dias,
  },
  {
    clave: 'vivas_sin_contacto',
    titulo: `VP/PP Viva con más de ${DIAS_MAX_SIN_CONTACTO} días sin contacto`,
    regla: `VP o PP Viva sin gestión registrada hace más de ${DIAS_MAX_SIN_CONTACTO} días (o sin ninguna).`,
    filtro: (l) => (l.status === VP_VIVA || l.status === PP_VIVA) && (l.diasSinContacto === null || l.diasSinContacto > DIAS_MAX_SIN_CONTACTO),
  },
  {
    clave: 'vivas_perfil_incompleto',
    titulo: 'VP/PP Viva con perfilamiento incompleto',
    regla: 'VP o PP Viva a la que le falta alguna de las 6 preguntas de perfilamiento del asesor.',
    filtro: (l) => (l.status === VP_VIVA || l.status === PP_VIVA) && !l.perfilCompleto,
  },
  {
    clave: 'vivas_objecion_precio',
    titulo: 'VP/PP Viva con objeción de precio o pago',
    regla: 'VP o PP Viva cuyo dolor/necesidad o "qué le falta" menciona precio, pago, beca o dinero.',
    filtro: (l) =>
      (l.status === VP_VIVA || l.status === PP_VIVA) &&
      /precio|pago|pagar|beca|econ[oó]m|dinero|costo|cuota|plata|presupuesto|financ/i.test(`${l.dolor} ${l.queLeFalta}`),
  },
  {
    clave: 'volver_a_llamar',
    titulo: 'Volver a llamar',
    regla: 'Leads en estado Volver a Llamar.',
    filtro: (l) => l.status === VOLVER,
  },
  {
    clave: 'sin_contacto',
    titulo: 'Sin contacto',
    regla: 'Leads en estado Sin Contacto.',
    filtro: (l) => l.status === SIN_CONTACTO,
  },
];

// ---------- Fechas en hora de Lima (UTC-5, sin horario de verano) ----------
function ymdLima(d: Date): string {
  return new Date(d.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}
function parsearFecha(valor: any): string | null {
  const s = String(valor ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : ymdLima(d);
}

function contar(valores: string[], top = 4): { valor: string; n: number }[] {
  const m = new Map<string, number>();
  for (const v of valores) {
    const k = String(v || '').trim();
    if (!k) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([valor, n]) => ({ valor, n }));
}

// ---------- Lectura de leads de una campaña ----------
export async function leerLeadsCampana(client: Client, campana: string): Promise<LeadMin[]> {
  // Mismo cruce que getLeads (leads.ts): el bottom se toma del asesor dueño del lead.
  const r = await client.query(
    `select l.id_prometeo, l.status_gestion, l.programa, l.modalidad, l.modalidad_ingreso,
            l.fecha_compromiso_pago,
            coalesce(nullif(u.nombre_aux, ''), nullif(l.asesor, ''), 'Sin asesor') as asesor,
            b.por_que_eligio_carrera, b.que_busca_universidad, b.quien_financiara, b.que_le_falta,
            b.otras_opciones, b.dolor_necesidad, b.comentarios_historial
     from leads l
     left join usuarios u on lower(u.usuario) = lower(l.asesor) or lower(u.nombre) = lower(l.asesor)
     left join leads_bottom b on b.id_prometeo = l.id_prometeo and b.campana = l.campana
       and lower(b.asesor_email) = lower(u.email)
     left join leads_pagos p on p.id_prometeo = l.id_prometeo and p.campana = l.campana
     where l.campana = $1
       and coalesce(p.status_pago_final, '') not in ('PAGO COMPLETO', 'PAGO FRACCIONADO')
       and l.status_gestion in ($2, $3, $4, $5)`,
    [campana, VP_VIVA, PP_VIVA, VOLVER, SIN_CONTACTO]
  );

  const ahora = Date.now();
  const vacio = (v: any) => !v || String(v).trim() === '';
  // El cruce con usuarios puede repetir un lead (usuario o nombre): se deja uno.
  const vistos = new Set<string>();
  const filas = r.rows.filter((row) => {
    const k = String(row.id_prometeo);
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  return filas.map((row) => {
    let hist: any[] = [];
    try {
      hist = Array.isArray(row.comentarios_historial) ? row.comentarios_historial : JSON.parse(row.comentarios_historial || '[]');
    } catch {
      hist = [];
    }
    const fechas = hist.map((h) => new Date(h?.fecha).getTime()).filter((t) => !isNaN(t));
    const ultima = fechas.length ? Math.max(...fechas) : null;
    const ultimoTexto = [...hist].reverse().find((h) => typeof h?.texto === 'string' && h.texto.trim());
    const perfilCompleto = ![
      row.por_que_eligio_carrera, row.que_busca_universidad, row.quien_financiara,
      row.que_le_falta, row.otras_opciones, row.dolor_necesidad,
    ].some(vacio);

    return {
      id: String(row.id_prometeo),
      asesor: String(row.asesor),
      status: String(row.status_gestion || ''),
      programa: String(row.programa || ''),
      modalidad: String(row.modalidad || ''),
      ingreso: String(row.modalidad_ingreso || ''),
      fechaCompromiso: parsearFecha(row.fecha_compromiso_pago),
      diasSinContacto: ultima === null ? null : Math.floor((ahora - ultima) / 86400000),
      perfilCompleto,
      dolor: String(row.dolor_necesidad || ''),
      queLeFalta: String(row.que_le_falta || ''),
      quienFinancia: String(row.quien_financiara || ''),
      otrasOpciones: String(row.otras_opciones || ''),
      ultimoComentario: ultimoTexto ? String(ultimoTexto.texto).replace(/\s+/g, ' ').slice(0, 160) : '',
    };
  });
}

// ---------- Armado de grupos ----------
export function armarGrupos(leads: LeadMin[], ahora = new Date()) {
  const hoy = ymdLima(ahora);
  const en2dias = ymdLima(new Date(ahora.getTime() + 2 * 86400000));

  const grupos = GRUPOS.map((g) => {
    const miembros = leads.filter((l) => g.filtro(l, hoy, en2dias));
    return {
      clave: g.clave,
      titulo: g.titulo,
      regla: g.regla,
      total: miembros.length,
      ids: miembros.slice(0, MAX_IDS_POR_GRUPO).map((l) => ({ id: l.id, asesor: l.asesor })),
      contexto: {
        programas: contar(miembros.map((l) => l.programa)),
        dolores: contar(miembros.map((l) => l.dolor)),
        que_le_falta: contar(miembros.map((l) => l.queLeFalta)),
        financia: contar(miembros.map((l) => l.quienFinancia)),
        otras_opciones: contar(miembros.map((l) => l.otrasOpciones)),
        comentarios: miembros.map((l) => l.ultimoComentario).filter(Boolean).slice(0, 4),
      },
    };
  });

  // Un lead puede estar en varios grupos: el total por asesor cuenta leads únicos.
  const porAsesorMap = new Map<string, { conteos: Record<string, number>; ids: Set<string> }>();
  for (const g of GRUPOS) {
    for (const l of leads) {
      if (!g.filtro(l, hoy, en2dias)) continue;
      const c = porAsesorMap.get(l.asesor) || { conteos: {}, ids: new Set<string>() };
      c.conteos[g.clave] = (c.conteos[g.clave] || 0) + 1;
      c.ids.add(l.id);
      porAsesorMap.set(l.asesor, c);
    }
  }
  const porAsesor = [...porAsesorMap.entries()]
    .map(([asesor, c]) => ({ asesor, conteos: c.conteos, total: c.ids.size }))
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_ASESORES);

  const resumen = {
    leads_gestionables: leads.length,
    vp_viva: leads.filter((l) => l.status === VP_VIVA).length,
    pp_viva: leads.filter((l) => l.status === PP_VIVA).length,
    volver_a_llamar: leads.filter((l) => l.status === VOLVER).length,
    sin_contacto: leads.filter((l) => l.status === SIN_CONTACTO).length,
    perfil_completo_vivas: leads.filter((l) => (l.status === VP_VIVA || l.status === PP_VIVA) && l.perfilCompleto).length,
    hoy,
  };

  return { grupos, porAsesor, resumen };
}

// ---------- Prompt ----------
function promptPropuesta(campana: string, datos: ReturnType<typeof armarGrupos>) {
  const system = `Eres el jefe comercial de Admisión de UCAL (universidad en Lima, Perú). Cada 4 horas revisas la bandeja de leads de telemarketing y propones cómo abordarla.
Escribes en español, directo y accionable, para supervisores y asesores. Usa el vocabulario de UCAL: "cuotas educativas" o "inversión", nunca "pensión" para pagos en UCAL.
Reglas comerciales que respetas: el seguimiento a un lead no debe superar 3 días sin contacto; las becas solo se ofrecen si el lead las pide o hay un problema económico; antes de cotizar se perfila (colegio, modalidad, quién decide, quién paga).
No inventes datos: usa solo las cifras que te doy. Respondes ÚNICAMENTE con JSON válido.`;

  const grupos = datos.grupos
    .filter((g) => g.total > 0)
    .map((g) => ({ clave: g.clave, grupo: g.titulo, regla: g.regla, total: g.total, contexto: g.contexto }));

  const user = `CAMPAÑA ${campana} · fecha (Lima): ${datos.resumen.hoy}

RESUMEN DE LA BANDEJA:
${JSON.stringify(datos.resumen)}

GRUPOS (ya calculados por el sistema):
${JSON.stringify(grupos)}

CARGA POR ASESOR (cantidad de leads en cada grupo):
${JSON.stringify(datos.porAsesor.map((a) => ({ asesor: a.asesor, ...a.conteos })))}

Devuelve este JSON:
{
 "macro": "3 a 5 frases: prioridades para todo el equipo en las próximas 4 horas, en orden",
 "grupos": { "<clave del grupo>": "qué hacer con ESTOS leads: acción concreta, mensaje o pregunta sugerida, en 2 a 3 frases" },
 "asesores": { "<nombre exacto del asesor>": "1 a 2 frases: qué debe hacer primero con sus leads" }
}
Incluye una entrada en "grupos" por cada grupo listado y una en "asesores" por cada asesor listado.`;

  return { system, user };
}

// ---------- Generar y guardar ----------
export async function generarPropuestaAbordaje(
  client: Client,
  env: Env,
  campana: string,
  origen: 'cron' | 'manual',
  usuario = ''
) {
  const leads = await leerLeadsCampana(client, campana);
  const datos = armarGrupos(leads);

  let macro = '';
  let accionesGrupo: Record<string, string> = {};
  let accionesAsesor: Record<string, string> = {};
  let proveedor = '';
  let modelo = '';
  let error = '';

  if (leads.length === 0) {
    macro = 'No hay leads gestionables (VP/PP Viva, Volver a llamar o Sin contacto) en esta campaña.';
  } else {
    try {
      const { system, user } = promptPropuesta(campana, datos);
      const r = await generarJSON<any>(env, { system, mensajes: [{ role: 'user', content: user }], maxTokens: 2500, temperatura: 0.3 });
      macro = String(r.data?.macro || '').trim();
      accionesGrupo = r.data?.grupos && typeof r.data.grupos === 'object' ? r.data.grupos : {};
      accionesAsesor = r.data?.asesores && typeof r.data.asesores === 'object' ? r.data.asesores : {};
      proveedor = r.proveedor;
      modelo = r.modelo;
    } catch (e: any) {
      error = 'La IA no pudo generar la propuesta: ' + (e?.message || String(e));
    }
  }

  const grupos = datos.grupos.map((g) => ({
    clave: g.clave,
    titulo: g.titulo,
    regla: g.regla,
    total: g.total,
    accion: String(accionesGrupo[g.clave] || '').trim(),
    ids: g.ids,
  }));
  const porAsesor = datos.porAsesor.map((a) => ({
    asesor: a.asesor,
    conteos: a.conteos,
    total: a.total,
    accion: String(accionesAsesor[a.asesor] || '').trim(),
  }));

  const ins = await client.query(
    `insert into propuestas_abordaje (campana, origen, generado_por, macro, grupos, por_asesor, resumen, proveedor_ia, modelo_ia, error)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     returning id, generado_en`,
    [campana, origen, usuario, macro, JSON.stringify(grupos), JSON.stringify(porAsesor), JSON.stringify(datos.resumen), proveedor, modelo, error]
  );

  return { id: ins.rows[0].id, generadoEn: ins.rows[0].generado_en, error };
}

// ---------- Cron: todas las campañas activas ----------
export async function generarPropuestasProgramadas(client: Client, env: Env) {
  const r = await client.query(`select codigo from campanas where activa = true order by codigo`);
  const resultados: any[] = [];
  for (const row of r.rows) {
    try {
      resultados.push({ campana: row.codigo, ...(await generarPropuestaAbordaje(client, env, row.codigo, 'cron')) });
    } catch (e: any) {
      resultados.push({ campana: row.codigo, error: e?.message || String(e) });
    }
  }
  // Se conservan 30 días de historial.
  await client.query(`delete from propuestas_abordaje where generado_en < now() - interval '30 days'`);
  return resultados;
}
