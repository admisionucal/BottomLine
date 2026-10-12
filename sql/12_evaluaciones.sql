create table if not exists evaluaciones (
    id            serial primary key,
    codigo        varchar(80) unique not null,
    titulo        varchar(200) not null,
    descripcion   text,
    archivo       varchar(200) not null,
    activo        boolean not null default true,
    orden         int not null default 0,
    creado_en     timestamptz not null default now()
);

create table if not exists evaluacion_intentos (
    id                 serial primary key,
    evaluacion_id      int not null references evaluaciones(id),
    usuario            varchar(100) not null references usuarios(usuario),
    nombre             varchar(200),
    campana            varchar(200),
    puntaje_obtenido   numeric(6,2) not null default 0,
    puntaje_maximo     numeric(6,2) not null default 0,
    porcentaje         numeric(5,2) not null default 0,
    respuestas         jsonb not null default '{}'::jsonb,
    detalle            jsonb,
    iniciado_en        timestamptz,
    finalizado_en       timestamptz,
    duracion_segundos  int,
    por_tiempo         boolean not null default false,
    creado_en          timestamptz not null default now(),
    unique (evaluacion_id, usuario)
);

create index if not exists idx_evaluacion_intentos_evaluacion on evaluacion_intentos(evaluacion_id);
create index if not exists idx_evaluacion_intentos_usuario on evaluacion_intentos(usuario);

insert into evaluaciones (codigo, titulo, descripcion, archivo, orden)
values (
    'marca_ucal_1',
    'Evaluación de Marca UCAL',
    'Evaluación de conocimiento sobre la propuesta de marca UCAL, a resolver por cada asesor.',
    'evaluacion-marca-ucal.html',
    1
)
on conflict (codigo) do nothing;

alter table evaluaciones add column if not exists asignado_a_nadie boolean not null default false;
alter table evaluaciones add column if not exists duracion_minutos integer not null default 40;