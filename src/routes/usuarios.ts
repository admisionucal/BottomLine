import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody } from '../types';
import { exigirSesion } from '../lib/session';
import { hashPassword } from '../lib/crypto';

export async function getSupervisoresConfig(client: Client, body: JsonBody) {
  const { error } = await exigirSesion(client, body, ['ADMISION']);
  if (error) return jsonError(error);

  const result = await client.query(
    `select usuario, nombre, nombre_aux, campana, activo
     from usuarios where upper(rol) = 'SUPERVISOR' order by nombre`
  );

  const data = result.rows.map((u) => ({
    usuario: u.usuario,
    nombre: u.nombre_aux || u.nombre || '',
    campanas: String(u.campana || '').split(',').map((c: string) => c.trim()).filter(Boolean),
    activo: u.activo !== false,
  }));

  return jsonOk({ data });
}

export async function crearUsuario(client: Client, body: JsonBody) {
  const { error } = await exigirSesion(client, body, ['ADMISION']);
  if (error) return jsonError(error);

  const usuario = String(body.usuario || '').trim();
  const nombre = String(body.nombre || '').trim();
  const nombreCorto = String(body.nombreCorto || '').trim();
  const rol = String(body.rol || '').trim().toUpperCase();
  const password = String(body.password || '');
  const campanas = Array.isArray(body.campanas)
    ? body.campanas.map((c: any) => String(c).trim()).filter(Boolean)
    : [];
  const cargo = String(body.cargo || '').trim();
  const dni = String(body.dni || '').trim();
  const email = String(body.email || '').trim();

  if (!usuario || !nombre || !password) {
    return jsonError('Usuario, nombre y contraseña son obligatorios.');
  }
  if (!['SUPERVISOR', 'ASESOR', 'ADMISION'].includes(rol)) {
    return jsonError('Rol inválido.');
  }
  if (password.length < 6) {
    return jsonError('La contraseña debe tener al menos 6 caracteres.');
  }

  const existe = await client.query(
    `select 1 from usuarios where lower(usuario) = lower($1)`, [usuario]
  );
  if ((existe.rowCount ?? 0) > 0) {
    return jsonError('Ya existe un usuario con ese nombre de login.');
  }

  const passwordHash = 'sha256:' + (await hashPassword(password));

  const result = await client.query(
    `insert into usuarios (usuario, password_hash, nombre, nombre_aux, rol, campana, cargo, dni, email, activo)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
    returning usuario, nombre, rol`,
    [usuario, passwordHash, nombre, nombreCorto, rol, campanas.join(','), cargo, dni, email]
  );

  return jsonOk({ usuario: result.rows[0] });
}

export async function getAsesoresActivos(client: Client, body: JsonBody) {
  const { error } = await exigirSesion(client, body, ['SUPERVISOR', 'ASESOR', 'ADMISION']);
  if (error) return jsonError(error);

  const campana = String(body.campana || '').trim();
  const result = await client.query(
    `select usuario, nombre, nombre_aux, email, campana
       from usuarios
      where upper(rol) = 'ASESOR' and activo is not false
      order by coalesce(nullif(nombre_aux, ''), nombre)`
  );

  const data = result.rows
    .filter((u) => {
      if (!campana) return true;
      const campanas = String(u.campana || '').split(',').map((c: string) => c.trim()).filter(Boolean);
      return campanas.length === 0 || campanas.includes(campana);
    })
    .map((u) => ({
      usuario: u.usuario,
      nombre: u.nombre_aux || u.nombre || u.usuario,
      email: u.email || '',
    }));

  return jsonOk({ data });
}
