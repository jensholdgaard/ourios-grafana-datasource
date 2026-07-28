# Ourios

Query [Ourios](https://github.com/jensholdgaard/ourios) — an OTLP-native
log backend — from Grafana using the Ourios logs DSL. One datasource
covers logs in Explore, tables, and time series; the response shape
picks the visualisation:

- record queries (`severity >= warn | limit 100`) render as logs
- bucketed aggregates (`sum(attr.cost_usd) by attr.model, bucket(1h)`)
  render as time series, one series per group
- other aggregates (`count by attr.model`) render as tables

The dashboard time range is injected as a `range(...)` stage — a range
written by hand wins. Aggregate gaps stay gaps: a group whose inputs
were all NULL renders as no data, never as zero.

## Configuration

Set the querier URL and the tenant. Requests go through Grafana's data
proxy, which attaches the `x-ourios-tenant` header server-side — the
browser never handles tenant selection. Against a querier with
authentication enabled, the tenant is additionally bound server-side to
the credential.

Documentation: https://github.com/jensholdgaard/ourios-grafana-datasource
