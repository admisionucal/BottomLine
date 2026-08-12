-- ============================================================
-- Columnas para replicar hoyOverrideEsConfiable / permitirActualizarAsignacionDetail
-- Guardan el asesor/status TAL COMO VIENEN del import diario de base
-- (importarLogBases), sin que el scraper de Prometeo (actualizarLeadsHoy)
-- los sobreescriba. Así se puede comparar "lo que dice hoy" contra
-- "lo que dice la base", igual que el código real.
-- ============================================================
alter table leads
  add column if not exists asesor_base text,
  add column if not exists status_base text;
