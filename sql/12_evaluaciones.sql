-- ================================================================
-- FASE: EVALUACIONES (Usuarios > Evaluaciones / Resultados)
-- ================================================================
-- Catálogo de evaluaciones disponibles (cada una vive como un .html
-- propio en principal/, igual que dashboard.html, asistencia.html, etc.)
create table if not exists evaluaciones (
    id            serial primary key,
    codigo        varchar(80) unique not null,   -- ej. 'marca_ucal_1'
    titulo        varchar(200) not null,
    descripcion   text,
    archivo       varchar(200) not null,          -- ej. 'evaluacion-marca-ucal.html'
    activo        boolean not null default true,
    orden         int not null default 0,
    creado_en     timestamptz not null default now()
);

-- Un intento por asesor por evaluación (no hay reintento, igual que el
-- comportamiento actual del .html: una vez enviado, solo se ve el resultado).
create table if not exists evaluacion_intentos (
    id                 serial primary key,
    evaluacion_id      int not null references evaluaciones(id),
    usuario            varchar(100) not null references usuarios(usuario),
    nombre             varchar(200),                -- snapshot del nombre al momento de resolver
    campana            varchar(200),                -- snapshot de la campaña del asesor
    puntaje_obtenido   numeric(6,2) not null default 0,
    puntaje_maximo     numeric(6,2) not null default 0,
    porcentaje         numeric(5,2) not null default 0,
    respuestas         jsonb not null default '{}'::jsonb,
    detalle            jsonb,                        -- desglose por pregunta (para el detalle en Resultados)
    iniciado_en        timestamptz,
    finalizado_en       timestamptz,
    duracion_segundos  int,
    por_tiempo         boolean not null default false, -- se envió automáticamente al agotarse el cronómetro
    creado_en          timestamptz not null default now(),
    unique (evaluacion_id, usuario)
);

create index if not exists idx_evaluacion_intentos_evaluacion on evaluacion_intentos(evaluacion_id);
create index if not exists idx_evaluacion_intentos_usuario on evaluacion_intentos(usuario);

-- Seed: la primera evaluación (la que llega en Evaluacion_Marca_UCAL_1.html,
-- reestilizada como principal/evaluacion-marca-ucal.html).
insert into evaluaciones (codigo, titulo, descripcion, archivo, orden)
values (
    'marca_ucal_1',
    'Evaluación de Marca UCAL',
    'Evaluación de conocimiento sobre la propuesta de marca UCAL, a resolver por cada asesor.',
    'evaluacion-marca-ucal.html',
    1
)
on conflict (codigo) do nothing;
