create table if not exists campanas (
  codigo         text primary key,
  periodo        text not null,
  perc           text not null,
  inicio_clases  text not null default '',
  activa         boolean not null default true,
  bcc_default    jsonb not null default '[]'::jsonb,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

insert into campanas (codigo, periodo, perc, inicio_clases, activa, bcc_default) values
  ('26.2', '2026-2', '26-2', 'Agosto', true,
    '["onboarding@ucal.edu.pe","azamora@ucal.edu.pe","renriquez@ucal.edu.pe"]'::jsonb),
  ('27.1', '2027-1', '27-1', 'Marzo', true,
    '["onboarding@ucal.edu.pe","mquiroz@ucal.edu.pe","renriquez@ucal.edu.pe"]'::jsonb)
on conflict (codigo) do nothing;

do $$ begin
  create type tipo_archivo_campana as enum (
    'lineamientos_5c',
    'lineamientos_6c',
    'terminos_referido',
    'terminos_referente_alumno',
    'terminos_referente_ingresante'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists campana_archivos (
  id              bigint generated always as identity primary key,
  campana_codigo  text not null references campanas(codigo) on delete cascade,
  tipo            tipo_archivo_campana not null,
  nombre_archivo  text not null,
  storage_path    text not null,
  subido_por      text default '',
  actualizado_en  timestamptz not null default now(),
  unique (campana_codigo, tipo)
);

create index if not exists idx_campana_archivos_campana on campana_archivos(campana_codigo);
