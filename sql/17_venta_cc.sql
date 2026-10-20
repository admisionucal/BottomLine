alter table solicitudes_cc add column if not exists cc_pdf_file_id text default '';
alter table solicitudes_cc add column if not exists cc_pdf_file_nombre text default '';
alter table solicitudes_cc add column if not exists comprobante_file_id text default '';
alter table solicitudes_cc add column if not exists nee_file_id text default '';
alter table solicitudes_cc add column if not exists venta_registrada_en timestamptz;
alter table solicitudes_cc add column if not exists venta_registrada_por text default '';
