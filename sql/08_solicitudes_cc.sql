-- ============================================================
-- SOLICITUDES_CC: espejo de lectura de la hoja SOLICITUDES_CC.
-- Las escrituras siguen ocurriendo en Apps Script (Drive/Gmail están ahí),
-- que hace dual-write hacia esta tabla en cada cambio de estado.
-- ============================================================
create table if not exists solicitudes_cc (
  id_solicitud    text primary key,
  fecha_solicitud timestamptz,
  campana         text default '',
  id_prometeo     text default '',
  asesor_email    text default '',
  asesor_nombre   text default '',
  correos_adicionales text default '',
  dni_file_id             text default '',
  dni_file_nombre         text default '',
  certificado_file_id     text default '',
  certificado_file_nombre text default '',
  boleta_procedencia_file_id     text default '',
  boleta_procedencia_file_nombre text default '',
  status          text default 'PENDIENTE',
  fecha_resolucion timestamptz,
  admin_email     text default '',
  motivo_rechazo  text default '',
  tipo_referido   text default '',
  personas_referido_json text default '',
  historial_envios text default '',
  actualizado_en  timestamptz not null default now()
);

create index if not exists idx_solicitudes_cc_campana_status on solicitudes_cc (campana, status);
create index if not exists idx_solicitudes_cc_lead on solicitudes_cc (id_prometeo, campana);
