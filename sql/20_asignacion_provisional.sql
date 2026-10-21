alter table leads add column if not exists asesor_provisional text not null default '';
alter table leads add column if not exists asesor_provisional_en timestamptz;
alter table leads add column if not exists asesor_provisional_por text not null default '';
