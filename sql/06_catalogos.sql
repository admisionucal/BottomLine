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

create table if not exists catalogo_instituciones_procedencia (
  nombre  text primary key,
  tipo    text default ''
);

create table if not exists catalogo_carreras_procedencia (
  nombre  text primary key
);
