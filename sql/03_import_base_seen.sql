create table if not exists import_base_seen (
  campana     text not null,
  id_prometeo text not null,
  fecha       date not null default current_date,
  primary key (campana, id_prometeo, fecha)
);
