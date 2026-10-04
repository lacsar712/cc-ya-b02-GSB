import asyncio
import math
import os
from datetime import datetime, timedelta, timezone
from functools import wraps

from jose import JWTError, jwt
from passlib.context import CryptContext
from quart import Quart, jsonify, request

from db import SCHEMA, connect
import lightning
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
    lightning.ensure_singleton(conn)
    lightning.ensure_initial_reading(conn)
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


def require_writer(handler):
    @wraps(handler)
    async def wrapper(*args, **kwargs):
        user = await current_user()
        if user is None:
            return jsonify({"detail": "未登录"}), 401
        if user["role"] != "writer":
            return jsonify({"detail": "仅现场技师可操作联闸与提交偏航记录"}), 403
        return await handler(user, *args, **kwargs)

    return wrapper


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
    if not math.isfinite(yaw_err_deg):
        return jsonify({"detail": "偏航误差必须是有效数字"}), 400

    now = datetime.now(timezone.utc)

    def insert():
        with connect() as conn:
            with conn.transaction():
                lightning.ensure_singleton(conn)
                # 联闸判定与退回流水必须在同一事务：拒收决策与流水同时落库
                il, reading = lightning.check_submission(conn, now)
                if (
                    il["is_open"]
                    and reading is not None
                    and lightning.is_reading_over_limit(
                        reading["field_kvm"], il["field_threshold_kvm"]
                    )
                ):
                    field_kvm = float(reading["field_kvm"])
                    threshold_kvm = float(il["field_threshold_kvm"])
                    lightning.insert_reject_flow(
                        conn,
                        turbine_code=turbine_code,
                        field_kvm=field_kvm,
                        threshold_kvm=threshold_kvm,
                        operator=user["username"],
                        now=now,
                    )
                    return {
                        "rejected": True,
                        "status_code": 409,
                        "detail": (
                            f"雷电联闸生效中：服务端电场读数 {field_kvm:g} kV/m "
                            f"已越过上限 {threshold_kvm:g} kV/m，本单整单退回，"
                            "未进入待处理队列；待读数回落至限值内或联闸解除后再报送。"
                        ),
                        "field_kvm": field_kvm,
                        "threshold_kvm": threshold_kvm,
                    }

                row = conn.execute(
                    """INSERT INTO yaw_logs
                       (turbine_code, yaw_err_deg, status, verdict, reason,
                        created_by, created_at)
                       VALUES (%s, %s, 'pending', NULL, NULL, %s, %s)
                       RETURNING id, turbine_code, yaw_err_deg, status, verdict,
                                 reason, created_by, created_at, processed_at""",
                    (turbine_code, yaw_err_deg, user["username"], now),
                ).fetchone()
                return {"rejected": False, "row": row}

    result = await run_db(insert)
    if result["rejected"]:
        return (
            jsonify(
                {
                    "detail": result["detail"],
                    "field_kvm": result["field_kvm"],
                    "threshold_kvm": result["threshold_kvm"],
                }
            ),
            409,
        )
    return jsonify(result["row"]), 201


@app.get("/api/lightning/status")
@require_login
async def lightning_status(user):
    def query():
        with connect() as conn:
            return lightning.status_payload(conn)

    return jsonify(await run_db(query))


@app.get("/api/lightning/flow")
@require_login
async def lightning_flow(user):
    def query():
        with connect() as conn:
            return lightning.flow_list(conn)

    return jsonify(await run_db(query))


def _parse_threshold(body):
    raw = body.get("field_threshold_kvm")
    try:
        threshold = float(raw)
    except (TypeError, ValueError):
        return None, "电场上限必须是数字"
    if not math.isfinite(threshold) or threshold <= 0 or threshold > 100:
        return None, "电场上限须为 0~100 kV/m 之间的正数"
    return threshold, None


def _parse_duration(body):
    raw = body.get("duration_minutes", lightning.DEFAULT_DURATION_MIN)
    try:
        duration = int(raw)
    except (TypeError, ValueError):
        return None, "开闸时长必须是整数分钟"
    if not (1 <= duration <= lightning.MAX_DURATION_MIN):
        return None, f"开闸时长须在 1~{lightning.MAX_DURATION_MIN} 分钟之间"
    return duration, None


@app.post("/api/lightning/interlock")
@require_writer
async def change_interlock(user):
    """技师拉起/关闭联闸。接口不接收任何电场采样值，采样只来自 worker。"""
    body = await request.get_json(force=True, silent=True) or {}
    action = body.get("action")
    if action not in ("open", "close"):
        return jsonify({"detail": "action 须为 open 或 close"}), 400

    # 参数先在事务外校验，避免坏请求裹挟联闸状态变更
    threshold = None
    duration = None
    if action == "open":
        threshold, err = _parse_threshold(body)
        if err:
            return jsonify({"detail": err}), 400
        duration, err = _parse_duration(body)
        if err:
            return jsonify({"detail": err}), 400

    now = datetime.now(timezone.utc)

    def mutate():
        with connect() as conn:
            with conn.transaction():
                lightning.ensure_singleton(conn)
                lightning.expire_if_due(conn, now)

                if action == "open":
                    open_until = lightning.open_interlock(
                        conn,
                        threshold_kvm=threshold,
                        duration_min=duration,
                        operator=user["username"],
                        now=now,
                    )
                    return {"ok": True, "open_until": open_until}

                closed = lightning.close_interlock(
                    conn, operator=user["username"], now=now
                )
                if not closed:
                    return {"ok": False, "status_code": 400,
                            "detail": "联闸当前未开启"}
                return {"ok": True}

    result = await run_db(mutate)
    if not result.get("ok"):
        return jsonify({"detail": result["detail"]}), result["status_code"]

    def query():
        with connect() as conn:
            return lightning.status_payload(conn)

    return jsonify(await run_db(query))
