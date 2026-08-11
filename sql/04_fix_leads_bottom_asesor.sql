-- ============================================================
-- CORRECCIÓN: leads_bottom ahora se identifica por
-- (id_prometeo, campana, asesor_email) — puede haber MÁS DE UNA
-- fila bottom por lead, una por cada asesor que lo ha tenido.
-- Esto reemplaza la tabla anterior (llave incorrecta).
-- ============================================================

drop table if exists leads_bottom cascade;

create table leads_bottom (
  id_prometeo     text not null,
  campana         text not null,
  asesor_email    text not null,

  -- Identidad "snapshot" del lead al momento de guardar (igual que
  -- capturarIdentidadBase en code.gs) — sobrevive aunque el lead
  -- luego desaparezca de la base o cambie de datos.
  nombre_lead     text default '',
  dni_lead        text default '',
  celular_lead    text default '',

  beneficio           text default 'NO',
  beneficio_adicional text default 'NO',
  beneficio_enganche  text default '',
  boleta              text default '',
  boleta_final        numeric,
  boleta_con_beca     text default '',
  boleta_procedencia  text default '',
  institucion_procedencia text default '',
  tipo_institucion_procedencia text default '',
  carrera_procedencia text default '',
  tiempo_ofrecido     text default '',
  ciclo_quedo         text default '',
  descuento_precios   text default '',
  tipo_alumno         text default '',
  numero_cuotas       text default '',
  metodo_pago         text default '',
  rinde_examen_suficiencia text default '',

  -- Cálculo financiero (nuevo)
  descuento_matricula numeric,
  matricula_final      numeric,
  descuento_admision   numeric,
  admision_final       numeric,

  -- Perfilamiento
  por_que_eligio_carrera text default '',
  que_busca_universidad  text default '',
  quien_financiara       text default '',
  acciones_definidas     text default '',
  que_le_falta           text default '',
  otras_opciones         text default '',
  comentarios_perfil     text default '',

  comentarios_historial jsonb default '[]',

  fecha_ult_modificacion timestamptz,
  actualizado_en  timestamptz not null default now(),

  estado_aprobacion      text default '',
  aprobado_por           text default '',
  fecha_aprobacion timestamptz,

  primary key (id_prometeo, campana, asesor_email),
  foreign key (id_prometeo, campana) references leads (id_prometeo, campana) on delete cascade
);

create index idx_leads_bottom_id_campana on leads_bottom (id_prometeo, campana);
