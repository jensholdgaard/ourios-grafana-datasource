# ourios-grafana-datasource

A [Grafana](https://grafana.com) datasource plugin for
[Ourios](https://github.com/jensholdgaard/ourios): query the Ourios logs
DSL from Grafana — logs in Explore, tables, and time series (including
cost/usage charts over typed numeric columns) from one datasource.

## How queries map

The query editor takes a raw DSL statement; the response shape picks the
visualisation:

| Response | Frame |
|---|---|
| `records[]` | logs (Explore / logs panel) |
| `aggregate[]` with a `bucket(w)` dimension | time series — one frame per group, scalar (`sum`/`min`/`max`/`avg`) preferred over count |
| `aggregate[]` without one | table |

```
severity >= warn | limit 100                          # a logs frame
body == "api_request" | count by bucket(1h)           # a time series
sum(attr.cost_usd) by attr.model, bucket(1h)          # one series per model
```

Behaviour worth knowing:

- The dashboard picker range is injected as a `range(...)` stage; a
  range you write by hand wins. The window is half-open
  (`from <= t < to`).
- The `bucket(w)` dimension is detected positionally, so group keys can
  come in any order.
- A `null` aggregate (every input in the group was NULL) renders as a
  gap, never a zero.
- Series identity is the full group tuple, so a group value containing
  the display delimiter cannot merge two series.

## Install

Download `ourios-ourios-datasource-<version>.zip` from the
[releases](https://github.com/jensholdgaard/ourios-grafana-datasource/releases),
extract it into Grafana's plugin directory, and allow the (unsigned)
plugin id:

```ini
[plugins]
allow_loading_unsigned_plugins = ourios-ourios-datasource
```

## Configure

The datasource takes the querier URL and a tenant. Requests go through
Grafana's data proxy, which attaches `x-ourios-tenant` server-side — the
browser never talks to the querier directly and there is no CORS
surface.
Provisioning example:

```yaml
apiVersion: 1
datasources:
  - name: ourios
    uid: ourios
    type: ourios-ourios-datasource
    access: proxy
    jsonData:
      url: http://ourios-querier:4319
      tenant: my-tenant
```

Against a querier with authentication enabled, the tenant is
additionally bound server-side to the credential.

## Development

```sh
npm install
npm run dev                  # webpack watch
npm run server               # Grafana in docker-compose with the plugin mounted
npm test                     # unit
npm run test:container-e2e   # container e2e (docker required)
```

`npm run server` provisions the datasource from
`provisioning/datasources/datasources.yml` — point it at any running
Ourios querier.

## Compatibility

The declared minimum `ourios-server` version is **0.5.0**; CI runs the
container end-to-end suite against exactly that GHCR image, so a
contract break fails this repository's gate — not your dashboard.

## License

Apache-2.0.
