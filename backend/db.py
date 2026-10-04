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

-- 雷电联闸：单行单例（id 恒为 1），记录开关状态与电场上限
CREATE TABLE IF NOT EXISTS lightning_interlock (
    id int PRIMARY KEY,
    is_open boolean NOT NULL DEFAULT false,
    field_threshold_kvm double precision NOT NULL DEFAULT 4.0,
    opened_by text,
    opened_at timestamptz,
    open_until timestamptz,
    close_reason text,
    CONSTRAINT lightning_interlock_singleton CHECK (id = 1)
);

-- 服务端采集的大气电场读数（kV/m，有符号）；只能由后端写入
CREATE TABLE IF NOT EXISTS lightning_readings (
    id bigserial PRIMARY KEY,
    field_kvm double precision NOT NULL,
    sampled_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lightning_readings_sampled
    ON lightning_readings (sampled_at DESC);

-- 雷电联闸流水（开闸/关闸/到期解除/越界退回）
CREATE TABLE IF NOT EXISTS lightning_flow (
    id bigserial PRIMARY KEY,
    action text NOT NULL,
    detail text NOT NULL,
    field_kvm double precision,
    threshold_kvm double precision,
    operator text,
    created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lightning_flow_id ON lightning_flow (id DESC);

-- 小项设置（如上次开闸时长，供阈值区记忆）
CREATE TABLE IF NOT EXISTS app_settings (
    key text PRIMARY KEY,
    value text NOT NULL
);
"""
