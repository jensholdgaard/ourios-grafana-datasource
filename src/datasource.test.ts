import { withRange, logsFrame, timeSeriesFrames, bucketIndex, severityOf } from './datasource';
import { DataFrameType, FieldType } from '@grafana/data';
import fixture from './fixture.json';
import type { OuriosRecord } from './types';

describe('withRange (Grafana picker -> DSL range stage)', () => {
  const from = '2026-07-25T08:00:00.000Z';
  const to = '2026-07-25T16:00:00.000Z';

  it('injects the picker range as a stage after the predicate', () => {
    expect(withRange('template_id == 14 | limit 100', from, to)).toBe(
      `template_id == 14 | range(${from}, ${to}) | limit 100`
    );
  });

  it('injects even when the query is a bare predicate', () => {
    expect(withRange('severity >= warn', from, to)).toBe(`severity >= warn | range(${from}, ${to})`);
  });

  it('leaves a hand-written range alone rather than silently overriding it', () => {
    const explicit = 'template_id == 14 | range(-30d, now) | limit 5';
    expect(withRange(explicit, from, to)).toBe(explicit);
  });

  it('preserves an aggregate tail so bucket() still lands last', () => {
    expect(withRange('template_id == 17 | count by bucket(1h)', from, to)).toBe(
      `template_id == 17 | range(${from}, ${to}) | count by bucket(1h)`
    );
  });
});

describe('logsFrame (real Ourios payload)', () => {
  const frame = logsFrame('A', fixture.records as unknown as OuriosRecord[]);
  const field = (n: string) => frame.fields.find((f) => f.name === n)!;

  it('emits exactly the fields the Grafana logs contract requires', () => {
    expect(frame.fields.map((f) => f.name)).toEqual(['timestamp', 'body', 'severity', 'id', 'labels']);
    expect(field('timestamp').type).toBe(FieldType.time);
    expect(field('body').type).toBe(FieldType.string);
    expect(field('labels').type).toBe(FieldType.other);
  });

  it('marks the frame as log lines so Explore renders it as logs', () => {
    expect(frame.meta?.type).toBe(DataFrameType.LogLines);
    expect(frame.meta?.preferredVisualisationType).toBe('logs');
  });

  it('converts nanosecond timestamps to epoch millis in a plausible range', () => {
    const ts = field('timestamp').values[0] as number;
    expect(ts).toBe(Math.floor((fixture.records[0].time_unix_nano as number) / 1e6));
    // sanity: a 13-digit ms epoch, not a nanosecond value leaking through
    expect(String(ts)).toHaveLength(13);
  });

  it('renders the body line, not the body object', () => {
    expect(field('body').values[0]).toBe(fixture.records[0].body.line);
    expect(typeof field('body').values[0]).toBe('string');
  });

  it('flattens OTLP attributes into a labels record', () => {
    const labels = field('labels').values[0] as Record<string, unknown>;
    // resource + log attributes both land, values unwrapped from AnyValue
    expect(labels['service.name']).toBe('agent-dogfood');
    expect(labels['event.name']).toBe('user_prompt');
    expect(labels['template_id']).toBe(14);
  });

  it('gives every row a distinct id', () => {
    const ids = field('id').values as string[];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('severityOf (OTLP number -> Grafana level)', () => {
  it('prefers severity_text when present', () => {
    expect(severityOf({ severity_number: 17, severity_text: 'INFO' } as OuriosRecord)).toBe('info');
  });

  it('maps OTLP bands when text is absent', () => {
    expect(severityOf({ severity_number: 9 } as OuriosRecord)).toBe('info');
    expect(severityOf({ severity_number: 17 } as OuriosRecord)).toBe('error');
    expect(severityOf({ severity_number: 5 } as OuriosRecord)).toBe('debug');
  });

  it('leaves severity_number 0 unset so Grafana falls back rather than mislabelling', () => {
    // Claude Code's GenAI events emit 0 — the documented gotcha.
    expect(severityOf({ severity_number: 0 } as OuriosRecord)).toBe('');
    expect(severityOf(fixture.records[0] as unknown as OuriosRecord)).toBe('');
  });
});

describe('bucketIndex (positional bucket detection)', () => {
  it('finds the bucket dimension wherever the DSL put it', () => {
    const rows = [
      { key: ['claude-fable-5', '2026-07-25T08:00:00Z'], count: 3 },
      { key: ['claude-fable-5', '2026-07-25T09:00:00Z'], count: 5 },
    ];
    expect(bucketIndex(rows)).toBe(1);
  });

  it('is undefined when no position is an instant on every row — a table, not a series', () => {
    expect(bucketIndex([{ key: ['claude-fable-5'], count: 3 }])).toBeUndefined();
  });

  it('rejects a stored string that merely starts date-like', () => {
    const rows = [{ key: ['2026-07-25T08:00 partial'], count: 1 }];
    expect(bucketIndex(rows)).toBeUndefined();
  });
});

describe('timeSeriesFrames (RFC0041.3 semantics)', () => {
  it('charts count-by-bucket as a single frame', () => {
    const rows = [
      { key: ['2026-07-25T08:00:00Z'], count: 352 },
      { key: ['2026-07-25T09:00:00Z'], count: 71 },
    ];
    const frames = timeSeriesFrames('B', rows, 0);
    expect(frames).toHaveLength(1);
    expect(frames[0].fields.map((f) => f.name)).toEqual(['time', 'value']);
    expect(frames[0].fields[0].type).toBe(FieldType.time);
    expect(frames[0].fields[0].values[0]).toBe(Date.parse('2026-07-25T08:00:00Z'));
    expect(frames[0].fields[1].values).toEqual([352, 71]);
  });

  it('splits group keys into one frame per series, charting the scalar', () => {
    const rows = [
      { key: ['claude-fable-5', '2026-07-25T08:00:00Z'], count: 3, value: 12.5 },
      { key: ['claude-haiku-4-5', '2026-07-25T08:00:00Z'], count: 2, value: 0.01 },
      { key: ['claude-fable-5', '2026-07-25T09:00:00Z'], count: 5, value: 20.25 },
    ];
    const frames = timeSeriesFrames('B', rows, 1);
    expect(frames.map((f) => f.name)).toEqual(['claude-fable-5', 'claude-haiku-4-5']);
    const fable = frames[0];
    expect(fable.fields[1].values).toEqual([12.5, 20.25]);
  });

  it('keeps an all-NULL scalar as null — a gap, never a zero (RFC 0042 §3.5)', () => {
    const rows = [
      { key: ['2026-07-25T08:00:00Z'], count: 4, value: null },
      { key: ['2026-07-25T09:00:00Z'], count: 3, value: 7 },
    ];
    const frames = timeSeriesFrames('B', rows, 0);
    expect(frames[0].fields[1].values).toEqual([null, 7]);
  });

  it('keeps two groups distinct even when their display names collide', () => {
    // Groups ["a", "b"] and ["a, b", "x"]: identity is the JSON form of the
    // group parts, so a value containing the display delimiter cannot merge
    // two series (the failure the Perses port hit first).
    const collide = [
      { key: ['a', 'b', '2026-07-25T08:00:00Z'], count: 1 },
      { key: ['a, b', 'x', '2026-07-25T08:00:00Z'], count: 2 },
    ];
    const frames = timeSeriesFrames('B', collide, 2);
    expect(frames).toHaveLength(2);
  });

  it('sorts points by time within a series', () => {
    const rows = [
      { key: ['2026-07-25T09:00:00Z'], count: 2 },
      { key: ['2026-07-25T08:00:00Z'], count: 1 },
    ];
    const frames = timeSeriesFrames('B', rows, 0);
    expect(frames[0].fields[0].values).toEqual([
      Date.parse('2026-07-25T08:00:00Z'),
      Date.parse('2026-07-25T09:00:00Z'),
    ]);
  });
});
