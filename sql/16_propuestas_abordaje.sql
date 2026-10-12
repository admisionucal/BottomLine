create table if not exists propuestas_abordaje (
    id            bigserial primary key,
    campana       text not null,
    generado_en   timestamptz not null default now(),
    origen        text not null default 'cron',
    generado_por  text not null default '',
    macro         text not null default '',
    grupos        jsonb not null default '[]'::jsonb,
    por_asesor    jsonb not null default '[]'::jsonb,
    resumen       jsonb not null default '{}'::jsonb,
    proveedor_ia  text not null default '',
    modelo_ia     text not null default '',
    error         text not null default ''
);
create index if not exists idx_propuestas_abordaje_campana on propuestas_abordaje (campana, generado_en desc);
