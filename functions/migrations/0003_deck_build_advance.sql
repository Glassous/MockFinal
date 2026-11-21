ALTER TABLE app.deck_build_jobs ADD COLUMN cursor jsonb;
ALTER TABLE app.deck_build_jobs ADD COLUMN lease_key bigint;
ALTER TABLE app.deck_build_jobs ADD COLUMN lease_until timestamptz;

CREATE INDEX deck_build_jobs_status_idx ON app.deck_build_jobs (status);
