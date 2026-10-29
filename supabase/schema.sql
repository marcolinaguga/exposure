-- ===========================================================================
-- SCHEMA DO BANCO DE DADOS (PostgreSQL do Supabase)
--
-- Como usar: no painel do Supabase, abra "SQL Editor" > "New query",
-- cole TODO este arquivo e clique em "Run". Pode rodar mais de uma vez
-- sem problemas (os comandos usam "if not exists" / "on conflict").
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- Tabela de ÁLBUNS
-- Cada linha é um álbum. "is_public" controla quem pode ver:
--   true  -> qualquer visitante vê
--   false -> só o proprietário (logado) vê
-- ---------------------------------------------------------------------------
create table if not exists public.albums (
    id             uuid primary key default gen_random_uuid(),
    title          text        not null,
    -- "slug" é a versão do título usada na URL: "Viagem à Serra" -> "viagem-a-serra"
    slug           text        not null unique,
    description    text,
    is_public      boolean     not null default false,
    -- Foto usada como capa do álbum (a chave estrangeira é criada mais abaixo,
    -- depois que a tabela "photos" existir).
    cover_photo_id uuid,
    created_at     timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- Tabela de FOTOS
-- O arquivo da imagem NÃO fica aqui: ele fica no Storage. Aqui guardamos
-- apenas o "caminho" do arquivo no Storage e os metadados (EXIF).
-- ---------------------------------------------------------------------------
create table if not exists public.photos (
    id            uuid primary key default gen_random_uuid(),
    album_id      uuid        not null,

    -- Caminhos dentro do bucket. Ex.: "<album_id>/<photo_id>.jpg"
    storage_path  text        not null unique,
    thumb_path    text        not null,

    title         text,
    description   text,
    width         integer,
    height        integer,
    file_size     bigint,          -- em bytes

    -- Metadados EXIF (extraídos no navegador, validados no backend)
    camera_make   text,            -- fabricante: "Canon"
    camera_model  text,            -- modelo: "Canon EOS Rebel T6i"
    lens_model    text,            -- lente: "EF-S18-55mm f/3.5-5.6 IS STM"
    focal_length  numeric(7, 2),   -- distância focal em mm: 50.00
    aperture      numeric(5, 2),   -- número f: 1.80
    exposure_time double precision,-- tempo de exposição em segundos: 0.004
    shutter_speed text,            -- versão legível: "1/250"
    iso           integer,         -- 100, 800, 3200...
    taken_at      timestamptz,     -- data/hora em que a foto foi tirada

    created_at    timestamptz not null default now(),

    -- Se o álbum for apagado, as linhas das fotos dele somem junto (cascade).
    -- O nome da restrição é explícito porque o backend o usa nas consultas.
    constraint photos_album_id_fkey
        foreign key (album_id) references public.albums (id) on delete cascade
);

-- Índice: acelera a busca "todas as fotos do álbum X".
create index if not exists photos_album_id_idx on public.photos (album_id);


-- ---------------------------------------------------------------------------
-- Chave estrangeira da capa do álbum.
-- Se a foto de capa for apagada, o campo vira NULL (o backend escolhe outra).
-- ---------------------------------------------------------------------------
alter table public.albums drop constraint if exists albums_cover_photo_id_fkey;
alter table public.albums
    add constraint albums_cover_photo_id_fkey
    foreign key (cover_photo_id) references public.photos (id) on delete set null;


-- ---------------------------------------------------------------------------
-- SEGURANÇA (Row Level Security)
-- Ativamos o RLS e NÃO criamos nenhuma política. Resultado: a chave pública
-- ("anon") do Supabase não consegue ler nem escrever nada. Apenas o nosso
-- backend, que usa a chave "service_role", acessa os dados. Assim toda regra
-- de acesso (público/privado, login) fica centralizada no código Python.
-- ---------------------------------------------------------------------------
alter table public.albums enable row level security;
alter table public.photos enable row level security;


-- ---------------------------------------------------------------------------
-- BUCKET DO STORAGE
-- Bucket PRIVADO: nenhum arquivo tem link público permanente. O backend gera
-- links temporários ("signed URLs") só para fotos que o visitante pode ver.
-- Limite de 50 MB por arquivo (máximo do plano gratuito) e só JPG/PNG.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 52428800, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;
