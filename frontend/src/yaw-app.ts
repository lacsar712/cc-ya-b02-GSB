import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

import type { Session } from "./types";
import type { InterlockStatus } from "./yaw-interlock";
import "./yaw-interlock";

type LogRow = {
  id: number;
  turbine_code: string;
  yaw_err_deg: number;
  status: string;
  verdict: string | null;
  reason: string | null;
  created_by: string;
  created_at: string;
  processed_at: string | null;
};

type View = "logs" | "interlock";

@customElement("yaw-align-app")
export class YawAlignApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      box-sizing: border-box;
      padding: 1.5rem;
      max-width: 1100px;
      margin: 0 auto;
    }
    h1 {
      margin: 0 0 0.25rem;
      font-size: 1.75rem;
      color: #38bdf8;
    }
    .sub {
      color: #94a3b8;
      margin-bottom: 1.5rem;
    }
    .topbar {
      display: flex;
      align-items: center;
      gap: 1rem;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 0.6rem 1rem;
      margin-bottom: 1rem;
      position: sticky;
      top: 0.5rem;
      z-index: 10;
    }
    .brand {
      color: #38bdf8;
      font-weight: 700;
      font-size: 1.05rem;
      white-space: nowrap;
    }
    nav {
      display: flex;
      gap: 0.4rem;
      flex: 1;
    }
    button.nav {
      background: transparent;
      color: #94a3b8;
    }
    button.nav.active {
      background: #0284c7;
      color: #fff;
    }
    .who {
      color: #94a3b8;
      font-size: 0.85rem;
      white-space: nowrap;
    }
    .banner {
      background: #451a03;
      border: 1px solid #b45309;
      color: #fcd34d;
      border-radius: 8px;
      padding: 0.7rem 1rem;
      margin-bottom: 1rem;
      font-size: 0.9rem;
    }
    section {
      background: #1e293b;
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin-bottom: 1rem;
      border: 1px solid #334155;
    }
    label {
      display: block;
      font-size: 0.85rem;
      color: #cbd5e1;
      margin-bottom: 0.25rem;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      padding: 0.5rem 0.65rem;
      border-radius: 6px;
      border: 1px solid #475569;
      background: #0f172a;
      color: #f1f5f9;
      margin-bottom: 0.75rem;
    }
    button {
      cursor: pointer;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      border: none;
      background: #0284c7;
      color: #fff;
      font-weight: 600;
    }
    button.secondary {
      background: #475569;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    th,
    td {
      text-align: left;
      padding: 0.5rem 0.4rem;
      border-bottom: 1px solid #334155;
    }
    th {
      color: #94a3b8;
      font-weight: 600;
    }
    .tag {
      display: inline-block;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      font-size: 0.8rem;
    }
    .ok {
      background: #14532d;
      color: #86efac;
    }
    .bad {
      background: #7f1d1d;
      color: #fca5a5;
    }
    .pending {
      background: #713f12;
      color: #fde68a;
    }
    .err {
      color: #f87171;
      margin-top: 0.5rem;
    }
    .row-actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      align-items: center;
    }
  `;

  @state() private session: Session | null = null;
  @state() private logs: LogRow[] = [];
  @state() private interlock: InterlockStatus | null = null;
  @state() private view: View = "logs";
  @state() private loginUser = "technician";
  @state() private loginPass = "tech123456";
  @state() private turbineCode = "";
  @state() private yawErr = "";
  @state() private error = "";
  @state() private loading = false;

  connectedCallback() {
    super.connectedCallback();
    const raw = localStorage.getItem("yaw_session");
    if (raw) {
      try {
        this.session = JSON.parse(raw) as Session;
        this.startPolling();
      } catch {
        localStorage.removeItem("yaw_session");
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
    }
  }

  private _pollTimer?: number;

  private startPolling() {
    void this.poll();
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = window.setInterval(() => void this.poll(), 2000);
  }

  private async poll() {
    await this.refreshLogs();
    if (this.view === "logs") {
      await this.refreshInterlock();
    }
  }

  private authHeaders(): HeadersInit {
    return this.session
      ? { Authorization: `Bearer ${this.session.token}` }
      : {};
  }

  private async refreshLogs() {
    if (!this.session) return;
    try {
      const res = await fetch("/api/logs", { headers: this.authHeaders() });
      if (res.status === 401) {
        this.logout();
        return;
      }
      if (!res.ok) return;
      this.logs = (await res.json()) as LogRow[];
    } catch {
      /* ignore transient network errors */
    }
  }

  private async refreshInterlock() {
    if (!this.session) return;
    try {
      const res = await fetch("/api/interlock", {
        headers: this.authHeaders(),
      });
      if (res.status === 401) {
        this.logout();
        return;
      }
      if (!res.ok) return;
      this.interlock = (await res.json()) as InterlockStatus;
    } catch {
      /* ignore transient network errors */
    }
  }

  private async login() {
    this.error = "";
    this.loading = true;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: this.loginUser,
          password: this.loginPass,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.error = data.detail || "登录失败";
        return;
      }
      this.session = {
        token: data.access_token,
        username: data.username,
        role: data.role,
      };
      localStorage.setItem("yaw_session", JSON.stringify(this.session));
      this.startPolling();
    } catch {
      this.error = "无法连接接口";
    } finally {
      this.loading = false;
    }
  }

  private logout() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this.session = null;
    this.logs = [];
    this.interlock = null;
    this.view = "logs";
    localStorage.removeItem("yaw_session");
  }

  private get isWriter() {
    return this.session?.role === "writer";
  }

  private async submitLog() {
    this.error = "";
    this.loading = true;
    try {
      const res = await fetch("/api/logs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({
          turbine_code: this.turbineCode,
          yaw_err_deg: Number(this.yawErr),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // 联闸整单退回（409）等服务端错误在此提示，表单内容保留以便解除后重报
        this.error = data.detail || "提交失败";
        await this.refreshInterlock();
        return;
      }
      this.turbineCode = "";
      this.yawErr = "";
      await this.refreshLogs();
    } catch {
      this.error = "提交时网络异常";
    } finally {
      this.loading = false;
    }
  }

  private verdictClass(row: LogRow) {
    if (row.status === "pending") return "pending";
    if (row.verdict === "合格") return "ok";
    if (row.verdict === "偏航超差") return "bad";
    return "";
  }

  private renderTopbar() {
    return html`
      <header class="topbar">
        <span class="brand">风机偏航对中台</span>
        <nav>
          <button
            class="nav ${this.view === "logs" ? "active" : ""}"
            @click=${() => (this.view = "logs")}
          >
            对中记录
          </button>
          <button
            class="nav ${this.view === "interlock" ? "active" : ""}"
            @click=${() => (this.view = "interlock")}
          >
            雷电联闸
          </button>
        </nav>
        <span class="who">
          ${this.session?.username}（${this.isWriter ? "可提交" : "只读"}）
        </span>
        <button class="secondary" @click=${this.logout}>退出</button>
      </header>
    `;
  }

  private renderLogs() {
    return html`
      ${this.interlock?.engaged
        ? html`
            <div class="banner">
              ⚡ 雷电联闸开闸中（电场上限 ${this.interlock.threshold_kv_m}
              kV/m，当前读数 ${this.interlock.latest_reading_kv_m ?? "—"}
              kV/m）：读数越界将整单退回，解除联闸后恢复报送。
            </div>
          `
        : null}
      ${this.isWriter
        ? html`
            <section>
              <h2 style="margin-top:0;font-size:1.1rem;">提交偏航记录</h2>
              <label>机组编号</label>
              <input
                placeholder="例如 W12"
                .value=${this.turbineCode}
                @input=${(e: Event) =>
                  (this.turbineCode = (e.target as HTMLInputElement).value)}
              />
              <label>偏航误差（度，可正可负）</label>
              <input
                type="number"
                step="0.1"
                .value=${this.yawErr}
                @input=${(e: Event) =>
                  (this.yawErr = (e.target as HTMLInputElement).value)}
              />
              <button ?disabled=${this.loading} @click=${this.submitLog}>
                提交（进入待认领队列）
              </button>
              ${this.error ? html`<p class="err">${this.error}</p>` : null}
            </section>
          `
        : null}

      <section>
        <div class="row-actions" style="margin-bottom:0.75rem;">
          <h2 style="margin:0;font-size:1.1rem;flex:1;">对中记录</h2>
          <button
            class="secondary"
            ?disabled=${this.loading}
            @click=${this.refreshLogs}
          >
            刷新列表
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>编号</th>
              <th>机组</th>
              <th>误差°</th>
              <th>状态</th>
              <th>结论</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            ${this.logs.map(
              (row) => html`
                <tr>
                  <td>${row.id}</td>
                  <td>${row.turbine_code}</td>
                  <td>${row.yaw_err_deg}</td>
                  <td>
                    <span class="tag ${row.status === "pending" ? "pending" : "ok"}">
                      ${row.status === "pending" ? "待处理" : "已完成"}
                    </span>
                  </td>
                  <td>
                    ${row.verdict
                      ? html`<span class="tag ${this.verdictClass(row)}">${row.verdict}</span>`
                      : "—"}
                  </td>
                  <td>${row.reason ?? "—"}</td>
                </tr>
              `
            )}
          </tbody>
        </table>
      </section>
    `;
  }

  render() {
    if (!this.session) {
      return html`
        <h1>风机偏航对中台</h1>
        <p class="sub">现场技师提交偏航误差，后台 worker 认领后给出合格或偏航超差结论。</p>
        <section>
          <label>用户名</label>
          <input
            .value=${this.loginUser}
            @input=${(e: Event) =>
              (this.loginUser = (e.target as HTMLInputElement).value)}
          />
          <label>密码</label>
          <input
            type="password"
            .value=${this.loginPass}
            @input=${(e: Event) =>
              (this.loginPass = (e.target as HTMLInputElement).value)}
          />
          <button ?disabled=${this.loading} @click=${this.login}>登录</button>
          ${this.error ? html`<p class="err">${this.error}</p>` : null}
        </section>
      `;
    }

    return html`
      ${this.renderTopbar()}
      ${this.view === "logs"
        ? this.renderLogs()
        : html`
            <yaw-interlock
              .session=${this.session}
              @auth-expired=${this.logout}
            ></yaw-interlock>
          `}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "yaw-align-app": YawAlignApp;
  }
}
