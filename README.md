# 风机偏航对中台

现场技师登记机组编号与偏航误差（度）；后台 worker 用数据库行锁认领待处理记录，按 ±1.5° 阈值写入「合格」或「偏航超差」。前端为 Lit 组件 + Vite，接口为 Quart + Hypercorn。

新增**雷电联闸**：场站雷电监测升高时，技师可在顶栏进入「雷电联闸」专页，录入电场上限并拉起联闸，一刀切暂停偏航报送。开闸期间 worker 持续采集电场读数，报送时读数越界则整单退回（退回流水与真实拒收同事务提交）；解除联闸（关闸）后新单不再被挡，阈值区记忆上次开闸时长。

## 端口

| 服务 | 地址 |
|------|------|
| 页面 | http://localhost:3199 |
| 接口 | http://localhost:8199 |
| PostgreSQL | localhost:54399（库名 `yawalign`） |

## 账号

| 用户 | 密码 | 权限 |
|------|------|------|
| technician | tech123456 | 可提交、可拉/解联闸 |
| observer | obs123456 | 只读（可浏览阈值与开闸记录，无权改开关） |

## 启动

```bash
cd projects/20-yaw-align-log
docker compose up --build
```

健康检查：`GET http://localhost:8199/api/health` → `{"status":"ok","service":"yaw-align-log"}`。

## 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/logs | 对中记录（登录） |
| POST | /api/logs | 提交偏航记录（技师）；开闸中读数越界返回 409 整单退回 |
| GET | /api/interlock | 联闸状态：开关、电场上限、当前读数、上次开闸时长（登录） |
| GET | /api/interlock/events | 开闸/关闸/退回流水（登录） |
| POST | /api/interlock/engage | 拉起联闸，body `{"threshold_kv_m": 数值}`（技师） |
| POST | /api/interlock/release | 解除联闸，记忆本次开闸时长（技师） |

采样值只能来自服务端采集（worker 周期写入 `interlock_state`，报送判定前兜底补采），前端不得自填采样值做演示。

## 验收

1. 种子数据：机组 W01 误差 0.4° 结论「合格」；机组 W07 误差 3.2° 结论「偏航超差」。
2. technician 提交新记录后，列表先显示「待处理」，数秒内 worker 处理后变为对应结论。
3. observer 可查看列表，无提交表单。
4. 雷电联闸演示：technician 从顶栏进入「雷电联闸」专页，把电场上限调到极低（如 0.1 kV/m）并拉起联闸 → 回到「对中记录」提交，报送失败（409 整单退回，提示解除后恢复），专页流水区出现退回记录 → 解除联闸（关闸）后再提交，成功进入待处理队列；阈值区显示上次开闸时长。
5. observer 打开「雷电联闸」专页可浏览阈值与开闸/退回流水，但无操作按钮；直接调用 engage/release 接口返回 403。

## 技术栈

- 后端：Quart、psycopg、`worker.py`（`FOR UPDATE SKIP LOCKED` + 电场周期采集）、Hypercorn
- 前端：Lit、TypeScript、Vite；生产镜像内 nginx 反代 `/api`
- 镜像源：DaoCloud 基础镜像、清华 PyPI、npmmirror npm
