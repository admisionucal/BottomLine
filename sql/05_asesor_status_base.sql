alter table leads
  add column if not exists asesor_base text,
  add column if not exists status_base text;
