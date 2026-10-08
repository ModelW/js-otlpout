import { ErrorEvent, EventHint, TransactionEvent, Log, Integration, Event } from '@sentry/core';
import { Writable } from 'node:stream';

/** The configuration shape shared by the conversion modules. */
interface OtlpOutConfig {
    serviceName: string;
    serviceVersion?: string;
    serviceNamespace?: string;
    deploymentEnvironment?: string;
    extraResourceAttributes: Record<string, unknown>;
    ipPrecedence?: readonly string[];
}

/**
 * Wire types for the OTLP/JSON payloads emitted by this library.
 *
 * The names and shapes mirror the OpenTelemetry protobuf JSON mapping
 * (`intValue` as a decimal string, `arrayValue`/`kvlistValue` wrappers, …).
 */
type AnyValue = {
    stringValue: string;
} | {
    boolValue: boolean;
} | {
    intValue: string;
} | {
    doubleValue: number;
} | {
    bytesValue: string;
} | {
    arrayValue: {
        values: AnyValue[];
    };
} | {
    kvlistValue: {
        values: KeyValue[];
    };
};
interface KeyValue {
    key: string;
    value: AnyValue;
}
interface Resource {
    attributes?: KeyValue[];
}
interface Scope {
    name?: string;
    version?: string;
}
interface Status {
    code?: number;
    message?: string;
}
interface Span {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    name: string;
    kind: number;
    startTimeUnixNano?: string;
    endTimeUnixNano?: string;
    attributes?: KeyValue[];
    status?: Status;
}
interface ScopeSpans {
    scope?: Scope;
    spans: Span[];
}
interface ResourceSpans {
    resource?: Resource;
    scopeSpans: ScopeSpans[];
}
interface LogRecord {
    timeUnixNano?: string;
    severityNumber?: number;
    severityText?: string;
    body?: AnyValue;
    attributes?: KeyValue[];
    traceId?: string;
    spanId?: string;
}
interface ScopeLogs {
    scope?: Scope;
    logRecords: LogRecord[];
}
interface ResourceLogs {
    resource?: Resource;
    scopeLogs: ScopeLogs[];
}
interface TraceEnvelope {
    resourceSpans: ResourceSpans[];
}
interface LogEnvelope {
    resourceLogs: ResourceLogs[];
}
type Envelope = TraceEnvelope | LogEnvelope;

/**
 * Request-span capture from the Node HTTP layer.
 *
 * `beforeSendSpan` (and integration `processSpan`/`processSegmentSpan`) only run
 * for traces Sentry actually records — i.e. with a DSN and a sampled trace — so
 * hanging the access log on it means a sampling change silently drops every
 * `resourceSpans`. Instead this integration subscribes to the client's
 * `httpServerRequest` event, which the Node HTTP integration emits for every
 * inbound request **regardless of trace sampling**, and emits one server span
 * per request.
 *
 * A DSN is still required: without one the SDK never sets up the HTTP
 * integration, so no `httpServerRequest` is emitted.
 */

/** Everything the OTLP server span needs, decoupled from the Sentry types. */
interface ServerRequestInput {
    method: string;
    /** Absolute URL or request target, as Sentry normalised it. */
    url: string;
    headers: Record<string, string | string[] | undefined>;
    /** The HTTP version, e.g. `"1.1"` (from `request.httpVersion`). */
    protocolVersion?: string | undefined;
    statusCode: number;
    responseHeaders?: Record<string, unknown> | undefined;
    startedAt: Date;
    finishedAt: Date;
}

/**
 * Convert Sentry transaction events into OTLP `resourceSpans` payloads.
 *
 * Only the spans selected by the filter are emitted — by default HTTP spans,
 * which in practice means the `http.server` transaction root an access-log
 * consumer needs. Sentry keeps the full span tree, so child spans are not
 * duplicated here (which also keeps records under the container log-line limit).
 */

/** Predicate deciding whether a span (by its Sentry operation) is emitted. */
type SpanFilter = (op: string | undefined) => boolean;
/** Default span filter: keep only HTTP spans (`http.server`/`http.client`). */
declare function keepHttpSpans(op: string | undefined): boolean;

/**
 * The public integration: mirror everything Sentry traces to stdout as
 * line-delimited OTLP/JSON.
 *
 * The JavaScript SDK has no integration hook that can observe finished events,
 * so this class exposes the SDK's `beforeSend` / `beforeSendTransaction` /
 * `beforeSendLog` hooks. They mirror the event and return it unchanged, so
 * normal Sentry delivery is left completely untouched.
 *
 * ```ts
 * import * as Sentry from "@sentry/node";
 * import { OtlpOut } from "js-otlpout";
 *
 * const otlp = new OtlpOut({ serviceName: "my-api", deploymentEnvironment: "production" });
 * Sentry.init({
 *   dsn: "https://…",
 *   beforeSend: otlp.beforeSend,
 *   beforeSendTransaction: otlp.beforeSendTransaction,
 *   beforeSendLog: otlp.beforeSendLog,
 * });
 * ```
 */

/** Default cap on one emitted line (containerd's `max_container_log_line_size`). */
declare const DEFAULT_MAX_LINE_BYTES: number;
interface OtlpOutOptions {
    /** Value of the `service.name` resource attribute (required). */
    serviceName: string;
    /** `service.version`; falls back to the Sentry release. */
    serviceVersion?: string;
    /** `service.namespace`, the logical grouping the service belongs to. */
    serviceNamespace?: string;
    /** `deployment.environment.name`; falls back to the event's environment. */
    deploymentEnvironment?: string;
    /** Where JSON lines are written. Defaults to `process.stdout` at write time. */
    stream?: Writable;
    /** Mirror Sentry structured logs below `error` (default `true`). */
    mirrorLogs?: boolean;
    /** Fraction of records to emit, `0.0`-`1.0`. */
    sampleRate?: number;
    /** Header precedence used to resolve `client.address`. */
    ipPrecedence?: readonly string[];
    /** Extra, non-standard attributes merged into every resource block. */
    extraResourceAttributes?: Record<string, unknown>;
    /** Predicate over a span's operation deciding whether it is emitted. */
    spanFilter?: SpanFilter;
    /** Emitted-line budget; oversized records are reduced, then dropped. */
    maxLineBytes?: number;
    /** Clock, injectable for tests. Defaults to `Date.now`. */
    now?: () => number;
    /** Random source used for sampling, injectable for tests. Defaults to `Math.random`. */
    random?: () => number;
    /** Trace/span id factory for request spans. Defaults to random ids. */
    idFactory?: () => {
        traceId: string;
        spanId: string;
    };
}
declare class OtlpOut implements OtlpOutConfig {
    readonly serviceName: string;
    readonly serviceVersion?: string;
    readonly serviceNamespace?: string;
    readonly deploymentEnvironment?: string;
    readonly extraResourceAttributes: Record<string, unknown>;
    readonly ipPrecedence?: readonly string[];
    readonly spanFilter: SpanFilter;
    readonly now: () => number;
    readonly idFactory: () => {
        traceId: string;
        spanId: string;
    };
    private readonly mirrorLogs;
    private readonly sampleRate;
    private readonly maxLineBytes;
    private readonly random;
    private readonly writer;
    constructor(options: OtlpOutOptions);
    /** `beforeSend` hook: mirror a captured error/message, return it unchanged. */
    readonly beforeSend: (event: ErrorEvent, _hint?: EventHint) => ErrorEvent;
    /** `beforeSendTransaction` hook: mirror a transaction, return it unchanged. */
    readonly beforeSendTransaction: (event: TransactionEvent, _hint?: EventHint) => TransactionEvent;
    /** `beforeSendLog` hook: mirror a structured log, return it unchanged. */
    readonly beforeSendLog: (log: Log) => Log;
    /**
     * The Sentry integration that mirrors every inbound request as an OTLP
     * server span, independent of `tracesSampleRate`. Add it to
     * `Sentry.init({ integrations: (defaults) => [...defaults, otlp.integration()] })`.
     */
    integration(): Integration;
    /** Emit one inbound server request as a `resourceSpans` line. */
    emitRequest(input: ServerRequestInput): void;
    /** Convert one Sentry event into an OTLP/JSON line when relevant. */
    processEvent(event: Event): void;
    /** Mirror a Sentry structured log when it passes the configured filters. */
    processLog(log: Log): void;
    private emit;
}

export { type AnyValue, DEFAULT_MAX_LINE_BYTES, type Envelope, type KeyValue, type LogEnvelope, type LogRecord, OtlpOut, type OtlpOutOptions, type Resource, type ResourceLogs, type ResourceSpans, type Scope, type ScopeLogs, type ScopeSpans, type Span, type SpanFilter, type Status, type TraceEnvelope, keepHttpSpans };
