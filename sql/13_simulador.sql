-- ================================================================
-- FASE: CAPACITACIÓN IA (Simulador comercial por chat)
-- Correr una vez en el SQL Editor de Supabase.
-- Las fases de llamada y videollamada reutilizan estas mismas tablas
-- (columna `canal` en sim_sesiones).
-- ================================================================

-- ---------- CHATS REALES DE REFERENCIA ----------
-- Se cargan con scripts/importar_chats.py (genera el .sql de carga).
-- Los mensajes llegan ANONIMIZADOS (sin nombres, DNI, correos ni
-- teléfonos). El teléfono normalizado (9 dígitos) se guarda solo para
-- enlazar con el perfilamiento del lead (leads.telefono2) y nunca se
-- envía a la IA.
create table if not exists sim_chats_fuente (
    id                 serial primary key,
    hash               text unique not null,          -- evita cargar dos veces el mismo chat
    archivo            text not null default '',
    asesor_real        text not null default '',      -- asesor que atendió (del nombre del archivo)
    etiqueta           text not null default '',      -- etiqueta del contacto sin nombre (ej. "DGP +2")
    carrera            text not null default '',
    tipo_ingreso       text not null default '',      -- nuevo | traslado_con_convalidacion | programa_mas2 | cpa | ''
    modalidad          text not null default '',      -- semipresencial | virtual | ''
    telefono           text not null default '',      -- 9 dígitos, solo para el join con leads
    nivel_interaccion  text not null default 'normal',-- conversador | normal | cortante | muy_cortante
    n_mensajes         int  not null default 0,
    n_mensajes_lead    int  not null default 0,
    prom_palabras_lead numeric(6,2) not null default 0,
    mensajes           jsonb not null default '[]'::jsonb, -- [{r:'lead'|'asesor', t:'texto'}]
    activo             boolean not null default true,
    creado_en          timestamptz not null default now()
);
create index if not exists idx_sim_chats_tipo on sim_chats_fuente (tipo_ingreso);
create index if not exists idx_sim_chats_nivel on sim_chats_fuente (nivel_interaccion);
create index if not exists idx_sim_chats_tel on sim_chats_fuente (telefono);

-- ---------- ESCENARIOS ----------
-- Plantillas de práctica. `filtros` restringe qué chats reales se usan
-- como semilla: {"tipo_ingreso": "...", "carrera": "...", "modalidad": "..."}.
create table if not exists sim_escenarios (
    id                  serial primary key,
    codigo              varchar(80) unique not null,
    titulo              varchar(200) not null,
    nivel               int not null check (nivel between 1 and 4),
    objetivo            text not null default '',     -- competencia que se practica (se muestra al asesor)
    descripcion         text not null default '',     -- nota interna para supervisores
    filtros             jsonb not null default '{}'::jsonb,
    instrucciones_extra text not null default '',     -- indicaciones internas para el lead simulado
    activo              boolean not null default true,
    orden               int not null default 0,
    creado_por          text default '',
    creado_en           timestamptz not null default now()
);

-- ---------- ASIGNACIONES ----------
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

-- ---------- SESIONES DE PRÁCTICA ----------
create table if not exists sim_sesiones (
    id                    uuid primary key default gen_random_uuid(),
    usuario               text not null references usuarios(usuario),
    nombre                text default '',
    campana               text default '',
    escenario_id          int references sim_escenarios(id) on delete set null,
    asignacion_id         int references sim_asignaciones(id) on delete set null,
    canal                 text not null default 'chat',   -- chat | llamada | video
    nivel                 int not null default 1,
    enfoque               text not null default '',        -- competencia a reforzar (segundo intento)
    fuente_chat_id        int references sim_chats_fuente(id) on delete set null,
    perfil_oculto         jsonb not null default '{}'::jsonb,
    precio_correcto       jsonb,                           -- lo que le corresponde al lead según el pricing
    mensajes              jsonb not null default '[]'::jsonb, -- [{r:'asesor'|'lead', t, ts}]
    estado                text not null default 'en_curso', -- en_curso | finalizada | abandonada
    puntaje_conversacion  numeric(5,2),
    puntaje_precision     numeric(5,2),
    habilitado            boolean,                         -- Conversación >= 75 y Precisión >= 85
    evaluacion            jsonb,
    proveedor_ia          text default '',
    modelo_ia             text default '',
    iniciado_en           timestamptz not null default now(),
    finalizado_en         timestamptz,
    duracion_segundos     int
);
create index if not exists idx_sim_ses_usuario on sim_sesiones (usuario, iniciado_en desc);
create index if not exists idx_sim_ses_estado on sim_sesiones (estado);

-- ---------- CONOCIMIENTO EDITABLE (opcional) ----------
-- Si existe una fila aquí, reemplaza el texto por defecto que trae el
-- código. Claves usadas: 'rubrica', 'feedback', 'comportamiento_lead'.
-- Útil para pegar la Rúbrica V3.3 completa cuando se use Claude.
create table if not exists sim_conocimiento (
    clave          text primary key,
    contenido      text not null,
    actualizado_en timestamptz not null default now()
);

-- ---------- ESCENARIOS INICIALES ----------
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
