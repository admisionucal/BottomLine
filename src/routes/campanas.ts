import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody, type Env } from '../types';
import { exigirSesion } from '../lib/session';

// ================================================================
// CAMPAÑAS - catálogo + archivos (Lineamientos, T&C) por campaña
// Reemplaza CONFIG_CC / BCC_DEFAULT_CC hardcodeados y los PDFs
// estáticos en assets/. Solo ADMISION puede crear/editar/subir.
// ================================================================

const TIPOS_ARCHIVO = [
  'lineamientos_5c',
  'lineamientos_6c',
  'terminos_referido',
  'terminos_referente_alumno',
  'terminos_referente_ingresante',
] as const;
type TipoArchivo = (typeof TIPOS_ARCHIVO)[number];

// Nomenclatura fija: sin importar el nombre del archivo que suba el
// admin, el que se guarda y el que ve el destinatario del correo
// siempre sigue este patrón (mismo patrón que ya usaba
// condiciones-comerciales.js contra assets/ estáticos).
const NOMBRE_SEGUN_TIPO: Record<TipoArchivo, (periodo: string) => string> = {
  lineamientos_5c: (periodo) => `Lineamientos de Admisión para ingresantes al semestre académico ${periodo}.pdf`,
  lineamientos_6c: (periodo) => `Lineamientos de Admisión para ingresantes al semestre académico ${periodo} - 6c.pdf`,
  terminos_referido: (periodo) => `T&C - REFERIDO ${periodo}.pdf`,
  terminos_referente_alumno: (periodo) => `T&C - REFERENTE ALUMNO ${periodo}.pdf`,
  terminos_referente_ingresante: (periodo) => `T&C - REFERENTE INGRESANTE ${periodo}.pdf`,
};

function esTipoValido(tipo: any): tipo is TipoArchivo {
  return TIPOS_ARCHIVO.indexOf(tipo) !== -1;
}

function storagePath(codigo: string, tipo: TipoArchivo) {
  return `campanas/${codigo}/${tipo}.pdf`;
}

function storageUrl(env: Env, path: string) {
  return `${env.SUPABASE_URL}/storage/v1/object/${env.SUPABASE_STORAGE_BUCKET}/${path}`;
}

// ===== LECTURA (cualquier usuario logueado: lo usa condiciones-comerciales.js
//        para armar el PDF de CC y la pantalla de Configuración para listar) =====
export async function getCampanasConfig(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ASESOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const [campanasRes, archivosRes] = await Promise.all([
    client.query(
      `select codigo, periodo, perc as "perC", inicio_clases as "inicioClases",
              activa, bcc_default as "bccDefault"
       from campanas order by codigo`
    ),
    client.query(
      `select campana_codigo as "campanaCodigo", tipo, nombre_archivo as "nombreArchivo",
              actualizado_en as "actualizadoEn"
       from campana_archivos`
    ),
  ]);

  const archivosPorCampana: Record<string, Record<string, any>> = {};
  for (const row of archivosRes.rows) {
    (archivosPorCampana[row.campanaCodigo] ??= {})[row.tipo] = {
      nombreArchivo: row.nombreArchivo,
      actualizadoEn: row.actualizadoEn,
    };
  }

  const campanas = campanasRes.rows.map((c) => ({
    ...c,
    archivos: archivosPorCampana[c.codigo] || {},
  }));

  return jsonOk({ data: campanas });
}

// ===== ESCRITURA: crear / actualizar config de una campaña (solo ADMISION) =====
export async function guardarCampana(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['ADMISION']);
  if (!sesion) return jsonError(error!);

  const codigo = String(body.codigo || '').trim();
  if (!codigo) return jsonError('Falta el código de campaña (ej. "27.2").');

  const periodo = String(body.periodo || '').trim();
  const perc = String(body.perC || body.perc || '').trim();
  const inicioClases = String(body.inicioClases || '').trim();
  const activa = body.activa !== false;
  const bccDefault = Array.isArray(body.bccDefault) ? body.bccDefault : [];

  if (!periodo || !perc) {
    return jsonError('Periodo y perC son obligatorios (ej. periodo "2027-2", perC "27-2").');
  }

  await client.query(
    `insert into campanas (codigo, periodo, perc, inicio_clases, activa, bcc_default)
     values ($1, $2, $3, $4, $5, $6::jsonb)
     on conflict (codigo) do update set
       periodo = excluded.periodo,
       perc = excluded.perc,
       inicio_clases = excluded.inicio_clases,
       activa = excluded.activa,
       bcc_default = excluded.bcc_default,
       actualizado_en = now()`,
    [codigo, periodo, perc, inicioClases, activa, JSON.stringify(bccDefault)]
  );

  return jsonOk();
}

// Activar / desactivar rápido, sin reenviar todo el formulario.
export async function toggleCampanaActiva(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['ADMISION']);
  if (!sesion) return jsonError(error!);

  const codigo = String(body.codigo || '').trim();
  if (!codigo) return jsonError('Falta el código de campaña.');

  await client.query(
    `update campanas set activa = $2, actualizado_en = now() where codigo = $1`,
    [codigo, body.activa !== false]
  );

  return jsonOk();
}

// ===== ARCHIVOS: subir (o reemplazar) uno de los 5 tipos (solo ADMISION) =====
export async function subirArchivoCampana(client: Client, body: JsonBody, env: Env) {
  const { sesion, error } = await exigirSesion(client, body, ['ADMISION']);
  if (!sesion) return jsonError(error!);

  const codigo = String(body.campana || '').trim();
  const tipo = body.tipo;
  const archivoBase64 = String(body.archivoBase64 || '');

  if (!codigo) return jsonError('Falta la campaña.');
  if (!esTipoValido(tipo)) return jsonError('Tipo de archivo inválido.');
  if (!archivoBase64) return jsonError('Falta el archivo (base64).');

  const campanaRes = await client.query(`select periodo from campanas where codigo = $1`, [codigo]);
  if (campanaRes.rows.length === 0) {
    return jsonError('La campaña no existe. Créala primero en Configuración.');
  }
  const periodo = campanaRes.rows[0].periodo as string;

  // El nombre SIEMPRE se genera según la nomenclatura fija — nunca se usa
  // el nombre del archivo que llega del navegador, sin importar qué haya
  // subido el admin.
  const nombreArchivo = NOMBRE_SEGUN_TIPO[tipo](periodo);
  const path = storagePath(codigo, tipo);

  const bytes = base64ToUint8Array(archivoBase64);

  const uploadResp = await fetch(storageUrl(env, path), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/pdf',
      'x-upsert': 'true', // sobreescribe si ya existía (reemplazar archivo)
    },
    body: bytes,
  });

  if (!uploadResp.ok) {
    const texto = await uploadResp.text().catch(() => '');
    return jsonError('No se pudo subir el archivo al storage: ' + texto);
  }

  await client.query(
    `insert into campana_archivos (campana_codigo, tipo, nombre_archivo, storage_path, subido_por)
     values ($1, $2, $3, $4, $5)
     on conflict (campana_codigo, tipo) do update set
       nombre_archivo = excluded.nombre_archivo,
       storage_path = excluded.storage_path,
       subido_por = excluded.subido_por,
       actualizado_en = now()`,
    [codigo, tipo, nombreArchivo, path, sesion.email]
  );

  return jsonOk({ nombreArchivo });
}

export async function eliminarArchivoCampana(client: Client, body: JsonBody, env: Env) {
  const { sesion, error } = await exigirSesion(client, body, ['ADMISION']);
  if (!sesion) return jsonError(error!);

  const codigo = String(body.campana || '').trim();
  const tipo = body.tipo;
  if (!codigo) return jsonError('Falta la campaña.');
  if (!esTipoValido(tipo)) return jsonError('Tipo de archivo inválido.');

  const path = storagePath(codigo, tipo);

  await fetch(storageUrl(env, path), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  }).catch(() => {});

  await client.query(
    `delete from campana_archivos where campana_codigo = $1 and tipo = $2`,
    [codigo, tipo]
  );

  return jsonOk();
}

// ===== DESCARGA: usado por condiciones-comerciales.js para adjuntar el
//        PDF al correo (en vez de fetch() directo a assets/ estático) =====
export async function obtenerArchivoCampanaBase64(client: Client, body: JsonBody, env: Env) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ASESOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const codigo = String(body.campana || '').trim();
  const tipo = body.tipo;
  if (!codigo) return jsonError('Falta la campaña.');
  if (!esTipoValido(tipo)) return jsonError('Tipo de archivo inválido.');

  const fila = await client.query(
    `select nombre_archivo as "nombreArchivo", storage_path as "storagePath"
     from campana_archivos where campana_codigo = $1 and tipo = $2`,
    [codigo, tipo]
  );
  if (fila.rows.length === 0) {
    return jsonError(`No hay archivo de tipo "${tipo}" cargado para la campaña ${codigo}.`);
  }
  const { nombreArchivo, storagePath: path } = fila.rows[0];

  const resp = await fetch(storageUrl(env, path), {
    headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!resp.ok) return jsonError('No se pudo leer el archivo del storage.');

  const buffer = await resp.arrayBuffer();
  const base64 = uint8ArrayToBase64(new Uint8Array(buffer));

  return jsonOk({ nombreArchivo, archivoBase64: base64 });
}

// ---------- helpers base64 (Workers no tiene Buffer) ----------
function base64ToUint8Array(base64: string): Uint8Array {
  const limpio = base64.indexOf(',') !== -1 ? base64.split(',')[1] : base64;
  const binario = atob(limpio);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binario = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binario += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binario);
}
