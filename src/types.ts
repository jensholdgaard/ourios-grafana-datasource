import { DataSourceJsonData } from '@grafana/data';
import { DataQuery } from '@grafana/schema';

export interface OuriosQuery extends DataQuery {
  /** A logs-DSL statement, e.g. `template_id == 17 | count by attr.model`. */
  dsl?: string;
}

export const DEFAULT_QUERY: Partial<OuriosQuery> = {
  dsl: 'severity >= trace | limit 100',
};

export interface OuriosDataSourceOptions extends DataSourceJsonData {
  /** Base URL of the Ourios querier, e.g. http://host.docker.internal:4319 */
  url?: string;
  /** RFC 0026 tenant; sent as the x-ourios-tenant header by the proxy route. */
  tenant?: string;
}

/** One record from `POST /v1/query` — the RFC 0005 / OTLP row shape. */
export interface OuriosRecord {
  time_unix_nano: number;
  observed_time_unix_nano?: number;
  severity_number: number;
  severity_text?: string;
  scope_name?: string;
  trace_id?: string;
  span_id?: string;
  template_id?: number;
  template_version?: number;
  attributes?: OuriosKeyValue[];
  resource_attributes?: OuriosKeyValue[];
  body?: { kind?: string; line?: string; reconstruction?: string };
}

export interface OuriosKeyValue {
  key: string;
  value?: Record<string, unknown>;
}

export interface OuriosAggregateRow {
  key: string[];
  count: number;
  /**
   * The scalar of a `sum(...)`/`min`/`max`/`avg` query (RFC0002.17 +
   * RFC 0042). Absent for the bare `count` family; `null` when every
   * input in the group was NULL (RFC 0042 §3.5) — a gap, never a zero.
   */
  value?: number | null;
}

export interface OuriosQueryResponse {
  rows: number;
  stats?: {
    row_groups_scanned?: number;
    row_groups_pruned?: number;
    bytes_read?: number;
    rows_excluded?: number;
  };
  records?: OuriosRecord[];
  aggregate?: OuriosAggregateRow[];
}
