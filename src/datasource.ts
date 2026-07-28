import { getBackendSrv, isFetchError } from '@grafana/runtime';
import {
  CoreApp,
  DataFrame,
  DataFrameType,
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  DataSourceInstanceSettings,
  createDataFrame,
  FieldType,
} from '@grafana/data';
import { lastValueFrom } from 'rxjs';

import {
  DEFAULT_QUERY,
  OuriosAggregateRow,
  OuriosDataSourceOptions,
  OuriosQuery,
  OuriosQueryResponse,
  OuriosRecord,
} from './types';

/**
 * OTLP severity_number -> Grafana level. Ourios preserves the OTLP number
 * faithfully and `severity_text` is optional, so the number is the reliable
 * source. Several real sources (Claude Code's GenAI events) emit 0, which we
 * leave unset so Grafana falls back to its own heuristics rather than
 * mislabelling every such line.
 */
export function severityOf(rec: OuriosRecord): string {
  if (rec.severity_text) {
    return rec.severity_text.toLowerCase();
  }
  const n = rec.severity_number;
  if (n >= 21) {return 'critical';}
  if (n >= 17) {return 'error';}
  if (n >= 13) {return 'warning';}
  if (n >= 9) {return 'info';}
  if (n >= 5) {return 'debug';}
  if (n >= 1) {return 'trace';}
  return '';
}

/** Flatten an OTLP AnyValue so Grafana can render it in Log details. */
function anyValue(v?: Record<string, unknown>): unknown {
  if (!v) {return null;}
  const key = Object.keys(v)[0];
  return key === undefined ? null : v[key];
}

function labelsOf(rec: OuriosRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const kv of rec.resource_attributes ?? []) {
    out[kv.key] = anyValue(kv.value);
  }
  for (const kv of rec.attributes ?? []) {
    out[kv.key] = anyValue(kv.value);
  }
  if (rec.scope_name) {out['scope.name'] = rec.scope_name;}
  if (rec.template_id !== undefined) {out['template_id'] = rec.template_id;}
  if (rec.trace_id) {out['trace_id'] = rec.trace_id;}
  if (rec.span_id) {out['span_id'] = rec.span_id;}
  return out;
}

/** `records[]` -> the documented Grafana logs frame. */
export function logsFrame(refId: string, records: OuriosRecord[]): DataFrame {
  return createDataFrame({
    refId,
    fields: [
      {
        name: 'timestamp',
        type: FieldType.time,
        // Ourios timestamps are nanoseconds; Grafana wants epoch millis.
        values: records.map((r) => Math.floor(r.time_unix_nano / 1e6)),
      },
      { name: 'body', type: FieldType.string, values: records.map((r) => r.body?.line ?? '') },
      { name: 'severity', type: FieldType.string, values: records.map(severityOf) },
      {
        name: 'id',
        type: FieldType.string,
        // Ourios has no per-row id; synthesize a stable one. The index breaks
        // ties between records sharing a nanosecond timestamp.
        values: records.map((r, i) => `${r.time_unix_nano}-${r.template_id ?? 'x'}-${i}`),
      },
      { name: 'labels', type: FieldType.other, values: records.map(labelsOf) },
    ],
    meta: {
      type: DataFrameType.LogLines,
      preferredVisualisationType: 'logs',
    },
  });
}

/**
 * A `bucket(w)` group key: the RFC 3339 UTC start of the half-open window
 * `[k·w, (k+1)·w)` (RFC 0002 §6.3). Everything else the DSL can put in
 * `key[]` is a stored string form that never looks like this.
 */
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * The index of the `bucket(w)` dimension in the group keys: the position
 * that is an RFC 3339 timestamp on every row. Undefined when no position
 * qualifies — the query has no bucket term, so it is not a time series
 * (RFC 0041 §3.2: "aggregate[] with other keys → table").
 */
export function bucketIndex(rows: OuriosAggregateRow[]): number | undefined {
  const width = rows[0]?.key.length ?? 0;
  for (let i = 0; i < width; i++) {
    if (rows.every((row) => RFC3339.test(row.key[i] ?? ''))) {
      return i;
    }
  }
  return undefined;
}

/** The charted number: a scalar when the query has one, else the count. */
function scalarOf(row: OuriosAggregateRow): number | null {
  return row.value === undefined ? row.count : row.value;
}

/**
 * Bucketed aggregate rows -> one frame per group (RFC0041.3 semantics,
 * shared with the Perses plugin): bucket keys become the time field, the
 * remaining group keys become the series identity, and a `null` scalar (an
 * all-NULL group, RFC 0042 §3.5) stays `null` — Grafana renders the gap —
 * **never** a zero. The map key is the JSON form of the group parts, not
 * the display name: a group value may itself contain the display delimiter.
 */
export function timeSeriesFrames(refId: string, rows: OuriosAggregateRow[], bucket: number): DataFrame[] {
  const byGroup = new Map<string, { name: string; points: Array<[number, number | null]> }>();
  for (const row of rows) {
    const groupParts = row.key.filter((_, i) => i !== bucket);
    const identity = JSON.stringify(groupParts);
    let series = byGroup.get(identity);
    if (series === undefined) {
      series = { name: groupParts.length > 0 ? groupParts.join(', ') : 'value', points: [] };
      byGroup.set(identity, series);
    }
    series.points.push([Date.parse(row.key[bucket]!), scalarOf(row)]);
  }
  return [...byGroup.values()].map((series) => {
    series.points.sort((a, b) => a[0] - b[0]);
    return createDataFrame({
      refId,
      name: series.name,
      fields: [
        { name: 'time', type: FieldType.time, values: series.points.map((p) => p[0]) },
        // displayNameFromDS is the datasource-owned display name; naming the
        // FIELD after the series makes Grafana render "name name" in legends
        // and table headers (frame name + field name concatenated).
        {
          name: 'value',
          type: FieldType.number,
          config: { displayNameFromDS: series.name },
          values: series.points.map((p) => p[1]),
        },
      ],
    });
  });
}

/** Unbucketed aggregate rows -> a table, scalar column included when present. */
function aggregateTableFrame(refId: string, rows: OuriosAggregateRow[]): DataFrame {
  const width = rows[0]?.key.length ?? 0;
  const keyFields = Array.from({ length: width }, (_, i) => ({
    name: width === 1 ? 'group' : `group_${i}`,
    type: FieldType.string,
    values: rows.map((r) => r.key[i]),
  }));
  const hasScalar = rows.some((r) => r.value !== undefined);
  return createDataFrame({
    refId,
    fields: [
      ...keyFields,
      { name: 'count', type: FieldType.number, values: rows.map((r) => r.count) },
      ...(hasScalar
        ? [{ name: 'value', type: FieldType.number, values: rows.map((r) => (r.value === undefined ? null : r.value)) }]
        : []),
    ],
  });
}

/**
 * Inject Grafana's picker range as a `range(...)` stage. The DSL takes RFC
 * 3339 bounds, so the picker maps straight across. A range the user wrote by
 * hand wins — silently overriding it would make the editor lie about what ran.
 */
export function withRange(dsl: string, fromISO: string, toISO: string): string {
  if (/\brange\s*\(/.test(dsl)) {
    return dsl;
  }
  const stages = dsl.split('|');
  const head = stages[0].trim();
  const rest = stages.slice(1).map((s) => s.trim());
  return [head, `range(${fromISO}, ${toISO})`, ...rest].join(' | ');
}

export class DataSource extends DataSourceApi<OuriosQuery, OuriosDataSourceOptions> {
  baseUrl: string;

  constructor(instanceSettings: DataSourceInstanceSettings<OuriosDataSourceOptions>) {
    super(instanceSettings);
    // Grafana's data proxy: requests go via the Grafana server, which attaches
    // x-ourios-tenant from jsonData (plugin.json `routes`) — so no CORS, and
    // no tenant handling in the browser.
    this.baseUrl = `${instanceSettings.url}/ourios`;
  }

  getDefaultQuery(_: CoreApp): Partial<OuriosQuery> {
    return DEFAULT_QUERY;
  }

  filterQuery(query: OuriosQuery): boolean {
    return !!query.dsl?.trim();
  }

  private async runDsl(dsl: string): Promise<OuriosQueryResponse> {
    const res = getBackendSrv().fetch<OuriosQueryResponse>({
      url: `${this.baseUrl}/v1/query`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: { query: dsl },
    });
    return (await lastValueFrom(res)).data;
  }

  async query(options: DataQueryRequest<OuriosQuery>): Promise<DataQueryResponse> {
    const fromISO = options.range.from.toISOString();
    const toISO = options.range.to.toISOString();

    const frames = await Promise.all(
      options.targets
        .filter((t) => !t.hide && this.filterQuery(t))
        .map(async (target) => {
          const dsl = withRange(target.dsl!.trim(), fromISO, toISO);
          const body = await this.runDsl(dsl);

          // An aggregate query answers with `aggregate`, a row query with
          // `records` — the response shape picks the frame, so one editor
          // serves logs, graphs and tables.
          if (body.aggregate?.length) {
            const bucket = bucketIndex(body.aggregate);
            return bucket === undefined
              ? [aggregateTableFrame(target.refId, body.aggregate)]
              : timeSeriesFrames(target.refId, body.aggregate, bucket);
          }
          return [logsFrame(target.refId, body.records ?? [])];
        })
    );

    return { data: frames.flat() };
  }

  async testDatasource() {
    try {
      // A trivially cheap query: proves URL, proxy route, tenant header and
      // DSL parsing all line up, which a bare GET would not.
      await this.runDsl('severity >= trace | range(-5m, now) | limit 1');
      return { status: 'success', message: 'Queried Ourios successfully' };
    } catch (err) {
      let message = 'Cannot reach the Ourios querier';
      if (typeof err === 'string') {
        message = err;
      } else if (isFetchError(err)) {
        const detail = err.data?.detail ?? err.data?.error ?? err.statusText;
        message = `Ourios returned ${err.status}${detail ? `: ${detail}` : ''}`;
      }
      return { status: 'error', message };
    }
  }
}
