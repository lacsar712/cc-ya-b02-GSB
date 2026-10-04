# 风机偏航对中台

现场技师登记机组编号与偏航误差（度）；后台 worker 用数据库行锁认领待处理记录，按 ±1.5° 阈值写入「合格」或「偏航超差」。前端为 Lit 组件 + Vite，接口为 Quart + Hypercorn。

另有**雷电联闸**：场站雷电监测升高时，技师可在雷电联闸专页「一刀切」暂停偏航报送——电场上限由技师录入，大气电场读数只由服务端 worker 周期采集（前端没有自填入口）；读数 `|E|` 越上限期间，报送整单退回，退回流水与拒收在同一数据库事务提交；读数回落、联闸到期或手动关闸后，新单恢复。

## 端口

| 服务 | 地址 |
|------|------|
| 页面 | http://localhost:3199 |
| 接口 | http://localhost:8199 |
| PostgreSQL | localhost:54399（库名 `yawalign`） |

## 账号

| 用户 | 密码 | 权限 |
|------|------|------|
| technician | tech123456 | 可提交、可操作联闸 |
| observer | obs123456 | 只读（可浏览阈值、读数、流水，不可动开关） |

## 启动

```bash
cd projects/20-yaw-align-log
docker compose up --build
```

健康检查：`GET http://localhost:8199/api/health` → `{"status":"ok","service":"yaw-align-log"}`。

## 验收

1. 种子数据：机组 W01 误差 0.4° 结论「合格」；机组 W07 误差 3.2° 结论「偏航超差」。
2. technician 提交新记录后，列表先显示「待处理」，数秒内 worker 处理后变为对应结论。
3. observer 可查看列表，无提交表单。
4. observer 进「雷电联闸」专页可看阈值、最新服务端电场读数与全部流水，但没有任何开关/上限录入控件。
5. technician 开闸时录入电场上限与开闸时长；专页阈值区会**记忆上次开闸时长**并在下次自动回填。
6. 演示路径：把上限调到极低（如 0.1 kV/m）并拉起联闸，等读数越限后回报送，应收到**整单退回**提示（HTTP 409，无 `yaw_logs` 新行，流水区同步出现「越界退回」）；关闸后再送，应成功（201）。
7. 读数回落到上限内即使未关闸也可正常报送；联闸可手动关闭或到点自动解除，两种方式都记流水。

## 雷电联闸接口

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/lightning/status` | 登录即可 | 联闸状态、最新/近期服务端读数、越限标记、记忆时长 |
| GET | `/api/lightning/flow` | 登录即可 | 联闸流水：开闸 / 手动关闸 / 到期解除 / 每一次越界退回 |
| POST | `/api/lightning/interlock` | writer | `{"action":"open", field_threshold_kvm, duration_minutes}`；关闸 `{"action":"close"}`。不接受任何电场采样值 |

`POST /api/logs` 在联闸生效且最新**服务端**读数满足 `|E| > 上限` 时返回 409；退回判定与流水写入在同一个数据库事务内，失败一起回滚。

## 技术栈

- 后端：Quart、psycopg、`worker.py`（`FOR UPDATE SKIP LOCKED` + 服务端电场采集线程）、Hypercorn
- 前端：Lit、TypeScript、Vite；生产镜像内 nginx 反代 `/api`
- 数据表：`yaw_logs`（报送）、`lightning_interlock`（单例联闸状态）、`lightning_readings`（服务端采集）、`lightning_flow`（联闸/退回流水）、`app_settings`（开闸时长记忆）
- 采集参数可用环境变量调整：`LIGHTNING_SAMPLE_SEC`（默认 2s）、`LIGHTNING_FIELD_VOL`、`LIGHTNING_FIELD_REVERT`、`LIGHTNING_FIELD_LIMIT`
- 镜像源：DaoCloud 基础镜像、清华 PyPI、npmmirror npm
