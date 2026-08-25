-- ============================================================
-- Campo nuevo DOLOR_NECESIDAD (perfilamiento) + su catálogo
-- ============================================================
alter table leads_bottom
  add column if not exists dolor_necesidad text default '';

create table if not exists catalogo_dolor_necesidad (
  nombre       text primary key,  -- normalizado: trim + mayúsculas + espacios colapsados, máx 5 palabras
  descripcion  text default ''
);
