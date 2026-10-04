import os

import psycopg
from psycopg.rows import dict_row

DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://app:app@localhost:54399/yawalign",
)


def connect():
    return psycopg.connect(DSN, row_factory=dict_row)


SCHEMA = """
CREATE TABLE IF NOT EXISTS yaw_logs (
    id serial PRIMARY KEY,
    turbine_code text NOT NULL,
    yaw_err_deg double precision NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    verdict text,
    reason text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL,
    processed_at timestamptz
);

CREATE TABLE IF NOT EXISTS interlock_state (
    id boolean PRIMARY KEY DEFAULT TRUE CHECK (id),
    engaged boolean NOT NULL DEFAULT FALSE,
    threshold_kv_m double precision,
    engaged_by text,
    engaged_at timestamptz,
    last_duration_sec double precision,
    latest_reading_kv_m double precision,
    latest_sampled_at timestamptz
);

CREATE TABLE IF NOT EXISTS interlock_events (
    id serial PRIMARY KEY,
    event_type text NOT NULL,
    threshold_kv_m double precision,
    reading_kv_m double precision,
    actor text NOT NULL,
    turbine_code text,
    detail text NOT NULL,
    created_at timestamptz NOT NULL
);
"""
