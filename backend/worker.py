"""后台 worker：用 SKIP LOCKED 认领 pending 记录并写入判定结论。

同时周期采集场站电场读数写入 interlock_state，供雷电联闸拦截判定
与前端展示；采样只能发生在服务端，前端不得自填。
"""

import os
import time
from datetime import datetime, timezone

import psycopg
from psycopg.rows import dict_row

from db import SCHEMA, connect
from interlock import collect_reading, ensure_state_row
from rules import judge

POLL_SEC = float(os.environ.get("WORKER_POLL_SEC", "0.5"))
IDLE_SEC = float(os.environ.get("WORKER_IDLE_SEC", "1.0"))


def ensure_schema(conn):
    conn.execute(SCHEMA)
    ensure_state_row(conn)
    conn.commit()


def claim_and_process(conn) -> bool:
    with conn.transaction():
        row = conn.execute(
            """SELECT id, turbine_code, yaw_err_deg
               FROM yaw_logs
               WHERE status = 'pending'
               ORDER BY id
               FOR UPDATE SKIP LOCKED
               LIMIT 1"""
        ).fetchone()
        if row is None:
            return False
        verdict, reason = judge(float(row["yaw_err_deg"]))
        now = datetime.now(timezone.utc)
        conn.execute(
            """UPDATE yaw_logs
               SET status = 'done', verdict = %s, reason = %s, processed_at = %s
               WHERE id = %s""",
            (verdict, reason, now, row["id"]),
        )
    return True


def main():
    print("yaw-align worker started", flush=True)
    with connect() as conn:
        ensure_schema(conn)
    while True:
        try:
            with connect() as conn:
                collect_reading(conn)
                processed = claim_and_process(conn)
                conn.commit()
                time.sleep(POLL_SEC if processed else IDLE_SEC)
        except psycopg.Error as exc:
            print(f"worker db error: {exc}", flush=True)
            time.sleep(IDLE_SEC)


if __name__ == "__main__":
    main()
