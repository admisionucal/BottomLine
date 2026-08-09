-- ============================================================
-- FASE 3: Leads (reemplaza pestañas por campaña + hoy{campaña})
-- ============================================================

-- ---------- LEADS ----------
-- Reemplaza: la hoja "{campaña}" (26.2, 27.1...) Y la hoja "hoy{campaña}"
-- fusionadas en una sola tabla. Ya no hace falta mezclar dos fuentes en
-- cada lectura: el scraper de Prometeo actualiza esta misma fila.
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

  asesor          text default '',           -- ASESOR ULT TIP DF SN CONTC (usuario/nombre raw)
  status_gestion  text default '',           -- VALORES_VALORACIONES_POSITIVAS_VIVA, etc.
  fecha_compromiso_pago text default '',
  vps_dif_ti_inte numeric default 0,         -- "# DE VPs DIF TI INTE" del Log de Bases

  -- Para saber si el lead viene de la base (Log de Bases/BBDD) o solo del
  -- CRM Prometeo hoy (equivalente a tu leadObjHoy con SOLO_HOY: true).
  en_base         boolean not null default true,

  -- Cuándo lo tocó por última vez el scraper de Prometeo (reemplaza a
  -- purgarLeadsInactivos + la hoja "hoy" separada).
  actualizado_hoy_en timestamptz,

  -- Cualquier columna del Log de Bases/BBDD que no modelamos explícitamente
  -- (son decenas). Se guarda tal cual para no perder nada, y se puede
  -- consultar con extra->>'NOMBRE_COLUMNA' si se necesita después.
  extra           jsonb default '{}',

  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),

  primary key (id_prometeo, campana)
);

create index if not exists idx_leads_campana on leads (campana);
create index if not exists idx_leads_asesor on leads (asesor);
create index if not exists idx_leads_status on leads (status_gestion);
create index if not exists idx_leads_programa on leads (programa);
-- El filtro más frecuente en getLeads: campaña + status + asesor a la vez.
create index if not exists idx_leads_filtro_principal on leads (campana, status_gestion, asesor);

-- ---------- LEADS_BOTTOM ----------
-- Reemplaza la hoja "bottom{campaña}" (perfilamiento + beneficios).
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

  -- Perfilamiento (usado por calcularPerfilamientoCompleto)
  por_que_eligio_carrera text default '',
  que_busca_universidad  text default '',
  quien_financiara       text default '',
  acciones_definidas     text default '',
  que_le_falta           text default '',
  otras_opciones         text default '',
  comentarios_perfil     text default '',

  -- Historial de comentarios, igual formato JSON que ya usas hoy.
  comentarios_historial jsonb default '[]',

  actualizado_en  timestamptz not null default now(),

  primary key (id_prometeo, campana),
  foreign key (id_prometeo, campana) references leads (id_prometeo, campana) on delete cascade
);

-- ---------- LEADS_PAGOS ----------
-- Reemplaza pagosMap (solo visible para roles admin/supervisor).
create table if not exists leads_pagos (
  id_prometeo     text not null,
  campana         text not null,
  status_pago_final text default '',      -- 'PAGO COMPLETO' | 'PAGO FRACCIONADO' | ...
  fecha_pago_completo text default '',
  fecha_promesa_pago  text default '',
  actualizado_en  timestamptz not null default now(),

  primary key (id_prometeo, campana),
  foreign key (id_prometeo, campana) references leads (id_prometeo, campana) on delete cascade
);

-- ---------- NOMBRES AUXILIARES DE ASESORES ----------
-- Reemplaza nombreAuxMap (probablemente ya cubierto por la tabla `usuarios`
-- de la Fase 2 vía nombre_aux, pero lo dejamos aparte por si el mapeo usa
-- una fuente distinta a USUARIOS).
create table if not exists asesores_nombre_aux (
  nombre_raw  text primary key,
  nombre_aux  text not null
);
