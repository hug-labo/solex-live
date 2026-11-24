-- Solex Live — schéma Supabase (V2)
-- À coller une seule fois dans Supabase : SQL Editor → New query → Run.
--
-- Principe de sécurité :
--  * les tables ne sont PAS accessibles directement avec la clé publique (RLS sans aucune règle) ;
--  * tout passe par des fonctions qui vérifient les identifiants de course :
--      - l'identifiant de course (id) permet de LIRE (stands, spectateurs) ;
--      - la clé d'écriture (write_key) permet d'ENVOYER des points et de modifier le circuit (téléphone, PC stand).
--  Ces deux valeurs sont des UUID aléatoires, impossibles à deviner : chaque équipe est isolée.

create table if not exists public.race_sessions (
  id         uuid primary key default gen_random_uuid(),
  write_key  uuid not null default gen_random_uuid(),
  name       text not null default '',
  circuit    jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.race_points (
  session_id uuid not null references public.race_sessions(id) on delete cascade,
  t          bigint not null,            -- horodatage GPS en millisecondes
  lat        double precision not null,
  lon        double precision not null,
  speed      real,                       -- m/s
  heading    real,                       -- degrés
  acc        real,                       -- précision (m)
  primary key (session_id, t)
);

alter table public.race_sessions enable row level security;
alter table public.race_points  enable row level security;
-- Aucune policy : accès direct refusé à la clé publique.

-- Créer une course ------------------------------------------------------------
create or replace function public.create_session(p_name text, p_circuit jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare s public.race_sessions;
begin
  if pg_column_size(p_circuit) > 300000 then raise exception 'Circuit trop volumineux'; end if;
  insert into public.race_sessions(name, circuit)
  values (left(coalesce(p_name, ''), 100), p_circuit)
  returning * into s;
  return json_build_object('id', s.id, 'write_key', s.write_key);
end $$;

-- Lire une course (nom + circuit) --------------------------------------------
create or replace function public.get_session(p_id uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('id', id, 'name', name, 'circuit', circuit, 'created_at', created_at)
  from public.race_sessions where id = p_id;
$$;

-- Modifier le circuit (clé d'écriture requise) --------------------------------
create or replace function public.update_circuit(p_id uuid, p_key uuid, p_circuit jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if pg_column_size(p_circuit) > 300000 then raise exception 'Circuit trop volumineux'; end if;
  update public.race_sessions set circuit = p_circuit where id = p_id and write_key = p_key;
  if not found then raise exception 'Clé de course invalide'; end if;
end $$;

-- Envoyer des points (clé d'écriture requise) ---------------------------------
-- p_points : tableau JSON de [t, lat, lon, speed, heading, acc]
create or replace function public.push_points(p_id uuid, p_key uuid, p_points jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not exists (select 1 from public.race_sessions where id = p_id and write_key = p_key) then
    raise exception 'Clé de course invalide';
  end if;
  if jsonb_array_length(p_points) > 600 then raise exception 'Trop de points dans un envoi'; end if;
  insert into public.race_points(session_id, t, lat, lon, speed, heading, acc)
  select p_id, (e->>0)::bigint, (e->>1)::float8, (e->>2)::float8,
         (e->>3)::real, (e->>4)::real, (e->>5)::real
  from jsonb_array_elements(p_points) as e
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Lire les points après un instant donné (par paquets) ------------------------
create or replace function public.get_points(p_id uuid, p_after bigint default -1, p_limit int default 5000)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_array(t, lat, lon, speed, heading, acc) order by t), '[]'::json)
  from (
    select t, lat, lon, speed, heading, acc from public.race_points
    where session_id = p_id and t > p_after
    order by t
    limit least(greatest(p_limit, 1), 5000)
  ) x;
$$;

revoke all on function public.create_session(text, jsonb)            from public;
revoke all on function public.get_session(uuid)                      from public;
revoke all on function public.update_circuit(uuid, uuid, jsonb)      from public;
revoke all on function public.push_points(uuid, uuid, jsonb)         from public;
revoke all on function public.get_points(uuid, bigint, int)          from public;
grant execute on function public.create_session(text, jsonb)         to anon, authenticated;
grant execute on function public.get_session(uuid)                   to anon, authenticated;
grant execute on function public.update_circuit(uuid, uuid, jsonb)   to anon, authenticated;
grant execute on function public.push_points(uuid, uuid, jsonb)      to anon, authenticated;
grant execute on function public.get_points(uuid, bigint, int)       to anon, authenticated;
