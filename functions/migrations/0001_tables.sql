-- MockFinal Serverless schema (Qoder Sites managed PostgreSQL subset).
-- Rules: no FOREIGN KEYs, no arrays, no CHECK, no partial/expression indexes,
-- no identity/serial. Primary keys are application-generated bigint values.

CREATE TABLE app.users (
  id bigint PRIMARY KEY,
  username text NOT NULL,
  password_hash text NOT NULL,
  security_question text NOT NULL,
  security_answer_hash text NOT NULL,
  token_version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (username)
);

CREATE TABLE app.workspaces (
  id bigint PRIMARY KEY,
  user_id bigint NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.materials (
  id bigint PRIMARY KEY,
  workspace_id bigint NOT NULL,
  filename text NOT NULL,
  storage_key text NOT NULL,
  size bigint NOT NULL,
  content_type text NOT NULL,
  status text NOT NULL,
  error text,
  chunk_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storage_key)
);

CREATE TABLE app.material_sections (
  id bigint PRIMARY KEY,
  material_id bigint NOT NULL,
  workspace_id bigint NOT NULL,
  ordinal integer NOT NULL,
  heading text NOT NULL,
  content text NOT NULL,
  char_count integer NOT NULL,
  page integer,
  meta jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.generation_jobs (
  id bigint PRIMARY KEY,
  workspace_id bigint NOT NULL,
  status text NOT NULL,
  stage text,
  error text,
  cursor jsonb NOT NULL,
  lease_key bigint,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (lease_key)
);

CREATE TABLE app.artifacts (
  id bigint PRIMARY KEY,
  workspace_id bigint NOT NULL,
  job_id bigint NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  storage_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, kind),
  UNIQUE (storage_key)
);

CREATE TABLE app.review_decks (
  id bigint PRIMARY KEY,
  workspace_id bigint NOT NULL,
  title text NOT NULL,
  status text NOT NULL,
  style jsonb NOT NULL,
  outline jsonb NOT NULL,
  source_signature text,
  last_page_id bigint,
  completed_page_ids jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.knowledge_points (
  id bigint PRIMARY KEY,
  deck_id bigint NOT NULL,
  parent_id bigint,
  ordinal integer NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  importance text NOT NULL,
  difficulty text NOT NULL,
  objectives jsonb NOT NULL,
  key_points jsonb NOT NULL,
  formulas jsonb NOT NULL,
  misconceptions jsonb NOT NULL,
  source_refs jsonb NOT NULL,
  interaction_idea text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.deck_pages (
  id bigint PRIMARY KEY,
  deck_id bigint NOT NULL,
  knowledge_point_ids jsonb NOT NULL,
  primary_knowledge_point_id bigint,
  ordinal integer NOT NULL,
  title text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL,
  current_version integer NOT NULL,
  bundle_key text,
  thumbnail_key text,
  manifest jsonb NOT NULL,
  validation jsonb NOT NULL,
  build_attempts integer NOT NULL,
  builder_build_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.deck_build_jobs (
  id bigint PRIMARY KEY,
  deck_id bigint NOT NULL,
  workspace_id bigint NOT NULL,
  status text NOT NULL,
  stage text,
  progress integer NOT NULL,
  total_pages integer NOT NULL,
  ready_pages integer NOT NULL,
  failed_pages integer NOT NULL,
  error text,
  cancel_requested boolean NOT NULL DEFAULT false,
  target_page_id bigint,
  feedback text,
  usage jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE TABLE app.deck_build_events (
  id bigint PRIMARY KEY,
  job_id bigint NOT NULL,
  page_id bigint,
  type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.page_chat_messages (
  id bigint PRIMARY KEY,
  user_id bigint NOT NULL,
  deck_id bigint NOT NULL,
  page_id bigint NOT NULL,
  role text NOT NULL,
  status text NOT NULL,
  content text NOT NULL,
  quote text,
  context_refs jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.auth_limiter (
  key text PRIMARY KEY,
  failures integer NOT NULL,
  window_start timestamptz NOT NULL
);
