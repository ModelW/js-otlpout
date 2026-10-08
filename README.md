# js-otlpout

A generic [Sentry JavaScript SDK](https://docs.sentry.io/platforms/javascript/)
integration that mirrors everything Sentry traces — the inbound server request
span, captured errors/messages and structured logs — to **stdout as OTLP/JSON**.

Plug the integration and hooks into `Sentry.init()` and structured OpenTelemetry
records are written, one complete OTLP/JSON envelope per line, ready to be
picked up by a log drain. Normal Sentry delivery is left completely untouched.

```ts
import * as Sentry from "@sentry/node";
import { OtlpOut } from "js-otlpout";

const otlp = new OtlpOut({
    serviceName: "my-api",
    serviceNamespace: "my-product",
    deploymentEnvironment: "production",
    extraResourceAttributes: { component: "api" },
});

Sentry.init({
    dsn: "https://…",
    integrations: (defaults) => [...defaults, otlp.integration()],
    beforeSend: otlp.beforeSend, // captured errors/messages
    beforeSendLog: otlp.beforeSendLog, // structured logs
});
```

Everything is configured in code — `js-otlpout` reads **no environment
variables**.

## Sampling independence (and the DSN requirement)

The request span is captured by `otlp.integration()` from the Node HTTP layer's
`httpServerRequest` event, which the SDK emits for **every** inbound request
regardless of `tracesSampleRate`. Access logs therefore survive any sampling
configuration. (`beforeSendSpan` was rejected for this: it only runs for traces
Sentry actually records, so a sampling change would silently drop every record.)

A DSN is still required: without one the SDK never installs the HTTP
integration, so no request is observed. A **placeholder DSN is enough** if the
app does not otherwise use Sentry — the OTLP mirror never needs Sentry to
receive anything.

## Server-side only (and why SPAs are a non-issue)

`js-otlpout` is meant to run in the **SSR / server runtime**. Browser stdout is
not collected, so the library is only wired into the server SDK.

- The OTLP root is the inbound `http.server` request, which ends with the
  response — request-bounded, never a multi-hour span.
- A client-side route change in a SPA (`pageload` / `navigation` spans) is
  emitted by the **browser** SDK and never reaches the server's stdout, so it
  cannot leak into the access logs.
- Instantiating `OtlpOut` only in server-only modules (`hooks.server.ts`, a
  `$lib/server` module, an Express middleware, …) keeps the boundary explicit.

## What gets emitted

| Sentry source                                 | OTLP/JSON payload |
| --------------------------------------------- | ----------------- |
| Every inbound request (`otlp.integration()`)  | `resourceSpans`   |
| Captured error / message                      | `resourceLogs`    |
| Structured `Sentry.logger` logs below `error` | `resourceLogs`    |

Span attributes follow the OpenTelemetry HTTP **server** semantic conventions:
the required `http.request.method`, `url.path` and `url.scheme`; the
conditionally-required `url.query`, `http.response.status_code` and `error.type`
(on a 5xx); the recommended `client.address`, `server.address`/`server.port`
(`Forwarded#host`/`X-Forwarded-Host` preferred), `network.protocol.version` and
`user_agent.original`; and the opt-in request and response headers as
`http.request.header.<name>` / `http.response.header.<name>`, typed as a
single-item string array as the registry requires. The referrer is therefore
`http.request.header.referer`, and `url.full` is the absolute URL with
credentials and the OTel sensitive query parameters redacted. Bespoke spellings
such as `http.request.origin` or `http.request.referrer` are deliberately not
emitted. Mirrored log records use the logger name as the instrumentation scope
name, as the OTel Logs API prescribes.

## Configuration

`new OtlpOut({ … })` accepts, among others:

| Option                    | Meaning                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `serviceName`             | `service.name` resource attribute (required).                  |
| `serviceVersion`          | `service.version` (falls back to the Sentry release).          |
| `serviceNamespace`        | `service.namespace` — the logical grouping, e.g. a product.    |
| `deploymentEnvironment`   | `deployment.environment.name` (falls back to the event's env). |
| `stream`                  | Output stream; defaults to `process.stdout` at write time.     |
| `mirrorLogs`              | Mirror structured logs below `error` (default `true`).         |
| `ipPrecedence`            | Header precedence used to resolve `client.address`.            |
| `extraResourceAttributes` | Non-standard attributes merged into every resource block.      |
| `spanFilter`              | Predicate `op => boolean` selecting emitted spans (HTTP only). |
| `maxLineBytes`            | Per-line budget; oversized records are reduced, then dropped.  |

## Conformance

The test-suite validates **every** emitted payload two ways: it is parsed with
the official OTLP protobuf messages (`protobufjs` + the vendored
`opentelemetry-proto` schemas), and every attribute key is checked against the
official `@opentelemetry/semantic-conventions` registry. Flat, deterministic
payload tests pin the exact output of the transaction, error and log
conversions.

## Development

```bash
pnpm install
make format      # prettier --write (WITH code guidelines)
make lint        # prettier --check + eslint
make typecheck   # tsc --noEmit
make test        # vitest
make build       # tsup (ESM + d.ts)
```
