/**
 * Container e2e against the released `ourios-server` image (see
 * `run-e2e.sh` for the fixture topology and the graceful-shutdown flush
 * choreography — both shared verbatim with the Perses plugin repo).
 *
 * The datasource class itself needs Grafana's runtime (`getBackendSrv`,
 * the data proxy), so these suites pin the two halves the class is glued
 * from: the wire contract (`POST /v1/query`, RFC 0026 auth behaviour the
 * proxy route relies on) and the exported pure mapping (withRange,
 * logsFrame, timeSeriesFrames) fed with real responses.
 */
import { withRange, logsFrame, timeSeriesFrames, bucketIndex, severityOf } from '../src/datasource';
import type { OuriosQueryResponse, OuriosRecord } from '../src/types';
import { requireEnv } from './env';

const OPEN_URL = requireEnv('OPEN_QUERY_URL');
const AUTH_URL = requireEnv('AUTH_QUERY_URL');
const GOOD = requireEnv('E2E_TOKEN_GOOD');
const OTHER = requireEnv('E2E_TOKEN_OTHER');

const TENANT = 'e2e-tenant';
// The seeded records sit at 2026-07-27T10:00:00Z, +1s, and 11:00:00Z.
// END is 12:00, NOT 11:00: `range(from, to)` is half-open (RFC 0002
// §6.2), so a record exactly on `to` is excluded.
const START = '2026-07-27T09:00:00.000Z';
const END = '2026-07-27T12:00:00.000Z';

async function post(
  url: string,
  dsl: string,
  headers: Record<string, string> = { 'x-ourios-tenant': TENANT }
): Promise<{ status: number; body: OuriosQueryResponse }> {
  const res = await fetch(`${url}/v1/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ query: dsl }),
  });
  return { status: res.status, body: (await res.json()) as OuriosQueryResponse };
}

describe('wire contract — open mode', () => {
  it('answers without any credential', async () => {
    const { status, body } = await post(OPEN_URL, withRange('severity >= trace', START, END));
    expect(status).toBe(200);
    expect(body.rows).toBe(2); // both INFO records; severity 0 is below trace on 0.5.0
  });

  it('keeps a hand-written range instead of overriding it', async () => {
    // The injected picker range would cover all three records; the
    // hand-written one ends ON the 11:00:00Z record, which the half-open
    // window excludes — proving the hand-written range actually ran.
    const dsl = withRange(`template_id > 0 | range(${START}, 2026-07-27T11:00:00Z)`, START, END);
    const { body } = await post(OPEN_URL, dsl);
    expect(body.rows).toBe(2);
  });

  it('sees the boundary record once the window passes it (half-open, RFC 0002 §6.2)', async () => {
    const { body } = await post(OPEN_URL, withRange('template_id > 0', START, END));
    expect(body.rows).toBe(3);
  });
});

describe('wire contract — RFC 0026 enforcement (what the data proxy relies on)', () => {
  const dsl = withRange('severity >= trace', START, END);

  it('accepts the credential covering the tenant', async () => {
    const { status, body } = await post(AUTH_URL, dsl, {
      'x-ourios-tenant': TENANT,
      authorization: `Bearer ${GOOD}`,
    });
    expect(status).toBe(200);
    expect(body.rows).toBe(2);
  });

  it('rejects a missing credential as 401, not 403', async () => {
    const { status } = await post(AUTH_URL, dsl);
    expect(status).toBe(401);
  });

  it('rejects a credential for another tenant as 403, not 401', async () => {
    const { status } = await post(AUTH_URL, dsl, {
      'x-ourios-tenant': TENANT,
      authorization: `Bearer ${OTHER}`,
    });
    expect(status).toBe(403);
  });
});

describe('logsFrame on real records', () => {
  let records: OuriosRecord[];

  beforeAll(async () => {
    const { body } = await post(OPEN_URL, withRange('template_id > 0', START, END));
    records = body.records ?? [];
  });

  it('maps the wire records into the Grafana logs frame', () => {
    const frame = logsFrame('A', records);
    const field = (n: string) => frame.fields.find((f) => f.name === n)!;
    expect(records).toHaveLength(3);
    // ns -> ms, against the known seed instant
    expect(field('timestamp').values).toContain(Date.parse('2026-07-27T10:00:00Z'));
    expect(field('body').values).toContain('hello from the e2e fixture');
    const ids = field('id').values as string[];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('surfaces the promoted attribute in labels and keeps severity 0 unset', () => {
    const labelled = records
      .map((r) => logsFrame('A', [r]).fields.find((f) => f.name === 'labels')!.values[0] as Record<string, unknown>)
      .filter((l) => l['model'] === 'claude-fable-5');
    expect(labelled.length).toBeGreaterThan(0);
    const unspecified = records.find((r) => r.severity_number === 0);
    expect(unspecified).toBeDefined();
    expect(severityOf(unspecified!)).toBe('');
  });
});

describe('timeSeriesFrames on real aggregates', () => {
  it('charts count by bucket(1h) with the bucket found positionally', async () => {
    const { body } = await post(OPEN_URL, withRange('template_id > 0 | count by bucket(1h)', START, END));
    const rows = body.aggregate ?? [];
    const bucket = bucketIndex(rows);
    expect(bucket).toBe(0);
    const frames = timeSeriesFrames('B', rows, bucket!);
    expect(frames).toHaveLength(1);
    const times = frames[0].fields[0].values as number[];
    const counts = frames[0].fields[1].values as number[];
    expect(times).toEqual([Date.parse('2026-07-27T10:00:00Z'), Date.parse('2026-07-27T11:00:00Z')]);
    expect(counts).toEqual([2, 1]);
  });

  it('splits a grouped aggregate into one frame per group', async () => {
    const { body } = await post(
      OPEN_URL,
      withRange('template_id > 0 | count by attr.model, bucket(1h)', START, END)
    );
    const rows = body.aggregate ?? [];
    const bucket = bucketIndex(rows);
    expect(bucket).toBe(1); // group key first, bucket second — positional detection
    const frames = timeSeriesFrames('B', rows, bucket!);
    const named = frames.find((f) => f.name === 'claude-fable-5');
    expect(named).toBeDefined();
    // The record with no model attribute is EXCLUDED from the group-by (the
    // server emits no null group), so the two fable-5 records are the only
    // series — one frame, a point per bucket.
    expect(frames).toHaveLength(1);
    expect(named!.fields[0].values).toEqual([
      Date.parse('2026-07-27T10:00:00Z'),
      Date.parse('2026-07-27T11:00:00Z'),
    ]);
  });
});
