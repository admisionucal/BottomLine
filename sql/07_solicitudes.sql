-- ============================================================
-- SOLICITUDES: recategorización de boleta/beneficio (createSolicitud,
-- resolveSolicitud, cancelarSolicitud, etc.)
-- ============================================================
create table if not exists solicitudes (
  id_solicitud   text primary key,
  id_prometeo    text not null,
  campana        text not null,
  asesor_email   text default '',
  asesor_nombre  text default '',
  boleta_actual              text default '',
  beneficio_actual           text default '',
  boleta_con_beca_actual     text default '',
  boleta_solicitada          text default '',
  beneficio_solicitado       text default '',
  boleta_con_beca_solicitada text default '',
  status         text not null default 'PENDIENTE',
  fecha_solicitud   timestamptz not null default now(),
  fecha_resolucion  timestamptz,
  admin_email    text default ''
);

create index if not exists idx_solicitudes_lead on solicitudes (id_prometeo, campana);
create index if not exists idx_solicitudes_campana_status on solicitudes (campana, status);

-- Garantiza a nivel de base de datos que no haya 2 solicitudes PENDIENTE
-- para el mismo lead (reemplaza el lock manual de Apps Script) — evita
-- condiciones de carrera sin necesidad de LockService.
create unique index if not exists idx_solicitudes_pendiente_unica
  on solicitudes (id_prometeo, campana)
  where status = 'PENDIENTE';
