alter table leads add column if not exists venta_provisional_status text not null default '';
alter table leads add column if not exists venta_provisional_en timestamptz;
