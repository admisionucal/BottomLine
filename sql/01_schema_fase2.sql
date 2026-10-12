create table if not exists usuarios (
  usuario       text primary key,
  password_hash text not null,
  nombre        text not null default '',
  nombre_aux    text default '',
  rol           text not null,
  campana       text default '',
  cargo         text default '',
  dni           text default '',
  email         text default '',
  foto          text default '',
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create unique index if not exists idx_usuarios_usuario_lower
  on usuarios (lower(usuario));

create table if not exists login_intentos (
  usuario_norm  text primary key,
  intentos      int not null default 0,
  bloqueado_hasta timestamptz
);

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

create table if not exists asistencia (
  id            bigserial primary key,
  usuario       text not null,
  fecha         date not null,
  nombre        text default '',
  campana       text default '',
  cargo         text default '',
  dni           text default '',
  entrada       text default '',
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

  unique (usuario, fecha)
);

create index if not exists idx_asistencia_usuario on asistencia (usuario);
create index if not exists idx_asistencia_fecha on asistencia (fecha);
create index if not exists idx_asistencia_campana on asistencia (campana);
