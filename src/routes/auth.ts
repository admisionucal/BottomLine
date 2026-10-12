import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody, type Env } from '../types';
import { hashPassword, verificarPassword } from '../lib/crypto';
import {
  crearSesion,
  eliminarSesion,
  loginBloqueado,
  registrarIntentoFallido,
  limpiarIntentosFallidos,
} from '../lib/session';

export async function login(client: Client, body: JsonBody, env: Env, ctx: ExecutionContext) {
  const usuarioNorm = String(body.usuario || '').trim().toLowerCase();

  if (await loginBloqueado(client, usuarioNorm)) {
    return jsonError('Demasiados intentos fallidos. Espera unos minutos e intenta de nuevo.');
  }

  const result = await client.query(
    `select * from usuarios where lower(usuario) = $1 limit 1`,
    [usuarioNorm]
  );
  const user = result.rows[0];

  if (!user) {
    await registrarIntentoFallido(client, usuarioNorm);
    return jsonError('Usuario no encontrado');
  }

  const passwordOk = await verificarPassword(user.password_hash, body.password);
  if (!passwordOk) {
    await registrarIntentoFallido(client, usuarioNorm);
    return jsonError('Contraseña incorrecta');
  }

  if (String(user.password_hash || '').indexOf('sha256:') !== 0) {
    const nuevoHash = 'sha256:' + (await hashPassword(body.password));
    await client.query(`update usuarios set password_hash = $1 where usuario = $2`, [
      nuevoHash,
      user.usuario,
    ]);
  }

  await limpiarIntentosFallidos(client, usuarioNorm);

  const camActivasRes = await client.query(
    `select codigo from campanas where activa = true order by codigo`
  );
  const activas = new Set(camActivasRes.rows.map((r) => r.codigo));

  let campanas: string[] = [];
  const raw = String(user.campana || '');
  if (raw.toLowerCase() === 'todas') {
    campanas = Array.from(activas).sort();
  } else {
    campanas = raw.split(',').map((c) => c.trim()).filter((c) => c && activas.has(c));
  }

  const emailUser = String(user.email || '').trim().toLowerCase();
  const token = await crearSesion(client, {
    usuario: user.usuario,
    email: emailUser,
    rol: user.rol,
    nombre: user.nombre_aux || user.nombre,
  });

  ctx.waitUntil(
    fetch(env.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'registrarSesionExterna',
        secret: env.IMPORT_SECRET,
        token,
        usuario: user.usuario,
        email: emailUser,
        rol: user.rol === 'SISTEMAS' ? 'ADMISION' : user.rol,
        nombre: user.nombre_aux || user.nombre,
      }),
    }).catch(() => {})
  );

  return jsonOk({
    user: {
      usuario: user.usuario || '',
      email: emailUser,
      nombre: user.nombre_aux || user.nombre || '',
      nombre_completo: user.nombre || '',
      rol: user.rol || '',
      campanas,
      nombre_asesor: user.nombre_aux || '',
      cargo: user.cargo || '',
      dni: user.dni || '',
      foto: user.foto || '',
      token,
    },
  });
}

export async function logout(client: Client, body: JsonBody, env: Env) {
  await eliminarSesion(client, body.sessionToken);

  try {
    await fetch(env.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'logout', sessionToken: body.sessionToken }),
    });
  } catch (_e) {}

  return jsonOk();
}