alter table campanas add column if not exists ventas_spreadsheet_id text not null default '';
alter table campanas add column if not exists ventas_hoja text not null default '';
alter table campanas add column if not exists vb_lista jsonb not null default '["RAUL","MARIO","ROSMERY"]'::jsonb;
update campanas set ventas_spreadsheet_id = '14HDYCYjcdgM6suTaPwNaxiI8B-PytjPJK_gxegH7fgc', ventas_hoja = 'Forms de Ventas 27-1'
where codigo = '27.1' and ventas_spreadsheet_id = '';
