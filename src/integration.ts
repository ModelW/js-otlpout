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

import type {
    ErrorEvent,
    Event,
    EventHint,
    Integration,
    Log,
    TransactionEvent,
} from "@sentry/core";
import type { Writable } from "node:stream";

import type { OtlpOutConfig } from "./config.js";
import { LineWriter, dumps } from "./json.js";
import {
    DENIED_LOG_LEVELS,
    eventToOtlp,
    logToOtlp,
    reduceLogEnvelope,
} from "./logs.js";
import type { Envelope } from "./otlp.js";
import {
    otlpOutIntegration,
    randomIds,
    serverRequestToOtlp,
    type ServerRequestInput,
} from "./server.js";
import {
    keepHttpSpans,
    reduceEnvelope,
    transactionToOtlp,
    type SpanFilter,
} from "./spans.js";

/** Default cap on one emitted line (containerd's `max_container_log_line_size`). */
export const DEFAULT_MAX_LINE_BYTES = 16 * 1024;

export interface OtlpOutOptions {
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
    idFactory?: () => { traceId: string; spanId: string };
}

export class OtlpOut implements OtlpOutConfig {
    readonly serviceName: string;
    readonly serviceVersion?: string;
    readonly serviceNamespace?: string;
    readonly deploymentEnvironment?: string;
    readonly extraResourceAttributes: Record<string, unknown>;
    readonly ipPrecedence?: readonly string[];
    readonly spanFilter: SpanFilter;
    readonly now: () => number;
    readonly idFactory: () => { traceId: string; spanId: string };

    private readonly mirrorLogs: boolean;
    private readonly sampleRate: number;
    private readonly maxLineBytes: number;
    private readonly random: () => number;
    private readonly writer: LineWriter;

    constructor(options: OtlpOutOptions) {
        if (!options.serviceName) {
            throw new Error("OtlpOut requires a serviceName");
        }
        this.serviceName = options.serviceName;
        this.serviceVersion = options.serviceVersion;
        this.serviceNamespace = options.serviceNamespace;
        this.deploymentEnvironment = options.deploymentEnvironment;
        this.extraResourceAttributes = options.extraResourceAttributes ?? {};
        this.ipPrecedence = options.ipPrecedence;
        this.spanFilter = options.spanFilter ?? keepHttpSpans;
        this.mirrorLogs = options.mirrorLogs ?? true;
        this.sampleRate = options.sampleRate ?? 1;
        this.maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
        this.now = options.now ?? Date.now;
        this.random = options.random ?? Math.random;
        this.idFactory = options.idFactory ?? randomIds;
        this.writer = new LineWriter(options.stream);
    }

    /** `beforeSend` hook: mirror a captured error/message, return it unchanged. */
    readonly beforeSend = (
        event: ErrorEvent,
        _hint?: EventHint,
    ): ErrorEvent => {
        this.processEvent(event);
        return event;
    };

    /** `beforeSendTransaction` hook: mirror a transaction, return it unchanged. */
    readonly beforeSendTransaction = (
        event: TransactionEvent,
        _hint?: EventHint,
    ): TransactionEvent => {
        this.processEvent(event);
        return event;
    };

    /** `beforeSendLog` hook: mirror a structured log, return it unchanged. */
    readonly beforeSendLog = (log: Log): Log => {
        this.processLog(log);
        return log;
    };

    /**
     * The Sentry integration that mirrors every inbound request as an OTLP
     * server span, independent of `tracesSampleRate`. Add it to
     * `Sentry.init({ integrations: (defaults) => [...defaults, otlp.integration()] })`.
     */
    integration(): Integration {
        return otlpOutIntegration(this);
    }

    /** Emit one inbound server request as a `resourceSpans` line. */
    emitRequest(input: ServerRequestInput): void {
        this.emit(serverRequestToOtlp(input, this));
    }

    /** Convert one Sentry event into an OTLP/JSON line when relevant. */
    processEvent(event: Event): void {
        if (event.type === "transaction") {
            this.emit(transactionToOtlp(event as TransactionEvent, this));
        } else {
            this.emit(eventToOtlp(event, this));
        }
    }

    /** Mirror a Sentry structured log when it passes the configured filters. */
    processLog(log: Log): void {
        if (
            !this.mirrorLogs ||
            DENIED_LOG_LEVELS.has(String(log.level).toLowerCase())
        ) {
            return;
        }
        this.emit(logToOtlp(log, this));
    }

    private emit(envelope: Envelope | undefined): void {
        if (!envelope) {
            return;
        }
        if (this.sampleRate < 1 && this.random() >= this.sampleRate) {
            return;
        }

        let line = dumps(envelope);
        if (Buffer.byteLength(line, "utf8") > this.maxLineBytes) {
            line = dumps(
                "resourceSpans" in envelope
                    ? reduceEnvelope(envelope)
                    : reduceLogEnvelope(envelope),
            );
            if (Buffer.byteLength(line, "utf8") > this.maxLineBytes) {
                return;
            }
        }
        this.writer.writeLine(line);
    }
}
