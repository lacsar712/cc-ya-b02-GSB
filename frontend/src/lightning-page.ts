import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { FlowRow, LightningStatus, Session } from "./types";

const ACTION_LABELS: Record<string, string> = {
  open: "开闸",
  manual_close: "手动关闸",
  auto_close: "到期解除",
  reject: "越界退回",
};

const ACTION_CLASS: Record<string, string> = {
  open: "tag-open",
  manual_close: "tag-close",
  auto_close: "tag-auto",
  reject: "tag-reject",
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("zh-CN")} ${d.toLocaleTimeString("zh-CN")}`;
}

@customElement("lightning-page")
export class LightningPage extends LitElement {
  static styles = css`
    .page-head {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    h2 {
      margin: 0;
      font-size: 1.25rem;
      color: #38bdf8;
    }
    section {
      background: #1e293b;
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin-bottom: 1rem;
      border: 1px solid #334155;
    }
    .status-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 0.75rem;
      margin-bottom: 0.5rem;
    }
    .metric .k {
      font-size: 0.78rem;
      color: #94a3b8;
      margin-bottom: 0.15rem;
    }
    .metric .v {
      font-size: 1.05rem;
      font-weight: 600;
    }
    .field-reading {
      font-size: 1.8rem;
      font-weight: 700;
    }
    .field-ok {
      color: #86efac;
    }
    .field-over {
      color: #fca5a5;
    }
    .field-muted {
      color: #94a3b8;
    }
    .badge {
      display: inline-block;
      padding: 0.2rem 0.6rem;
      border-radius: 999px;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .badge-open {
      background: #7f1d1d;
      color: #fecaca;
    }
    .badge-closed {
      background: #14532d;
      color: #bbf7d0;
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
    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
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
    button.danger {
      background: #b91c1c;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .actions {
      display: flex;
      gap: 0.6rem;
      align-items: center;
      flex-wrap: wrap;
    }
    .err {
      color: #f87171;
      margin: 0.5rem 0 0;
    }
    .ok-msg {
      color: #86efac;
      margin: 0.5rem 0 0;
    }
    .columns {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
      align-items: start;
    }
    @media (max-width: 820px) {
      .columns {
        grid-template-columns: 1fr;
      }
    }
    h3 {
      margin: 0 0 0.6rem;
      font-size: 1rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    th,
    td {
      text-align: left;
      padding: 0.45rem 0.35rem;
      border-bottom: 1px solid #334155;
      vertical-align: top;
    }
    th {
      color: #94a3b8;
      font-weight: 600;
      white-space: nowrap;
    }
    .tag {
      display: inline-block;
      padding: 0.1rem 0.45rem;
      border-radius: 4px;
      font-size: 0.78rem;
      white-space: nowrap;
    }
    .tag-open {
      background: #7f1d1d;
      color: #fecaca;
    }
    .tag-close {
      background: #14532d;
      color: #bbf7d0;
    }
    .tag-auto {
      background: #713f12;
      color: #fde68a;
    }
    .tag-reject {
      background: #450a0a;
      color: #fca5a5;
    }
    .explain {
      margin: 0;
      padding-left: 1.1rem;
      color: #cbd5e1;
      font-size: 0.88rem;
      line-height: 1.7;
    }
    .explain li {
      margin-bottom: 0.4rem;
    }
    .demo {
      margin-top: 0.6rem;
      padding: 0.6rem 0.75rem;
      background: #0f172a;
      border-left: 3px solid #38bdf8;
      border-radius: 4px;
      font-size: 0.84rem;
      color: #e2e8f0;
      line-height: 1.6;
    }
    .readonly-note {
      font-size: 0.85rem;
      color: #94a3b8;
      margin-top: 0.4rem;
    }
    .countdown {
      font-variant-numeric: tabular-nums;
    }
  `;

  @property({ attribute: false }) session: Session | null = null;
  @state() private status: LightningStatus | null = null;
  @state() private flow: FlowRow[] = [];
  @state() private thresholdInput = "";
  @state() private durationInput = "";
  @state() private durationPristine = true;
  @state() private busy = false;
  @state() private error = "";
  @state() private notice = "";
  @state() private nowTick = 0;

  private pollTimer?: number;
  private tickTimer?: number;

  connectedCallback() {
    super.connectedCallback();
    void this.refresh();
    this.pollTimer = window.setInterval(() => void this.refresh(), 2000);
    this.tickTimer = window.setInterval(() => {
      this.nowTick++;
    }, 1000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
  }

  private get isWriter() {
    return this.session?.role === "writer";
  }

  private authHeaders(): HeadersInit {
    return this.session
      ? { Authorization: `Bearer ${this.session.token}` }
      : {};
  }

  private async refresh() {
    if (!this.session) return;
    try {
      const [sres, fres] = await Promise.all([
        fetch("/api/lightning/status", { headers: this.authHeaders() }),
        fetch("/api/lightning/flow", { headers: this.authHeaders() }),
      ]);
      if (sres.status === 401 || fres.status === 401) {
        this.dispatchEvent(
          new CustomEvent("unauthorized", { bubbles: true, composed: true })
        );
        return;
      }
      if (!sres.ok || !fres.ok) return;
      const status = (await sres.json()) as LightningStatus;
      this.status = status;
      this.flow = (await fres.json()) as FlowRow[];
      // 阈值区记忆上次开闸时长：输入框首次出现时回填服务端记忆值
      if (this.durationPristine) {
        this.durationInput = String(status.last_duration_minutes);
      }
      if (!this.thresholdInput) {
        this.thresholdInput = String(status.field_threshold_kvm);
      }
    } catch {
      /* 忽略瞬时网络异常 */
    }
  }

  private async postAction(body: Record<string, unknown>) {
    this.error = "";
    this.notice = "";
    this.busy = true;
    try {
      const res = await fetch("/api/lightning/interlock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        this.error = data.detail || "操作失败";
        return;
      }
      this.status = data as LightningStatus;
      this.notice =
        body.action === "open" ? "联闸已拉起" : "联闸已关闭，新单不再被挡";
      await this.refresh();
    } catch {
      this.error = "操作时网络异常";
    } finally {
      this.busy = false;
    }
  }

  private openGate() {
    const threshold = Number(this.thresholdInput);
    const duration = Number(this.durationInput);
    void this.postAction({
      action: "open",
      field_threshold_kvm: threshold,
      duration_minutes: duration,
    });
  }

  private closeGate() {
    void this.postAction({ action: "close" });
  }

  private remainingText(): string {
    if (!this.status?.is_open || !this.status.open_until) return "";
    const ms = new Date(this.status.open_until).getTime() - Date.now();
    this.nowTick;
    if (ms <= 0) return "即将解除…";
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h} 小时 ${m} 分 ${s} 秒`;
    return `${m} 分 ${s} 秒`;
  }

  render() {
    const s = this.status;
    const latest = s?.latest ?? null;
    const readingClass = !s
      ? "field-muted"
      : latest?.is_over_limit
        ? "field-over"
        : "field-ok";

    return html`
      <div class="page-head">
        <h2>雷电联闸专页</h2>
        ${s
          ? html`<span class="badge ${s.is_open ? "badge-open" : "badge-closed"}">
              ${s.is_open ? "联闸生效中" : "联闸关闭"}
            </span>`
          : null}
      </div>

      <section>
        <div class="status-grid">
          <div class="metric">
            <div class="k">服务端电场读数（kV/m）</div>
            <div class="v field-reading ${readingClass}">
              ${latest ? latest.field_kvm : "采集启动中…"}
            </div>
            <div class="k">
              ${latest
                ? (latest.is_over_limit ? "⚠ 已越限，报送将被退回" : "限值内") +
                  ` · 采集于 ${fmtTime(latest.sampled_at)}`
                : "读数只能来自服务端采集"}
            </div>
          </div>
          <div class="metric">
            <div class="k">电场上限（kV/m）</div>
            <div class="v">${s ? s.field_threshold_kvm : "—"}</div>
          </div>
          <div class="metric">
            <div class="k">开闸人 / 开闸时间</div>
            <div class="v" style="font-size:0.95rem">
              ${s?.opened_by ? s.opened_by : "—"}
            </div>
            <div class="k">${fmtTime(s?.opened_at ?? null)}</div>
          </div>
          <div class="metric">
            <div class="k">计划解除 / 剩余</div>
            <div class="v" style="font-size:0.95rem">
              ${fmtTime(s?.open_until ?? null)}
            </div>
            <div class="k countdown">
              ${s?.is_open ? this.remainingText() : "—"}
            </div>
          </div>
        </div>
      </section>

      <section>
        <h3>阈值区</h3>
        ${this.isWriter
          ? html`
              <div class="form-row">
                <div>
                  <label>电场上限（kV/m，技师录入）</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    placeholder="例如 4.0"
                    .value=${this.thresholdInput}
                    ?disabled=${s?.is_open}
                    @input=${(e: Event) =>
                      (this.thresholdInput = (e.target as HTMLInputElement).value)}
                  />
                </div>
                <div>
                  <label>开闸时长（分钟，自动记忆上次时长）</label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    .value=${this.durationInput}
                    ?disabled=${s?.is_open}
                    @input=${(e: Event) => {
                      this.durationPristine = false;
                      this.durationInput = (e.target as HTMLInputElement).value;
                    }}
                  />
                </div>
              </div>
              <div class="actions">
                ${s?.is_open
                  ? html`
                      <button
                        class="danger"
                        ?disabled=${this.busy}
                        @click=${this.closeGate}
                      >
                        关闭联闸（解除后恢复报送）
                      </button>
                    `
                  : html`
                      <button ?disabled=${this.busy} @click=${this.openGate}>
                        拉起联闸
                      </button>
                    `}
                <span class="k" style="color:#94a3b8;font-size:0.82rem">
                  采样值由服务端采集提供，页面不接受手填
                </span>
              </div>
              ${this.error ? html`<p class="err">${this.error}</p>` : null}
              ${this.notice ? html`<p class="ok-msg">${this.notice}</p>` : null}
            `
          : html`
              <p class="readonly-note">
                观察员仅可浏览阈值与开闸 / 退回记录，无权改动开关与上限。
              </p>
            `}
      </section>

      <div class="columns">
        <section style="margin-bottom:0">
          <h3>流水区</h3>
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>事项</th>
                <th>详情</th>
                <th>操作人</th>
              </tr>
            </thead>
            <tbody>
              ${this.flow.length === 0
                ? html`<tr><td colspan="4" style="color:#94a3b8">暂无流水</td></tr>`
                : this.flow.map(
                    (f) => html`
                      <tr>
                        <td style="white-space:nowrap">
                          ${fmtTime(f.created_at)}
                        </td>
                        <td>
                          <span class="tag ${ACTION_CLASS[f.action] || ""}">
                            ${ACTION_LABELS[f.action] || f.action}
                          </span>
                        </td>
                        <td>${f.detail}</td>
                        <td>${f.operator ?? "—"}</td>
                      </tr>
                    `
                  )}
            </tbody>
          </table>
        </section>

        <section style="margin-bottom:0">
          <h3>说明区</h3>
          <ul class="explain">
            <li>
              场站雷电监测升高时，可在此「一刀切」暂停偏航报送：联闸生效期间
              每条报送都会由服务端核对最近一次<strong>服务端采集</strong>的电场读数。
            </li>
            <li>
              读数满足 <code>|E| &gt; 电场上限</code> 时，报送<strong>整单退回</strong>
              （不进待处理队列）；退回流水与真实拒收在<strong>同一数据库事务</strong>提交。
            </li>
            <li>
              读数回落到限值内，报送自动恢复；联闸到计划时间自动解除，
              也可由技师手动关闭。关闭后新单不再被挡。
            </li>
            <li>
              阈值区会记忆上次开闸时长，下次拉起自动回填；电场上限由技师录入，
              电场采样值只来自后端 worker，前端没有任何自填入口。
            </li>
            <li>观察员可浏览本页阈值、读数与全部流水，但看不到开关操作。</li>
          </ul>
          <div class="demo">
            <strong>演示口径：</strong>把电场上限调到极低（如 0.1 kV/m）并拉起联闸，
            等服务端读数越限后回报首页报送偏航记录，应收到整单退回提示且流水新增
            「越界退回」；回本页关闭联闸后再送，应成功进入待处理队列。
          </div>
        </section>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "lightning-page": LightningPage;
  }
}
