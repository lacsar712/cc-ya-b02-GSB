"""雷电联闸：开闸期间后台电场读数越界则整单退回偏航报送。

状态单行存放在 interlock_state（id = TRUE），操作为：
- 开闸（拉起联闸）：技师录入电场上限后启用，期间报送按读数拦截；
- 关闸（解除联闸）：恢复报送，并把本次开闸时长记入 last_duration_sec；
- 整单退回：退回流水（interlock_events）与拒收决定在同一事务提交。
"""

from datetime import datetime, timezone

from field_sensor import sample_field_kv_m

STALE_SEC = 30.0

STATE_COLUMNS = """engaged, threshold_kv_m, engaged_by, engaged_at,
                   last_duration_sec, latest_reading_kv_m, latest_sampled_at"""


def ensure_state_row(conn):
    conn.execute(
        "INSERT INTO interlock_state (id, engaged) VALUES (TRUE, FALSE) "
        "ON CONFLICT (id) DO NOTHING"
    )


def fetch_state(conn):
    return conn.execute(
        f"SELECT {STATE_COLUMNS} FROM interlock_state WHERE id = TRUE"
    ).fetchone()


def lock_state(conn):
    return conn.execute(
        f"SELECT {STATE_COLUMNS} FROM interlock_state WHERE id = TRUE FOR UPDATE"
    ).fetchone()


def collect_reading(conn, now=None):
    """服务端采集一次电场读数并落库（worker 周期调用）。"""
    now = now or datetime.now(timezone.utc)
    reading = sample_field_kv_m()
    conn.execute(
        """UPDATE interlock_state
           SET latest_reading_kv_m = %s, latest_sampled_at = %s
           WHERE id = TRUE""",
        (reading, now),
    )
    return reading


def current_reading(conn, state, now):
    """取后台最新采集值；缺失或过期（如 worker 暂停）则现场补采并落库。"""
    reading = state["latest_reading_kv_m"]
    sampled_at = state["latest_sampled_at"]
    stale = sampled_at is None or (now - sampled_at).total_seconds() > STALE_SEC
    if reading is None or stale:
        reading = collect_reading(conn, now)
    return reading


def engage(conn, username, threshold_kv_m, now):
    """拉起联闸。返回 (结果, None) 或 (None, 错误消息)。"""
    state = lock_state(conn)
    if state["engaged"]:
        return None, "联闸已处于开闸状态"
    conn.execute(
        """UPDATE interlock_state
           SET engaged = TRUE, threshold_kv_m = %s, engaged_by = %s, engaged_at = %s
           WHERE id = TRUE""",
        (threshold_kv_m, username, now),
    )
    detail = f"拉起联闸，电场上限 {threshold_kv_m} kV/m"
    conn.execute(
        """INSERT INTO interlock_events
           (event_type, threshold_kv_m, actor, detail, created_at)
           VALUES ('engage', %s, %s, %s, %s)""",
        (threshold_kv_m, username, detail, now),
    )
    return {"detail": detail}, None


def release(conn, username, now):
    """解除联闸（关闸），记忆本次开闸时长。返回 (结果, None) 或 (None, 错误消息)。"""
    state = lock_state(conn)
    if not state["engaged"]:
        return None, "联闸当前未开闸"
    engaged_at = state["engaged_at"]
    duration = (now - engaged_at).total_seconds() if engaged_at else None
    conn.execute(
        """UPDATE interlock_state
           SET engaged = FALSE, last_duration_sec = %s
           WHERE id = TRUE""",
        (duration,),
    )
    detail = f"解除联闸，本次开闸时长 {fmt_duration_cn(duration)}，恢复偏航报送"
    conn.execute(
        """INSERT INTO interlock_events
           (event_type, threshold_kv_m, actor, detail, created_at)
           VALUES ('release', %s, %s, %s, %s)""",
        (state["threshold_kv_m"], username, detail, now),
    )
    return {"detail": detail, "duration_sec": duration}, None


def check_submission(conn, username, turbine_code, now):
    """报送前拦截检查。

    开闸中且后台读数越界时，写入退回流水并返回退回信息（调用方在同一
    事务内提交后向客户端拒收）；其余情况返回 None 放行。
    """
    state = lock_state(conn)
    if not state["engaged"]:
        return None
    threshold = state["threshold_kv_m"]
    reading = current_reading(conn, state, now)
    if threshold is None or reading <= threshold:
        return None
    detail = (
        f"雷电联闸开闸中：电场读数 {reading} kV/m 越过上限 {threshold} kV/m，"
        f"机组 {turbine_code} 整单退回，解除联闸后恢复报送"
    )
    conn.execute(
        """INSERT INTO interlock_events
           (event_type, threshold_kv_m, reading_kv_m, actor, turbine_code,
            detail, created_at)
           VALUES ('reject', %s, %s, %s, %s, %s, %s)""",
        (threshold, reading, username, turbine_code, detail, now),
    )
    return {
        "detail": detail,
        "reading_kv_m": reading,
        "threshold_kv_m": threshold,
    }


def fmt_duration_cn(seconds):
    if seconds is None:
        return "—"
    s = max(0, round(seconds))
    if s < 60:
        return f"{s} 秒"
    m, r = divmod(s, 60)
    if m < 60:
        return f"{m} 分 {r} 秒" if r else f"{m} 分钟"
    h, m = divmod(m, 60)
    return f"{h} 小时 {m} 分"
