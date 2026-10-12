-- ================================================================
-- UBICACIÓN POR MARCACIÓN (Asistencia > Calendario > mapa del día)
-- Correr una vez en el SQL Editor de Supabase, ANTES de desplegar.
--
-- Hasta ahora se guardaba una sola latitud/longitud por día (la de la
-- entrada). Con esto cada marcación guarda la suya. Los días anteriores
-- solo tendrán la de la entrada (se copia abajo).
-- ================================================================
alter table asistencia add column if not exists lat_entrada  text;
alter table asistencia add column if not exists lng_entrada  text;
alter table asistencia add column if not exists dir_entrada  text;
alter table asistencia add column if not exists lat_almuerzo text;
alter table asistencia add column if not exists lng_almuerzo text;
alter table asistencia add column if not exists dir_almuerzo text;
alter table asistencia add column if not exists lat_regreso  text;
alter table asistencia add column if not exists lng_regreso  text;
alter table asistencia add column if not exists dir_regreso  text;
alter table asistencia add column if not exists lat_salida   text;
alter table asistencia add column if not exists lng_salida   text;
alter table asistencia add column if not exists dir_salida   text;

-- Historial: la ubicación guardada hasta hoy corresponde a la entrada.
update asistencia
   set lat_entrada = latitud::text, lng_entrada = longitud::text, dir_entrada = direccion::text
 where lat_entrada is null and coalesce(latitud::text, '') <> '';
