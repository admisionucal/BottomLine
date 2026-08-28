import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody } from '../types';
import { exigirSesion } from '../lib/session';

// Mapea el "campo" que manda el frontend a la columna real de la tabla.
// Igual que colMap en marcarAsistenciaInterno().
const CAMPOS_VALIDOS: Record<string, string> = {
  entrada: 'entrada',
  almuerzo: 'almuerzo',
  regreso: 'regreso',
  salida: 'salida',
};

// Acepta 'YYYY-MM-DD' o 'DD/MM/YYYY' desde el frontend y devuelve 'YYYY-MM-DD' para Postgres.
function normalizarFecha(fechaStr: string): string | null {
  const fecha = String(fechaStr || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fecha;
  const m = fecha.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

// Convierte el 'date' de Postgres (string 'YYYY-MM-DD', o Date si algún día
// cambia el parser de tipos) a 'DD/MM/YYYY', que es lo que espera todo el
// frontend (calendario, Análisis, ranking, KPI "Asistencia de hoy").
function formatearFechaDDMMYYYY(fecha: any): string {
  if (!fecha) return '';
  if (fecha instanceof Date) {
    const y = fecha.getUTCFullYear();
    const m = String(fecha.getUTCMonth() + 1).padStart(2, '0');
    const d = String(fecha.getUTCDate()).padStart(2, '0');
    return `${d}/${m}/${y}`;
  }
  const m = String(fecha).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(fecha).trim();
}

export async function marcarAsistencia(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ASESOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);
  if (!sesion.usuario) {
    return jsonError('Tu sesión no tiene usuario asociado. Vuelve a iniciar sesión.');
  }

  const campo = CAMPOS_VALIDOS[body.campo];
  if (!campo) return jsonError('Campo inválido: ' + body.campo);

  const fecha = normalizarFecha(body.fecha);
  if (!fecha) return jsonError('Fecha inválida.');

  // Aseguramos que exista la fila del día (equivalente a sh.appendRow si no existía),
  // sin pisar campos ya registrados.
  await client.query(
    `insert into asistencia (usuario, fecha, nombre, campana, cargo, dni)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (usuario, fecha) do nothing`,
    [sesion.usuario, fecha, sesion.nombre || '', body.campaña || '', body.cargo || '', body.dni || '']
  );

  // UPDATE atómico: solo escribe si el campo todavía está vacío.
  // Esto reemplaza por completo tu conLockAsistencia() manual — Postgres
  // ya garantiza que dos marcaciones simultáneas no se pisen entre sí.
  const result = await client.query(
    `update asistencia set
        ${campo} = $1,
        latitud = coalesce(nullif($2, ''), latitud),
        longitud = coalesce(nullif($3, ''), longitud),
        direccion = coalesce(nullif($4, ''), direccion),
        horas_trab = coalesce(nullif($5, ''), horas_trab),
        horas_alm = coalesce(nullif($6, ''), horas_alm),
        estado = coalesce(nullif($7, ''), estado),
        ip = coalesce(nullif($8, ''), ip),
        tipo = coalesce(nullif($9, ''), tipo),
        actualizado_en = now()
     where usuario = $10 and fecha = $11 and (${campo} is null or ${campo} = '')
     returning ${campo}`,
    [
      String(body.valor || ''),
      String(body.lat || ''),
      String(body.lng || ''),
      body.direccion || '',
      String(body.horasTrab || ''),
      String(body.horasAlm || ''),
      body.estado || '',
      body.ip || '',
      body.tipo || '',
      sesion.usuario,
      fecha,
    ]
  );

  if (result.rowCount === 0) {
    // O no existe la fila (no debería pasar, la creamos arriba) o el campo ya tenía valor.
    const actual = await client.query(
      `select ${campo} as valor from asistencia where usuario = $1 and fecha = $2`,
      [sesion.usuario, fecha]
    );
    const valorActual = actual.rows[0]?.valor || '';
    return jsonError(`${body.campo} ya fue registrado anteriormente a las ${valorActual}`);
  }

  return jsonOk({ message: `${body.campo} registrado correctamente a las ${body.valor}` });
}

export async function getAsistenciaRegistroHoy(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ASESOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const fecha = normalizarFecha(body.fecha);
  if (!fecha) return jsonOk({ record: null });

  const result = await client.query(
    `select * from asistencia where usuario = $1 and fecha = $2`,
    [sesion.usuario, fecha]
  );

  return jsonOk({ record: result.rows[0] ? filaAObjeto(result.rows[0]) : null });
}

export async function getAsistenciaRegistros(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ASESOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const esAdmin = sesion.rol === 'SUPERVISOR' || sesion.rol === 'ADMISION';
  const filtroEmpleado = esAdmin ? body.empleado || null : sesion.usuario;
  const filtroCampana = body.campaña || null;

  const result = await client.query(
    `select * from asistencia
     where ($1::text is null or usuario = $1)
       and ($2::text is null or campana = $2)
     order by fecha desc`,
    [filtroEmpleado, filtroCampana]
  );

  return jsonOk({ data: result.rows.map(filaAObjeto) });
}

export async function getAsistenciaEmpleados(client: Client, body: JsonBody) {
  const { error } = await exigirSesion(client, body, ['SUPERVISOR', 'ADMISION']);
  if (error) return jsonError(error);

  const result = await client.query(
    `select usuario, nombre, nombre_aux, rol, cargo, dni, campana, foto, activo
     from usuarios where upper(rol) = 'ASESOR'`
  );

  const data = result.rows.map((u) => ({
    usuario: u.usuario || '',
    nombre: u.nombre_aux || u.nombre || '',
    rol: String(u.rol || '').toLowerCase(),
    cargo: u.cargo || '',
    dni: u.dni || '',
    campaña: String(u.campana || '').split(',')[0]?.trim() || '',
    foto: u.foto || '',
    activo: u.activo !== false,
  }));

  return jsonOk({ data });
}

// Mantenimiento: activa/desactiva un colaborador. Reemplaza el toggle
// que antes solo vivía en localStorage (asis_config_colaboradores).
export async function actualizarEstadoColaborador(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const usuario = String(body.usuario || '').trim();
  if (!usuario) return jsonError('Usuario requerido.');

  const result = await client.query(
    `update usuarios set activo = $1, actualizado_en = now()
     where lower(usuario) = lower($2)
     returning usuario, activo`,
    [!!body.activo, usuario]
  );

  if (result.rowCount === 0) return jsonError('Colaborador no encontrado.');

  return jsonOk({ usuario: result.rows[0].usuario, activo: result.rows[0].activo });
}

function filaAObjeto(r: any) {
  return {
    usuario: r.usuario,
    fecha: formatearFechaDDMMYYYY(r.fecha),   // 👈 único cambio real: antes era r.fecha
    nombre: r.nombre,
    campaña: r.campana,
    cargo: r.cargo,
    dni: r.dni,
    entrada: r.entrada,
    almuerzo: r.almuerzo,
    regreso: r.regreso,
    salida: r.salida,
    horasTrab: r.horas_trab,
    horasAlm: r.horas_alm,
    lat: r.latitud,
    lng: r.longitud,
    direccion: r.direccion,
    estado: r.estado,
    tipo: r.tipo || '',
  };
}