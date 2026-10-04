"""后台 worker：用 SKIP LOCKED 认领 pending 记录并写入判定结论。

同时运行一个服务端电场采集线程：周期向 lightning_readings 写入模拟
大气电场读数。读数只能由本线程产生，接口不接受任何前端上送的采样值。
"""

import os
import threading
import time
from datetime import datetime, timezone

import psycopg

from db import SCHEMA, connect
import lightning
from rules import judge

POLL_SEC = float(os.environ.get("WORKER_POLL_SEC", "0.5"))
IDLE_SEC = float(os.environ.get("WORKER_IDLE_SEC", "1.0"))
SAMPLE_SEC = float(os.environ.get("LIGHTNING_SAMPLE_SEC", "2.0"))


def ensure_schema(conn):
    conn.execute(SCHEMA)
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


def _bootstrap(conn):
    """首次启动：单例联闸行 + 第一条服务端采样。"""
    lightning.ensure_singleton(conn)
    lightning.ensure_initial_reading(conn)


def field_sampler_loop(stop_event: threading.Event):
    """服务端采集循环：读上一条 → 随机游走 → 落库，并顺带做到期解除。"""
    print("lightning field sampler started", flush=True)
    while not stop_event.wait(SAMPLE_SEC):
        try:
            with connect() as conn:
                lightning.ensure_singleton(conn)
                prev = lightning.latest_reading(conn)
                prev_field = float(prev["field_kvm"]) if prev else lightning.FIELD_INITIAL
                field_kvm = lightning.next_field(prev_field)
                now = datetime.now(timezone.utc)
                lightning.record_reading(conn, field_kvm, now)
                lightning.expire_if_due(conn, now)
        except psycopg.Error as exc:
            print(f"sampler db error: {exc}", flush=True)
            time.sleep(IDLE_SEC)


def main():
    print("yaw-align worker started", flush=True)
    with connect() as conn:
        ensure_schema(conn)
        _bootstrap(conn)
        conn.commit()

    stop_event = threading.Event()
    sampler = threading.Thread(
        target=field_sampler_loop, args=(stop_event,), daemon=True
    )
    sampler.start()

    try:
        while True:
            try:
                with connect() as conn:
                    if claim_and_process(conn):
                        conn.commit()
                        time.sleep(POLL_SEC)
                    else:
                        time.sleep(IDLE_SEC)
            except psycopg.Error as exc:
                print(f"worker db error: {exc}", flush=True)
                time.sleep(IDLE_SEC)
    except KeyboardInterrupt:
        stop_event.set()


if __name__ == "__main__":
    main()
