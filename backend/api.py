import asyncio
import os
from datetime import datetime, timedelta, timezone
from functools import wraps

from jose import JWTError, jwt
from passlib.context import CryptContext
from quart import Quart, jsonify, request

from db import SCHEMA, connect
from interlock import check_submission, engage, ensure_state_row, fetch_state, release
from rules import judge

SECRET = os.environ.get("JWT_SECRET", "yaw-align-dev-secret")
pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

USERS = {
    "technician": {
        "role": "writer",
        "password_hash": pwd.hash("tech123456"),
    },
    "observer": {
        "role": "reader",
        "password_hash": pwd.hash("obs123456"),
    },
}

app = Quart(__name__)


def _run_db(fn, *args, **kwargs):
    return fn(*args, **kwargs)


async def run_db(fn, *args, **kwargs):
    return await asyncio.to_thread(_run_db, fn, *args, **kwargs)


def seed_if_empty(conn):
    conn.execute(SCHEMA)
    count = conn.execute("SELECT COUNT(*) AS n FROM yaw_logs").fetchone()["n"]
    if count > 0:
        return
    now = datetime.now(timezone.utc)
    samples = [
        ("W01", 0.4, "合格"),
        ("W07", 3.2, "偏航超差"),
    ]
    for code, err, expected_verdict in samples:
        verdict, reason = judge(err)
        assert verdict == expected_verdict
        conn.execute(
            """INSERT INTO yaw_logs
               (turbine_code, yaw_err_deg, status, verdict, reason,
                created_by, created_at, processed_at)
               VALUES (%s, %s, 'done', %s, %s, %s, %s, %s)""",
            (code, err, verdict, reason, "technician", now, now),
        )


@app.before_serving
async def startup():
    def init():
        with connect() as conn:
            seed_if_empty(conn)
            ensure_state_row(conn)
            conn.commit()

    await run_db(init)


def parse_bearer():
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


async def current_user():
    token = parse_bearer()
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET, algorithms=["HS256"])
    except JWTError:
        return None
    sub = payload.get("sub")
    if sub not in USERS:
        return None
    return {"username": sub, "role": payload.get("role")}


def require_login(handler):
    @wraps(handler)
    async def wrapper(*args, **kwargs):
        user = await current_user()
        if user is None:
            return jsonify({"detail": "未登录"}), 401
        return await handler(user, *args, **kwargs)

    return wrapper


def require_writer(handler=None, *, detail="仅现场技师可提交偏航记录"):
    def decorate(fn):
        @wraps(fn)
        async def wrapper(*args, **kwargs):
            user = await current_user()
            if user is None:
                return jsonify({"detail": "未登录"}), 401
            if user["role"] != "writer":
                return jsonify({"detail": detail}), 403
            return await fn(user, *args, **kwargs)

        return wrapper

    if handler is None:
        return decorate
    return decorate(handler)


@app.get("/api/health")
async def health():
    return jsonify({"status": "ok", "service": "yaw-align-log"})


@app.post("/api/auth/login")
async def login():
    body = await request.get_json(force=True, silent=True) or {}
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    user = USERS.get(username)
    if not user or not pwd.verify(password, user["password_hash"]):
        return jsonify({"detail": "用户名或密码错误"}), 401
    exp = datetime.now(timezone.utc) + timedelta(hours=8)
    token = jwt.encode(
        {"sub": username, "role": user["role"], "exp": exp},
        SECRET,
        algorithm="HS256",
    )
    return jsonify(
        {
            "access_token": token,
            "username": username,
            "role": user["role"],
        }
    )


@app.get("/api/logs")
@require_login
async def list_logs(user):
    def query():
        with connect() as conn:
            return conn.execute(
                """SELECT id, turbine_code, yaw_err_deg, status, verdict, reason,
                          created_by, created_at, processed_at
                   FROM yaw_logs ORDER BY id DESC"""
            ).fetchall()

    rows = await run_db(query)
    return jsonify(rows)


@app.post("/api/logs")
@require_writer
async def create_log(user):
    body = await request.get_json(force=True, silent=True) or {}
    turbine_code = (body.get("turbine_code") or "").strip()
    if not turbine_code:
        return jsonify({"detail": "机组编号不能为空"}), 400
    try:
        yaw_err_deg = float(body.get("yaw_err_deg"))
    except (TypeError, ValueError):
        return jsonify({"detail": "偏航误差必须是数字"}), 400

    now = datetime.now(timezone.utc)

    def insert():
        with connect() as conn:
            rejection = check_submission(conn, user["username"], turbine_code, now)
            if rejection is not None:
                # 退回流水与拒收决定在同一事务提交，随后整单退回
                conn.commit()
                return {"rejection": rejection}
            row = conn.execute(
                """INSERT INTO yaw_logs
                   (turbine_code, yaw_err_deg, status, verdict, reason,
                    created_by, created_at)
                   VALUES (%s, %s, 'pending', NULL, NULL, %s, %s)
                   RETURNING id, turbine_code, yaw_err_deg, status, verdict, reason,
                             created_by, created_at, processed_at""",
                (turbine_code, yaw_err_deg, user["username"], now),
            ).fetchone()
            conn.commit()
            return {"row": row}

    result = await run_db(insert)
    if "rejection" in result:
        rejection = result["rejection"]
        return (
            jsonify(
                {
                    "detail": rejection["detail"],
                    "reading_kv_m": rejection["reading_kv_m"],
                    "threshold_kv_m": rejection["threshold_kv_m"],
                }
            ),
            409,
        )
    return jsonify(result["row"]), 201


@app.get("/api/interlock")
@require_login
async def interlock_status(user):
    def query():
        with connect() as conn:
            return fetch_state(conn)

    state = await run_db(query)
    return jsonify(state)


@app.get("/api/interlock/events")
@require_login
async def interlock_events(user):
    def query():
        with connect() as conn:
            return conn.execute(
                """SELECT id, event_type, threshold_kv_m, reading_kv_m, actor,
                          turbine_code, detail, created_at
                   FROM interlock_events
                   ORDER BY id DESC
                   LIMIT 100"""
            ).fetchall()

    rows = await run_db(query)
    return jsonify(rows)


@app.post("/api/interlock/engage")
@require_writer(detail="仅现场技师可操作雷电联闸")
async def interlock_engage(user):
    body = await request.get_json(force=True, silent=True) or {}
    try:
        threshold_kv_m = float(body.get("threshold_kv_m"))
    except (TypeError, ValueError):
        return jsonify({"detail": "电场上限必须是数字"}), 400
    if not 0 < threshold_kv_m <= 100:
        return jsonify({"detail": "电场上限需在 0~100 kV/m 之间"}), 400

    now = datetime.now(timezone.utc)

    def tx():
        with connect() as conn:
            result, err = engage(conn, user["username"], threshold_kv_m, now)
            if err is not None:
                return {"err": err}
            conn.commit()
            return {"result": result}

    out = await run_db(tx)
    if "err" in out:
        return jsonify({"detail": out["err"]}), 409
    return jsonify(out["result"])


@app.post("/api/interlock/release")
@require_writer(detail="仅现场技师可操作雷电联闸")
async def interlock_release(user):
    now = datetime.now(timezone.utc)

    def tx():
        with connect() as conn:
            result, err = release(conn, user["username"], now)
            if err is not None:
                return {"err": err}
            conn.commit()
            return {"result": result}

    out = await run_db(tx)
    if "err" in out:
        return jsonify({"detail": out["err"]}), 409
    return jsonify(out["result"])
