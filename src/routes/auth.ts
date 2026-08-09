import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody } from '../types';
import { hashPassword, verificarPassword } from '../lib/crypto';
import {
  crearSesion,
  eliminarSesion,
  loginBloqueado,
  registrarIntentoFallido,
  limpiarIntentosFallidos,
} from '../lib/session';

export async function login(client: Client, body: JsonBody) {
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

  // Migración de contraseña en texto plano a hash, igual que migrarPasswordAHash()
  if (String(user.password_hash || '').indexOf('sha256:') !== 0) {
    const nuevoHash = 'sha256:' + (await hashPassword(body.password));
    await client.query(`update usuarios set password_hash = $1 where usuario = $2`, [
      nuevoHash,
      user.usuario,
    ]);
  }

  await limpiarIntentosFallidos(client, usuarioNorm);

  // Resolución de campañas: "todas" -> todas las que existan; si no, split por coma.
  let campanas: string[] = [];
  const raw = String(user.campana || '');
  if (raw.toLowerCase() === 'todas') {
    // Nota: la tabla leads_campanas todavía no existe (se crea en Fase 3-4).
    // Mientras tanto, si esta query falla, devolvemos [] sin romper el login.
    try {
      const camResult = await client.query(`select distinct campana from leads_campanas`);
      campanas = camResult.rows.map((r) => r.campana).filter(Boolean);
    } catch (_e) {
      campanas = [];
    }
  } else {
    campanas = raw.split(',').map((c) => c.trim()).filter(Boolean);
  }

  const emailUser = String(user.email || '').trim().toLowerCase();
  const token = await crearSesion(client, {
    usuario: user.usuario,
    email: emailUser,
    rol: user.rol,
    nombre: user.nombre_aux || user.nombre,
  });

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

export async function logout(client: Client, body: JsonBody) {
  await eliminarSesion(client, body.sessionToken);
  return jsonOk();
}
