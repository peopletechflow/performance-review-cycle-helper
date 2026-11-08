create table resources (
  id text primary key,
  tenant_id text not null,
  user_id text not null,
  kind text not null,
  version int not null check (version > 0),
  state text not null,
  content jsonb not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index resources_owner on resources (tenant_id, user_id, kind);
create table previews (
  token_hash text primary key,
  tenant_id text not null,
  user_id text not null,
  kind text not null,
  resource_id text not null,
  version int not null,
  digest text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index previews_expiry on previews (expires_at);
create table commits (
  tenant_id text not null,
  user_id text not null,
  tool text not null,
  idem_key text not null,
  resource_id text not null,
  digest text not null,
  status text not null check (status in ('pending','succeeded','failed','unknown')),
  result jsonb,
  upstream_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id, tool, idem_key)
);
create index commits_unknown on commits (status) where status in ('pending','unknown');
create table consents (
  tenant_id text not null,
  user_id text not null,
  scope text not null,
  granted_at timestamptz not null,
  revoked_at timestamptz,
  primary key (tenant_id, user_id, scope)
);
create table audit_log (
  id bigserial primary key,
  ts timestamptz not null default now(),
  tenant_id text not null,
  user_id text not null,
  tool text not null,
  outcome text not null,
  inputs jsonb not null,
  detail text
)
