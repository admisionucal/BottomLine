-- ============================================================
-- Campo nuevo FECHA PRIM VP/PP (primera fecha en que el lead
-- tuvo un compromiso de pago como VP o PP). Se llena solo una
-- vez, en leadsHoy.ts, y nunca se sobrescribe después.
-- ============================================================
alter table leads
  add column if not exists fecha_prim_vp_pp text default '';
