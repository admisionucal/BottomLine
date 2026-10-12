create table if not exists leads (
  id_prometeo     text not null,
  campana         text not null,

  nombres         text default '',
  telefono2       text default '',
  telefono3       text default '',
  email           text default '',
  colegio         text default '',
  codigo_modular  text default '',
  programa        text default '',
  numero_documento text default '',
  modalidad       text default '',
  modalidad_ingreso text default '',
  boleta_colegio  text default '',
  fecha_hora_registro text default '',

  asesor          text default '',
  status_gestion  text default '',
  fecha_compromiso_pago text default '',
  vps_dif_ti_inte numeric default 0,

  en_base         boolean not null default true,

  actualizado_hoy_en timestamptz,

  extra           jsonb default '{}',

  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),

  primary key (id_prometeo, campana)
);

create index if not exists idx_leads_campana on leads (campana);
create index if not exists idx_leads_asesor on leads (asesor);
create index if not exists idx_leads_status on leads (status_gestion);
create index if not exists idx_leads_programa on leads (programa);
create index if not exists idx_leads_filtro_principal on leads (campana, status_gestion, asesor);

create table if not exists leads_bottom (
  id_prometeo     text not null,
  campana         text not null,
  asesor          text default '',

  beneficio         text default 'NO',
  beneficio_adicional text default 'NO',
  beneficio_enganche  text default '',
  boleta            text default '',
  boleta_final      text default '',
  boleta_con_beca   text default '',
  boleta_procedencia text default '',
  institucion_procedencia text default '',
  tipo_institucion_procedencia text default '',
  carrera_procedencia text default '',
  tiempo_ofrecido   text default '',
  ciclo_quedo       text default '',
  descuento_precios text default '',
  tipo_alumno       text default '',
  numero_cuotas     text default '',
  metodo_pago       text default '',

  por_que_eligio_carrera text default '',
  que_busca_universidad  text default '',
  quien_financiara       text default '',
  acciones_definidas     text default '',
  que_le_falta           text default '',
  otras_opciones         text default '',
  comentarios_perfil     text default '',

  comentarios_historial jsonb default '[]',

  actualizado_en  timestamptz not null default now(),

  primary key (id_prometeo, campana),
  foreign key (id_prometeo, campana) references leads (id_prometeo, campana) on delete cascade
);

create table if not exists leads_pagos (
  id_prometeo     text not null,
  campana         text not null,
  status_pago_final text default '',
  fecha_pago_completo text default '',
  fecha_promesa_pago  text default '',
  actualizado_en  timestamptz not null default now(),

  primary key (id_prometeo, campana),
  foreign key (id_prometeo, campana) references leads (id_prometeo, campana) on delete cascade
);

create table if not exists asesores_nombre_aux (
  nombre_raw  text primary key,
  nombre_aux  text not null
);
