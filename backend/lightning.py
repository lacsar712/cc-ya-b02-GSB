"""雷电联闸数据访问与判定（api / worker 共用）。

所有写操作都接受外部连接与事务，调用方负责 commit —— 这样
偏航报送的「越界退回流水」可以和拒收决策落在同一个数据库事务里。
"""

import os
import random
from datetime import datetime, timedelta, timezone

# ---- 电场模拟采集参数（只在服务端 worker 内使用，前端永远拿不到写口）----
FIELD_INITIAL = 0.0
FIELD_VOL = float(os.environ.get("LIGHTNING_FIELD_VOL", "0.35"))
FIELD_REVERT = float(os.environ.get("LIGHTNING_FIELD_REVERT", "0.12"))
FIELD_LIMIT = float(os.environ.get("LIGHTNING_FIELD_LIMIT", "12.0"))

DEFAULT_THRESHOLD_KVM = 4.0
DEFAULT_DURATION_MIN = 60
MAX_DURATION_MIN = 1440

SINGLETON_ID = 1
LAST_DURATION_KEY = "last_open_duration_min"


# ---------------- 基础 ----------------

def ensure_singleton(conn):
    """联闸状态表是单行单例；启动与写操作前幂等确保存在。"""
    conn.execute(
        """INSERT INTO lightning_interlock (id, is_open, field_threshold_kvm)
           VALUES (%s, false, %s)
           ON CONFLICT (id) DO NOTHING""",
        (SINGLETON_ID, DEFAULT_THRESHOLD_KVM),
    )


def insert_flow(conn, action, detail, *, field_kvm=None, threshold_kvm=None,
                operator=None, now=None):
    conn.execute(
        """INSERT INTO lightning_flow
           (action, detail, field_kvm, threshold_kvm, operator, created_at)
           VALUES (%s, %s, %s, %s, %s, %s)""",
        (action, detail, field_kvm, threshold_kvm, operator,
         now or datetime.now(timezone.utc)),
    )


def get_setting(conn, key, default=None):
    row = conn.execute(
        "SELECT value FROM app_settings WHERE key = %s", (key,)
    ).fetchone()
    return row["value"] if row else default


def set_setting(conn, key, value):
    conn.execute(
        """INSERT INTO app_settings (key, value) VALUES (%s, %s)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value""",
        (key, str(value)),
    )


# ---------------- 服务端采集 ----------------

def next_field(prev: float) -> float:
    """均值回复随机游走，模拟大气电场（kV/m）。仅服务端调用。"""
    value = prev - FIELD_REVERT * prev + random.gauss(0.0, FIELD_VOL)
    return round(max(-FIELD_LIMIT, min(FIELD_LIMIT, value)), 3)


def record_reading(conn, field_kvm: float, now: datetime) -> None:
    conn.execute(
        "INSERT INTO lightning_readings (field_kvm, sampled_at) VALUES (%s, %s)",
        (field_kvm, now),
    )


def latest_reading(conn):
    return conn.execute(
        """SELECT field_kvm, sampled_at FROM lightning_readings
           ORDER BY id DESC LIMIT 1"""
    ).fetchone()


def recent_readings(conn, limit=24):
    return conn.execute(
        """SELECT field_kvm, sampled_at FROM lightning_readings
           ORDER BY id DESC LIMIT %s""",
        (limit,),
    ).fetchall()


def ensure_initial_reading(conn):
    """后端启动时若尚无读数先落一条，避免联闸查不到服务端读数。"""
    row = latest_reading(conn)
    if row is None:
        record_reading(conn, FIELD_INITIAL, datetime.now(timezone.utc))


# ---------------- 联闸状态变更 ----------------

def expire_if_due(conn, now: datetime) -> bool:
    """联闸到点自动解除；返回是否发生了解除。须在事务内调用。"""
    row = conn.execute(
        """UPDATE lightning_interlock
           SET is_open = false, close_reason = 'expired'
           WHERE id = %s AND is_open = true AND open_until IS NOT NULL
                 AND open_until <= %s
           RETURNING field_threshold_kvm""",
        (SINGLETON_ID, now),
    ).fetchone()
    if row is None:
        return False
    insert_flow(
        conn,
        "auto_close",
        "联闸到计划解除时间自动解除，偏航报送恢复",
        threshold_kvm=row["field_threshold_kvm"],
        now=now,
    )
    return True


def open_interlock(conn, *, threshold_kvm, duration_min, operator, now):
    """拉起联闸：写入上限与解除时间，并记忆本次开闸时长。"""
    open_until = now + timedelta(minutes=duration_min)
    conn.execute(
        """UPDATE lightning_interlock
           SET is_open = true,
               field_threshold_kvm = %s,
               opened_by = %s,
               opened_at = %s,
               open_until = %s,
               close_reason = NULL
           WHERE id = %s""",
        (threshold_kvm, operator, now, open_until, SINGLETON_ID),
    )
    set_setting(conn, LAST_DURATION_KEY, duration_min)
    insert_flow(
        conn,
        "open",
        f"雷电联闸开启：电场上限 {threshold_kvm:g} kV/m，"
        f"计划 {duration_min} 分钟后解除",
        threshold_kvm=threshold_kvm,
        operator=operator,
        now=now,
    )
    return open_until


def close_interlock(conn, *, operator, now):
    row = conn.execute(
        """UPDATE lightning_interlock
           SET is_open = false, close_reason = 'manual'
           WHERE id = %s AND is_open = true
           RETURNING field_threshold_kvm""",
        (SINGLETON_ID,),
    ).fetchone()
    if row is None:
        return False
    insert_flow(
        conn,
        "manual_close",
        "技师手动关闭雷电联闸，偏航报送恢复",
        threshold_kvm=row["field_threshold_kvm"],
        operator=operator,
        now=now,
    )
    return True


# ---------------- 报送联闸校验（与插入同一事务） ----------------

def check_submission(conn, now):
    """在报送事务内调用。

    返回 (interlock_row, reading_row)；调用方据此决定拒收还是受理。
    对联闸单行加 FOR UPDATE 行锁，并顺带做到期解除，保证判定与
    流水写入在同一事务内原子完成。
    """
    expire_if_due(conn, now)
    il = conn.execute(
        "SELECT * FROM lightning_interlock WHERE id = %s FOR UPDATE",
        (SINGLETON_ID,),
    ).fetchone()
    reading = latest_reading(conn)
    return il, reading


def is_reading_over_limit(field_kvm, threshold_kvm):
    return abs(float(field_kvm)) > float(threshold_kvm)


def insert_reject_flow(conn, *, turbine_code, field_kvm, threshold_kvm,
                       operator, now):
    insert_flow(
        conn,
        "reject",
        f"机组 {turbine_code} 偏航报送整单退回：电场读数 {field_kvm:g} kV/m "
        f"越限（|E| 超过上限 {threshold_kvm:g} kV/m），联闸生效中",
        field_kvm=field_kvm,
        threshold_kvm=threshold_kvm,
        operator=operator,
        now=now,
    )


# ---------------- 查询组装 ----------------

def flow_list(conn, limit=50):
    rows = conn.execute(
        """SELECT id, action, detail, field_kvm, threshold_kvm,
                  operator, created_at
           FROM lightning_flow ORDER BY id DESC LIMIT %s""",
        (limit,),
    ).fetchall()
    return [dict(r) for r in rows]


def last_duration_minutes(conn):
    raw = get_setting(conn, LAST_DURATION_KEY)
    try:
        value = int(raw) if raw is not None else DEFAULT_DURATION_MIN
    except (TypeError, ValueError):
        value = DEFAULT_DURATION_MIN
    return max(1, min(MAX_DURATION_MIN, value))


def status_payload(conn, now=None):
    now = now or datetime.now(timezone.utc)
    ensure_singleton(conn)
    expire_if_due(conn, now)
    il = conn.execute(
        "SELECT * FROM lightning_interlock WHERE id = %s", (SINGLETON_ID,)
    ).fetchone()
    reading = latest_reading(conn)
    recent = recent_readings(conn, 12)
    field_kvm = reading["field_kvm"] if reading else None
    over = (
        il["is_open"]
        and field_kvm is not None
        and is_reading_over_limit(field_kvm, il["field_threshold_kvm"])
    )
    return {
        "is_open": il["is_open"],
        "field_threshold_kvm": il["field_threshold_kvm"],
        "opened_by": il["opened_by"],
        "opened_at": il["opened_at"],
        "open_until": il["open_until"],
        "close_reason": il["close_reason"],
        "last_duration_minutes": last_duration_minutes(conn),
        "latest": (
            {
                "field_kvm": reading["field_kvm"],
                "sampled_at": reading["sampled_at"],
                "is_over_limit": over,
            }
            if reading
            else None
        ),
        "recent": [
            {"field_kvm": r["field_kvm"], "sampled_at": r["sampled_at"]}
            for r in recent
        ],
    }
