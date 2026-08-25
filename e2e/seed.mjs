// Seed the fixture server with two known records over OTLP/HTTP JSON
// (RFC 0003 §3.6 encoding: lowerCamelCase keys, timeUnixNano as a
// decimal string). Usage: node e2e/seed.mjs <ingestBase> [bearer]
const [ingestBase, bearer] = process.argv.slice(2);
if (!ingestBase) {
  console.error("usage: node e2e/seed.mjs <ingestBase> [bearer]");
  process.exit(2);
}

// 2026-07-27T10:00:00Z, +1s, and one record an hour later (a second
// bucket(1h) window for the time-series e2e) — nanoseconds as decimal
// strings.
const T1 = "1785146400000000000";
const T2 = "1785146401000000000";
const T3 = "1785150000000000000";

const payload = {
  resourceLogs: [
    {
      resource: {
        // Tenant derives from service.name (RFC 0026).
        attributes: [
          { key: "service.name", value: { stringValue: "e2e-tenant" } },
        ],
      },
      scopeLogs: [
        {
          scope: { name: "e2e.fixture" },
          logRecords: [
            {
              timeUnixNano: T1,
              severityNumber: 9,
              severityText: "INFO",
              body: { stringValue: "hello from the e2e fixture" },
              attributes: [
                { key: "model", value: { stringValue: "claude-fable-5" } },
                // Typed-promotion material (RFC 0042): a double and an
                // int (RFC 0003 §3.6: intValue is a decimal string). On
                // the 0.5.0 leg these are just stored attributes; on the
                // typed leg they become Float64/Int64 columns.
                { key: "cost_usd", value: { doubleValue: 12.5 } },
                { key: "output_tokens", value: { intValue: "800" } },
              ],
            },
            {
              // No severityText and SeverityNumber 0: the §3.2 band
              // fallback must label this "unspecified" (RFC0002.21).
              timeUnixNano: T2,
              severityNumber: 0,
              body: { stringValue: "unspecified severity line" },
              attributes: [],
            },
            {
              // The second bucket(1h) window. Carries the model but NO
              // cost_usd, so a typed sum over this bucket is an all-NULL
              // group — the null-stays-null wire case.
              timeUnixNano: T3,
              severityNumber: 9,
              severityText: "INFO",
              body: { stringValue: "second hour" },
              attributes: [
                { key: "model", value: { stringValue: "claude-fable-5" } },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const response = await fetch(`${ingestBase}/v1/logs`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    // RFC 0046: tenancy is out-of-band — the header names the tenant
    // (servers >= 0.9.0 require it; older ones ignore it and derive
    // from service.name, which the resource still carries).
    "x-ourios-tenant": "e2e-tenant",
    ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
  },
  body: JSON.stringify(payload),
});
if (!response.ok) {
  console.error(`seed failed: ${response.status} ${await response.text()}`);
  process.exit(1);
}
console.log(`seeded ${ingestBase}: ${response.status}`);
