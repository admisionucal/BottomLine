-- ============================================================
-- Catálogos: BOLETAS, BENEFICIOS, INSTITUCIONES_PROCEDENCIA, CARRERAS_PROCEDENCIA
-- Reemplazan las hojas homónimas, usadas por getCatalogos().
-- ============================================================

create table if not exists catalogo_boletas (
  id                          bigserial primary key,
  tipo_ingreso                text default '',
  boleta_procedencia_min      text default '',
  boleta_procedencia_max      text default '',
  boleta_base                 text default '',
  beca_aplicable               text default '',
  boleta_con_beca              text default ''
);

create table if not exists catalogo_beneficios (
  id      bigserial primary key,
  tipo    text default '',
  valor   text default '',
  label   text default '',
  modo    text default ''
);

-- Estas dos tablas reciben upserts automáticos desde saveBottom (igual que
-- upsertInstitucionProcedencia/upsertCarreraProcedencia en code.gs): cuando
-- un asesor escribe una institución/carrera de procedencia nueva, se agrega
-- sola al catálogo para las próximas veces.
create table if not exists catalogo_instituciones_procedencia (
  nombre  text primary key,   -- ya normalizado: trim + mayúsculas + espacios colapsados
  tipo    text default ''     -- 'UNIVERSIDAD' | 'INSTITUTO'
);

create table if not exists catalogo_carreras_procedencia (
  nombre  text primary key
);
