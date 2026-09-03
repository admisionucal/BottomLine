-- ================================================================
-- 10_campanas_config.sql
-- Convierte "campaña" en una entidad real (hoy solo existía de forma
-- implícita como valores distintos en leads.campana, y su config
-- vivía hardcodeada en CONFIG_CC / BCC_DEFAULT_CC en el frontend).
--
-- Con esto:
--   - se pueden crear campañas (27.2, 28.1, ...) sin que tengan leads
--   - se pueden activar/desactivar
--   - cada campaña tiene sus propios archivos (Lineamientos, T&C)
-- ================================================================

create table if not exists campanas (
  codigo         text primary key,            -- ej '26.2', '27.1', '27.2'
  periodo        text not null,                -- ej '2026-2'
  perc           text not null,                -- ej '26-2' (usado en el PDF de CC)
  inicio_clases  text not null default '',     -- ej 'Agosto', 'Marzo'
  activa         boolean not null default true,
  bcc_default    jsonb not null default '[]'::jsonb, -- correos en copia oculta al enviar CC
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- Seed: las dos campañas que hoy están hardcodeadas en el frontend
-- (CONFIG_CC y BCC_DEFAULT_CC en constants.js / cc-template.js).
insert into campanas (codigo, periodo, perc, inicio_clases, activa, bcc_default) values
  ('26.2', '2026-2', '26-2', 'Agosto', true,
    '["onboarding@ucal.edu.pe","azamora@ucal.edu.pe","renriquez@ucal.edu.pe"]'::jsonb),
  ('27.1', '2027-1', '27-1', 'Marzo', true,
    '["onboarding@ucal.edu.pe","mquiroz@ucal.edu.pe","renriquez@ucal.edu.pe"]'::jsonb)
on conflict (codigo) do nothing;

-- ----------------------------------------------------------------
-- Archivos por campaña: 5 tipos posibles (Lineamientos a 5 y 6
-- cuotas, y los 3 T&C de Referido/Referente). Uno por campaña+tipo
-- (unique), así subir uno nuevo simplemente reemplaza al anterior.
-- ----------------------------------------------------------------

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
  nombre_archivo  text not null,   -- nombre final con la nomenclatura fija (el que ve el destinatario del correo)
  storage_path    text not null,   -- ruta dentro del bucket de Supabase Storage
  subido_por      text default '',
  actualizado_en  timestamptz not null default now(),
  unique (campana_codigo, tipo)
);

create index if not exists idx_campana_archivos_campana on campana_archivos(campana_codigo);

-- Nota: los 4 PDFs que hoy están en assets/ (para 26.2 y 27.1) se deben
-- subir manualmente una vez desde la nueva pantalla de Configuración
-- para poblar el bucket y esta tabla — no se migran automáticamente
-- porque el contenido de los PDFs no está en este dump de texto.
