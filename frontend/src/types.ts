export type Session = {
  token: string;
  username: string;
  role: string;
};

export type LogRow = {
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

export type ReadingPoint = {
  field_kvm: number;
  sampled_at: string;
};

export type LightningStatus = {
  is_open: boolean;
  field_threshold_kvm: number;
  opened_by: string | null;
  opened_at: string | null;
  open_until: string | null;
  close_reason: string | null;
  last_duration_minutes: number;
  latest: (ReadingPoint & { is_over_limit: boolean }) | null;
  recent: ReadingPoint[];
};

export type FlowRow = {
  id: number;
  action: string;
  detail: string;
  field_kvm: number | null;
  threshold_kvm: number | null;
  operator: string | null;
  created_at: string;
};
