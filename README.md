# ourios-grafana-datasource

A Grafana datasource plugin for [Ourios](https://github.com/jensholdgaard/ourios)
— logs, tables and time series straight from the logs DSL (`POST /v1/query`,
RFC 0016). The RFC 0041 follow-up to the
[Perses plugin set](https://github.com/jensholdgaard/ourios-perses-plugin):
one datasource covers all three shapes, because Grafana picks the frame from
the response.

## How queries map

The editor takes a raw DSL statement. The response shape picks the
visualisation (RFC 0041 §3.2):

| Response | Frame |
|---|---|
| `records[]` | logs (Explore / logs panel) |
| `aggregate[]` with a `bucket(w)` dimension | time series — one frame per group, scalar (`sum`/`min`/`max`/`avg`) preferred over count |
| `aggregate[]` without one | table |

Semantics shared with the Perses plugins (RFC0041.3):

- The dashboard picker range is injected as a `range(...)` stage; a range the
  user wrote by hand wins. The window is half-open (`from <= t < to`).
- The `bucket(w)` dimension is detected positionally (the key slot that is an
  RFC 3339 instant on every row), so group keys can come in any order.
- A `null` scalar (an all-NULL group, RFC 0042 §3.5) stays `null` — Grafana
  draws the gap — never a zero.
- Series identity is the group tuple, not the display name, so a group value
  containing the display delimiter cannot merge two series.

## Tenant handling

Requests go through Grafana's data proxy (`plugin.json` `routes`): the
Grafana server attaches `x-ourios-tenant` from the datasource's `jsonData`,
so the browser never handles tenant selection and there is no CORS surface.
Point the datasource at an RFC 0026-enforcing querier and the tenant is
additionally bound server-side to the credential.

## Development

```sh
npm install
npm run dev        # webpack watch
npm run server     # Grafana in docker-compose with the plugin mounted
npm test
```

Requires a running Ourios querier (e.g. the repo's dogfood server, or
`ghcr.io/jensholdgaard/ourios:0.5.0`).

## Status

Bootstrapped from the RFC 0041 spike (which rendered live dashboards against
a real querier). Unit-tested mapping; container e2e and release/signing
wiring follow.
