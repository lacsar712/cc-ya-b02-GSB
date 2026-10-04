import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import "./lightning-page";
import type { LightningStatus, LogRow, Session } from "./types";

type View = "home" | "lightning";

@customElement("yaw-align-app")
export class YawAlignApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      box-sizing: border-box;
      padding: 0 1.5rem 1.5rem;
      max-width: 1040px;
      margin: 0 auto;
    }
    .topbar {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.9rem 0;
      border-bottom: 1px solid #334155;
      margin-bottom: 1.25rem;
      flex-wrap: wrap;
    }
    .brand {
      font-size: 1.15rem;
      font-weight: 700;
      color: #38bdf8;
      cursor: pointer;
      white-space: nowrap;
    }
    nav {
      display: flex;
      gap: 0.4rem;
    }
    .nav-btn {
      cursor: pointer;
      background: transparent;
      border: 1px solid transparent;
      color: #cbd5e1;
      padding: 0.4rem 0.9rem;
      border-radius: 6px;
      font-size: 0.92rem;
      font-weight: 500;
      position: relative;
    }
    .nav-btn:hover {
      background: #1e293b;
    }
    .nav-btn.active {
      background: #0c4a6e;
      color: #e0f2fe;
      border-color: #0369a1;
    }
    .nav-dot {
      position: absolute;
      top: 0.3rem;
      right: 0.35rem;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #f87171;
      box-shadow: 0 0 6px #f87171;
    }
    .spacer {
      flex: 1;
    }
    .user-chip {
      font-size: 0.85rem;
      color: #94a3b8;
      white-space: nowrap;
    }
    h1 {
      margin: 0 0 0.25rem;
      font-size: 1.6rem;
      color: #38bdf8;
    }
    .sub {
      color: #94a3b8;
      margin-bottom: 1.25rem;
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
    button.action-btn {
      cursor: pointer;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      border: none;
      background: #0284c7;
      color: #fff;
      font-weight: 600;
    }
    button.secondary {
      cursor: pointer;
      padding: 0.4rem 0.9rem;
      border-radius: 6px;
      border: 1px solid #475569;
      background: #334155;
      color: #e2e8f0;
      font-size: 0.88rem;
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
    .lock-banner {
      border-radius: 8px;
      padding: 0.85rem 1.1rem;
      margin-bottom: 1rem;
      border: 1px solid;
      font-size: 0.92rem;
      line-height: 1.6;
    }
    .lock-open {
      background: #450a0a;
      border-color: #b91c1c;
      color: #fecaca;
    }
    .lock-hold {
      background: #422006;
      border-color: #b45309;
      color: #fde68a;
    }
    .lock-banner strong {
      display: block;
      font-size: 1rem;
      margin-bottom: 0.15rem;
    }
    .lock-link {
      color: #7dd3fc;
      cursor: pointer;
      text-decoration: underline;
      background: none;
      border: none;
      padding: 0;
      font: inherit;
    }
    .reject-box {
      background: #450a0a;
      border: 1px solid #b91c1c;
      color: #fecaca;
      border-radius: 6px;
      padding: 0.7rem 0.9rem;
      margin-top: 0.6rem;
      line-height: 1.6;
    }
  `;

  @state() private session: Session | null = null;
  @state() private view: View = "home";
  @state() private logs: LogRow[] = [];
  @state() private lockStatus: LightningStatus | null = null;
  @state() private loginUser = "technician";
  @state() private loginPass = "tech123456";
  @state() private turbineCode = "";
  @state() private yawErr = "";
  @state() private error = "";
  @state() private rejectDetail = "";
  @state() private loading = false;

  private pollTimer?: number;
  private lockTimer?: number;

  connectedCallback() {
    super.connectedCallback();
    const raw = localStorage.getItem("yaw_session");
    if (raw) {
      try {
        this.session = JSON.parse(raw) as Session;
        void this.startPolling();
      } catch {
        localStorage.removeItem("yaw_session");
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.clearTimers();
  }

  private clearTimers() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.lockTimer) clearInterval(this.lockTimer);
    this.pollTimer = undefined;
    this.lockTimer = undefined;
  }

  private authHeaders(): HeadersInit {
    return this.session
      ? { Authorization: `Bearer ${this.session.token}` }
      : {};
  }

  private async startPolling() {
    this.clearTimers();
    await this.refreshLogs();
    await this.refreshLock();
    this.pollTimer = window.setInterval(() => void this.refreshLogs(), 2000);
    this.lockTimer = window.setInterval(() => void this.refreshLock(), 2000);
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

  private async refreshLock() {
    if (!this.session) return;
    try {
      const res = await fetch("/api/lightning/status", {
        headers: this.authHeaders(),
      });
      if (res.status === 401) {
        this.logout();
        return;
      }
      if (!res.ok) return;
      this.lockStatus = (await res.json()) as LightningStatus;
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
      this.view = "home";
      await this.startPolling();
    } catch {
      this.error = "无法连接接口";
    } finally {
      this.loading = false;
    }
  }

  private logout() {
    this.clearTimers();
    this.session = null;
    this.logs = [];
    this.lockStatus = null;
    this.view = "home";
    localStorage.removeItem("yaw_session");
  }

  private get isWriter() {
    return this.session?.role === "writer";
  }

  private async submitLog() {
    this.error = "";
    this.rejectDetail = "";
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
        // 409：联闸越限整单退回
        if (res.status === 409) {
          this.rejectDetail = data.detail || "雷电联闸生效中，本单整单退回";
        } else {
          this.error = data.detail || "提交失败";
        }
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

  private go(view: View) {
    this.view = view;
  }

  private renderTopbar() {
    const over = this.lockStatus?.latest?.is_over_limit ?? false;
    return html`
      <header class="topbar">
        <span class="brand" @click=${() => this.go("home")}>风机偏航对中台</span>
        <nav>
          <button
            class="nav-btn ${this.view === "home" ? "active" : ""}"
            @click=${() => this.go("home")}
          >
            偏航报送
          </button>
          <button
            class="nav-btn ${this.view === "lightning" ? "active" : ""}"
            @click=${() => this.go("lightning")}
          >
            雷电联闸
            ${this.lockStatus?.is_open
              ? html`<span class="nav-dot" title=${over ? "联闸生效且读数越限" : "联闸生效中"}></span>`
              : null}
          </button>
        </nav>
        <span class="spacer"></span>
        <span class="user-chip">
          ${this.session!.username}（${this.isWriter ? "现场技师" : "观察员"}）
        </span>
        <button class="secondary" @click=${this.logout}>退出</button>
      </header>
    `;
  }

  private renderLockBanner() {
    const s = this.lockStatus;
    if (!s || !s.is_open) return null;
    const over = s.latest?.is_over_limit;
    const cls = over ? "lock-open" : "lock-hold";
    return html`
      <div class="lock-banner ${cls}">
        <strong>
          ${over
            ? "⛈ 雷电联闸生效中且电场读数越限：偏航报送已一刀切暂停，新单整单退回"
            : "⛈ 雷电联闸生效中：读数尚在限值内，报送可继续；越限即整单退回"}
        </strong>
        当前服务端电场读数
        ${s.latest ? `${s.latest.field_kvm} kV/m` : "采集启动中…"}，
        电场上限 ${s.field_threshold_kvm} kV/m。读数回落或
        <button class="lock-link" @click=${() => this.go("lightning")}>
          前往雷电联闸专页关闭
        </button>
        后恢复。
      </div>
    `;
  }

  private renderHome() {
    return html`
      <h1>偏航报送</h1>
      <p class="sub">现场技师提交偏航误差，后台 worker 认领后给出合格或偏航超差结论。</p>

      <div class="row-actions" style="margin-bottom:0.75rem">
        <button class="secondary" ?disabled=${this.loading} @click=${this.refreshLogs}>
          刷新列表
        </button>
      </div>

      ${this.renderLockBanner()}

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
              <button class="action-btn" ?disabled=${this.loading} @click=${this.submitLog}>
                提交（进入待认领队列）
              </button>
              ${this.error ? html`<p class="err">${this.error}</p>` : null}
              ${this.rejectDetail
                ? html`<div class="reject-box">⛈ ${this.rejectDetail}</div>`
                : null}
            </section>
          `
        : null}

      <section>
        <h2 style="margin-top:0;font-size:1.1rem;">对中记录</h2>
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
        <h1 style="margin-top:1.25rem">风机偏航对中台</h1>
        <p class="sub">现场技师提交偏航误差；雷电联闸生效时，越限报送整单退回。</p>
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
          <button class="action-btn" ?disabled=${this.loading} @click=${this.login}>
            登录
          </button>
          ${this.error ? html`<p class="err">${this.error}</p>` : null}
        </section>
      `;
    }

    return html`
      ${this.renderTopbar()}
      ${this.view === "home"
        ? this.renderHome()
        : html`
            <lightning-page
              .session=${this.session}
              @unauthorized=${this.logout}
            ></lightning-page>
          `}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "yaw-align-app": YawAlignApp;
  }
}
