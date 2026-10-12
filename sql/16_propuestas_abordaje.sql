-- ================================================================
-- PROPUESTA DE ABORDAJE (Bottom Line > Análisis > Propuesta)
-- Correr una vez en el SQL Editor de Supabase.
-- La genera el Worker cada 4 horas (7:00, 11:00, 15:00 y 19:00, hora de
-- Lima) para cada campaña activa, o a demanda con "Generar ahora".
-- Se guardan 30 días de historial.
-- ================================================================
create table if not exists propuestas_abordaje (
    id            bigserial primary key,
    campana       text not null,
    generado_en   timestamptz not null default now(),
    origen        text not null default 'cron',          -- cron | manual
    generado_por  text not null default '',
    macro         text not null default '',              -- qué hacer con toda la campaña
    grupos        jsonb not null default '[]'::jsonb,    -- [{clave, titulo, regla, total, accion, ids:[{id, asesor}]}]
    por_asesor    jsonb not null default '[]'::jsonb,    -- [{asesor, conteos, total, accion}]
    resumen       jsonb not null default '{}'::jsonb,
    proveedor_ia  text not null default '',
    modelo_ia     text not null default '',
    error         text not null default ''
);
create index if not exists idx_propuestas_abordaje_campana on propuestas_abordaje (campana, generado_en desc);
