import type { Client } from 'pg';

export const SESSION_TTL_SECONDS = 32400; // 9 horas, igual que hoy
const LOGIN_MAX_INTENTOS = 5;
const LOGIN_BLOQUEO_SEGUNDOS = 60;

export interface Sesion {
  usuario: string;
  email: string;
  rol: string;
  nombre: string;
}

export async function crearSesion(client: Client, user: Sesion): Promise<string> {
  const token = crypto.randomUUID();
  await client.query(
    `insert into sesiones (token, usuario, email, rol, nombre, expira_en)
     values ($1, $2, $3, $4, $5, now() + interval '${SESSION_TTL_SECONDS} seconds')`,
    [token, user.usuario, user.email, user.rol, user.nombre]
  );
  return token;
}

export async function obtenerSesion(client: Client, token: string | undefined): Promise<Sesion | null> {
  if (!token) return null;
  const result = await client.query(
    `select usuario, email, rol, nombre from sesiones
     where token = $1 and expira_en > now()`,
    [token]
  );
  if (result.rows.length === 0) return null;

  // Renovar el TTL en cada uso, igual que hacía cache.put() de nuevo en obtenerSesion().
  await client.query(
    `update sesiones set expira_en = now() + interval '${SESSION_TTL_SECONDS} seconds' where token = $1`,
    [token]
  );

  return result.rows[0] as Sesion;
}

export async function eliminarSesion(client: Client, token: string | undefined) {
  if (!token) return;
  await client.query(`delete from sesiones where token = $1`, [token]);
}

export interface ExigirSesionResult {
  sesion: Sesion | null;
  error?: string;
}

export async function exigirSesion(
  client: Client,
  body: any,
  rolesPermitidos: string[] | null
): Promise<ExigirSesionResult> {
  const sesion = await obtenerSesion(client, body?.sessionToken);
  if (!sesion) {
    return { sesion: null, error: 'Sesión inválida o expirada. Vuelve a iniciar sesión.' };
  }
  if (rolesPermitidos && rolesPermitidos.indexOf(sesion.rol) === -1) {
    return { sesion: null, error: 'Acceso denegado: privilegios insuficientes.' };
  }
  return { sesion };
}

// ---------- Bloqueo por intentos fallidos ----------

export async function loginBloqueado(client: Client, usuarioNorm: string): Promise<boolean> {
  const result = await client.query(
    `select bloqueado_hasta from login_intentos where usuario_norm = $1`,
    [usuarioNorm]
  );
  if (result.rows.length === 0) return false;
  const bloqueadoHasta = result.rows[0].bloqueado_hasta;
  return bloqueadoHasta && new Date(bloqueadoHasta).getTime() > Date.now();
}

export async function registrarIntentoFallido(client: Client, usuarioNorm: string) {
  await client.query(
    `insert into login_intentos (usuario_norm, intentos, bloqueado_hasta)
     values ($1, 1, null)
     on conflict (usuario_norm) do update set
       intentos = login_intentos.intentos + 1,
       bloqueado_hasta = case
         when login_intentos.intentos + 1 >= $2
           then now() + interval '${LOGIN_BLOQUEO_SEGUNDOS} seconds'
         else login_intentos.bloqueado_hasta
       end`,
    [usuarioNorm, LOGIN_MAX_INTENTOS]
  );
}

export async function limpiarIntentosFallidos(client: Client, usuarioNorm: string) {
  await client.query(`delete from login_intentos where usuario_norm = $1`, [usuarioNorm]);
}
