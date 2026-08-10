-- ============================================================
-- Tabla auxiliar para actualizarLeadsBase: registra qué IDs se
-- vieron HOY en el import diario de cada campaña, para poder
-- marcar en_base=false a los que ya no vinieron, sin mandar
-- todos los IDs de golpe en un solo request desde Apps Script.
-- Se limpia sola al final de cada import (ver leadsBase.ts).
-- ============================================================
create table if not exists import_base_seen (
  campana     text not null,
  id_prometeo text not null,
  fecha       date not null default current_date,
  primary key (campana, id_prometeo, fecha)
);
