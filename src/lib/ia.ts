import type { Env } from '../types';

// ================================================================
// CAPA DE IA INTERCAMBIABLE
// ================================================================
//
// Hoy: Cloudflare Workers AI (binding "AI", ya configurado).
// Mañana: Claude (API de Anthropic) sin tocar el resto del código.
//
// Cómo pasar a Claude:
//   1) npx wrangler secret put ANTHROPIC_API_KEY
//   2) (opcional) var CLAUDE_MODEL en wrangler.jsonc con el modelo que
//      se quiera usar (ver https://docs.claude.com/en/docs/about-claude/models).
// Con la key presente se usa Claude automáticamente. Para forzar
// Workers AI aunque exista la key: var IA_PROVEEDOR = "workers".

export const MODELO_WORKERS = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MODELO_CLAUDE_DEFAULT = 'claude-sonnet-4-5';

export type Proveedor = 'claude' | 'workers';

export interface MensajeIA {
  role: 'user' | 'assistant';
  content: string;
}

export interface OpcionesIA {
  system: string;
  mensajes: MensajeIA[];
  maxTokens?: number;
  temperatura?: number;
}

export interface RespuestaIA {
  texto: string;
  proveedor: Proveedor;
  modelo: string;
}

export function proveedorActivo(env: Env): Proveedor {
  const forzado = String(env.IA_PROVEEDOR || '').toLowerCase();
  if (forzado === 'workers') return 'workers';
  if (env.ANTHROPIC_API_KEY) return 'claude';
  return 'workers';
}

// Límite aproximado de caracteres de historial que se manda a cada
// proveedor (Llama 3.3 fp8-fast tiene ~24k tokens de contexto en total).
export function limiteHistorial(env: Env): number {
  return proveedorActivo(env) === 'claude' ? 400_000 : 28_000;
}

export async function generar(env: Env, op: OpcionesIA): Promise<RespuestaIA> {
  const mensajes = normalizarTurnos(op.mensajes);
  if (proveedorActivo(env) === 'claude') return generarClaude(env, op, mensajes);
  return generarWorkers(env, op, mensajes);
}

// Une turnos consecutivos del mismo rol y garantiza que el primero sea "user"
// (requisito de la API de Claude; Llama lo tolera igual).
function normalizarTurnos(mensajes: MensajeIA[]): MensajeIA[] {
  const out: MensajeIA[] = [];
  for (const m of mensajes) {
    const content = String(m.content ?? '').trim();
    if (!content) continue;
    const ultimo = out[out.length - 1];
    if (ultimo && ultimo.role === m.role) ultimo.content += '\n' + content;
    else out.push({ role: m.role, content });
  }
  if (!out.length || out[0].role !== 'user') out.unshift({ role: 'user', content: '(inicio de la conversación)' });
  return out;
}

async function generarWorkers(env: Env, op: OpcionesIA, mensajes: MensajeIA[]): Promise<RespuestaIA> {
  if (!env.AI) throw new Error('Workers AI no está habilitado en este Worker.');
  const salida: any = await env.AI.run(MODELO_WORKERS as any, {
    messages: [{ role: 'system', content: op.system }, ...mensajes],
    max_tokens: op.maxTokens ?? 800,
    temperature: op.temperatura ?? 0.7,
  } as any);
  const r = salida?.response;
  const texto = typeof r === 'string' ? r : r != null ? JSON.stringify(r) : '';
  return { texto: texto.trim(), proveedor: 'workers', modelo: MODELO_WORKERS };
}

async function generarClaude(env: Env, op: OpcionesIA, mensajes: MensajeIA[]): Promise<RespuestaIA> {
  const modelo = env.CLAUDE_MODEL || MODELO_CLAUDE_DEFAULT;
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': String(env.ANTHROPIC_API_KEY),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: modelo,
      max_tokens: op.maxTokens ?? 800,
      temperature: op.temperatura ?? 0.7,
      // El system (rúbrica, perfil, ejemplos) se repite en cada turno:
      // se marca para caché y así solo se cobra completo la primera vez.
      system: [{ type: 'text', text: op.system, cache_control: { type: 'ephemeral' } }],
      messages: mensajes,
    }),
  });
  if (!resp.ok) {
    const detalle = await resp.text();
    throw new Error(`Claude respondió ${resp.status}: ${detalle.slice(0, 300)}`);
  }
  const data: any = await resp.json();
  const texto = (data?.content || [])
    .filter((b: any) => b?.type === 'text')
    .map((b: any) => b.text)
    .join('')
    .trim();
  return { texto, proveedor: 'claude', modelo };
}

// Extrae el primer objeto JSON de un texto (tolera ```json ... ``` y texto
// alrededor, que Llama a veces agrega aunque se le pida solo JSON).
export function extraerJSON<T = any>(texto: string): T {
  const limpio = String(texto || '').replace(/```json\s*|```/g, '').trim();
  try {
    return JSON.parse(limpio) as T;
  } catch {
    const ini = limpio.indexOf('{');
    const fin = limpio.lastIndexOf('}');
    if (ini === -1 || fin <= ini) throw new Error('La IA no devolvió JSON.');
    return JSON.parse(limpio.slice(ini, fin + 1)) as T;
  }
}

// Pide JSON y, si falla el parseo, reintenta una vez recordándole el formato.
export async function generarJSON<T = any>(env: Env, op: OpcionesIA): Promise<{ data: T; proveedor: Proveedor; modelo: string }> {
  const r1 = await generar(env, op);
  try {
    return { data: extraerJSON<T>(r1.texto), proveedor: r1.proveedor, modelo: r1.modelo };
  } catch {
    const r2 = await generar(env, {
      ...op,
      temperatura: 0.2,
      mensajes: [
        ...op.mensajes,
        { role: 'assistant', content: r1.texto.slice(0, 4000) },
        { role: 'user', content: 'Tu respuesta anterior no era JSON válido. Devuelve ÚNICAMENTE el objeto JSON completo, sin texto adicional.' },
      ],
    });
    return { data: extraerJSON<T>(r2.texto), proveedor: r2.proveedor, modelo: r2.modelo };
  }
}
