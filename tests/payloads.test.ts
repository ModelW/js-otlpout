/**
 * Exact, flat payload tests.
 *
 * Each test feeds one deterministic input through the conversion and compares
 * the *entire* output payload to a literal expected payload. Every input and
 * output is written out in full below.
 */

import { describe, expect, it } from "vitest";

import { OtlpOut } from "../src/integration.js";
import { eventToOtlp, logToOtlp } from "../src/logs.js";
import { serverRequestToOtlp } from "../src/server.js";
import { transactionToOtlp } from "../src/spans.js";

const ADAPTER = new OtlpOut({
    serviceName: "test-service",
    serviceNamespace: "tests",
    deploymentEnvironment: "test",
    extraResourceAttributes: { component: "unit" },
    now: () => 1704067200000,
    idFactory: () => ({ traceId: "a".repeat(32), spanId: "b".repeat(16) }),
});

// --------------------------------------------------------------------------- //
// Transaction
// --------------------------------------------------------------------------- //

const TRANSACTION_INPUT = {
    type: "transaction",
    transaction: "GET /pets/1",
    start_timestamp: 1704067200,
    timestamp: 1704067201,
    contexts: {
        trace: {
            trace_id: "a".repeat(32),
            span_id: "b".repeat(16),
            op: "http.server",
            origin: "auto.http.fastify",
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
        url: "http://example.com/pets/1?q=1#frag",
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

const TRANSACTION_OUTPUT = {
    resourceSpans: [
        {
            resource: {
                attributes: [
                    {
                        key: "service.name",
                        value: { stringValue: "test-service" },
                    },
                    {
                        key: "service.namespace",
                        value: { stringValue: "tests" },
                    },
                    {
                        key: "deployment.environment.name",
                        value: { stringValue: "test" },
                    },
                    {
                        key: "telemetry.sdk.name",
                        value: { stringValue: "sentry" },
                    },
                    {
                        key: "telemetry.sdk.language",
                        value: { stringValue: "javascript" },
                    },
                    {
                        key: "telemetry.sdk.version",
                        value: { stringValue: "10.0.0" },
                    },
                    { key: "host.name", value: { stringValue: "test-host" } },
                    { key: "component", value: { stringValue: "unit" } },
                ],
            },
            scopeSpans: [
                {
                    scope: { name: "sentry.transaction" },
                    spans: [
                        {
                            traceId: "a".repeat(32),
                            spanId: "b".repeat(16),
                            name: "GET /pets/1",
                            kind: 2,
                            startTimeUnixNano: "1704067200000000000",
                            endTimeUnixNano: "1704067201000000000",
                            attributes: [
                                {
                                    key: "sentry.op",
                                    value: { stringValue: "http.server" },
                                },
                                {
                                    key: "sentry.origin",
                                    value: { stringValue: "auto.http.fastify" },
                                },
                                {
                                    key: "http.method",
                                    value: { stringValue: "GET" },
                                },
                                {
                                    key: "url.full",
                                    value: {
                                        stringValue:
                                            "http://example.com/pets/1?q=1#frag",
                                    },
                                },
                                {
                                    key: "url.path",
                                    value: { stringValue: "/pets/1" },
                                },
                                {
                                    key: "url.query",
                                    value: { stringValue: "q=1" },
                                },
                                {
                                    key: "url.scheme",
                                    value: { stringValue: "http" },
                                },
                                {
                                    key: "server.address",
                                    value: { stringValue: "example.com" },
                                },
                                {
                                    key: "http.request.method",
                                    value: { stringValue: "GET" },
                                },
                                {
                                    key: "user_agent.original",
                                    value: {
                                        stringValue:
                                            "Mozilla/5.0 (compatible; GPTBot/1.2)",
                                    },
                                },
                                {
                                    key: "http.request.header.referer",
                                    value: {
                                        arrayValue: {
                                            values: [
                                                {
                                                    stringValue:
                                                        "http://ref.example.com/?x=1",
                                                },
                                            ],
                                        },
                                    },
                                },
                                {
                                    key: "http.request.header.x-forwarded-for",
                                    value: {
                                        arrayValue: {
                                            values: [
                                                {
                                                    stringValue:
                                                        "203.0.113.7, 10.0.0.1",
                                                },
                                            ],
                                        },
                                    },
                                },
                                {
                                    key: "http.response.status_code",
                                    value: { intValue: "200" },
                                },
                                {
                                    key: "http.response.body.size",
                                    value: { intValue: "42" },
                                },
                                {
                                    key: "http.response.header.content-type",
                                    value: {
                                        arrayValue: {
                                            values: [
                                                {
                                                    stringValue:
                                                        "application/json",
                                                },
                                            ],
                                        },
                                    },
                                },
                                {
                                    key: "client.address",
                                    value: { stringValue: "203.0.113.7" },
                                },
                                {
                                    key: "sentry.transaction",
                                    value: { stringValue: "GET /pets/1" },
                                },
                            ],
                            status: { code: 1 },
                        },
                    ],
                },
            ],
        },
    ],
};

// --------------------------------------------------------------------------- //
// Captured error
// --------------------------------------------------------------------------- //

const ERROR_INPUT = {
    level: "error",
    event_id: "e".repeat(32),
    timestamp: 1704067200,
    contexts: {
        trace: { trace_id: "a".repeat(32), span_id: "b".repeat(16) },
    },
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

const ERROR_OUTPUT = {
    resourceLogs: [
        {
            resource: {
                attributes: [
                    {
                        key: "service.name",
                        value: { stringValue: "test-service" },
                    },
                    {
                        key: "service.namespace",
                        value: { stringValue: "tests" },
                    },
                    {
                        key: "deployment.environment.name",
                        value: { stringValue: "test" },
                    },
                    {
                        key: "telemetry.sdk.name",
                        value: { stringValue: "sentry" },
                    },
                    {
                        key: "telemetry.sdk.language",
                        value: { stringValue: "javascript" },
                    },
                    {
                        key: "telemetry.sdk.version",
                        value: { stringValue: "10.0.0" },
                    },
                    { key: "component", value: { stringValue: "unit" } },
                ],
            },
            scopeLogs: [
                {
                    scope: { name: "sentry.event" },
                    logRecords: [
                        {
                            timeUnixNano: "1704067200000000000",
                            severityNumber: 17,
                            severityText: "ERROR",
                            body: { stringValue: "TypeError: boom" },
                            attributes: [
                                {
                                    key: "sentry.event_id",
                                    value: { stringValue: "e".repeat(32) },
                                },
                                {
                                    key: "exception.type",
                                    value: { stringValue: "TypeError" },
                                },
                                {
                                    key: "exception.message",
                                    value: { stringValue: "boom" },
                                },
                                {
                                    key: "exception.stacktrace",
                                    value: { stringValue: "app.ts:12 in run" },
                                },
                                {
                                    key: "environment",
                                    value: { stringValue: "production" },
                                },
                            ],
                            traceId: "a".repeat(32),
                            spanId: "b".repeat(16),
                        },
                    ],
                },
            ],
        },
    ],
};

// --------------------------------------------------------------------------- //
// Structured log
// --------------------------------------------------------------------------- //

const LOG_INPUT = {
    level: "warn",
    message: "hi bob",
    attributes: {
        "code.file.path": "app.ts",
        "code.line.number": 10,
        "thread.id": "123",
        "process.pid": 456,
    },
};

const LOG_OUTPUT = {
    resourceLogs: [
        {
            resource: {
                attributes: [
                    {
                        key: "service.name",
                        value: { stringValue: "test-service" },
                    },
                    {
                        key: "service.namespace",
                        value: { stringValue: "tests" },
                    },
                    {
                        key: "deployment.environment.name",
                        value: { stringValue: "test" },
                    },
                    {
                        key: "telemetry.sdk.name",
                        value: { stringValue: "sentry" },
                    },
                    {
                        key: "telemetry.sdk.language",
                        value: { stringValue: "javascript" },
                    },
                    { key: "component", value: { stringValue: "unit" } },
                ],
            },
            scopeLogs: [
                {
                    scope: { name: "sentry.log" },
                    logRecords: [
                        {
                            timeUnixNano: "1704067200000000000",
                            severityNumber: 13,
                            severityText: "WARN",
                            body: { stringValue: "hi bob" },
                            attributes: [
                                {
                                    key: "code.file.path",
                                    value: { stringValue: "app.ts" },
                                },
                                {
                                    key: "code.line.number",
                                    value: { intValue: "10" },
                                },
                                {
                                    key: "thread.id",
                                    value: { intValue: "123" },
                                },
                                {
                                    key: "process.pid",
                                    value: { intValue: "456" },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
};

// --------------------------------------------------------------------------- //
// Inbound server request (httpServerRequest integration)
// --------------------------------------------------------------------------- //

const SERVER_REQUEST = {
    method: "GET",
    url: "http://user:pass@example.com/pets/1?q=1&sig=abc#frag",
    headers: {
        "user-agent": "Mozilla/5.0 (compatible; GPTBot/1.2)",
        referer: "http://ref.example.com/?x=1",
        "x-forwarded-for": "203.0.113.7, 10.0.0.1",
    },
    protocolVersion: "1.1",
    statusCode: 200,
    responseHeaders: { "content-type": "application/json" },
    startedAt: new Date(1704067200000),
    finishedAt: new Date(1704067201000),
};

const SERVER_OUTPUT = {
    resourceSpans: [
        {
            resource: {
                attributes: [
                    {
                        key: "service.name",
                        value: { stringValue: "test-service" },
                    },
                    {
                        key: "service.namespace",
                        value: { stringValue: "tests" },
                    },
                    {
                        key: "deployment.environment.name",
                        value: { stringValue: "test" },
                    },
                    {
                        key: "telemetry.sdk.name",
                        value: { stringValue: "sentry" },
                    },
                    {
                        key: "telemetry.sdk.language",
                        value: { stringValue: "javascript" },
                    },
                    { key: "component", value: { stringValue: "unit" } },
                ],
            },
            scopeSpans: [
                {
                    scope: { name: "sentry.transaction" },
                    spans: [
                        {
                            traceId: "a".repeat(32),
                            spanId: "b".repeat(16),
                            name: "GET /pets/1",
                            kind: 2,
                            startTimeUnixNano: "1704067200000000000",
                            endTimeUnixNano: "1704067201000000000",
                            attributes: [
                                {
                                    key: "url.full",
                                    value: {
                                        stringValue:
                                            "http://REDACTED:REDACTED@example.com/pets/1?q=1&sig=REDACTED#frag",
                                    },
                                },
                                {
                                    key: "url.path",
                                    value: { stringValue: "/pets/1" },
                                },
                                {
                                    key: "url.query",
                                    value: { stringValue: "q=1&sig=REDACTED" },
                                },
                                {
                                    key: "url.scheme",
                                    value: { stringValue: "http" },
                                },
                                {
                                    key: "server.address",
                                    value: { stringValue: "example.com" },
                                },
                                {
                                    key: "http.request.method",
                                    value: { stringValue: "GET" },
                                },
                                {
                                    key: "user_agent.original",
                                    value: {
                                        stringValue:
                                            "Mozilla/5.0 (compatible; GPTBot/1.2)",
                                    },
                                },
                                {
                                    key: "http.request.header.referer",
                                    value: {
                                        arrayValue: {
                                            values: [
                                                {
                                                    stringValue:
                                                        "http://ref.example.com/?x=1",
                                                },
                                            ],
                                        },
                                    },
                                },
                                {
                                    key: "http.request.header.x-forwarded-for",
                                    value: {
                                        arrayValue: {
                                            values: [
                                                {
                                                    stringValue:
                                                        "203.0.113.7, 10.0.0.1",
                                                },
                                            ],
                                        },
                                    },
                                },
                                {
                                    key: "http.response.status_code",
                                    value: { intValue: "200" },
                                },
                                {
                                    key: "http.response.header.content-type",
                                    value: {
                                        arrayValue: {
                                            values: [
                                                {
                                                    stringValue:
                                                        "application/json",
                                                },
                                            ],
                                        },
                                    },
                                },
                                {
                                    key: "client.address",
                                    value: { stringValue: "203.0.113.7" },
                                },
                                {
                                    key: "network.protocol.version",
                                    value: { stringValue: "1.1" },
                                },
                                {
                                    key: "sentry.op",
                                    value: { stringValue: "http.server" },
                                },
                            ],
                            status: { code: 1 },
                        },
                    ],
                },
            ],
        },
    ],
};

describe("exact payloads", () => {
    it("converts an inbound server request exactly", () => {
        const output = serverRequestToOtlp(SERVER_REQUEST, ADAPTER);
        expect(output).toEqual(SERVER_OUTPUT);
    });

    it("converts a transaction exactly", () => {
        const output = transactionToOtlp(TRANSACTION_INPUT as any, ADAPTER);
        expect(output).toEqual(TRANSACTION_OUTPUT);
    });
    it("converts a captured error exactly", () => {
        const output = eventToOtlp(ERROR_INPUT as any, ADAPTER);
        expect(output).toEqual(ERROR_OUTPUT);
    });

    it("converts a structured log exactly", () => {
        const output = logToOtlp(LOG_INPUT as any, ADAPTER);
        expect(output).toEqual(LOG_OUTPUT);
    });
});
