/**
 * Wire types for the OTLP/JSON payloads emitted by this library.
 *
 * The names and shapes mirror the OpenTelemetry protobuf JSON mapping
 * (`intValue` as a decimal string, `arrayValue`/`kvlistValue` wrappers, …).
 */

export type AnyValue =
    | { stringValue: string }
    | { boolValue: boolean }
    | { intValue: string }
    | { doubleValue: number }
    | { bytesValue: string }
    | { arrayValue: { values: AnyValue[] } }
    | { kvlistValue: { values: KeyValue[] } };

export interface KeyValue {
    key: string;
    value: AnyValue;
}

export interface Resource {
    attributes?: KeyValue[];
}

export interface Scope {
    name?: string;
    version?: string;
}

export interface Status {
    code?: number;
    message?: string;
}

export interface Span {
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

export interface ScopeSpans {
    scope?: Scope;
    spans: Span[];
}

export interface ResourceSpans {
    resource?: Resource;
    scopeSpans: ScopeSpans[];
}

export interface LogRecord {
    timeUnixNano?: string;
    severityNumber?: number;
    severityText?: string;
    body?: AnyValue;
    attributes?: KeyValue[];
    traceId?: string;
    spanId?: string;
}

export interface ScopeLogs {
    scope?: Scope;
    logRecords: LogRecord[];
}

export interface ResourceLogs {
    resource?: Resource;
    scopeLogs: ScopeLogs[];
}

export interface TraceEnvelope {
    resourceSpans: ResourceSpans[];
}

export interface LogEnvelope {
    resourceLogs: ResourceLogs[];
}

export type Envelope = TraceEnvelope | LogEnvelope;
