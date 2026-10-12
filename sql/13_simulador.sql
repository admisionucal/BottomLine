create table if not exists sim_chats_fuente (
    id                 serial primary key,
    hash               text unique not null,
    archivo            text not null default '',
    asesor_real        text not null default '',
    etiqueta           text not null default '',
    carrera            text not null default '',
    tipo_ingreso       text not null default '',
    modalidad          text not null default '',
    telefono           text not null default '',
    nivel_interaccion  text not null default 'normal',
    n_mensajes         int  not null default 0,
    n_mensajes_lead    int  not null default 0,
    prom_palabras_lead numeric(6,2) not null default 0,
    mensajes           jsonb not null default '[]'::jsonb,
    activo             boolean not null default true,
    creado_en          timestamptz not null default now()
);
create index if not exists idx_sim_chats_tipo on sim_chats_fuente (tipo_ingreso);
create index if not exists idx_sim_chats_nivel on sim_chats_fuente (nivel_interaccion);
create index if not exists idx_sim_chats_tel on sim_chats_fuente (telefono);

create table if not exists sim_escenarios (
    id                  serial primary key,
    codigo              varchar(80) unique not null,
    titulo              varchar(200) not null,
    nivel               int not null check (nivel between 1 and 4),
    objetivo            text not null default '',
    descripcion         text not null default '',
    filtros             jsonb not null default '{}'::jsonb,
    instrucciones_extra text not null default '',
    activo              boolean not null default true,
    orden               int not null default 0,
    creado_por          text default '',
    creado_en           timestamptz not null default now()
);

create table if not exists sim_asignaciones (
    id            serial primary key,
    escenario_id  int not null references sim_escenarios(id) on delete cascade,
    usuario       text not null references usuarios(usuario),
    asignado_por  text default '',
    fecha_limite  timestamptz,
    creado_en     timestamptz not null default now(),
    unique (escenario_id, usuario)
);
create index if not exists idx_sim_asig_usuario on sim_asignaciones (usuario);

create table if not exists sim_sesiones (
    id                    uuid primary key default gen_random_uuid(),
    usuario               text not null references usuarios(usuario),
    nombre                text default '',
    campana               text default '',
    escenario_id          int references sim_escenarios(id) on delete set null,
    asignacion_id         int references sim_asignaciones(id) on delete set null,
    canal                 text not null default 'chat',
    nivel                 int not null default 1,
    enfoque               text not null default '',
    fuente_chat_id        int references sim_chats_fuente(id) on delete set null,
    perfil_oculto         jsonb not null default '{}'::jsonb,
    precio_correcto       jsonb,
    mensajes              jsonb not null default '[]'::jsonb,
    estado                text not null default 'en_curso',
    puntaje_conversacion  numeric(5,2),
    puntaje_precision     numeric(5,2),
    habilitado            boolean,
    evaluacion            jsonb,
    proveedor_ia          text default '',
    modelo_ia             text default '',
    iniciado_en           timestamptz not null default now(),
    finalizado_en         timestamptz,
    duracion_segundos     int
);
create index if not exists idx_sim_ses_usuario on sim_sesiones (usuario, iniciado_en desc);
create index if not exists idx_sim_ses_estado on sim_sesiones (estado);

create table if not exists sim_conocimiento (
    clave          text primary key,
    contenido      text not null,
    actualizado_en timestamptz not null default now()
);

insert into sim_escenarios (codigo, titulo, nivel, objetivo, descripcion, filtros, orden) values
('libre_n1', 'Postulante receptivo', 1,
 'Apertura, conexión y descubrimiento de la necesidad',
 'Lead interesado, conversador o normal. Una sola objeción suave.', '{}'::jsonb, 1),
('libre_n2', 'Postulante con dudas', 2,
 'Descubrimiento, generación de valor y manejo de objeciones',
 'Lead normal o cortante, objeción moderada que evoluciona.', '{}'::jsonb, 2),
('libre_n3', 'Postulante que compara y cuida el precio', 3,
 'Conducir una conversación compleja con sensibilidad al precio',
 'Lead cortante, compara con otra institución, varias objeciones.', '{}'::jsonb, 3),
('libre_n4', 'Certificación', 4,
 'Conversación comercial completa',
 'Perfil y objeciones al azar; el asesor no conoce el tipo de cliente.', '{}'::jsonb, 4),
('traslado_mas2', 'Egresado de instituto (+2)', 3,
 'Ubicar correctamente al lead en el proceso de admisión',
 'Traslado con convalidación; verificar instituto, carrera de origen y modalidad virtual.',
 '{"tipo_ingreso":"programa_mas2"}'::jsonb, 5)
on conflict (codigo) do nothing;
