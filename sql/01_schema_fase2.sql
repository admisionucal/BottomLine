-- ============================================================
-- FASE 2: Usuarios + Asistencia + Sesiones
-- Correr esto una vez en el SQL Editor de Supabase
-- ============================================================

-- ---------- USUARIOS ----------
-- Reemplaza la hoja "USUARIOS" de tu Sheet principal.
create table if not exists usuarios (
  usuario       text primary key,          -- login, ej. "jperez"
  password_hash text not null,             -- sha256 hex (mismo algoritmo que ya usas)
  nombre        text not null default '',  -- nombre completo
  nombre_aux    text default '',           -- nombre corto/display, si existe
  rol           text not null,             -- SUPERVISOR | ASESOR | ADMISION
  campana       text default '',           -- "26.2,27.1" o "todas"
  cargo         text default '',
  dni           text default '',
  email         text default '',
  foto          text default '',
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- Login case-insensitive, igual que tu lógica actual con .toLowerCase()
create unique index if not exists idx_usuarios_usuario_lower
  on usuarios (lower(usuario));

-- ---------- LOGIN: intentos fallidos / bloqueo ----------
-- Reemplaza el uso de CacheService para el bloqueo de 5 intentos / 60s.
create table if not exists login_intentos (
  usuario_norm  text primary key,   -- usuario en minúsculas
  intentos      int not null default 0,
  bloqueado_hasta timestamptz
);

-- ---------- SESIONES ----------
-- Reemplaza CacheService.getScriptCache() para las sesiones (9 horas).
create table if not exists sesiones (
  token       text primary key,
  usuario     text not null,
  email       text default '',
  rol         text not null,
  nombre      text default '',
  creado_en   timestamptz not null default now(),
  expira_en   timestamptz not null
);

create index if not exists idx_sesiones_expira on sesiones (expira_en);

-- ---------- ASISTENCIA ----------
-- Reemplaza la hoja "Asistencia" del spreadsheet externo (ASISTENCIA_SPREADSHEET_ID).
create table if not exists asistencia (
  id            bigserial primary key,
  usuario       text not null,
  fecha         date not null,
  nombre        text default '',
  campana       text default '',
  cargo         text default '',
  dni           text default '',
  entrada       text default '',   -- se guarda como texto "HH:mm:ss", igual que hoy
  almuerzo      text default '',
  regreso       text default '',
  salida        text default '',
  horas_trab    text default '',
  horas_alm     text default '',
  latitud       text default '',
  longitud      text default '',
  direccion     text default '',
  estado        text default '',
  ip            text default '',
  tipo          text default '',
  actualizado_en timestamptz not null default now(),

  -- Un solo registro por usuario y día (equivale a tu indexMap "usuario||fecha")
  unique (usuario, fecha)
);

create index if not exists idx_asistencia_usuario on asistencia (usuario);
create index if not exists idx_asistencia_fecha on asistencia (fecha);
create index if not exists idx_asistencia_campana on asistencia (campana);
