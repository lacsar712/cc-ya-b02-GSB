import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { Session } from "./types";

export type InterlockStatus = {
  engaged: boolean;
  threshold_kv_m: number | null;
  engaged_by: string | null;
  engaged_at: string | null;
  last_duration_sec: number | null;
  latest_reading_kv_m: number | null;
  latest_sampled_at: string | null;
};

type InterlockEvent = {
  id: number;
  event_type: "engage" | "release" | "reject";
  threshold_kv_m: number | null;
  reading_kv_m: number | null;
  actor: string;
  turbine_code: string | null;
  detail: string;
  created_at: string;
};

const EVENT_LABEL: Record<string, string> = {
  engage: "开闸",
  release: "关闸",
  reject: "整单退回",
};

function fmtTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleString("zh-CN", { hour12: false });
}

function fmtDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m} 分 ${r} 秒` : `${m} 分钟`;
  const h = Math.floor(m / 60);
  return `${h} 小时 ${m % 60} 分`;
}

@customElement("yaw-interlock")
export class YawInterlock extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    section {
      background: #1e293b;
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin-bottom: 1rem;
      border: 1px solid #334155;
    }
    h2 {
      margin: 0 0 0.75rem;
      font-size: 1.1rem;
      color: #e2e8f0;
    }
    .facts {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 0.4rem 1rem;
      font-size: 0.92rem;
      margin-bottom: 0.75rem;
    }
    .facts .k {
      color: #94a3b8;
    }
    .tag {
      display: inline-block;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      font-size: 0.8rem;
    }
    .on {
      background: #7f1d1d;
      color: #fca5a5;
    }
    .off {
      background: #14532d;
      color: #86efac;
    }
    .reject {
      background: #713f12;
      color: #fde68a;
    }
    .controls {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      flex-wrap: wrap;
    }
    input {
      width: 16rem;
      max-width: 100%;
      box-sizing: border-box;
      padding: 0.5rem 0.65rem;
      border-radius: 6px;
      border: 1px solid #475569;
      background: #0f172a;
      color: #f1f5f9;
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
      background: #b45309;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .hint {
      color: #94a3b8;
      font-size: 0.85rem;
      margin: 0.25rem 0 0;
    }
    .err {
      color: #f87171;
      margin: 0.5rem 0 0;
    }
    .cols {
      display: flex;
      gap: 1rem;
      align-items: stretch;
    }
    .cols > section {
      min-width: 0;
    }
    .stream {
      flex: 3;
    }
    .desc {
      flex: 2;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    th,
    td {
      text-align: left;
      padding: 0.45rem 0.4rem;
      border-bottom: 1px solid #334155;
      vertical-align: top;
    }
    th {
      color: #94a3b8;
      font-weight: 600;
    }
    .empty {
      color: #64748b;
      font-size: 0.9rem;
    }
    .desc ul {
      margin: 0;
      padding-left: 1.1rem;
      color: #cbd5e1;
      font-size: 0.88rem;
      line-height: 1.7;
    }
    @media (max-width: 760px) {
      .cols {
        flex-direction: column;
      }
    }
  `;

  @property({ attribute: false }) session: Session | null = null;

  @state() private status: InterlockStatus | null = null;
  @state() private events: InterlockEvent[] = [];
  @state() private thresholdInput = "";
  @state() private thresholdTouched = false;
  @state() private error = "";
  @state() private busy = false;

  private timer?: number;

  connectedCallback() {
    super.connectedCallback();
    void this.refresh();
    this.timer = window.setInterval(() => void this.refresh(), 2000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.timer) clearInterval(this.timer);
  }

  private get isWriter() {
    return this.session?.role === "writer";
  }

  private authHeaders(): HeadersInit {
    return this.session ? { Authorization: `Bearer ${this.session.token}` } : {};
  }

  private async refresh() {
    if (!this.session) return;
    try {
      const [statusRes, eventsRes] = await Promise.all([
        fetch("/api/interlock", { headers: this.authHeaders() }),
        fetch("/api/interlock/events", { headers: this.authHeaders() }),
      ]);
      if (statusRes.status === 401 || eventsRes.status === 401) {
        this.dispatchEvent(
          new CustomEvent("auth-expired", { bubbles: true, composed: true })
        );
        return;
      }
      if (statusRes.ok) {
        this.status = (await statusRes.json()) as InterlockStatus;
        if (
          !this.thresholdTouched &&
          this.thresholdInput === "" &&
          this.status.threshold_kv_m != null
        ) {
          this.thresholdInput = String(this.status.threshold_kv_m);
        }
      }
      if (eventsRes.ok) {
        this.events = (await eventsRes.json()) as InterlockEvent[];
      }
    } catch {
      /* 忽略瞬时网络异常 */
    }
  }

  private async engage() {
    this.error = "";
    this.busy = true;
    try {
      const res = await fetch("/api/interlock/engage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({ threshold_kv_m: Number(this.thresholdInput) }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.error = data.detail || "拉起联闸失败";
        return;
      }
      await this.refresh();
    } catch {
      this.error = "操作时网络异常";
    } finally {
      this.busy = false;
    }
  }

  private async release() {
    this.error = "";
    this.busy = true;
    try {
      const res = await fetch("/api/interlock/release", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
      });
      const data = await res.json();
      if (!res.ok) {
        this.error = data.detail || "解除联闸失败";
        return;
      }
      await this.refresh();
    } catch {
      this.error = "操作时网络异常";
    } finally {
      this.busy = false;
    }
  }

  private renderThreshold() {
    const s = this.status;
    return html`
      <section>
        <h2>阈值区</h2>
        <div class="facts">
          <span class="k">联闸状态</span>
          <span>
            ${s == null
              ? "…"
              : s.engaged
                ? html`<span class="tag on">开闸中</span>`
                : html`<span class="tag off">已关闸</span>`}
          </span>
          <span class="k">当前电场读数</span>
          <span>
            ${s?.latest_reading_kv_m != null
              ? `${s.latest_reading_kv_m} kV/m`
              : "—"}
            <span class="hint">（服务端采集，采样于 ${fmtTime(s?.latest_sampled_at ?? null)}）</span>
          </span>
          <span class="k">电场上限</span>
          <span>${s?.threshold_kv_m != null ? `${s.threshold_kv_m} kV/m` : "—"}</span>
          <span class="k">上次开闸时长</span>
          <span>${fmtDuration(s?.last_duration_sec ?? null)}</span>
          ${s?.engaged
            ? html`
                <span class="k">本次开闸</span>
                <span>${s.engaged_by} · ${fmtTime(s.engaged_at)}</span>
              `
            : null}
        </div>
        ${this.isWriter
          ? html`
              <div class="controls">
                ${s?.engaged
                  ? html`
                      <button
                        class="danger"
                        ?disabled=${this.busy}
                        @click=${this.release}
                      >
                        解除联闸（关闸）
                      </button>
                    `
                  : html`
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        placeholder="电场上限 kV/m，调到 0.5 以下可模拟越界"
                        .value=${this.thresholdInput}
                        @input=${(e: Event) => {
                          this.thresholdTouched = true;
                          this.thresholdInput = (
                            e.target as HTMLInputElement
                          ).value;
                        }}
                      />
                      <button
                        ?disabled=${this.busy || this.thresholdInput.trim() === ""}
                        @click=${this.engage}
                      >
                        拉起联闸（开闸）
                      </button>
                    `}
              </div>
            `
          : html`<p class="hint">只读账号：可浏览阈值与开闸记录，无权改开关。</p>`}
        ${this.error ? html`<p class="err">${this.error}</p>` : null}
      </section>
    `;
  }

  private renderStream() {
    return html`
      <section class="stream">
        <h2>流水区</h2>
        ${this.events.length === 0
          ? html`<p class="empty">暂无开闸 / 关闸 / 退回记录。</p>`
          : html`
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>事件</th>
                    <th>操作人</th>
                    <th>上限</th>
                    <th>读数</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  ${this.events.map(
                    (ev) => html`
                      <tr>
                        <td>${fmtTime(ev.created_at)}</td>
                        <td>
                          <span
                            class="tag ${ev.event_type === "reject"
                              ? "reject"
                              : ev.event_type === "engage"
                                ? "on"
                                : "off"}"
                          >
                            ${EVENT_LABEL[ev.event_type] ?? ev.event_type}
                          </span>
                        </td>
                        <td>${ev.actor}</td>
                        <td>
                          ${ev.threshold_kv_m != null
                            ? `${ev.threshold_kv_m} kV/m`
                            : "—"}
                        </td>
                        <td>
                          ${ev.reading_kv_m != null
                            ? `${ev.reading_kv_m} kV/m`
                            : "—"}
                        </td>
                        <td>${ev.detail}</td>
                      </tr>
                    `
                  )}
                </tbody>
              </table>
            `}
      </section>
    `;
  }

  private renderDesc() {
    return html`
      <section class="desc">
        <h2>说明区</h2>
        <ul>
          <li>场站雷电监测升高时，技师录入电场上限并拉起联闸，可一刀切暂停偏航报送。</li>
          <li>开闸期间后台 worker 持续采集电场读数；报送时读数越界则整单退回，退回流水与真实拒收在同一事务提交。</li>
          <li>采样值只能来自服务端采集，前端不得自填；演示时把阈值调到极低（如 0.1 kV/m）即可模拟越界。</li>
          <li>解除联闸（关闸）后新单不再被挡；阈值区会记忆上次开闸时长。</li>
          <li>观察员仅可浏览阈值与开闸记录，无权改开关。</li>
        </ul>
      </section>
    `;
  }

  render() {
    return html`
      ${this.renderThreshold()}
      <div class="cols">
        ${this.renderStream()} ${this.renderDesc()}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "yaw-interlock": YawInterlock;
  }
}
