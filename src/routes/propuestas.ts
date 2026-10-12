import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody, type Env } from '../types';
import { exigirSesion, ROL_SISTEMAS, type Sesion } from '../lib/session';
import { generarPropuestaAbordaje } from '../lib/propuestaAbordaje';

// ================================================================
// PROPUESTA DE ABORDAJE (Bottom Line > Análisis > Propuesta)
// ================================================================

// ETAPA DE PRUEBAS: solo SISTEMAS ve y genera la propuesta.
// Para liberarla, agregar perfiles aquí y en ROLES_PROPUESTA_IA de core/constants.js.
const ROLES_VER = [ROL_SISTEMAS];
const ROLES_GENERAR = [ROL_SISTEMAS];

function tieneRol(sesion: Sesion, roles: string[]) {
  return roles.includes(sesion.rolReal || sesion.rol) || roles.includes(sesion.rol);
}

export async function getPropuestaAbordaje(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, null);
  if (!sesion) return jsonError(error!);
  if (!tieneRol(sesion, ROLES_VER)) return jsonError('La Propuesta aún no está disponible para tu perfil.');

  const campana = String(body.campana || '').trim();
  if (!campana) return jsonError('Falta la campaña.');

  const r = await client.query(
    `select id, campana, generado_en as "generadoEn", origen, generado_por as "generadoPor", macro,
            grupos, por_asesor as "porAsesor", resumen, proveedor_ia as proveedor, modelo_ia as modelo, error
     from propuestas_abordaje where campana = $1
     order by generado_en desc limit 1`,
    [campana]
  );
  return jsonOk({ data: r.rows[0] || null, puedeGenerar: tieneRol(sesion, ROLES_GENERAR) });
}

export async function generarPropuestaAbordajeAhora(client: Client, body: JsonBody, env: Env) {
  const { sesion, error } = await exigirSesion(client, body, null);
  if (!sesion) return jsonError(error!);
  if (!tieneRol(sesion, ROLES_GENERAR)) return jsonError('Acceso denegado: privilegios insuficientes.');

  const campana = String(body.campana || '').trim();
  if (!campana) return jsonError('Falta la campaña.');
  const existe = await client.query(`select 1 from campanas where codigo = $1`, [campana]);
  if (!existe.rowCount) return jsonError('La campaña no existe.');

  // Evita dobles clics: si hay una de hace menos de 2 minutos, se devuelve esa.
  const reciente = await client.query(
    `select 1 from propuestas_abordaje where campana = $1 and generado_en > now() - interval '2 minutes'`,
    [campana]
  );
  if (reciente.rowCount) return getPropuestaAbordaje(client, body);

  try {
    await generarPropuestaAbordaje(client, env, campana, 'manual', sesion.nombre || sesion.usuario);
  } catch (e: any) {
    return jsonError('No se pudo generar la propuesta: ' + (e?.message || e));
  }
  return getPropuestaAbordaje(client, body);
}
