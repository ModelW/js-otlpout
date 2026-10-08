/**
 * Hard, third-party conformance verification.
 *
 * Every emitted payload is validated two ways: it is parsed with the official
 * OTLP protobuf messages (via `protobufjs` and the vendored `opentelemetry-
 * proto` schemas), and every attribute key is checked against the official
 * `@opentelemetry/semantic-conventions` registry.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";

import * as semconv from "@opentelemetry/semantic-conventions";
import protobuf from "protobufjs";
import { describe, expect, it } from "vitest";

import { OtlpOut } from "../src/integration.js";
import { eventToOtlp, logToOtlp } from "../src/logs.js";
import { transactionToOtlp } from "../src/spans.js";
import { serverRequestToOtlp } from "../src/server.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROTO_ROOT = path.join(here, "proto");

const root = new protobuf.Root();
root.resolvePath = (_origin, target) => path.join(PROTO_ROOT, target);
root.loadSync([
    "opentelemetry/proto/collector/trace/v1/trace_service.proto",
    "opentelemetry/proto/collector/logs/v1/logs_service.proto",
]);

const TraceRequest = root.lookupType(
    "opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest",
);
const LogsRequest = root.lookupType(
    "opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest",
);

/** Parse an OTLP/JSON trace payload with the official protobuf schema. */
function parseTrace(envelope: unknown): number {
    const message = TraceRequest.fromObject(envelope as { [k: string]: any });
    const bytes = TraceRequest.encode(message).finish();
    const decoded = TraceRequest.decode(bytes) as any;
    expect(decoded.resourceSpans.length).toBeGreaterThan(0);
    return bytes.length;
}

/** Parse an OTLP/JSON logs payload with the official protobuf schema. */
function parseLogs(envelope: unknown): number {
    const message = LogsRequest.fromObject(envelope as { [k: string]: any });
    const bytes = LogsRequest.encode(message).finish();
    const decoded = LogsRequest.decode(bytes) as any;
    expect(decoded.resourceLogs.length).toBeGreaterThan(0);
    return bytes.length;
}

const REGISTERED = new Set<string>();
for (const value of Object.values(semconv) as unknown[]) {
    if (typeof value === "string") {
        REGISTERED.add(value);
    }
}

const TEMPLATES = ["http.request.header.", "http.response.header."];
const CUSTOM_PREFIXES = ["sentry."];
const ALLOWED_CUSTOM = new Set([
    "http.method",
    "component",
    "environment",
    // Development attributes not (yet) exported by the npm registry package.
    "http.request.body.size",
    "http.response.body.size",
]);

function attributeKeys(envelope: any): string[] {
    const keys: string[] = [];
    const collect = (attributes: any): void => {
        for (const attribute of attributes ?? []) {
            keys.push(attribute.key);
        }
    };
    for (const resourceSpans of envelope.resourceSpans ?? []) {
        collect(resourceSpans.resource?.attributes);
        for (const scopeSpans of resourceSpans.scopeSpans ?? []) {
            for (const span of scopeSpans.spans ?? []) {
                collect(span.attributes);
            }
        }
    }
    for (const resourceLogs of envelope.resourceLogs ?? []) {
        collect(resourceLogs.resource?.attributes);
        for (const scopeLogs of resourceLogs.scopeLogs ?? []) {
            for (const record of scopeLogs.logRecords ?? []) {
                collect(record.attributes);
            }
        }
    }
    return keys;
}

function assertRegisteredKeys(envelope: any): void {
    for (const key of attributeKeys(envelope)) {
        if (REGISTERED.has(key) || ALLOWED_CUSTOM.has(key)) {
            continue;
        }
        if (CUSTOM_PREFIXES.some((prefix) => key.startsWith(prefix))) {
            continue;
        }
        if (TEMPLATES.some((prefix) => key.startsWith(prefix))) {
            continue;
        }
        throw new Error(`${key} is not a registered OpenTelemetry attribute`);
    }
}

const ADAPTER = new OtlpOut({
    serviceName: "test-service",
    serviceNamespace: "tests",
    deploymentEnvironment: "test",
    extraResourceAttributes: { component: "unit" },
    now: () => 1704067200000,
});

const TRANSACTION = {
    type: "transaction",
    transaction: "GET /pets/1",
    start_timestamp: 1704067200,
    timestamp: 1704067201,
    contexts: {
        trace: {
            trace_id: "a".repeat(32),
            span_id: "b".repeat(16),
            op: "http.server",
            status: "ok",
            data: {},
        },
        response: {
            status_code: 200,
            body_size: 42,
            headers: { "content-type": "application/json" },
        },
    },
    tags: { "http.method": "GET" },
    request: {
        url: "http://user:pass@example.com/pets/1?q=1&sig=abc#frag",
        method: "GET",
        headers: {
            referer: "http://ref.example.com/?x=1",
            "user-agent": "Mozilla/5.0 (compatible; GPTBot/1.2)",
            "x-forwarded-for": "203.0.113.7, 10.0.0.1",
        },
    },
    sdk: { name: "sentry.javascript.node", version: "10.0.0" },
    server_name: "test-host",
    environment: "production",
};

const ERROR = {
    level: "error",
    event_id: "e".repeat(32),
    timestamp: 1704067200,
    contexts: { trace: { trace_id: "a".repeat(32), span_id: "b".repeat(16) } },
    exception: {
        values: [
            {
                type: "TypeError",
                value: "boom",
                stacktrace: {
                    frames: [
                        { filename: "app.ts", lineno: 12, function: "run" },
                    ],
                },
            },
        ],
    },
    tags: { environment: "production" },
    sdk: { name: "sentry.javascript.node", version: "10.0.0" },
};

const LOG = {
    level: "warn",
    message: "hi bob",
    attributes: {
        "code.file.path": "app.ts",
        "code.line.number": 10,
        "thread.id": "123",
    },
};

const SERVER_REQUEST = {
    method: "GET",
    url: "http://user:pass@example.com/pets/1?q=1&sig=abc#frag",
    headers: {
        referer: "http://ref.example.com/?x=1",
        "user-agent": "Mozilla/5.0 (compatible; GPTBot/1.2)",
        "x-forwarded-for": "203.0.113.7, 10.0.0.1",
    },
    protocolVersion: "1.1",
    statusCode: 200,
    responseHeaders: { "content-type": "application/json" },
    startedAt: new Date(1704067200000),
    finishedAt: new Date(1704067201000),
};

describe("third-party conformance", () => {
    it("parses every payload with the official OTLP protobuf messages", () => {
        const trace = transactionToOtlp(TRANSACTION as any, ADAPTER);
        expect(parseTrace(trace)).toBeGreaterThan(0);

        const error = eventToOtlp(ERROR as any, ADAPTER);
        expect(parseLogs(error)).toBeGreaterThan(0);

        const log = logToOtlp(LOG as any, ADAPTER);
        expect(parseLogs(log)).toBeGreaterThan(0);

        const streamed = serverRequestToOtlp(SERVER_REQUEST, ADAPTER);
        expect(parseTrace(streamed)).toBeGreaterThan(0);
    });

    it("only emits registered semantic-convention attribute keys", () => {
        assertRegisteredKeys(transactionToOtlp(TRANSACTION as any, ADAPTER));
        assertRegisteredKeys(eventToOtlp(ERROR as any, ADAPTER));
        assertRegisteredKeys(logToOtlp(LOG as any, ADAPTER));
        assertRegisteredKeys(serverRequestToOtlp(SERVER_REQUEST, ADAPTER));
    });

    it("redacts credentials and keeps url.full absolute", () => {
        const trace = transactionToOtlp(TRANSACTION as any, ADAPTER);
        const span = trace!.resourceSpans[0]!.scopeSpans[0]!.spans[0]!;
        const attrs = Object.fromEntries(
            (span.attributes ?? []).map((item) => [item.key, item.value]),
        );

        const full = attrs["url.full"] as { stringValue: string };
        expect(full.stringValue).toBe(
            "http://REDACTED:REDACTED@example.com/pets/1?q=1&sig=REDACTED#frag",
        );
        expect(() => new URL(full.stringValue)).not.toThrow();
        const query = attrs["url.query"] as { stringValue: string };
        expect(query.stringValue).toBe("q=1&sig=REDACTED");
    });
});
