-- Phase 0 capability probe. Apply only on a temporary probe site and drop afterwards.
CREATE TABLE app.probe (
  id text PRIMARY KEY,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
