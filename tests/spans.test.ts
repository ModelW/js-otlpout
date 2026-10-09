/**
 * KFF-269 regression: only HTTP spans leave the exporter.
 *
 * The access-log pipeline only consumes `http.server` request spans. Database,
 * template, queue and other internal spans must never reach stdout — they are
 * already in Sentry, and shipping them both wastes volume and pushes records
 * past the container log-line limit (which truncates them into invalid JSON).
 */

import { describe, expect, it } from "vitest";

import { OtlpOut } from "../src/integration.js";
import { keepHttpSpans, transactionToOtlp } from "../src/spans.js";

const ADAPTER = new OtlpOut({ serviceName: "test-service" });

/** Build a minimal transaction with a root op and a list of child ops. */
function transaction(rootOp: string, childOps: string[]) {
    return {
        type: "transaction",
        transaction: "GET /pets/1",
        start_timestamp: 1704067200,
        timestamp: 1704067201,
        contexts: {
            trace: {
                trace_id: "a".repeat(32),
                span_id: "b".repeat(16),
                op: rootOp,
            },
        },
        spans: childOps.map((op, index) => ({
            trace_id: "a".repeat(32),
            span_id: String(index).repeat(16),
            parent_span_id: "b".repeat(16),
            op,
            description: op,
            start_timestamp: 1704067200,
            timestamp: 1704067201,
        })),
    };
}

describe("HTTP-only span filtering (KFF-269)", () => {
    it("keeps an http.server root and drops non-HTTP children", () => {
        const output = transactionToOtlp(
            transaction("http.server", ["db", "template.render"]) as never,
            ADAPTER,
        );

        const scopes = output!.resourceSpans[0]!.scopeSpans;
        expect(scopes.map((entry) => entry.scope?.name)).toEqual([
            "sentry.transaction",
        ]);
        expect(scopes[0]!.spans).toHaveLength(1);
    });

    it("keeps HTTP client children but still drops the rest", () => {
        const output = transactionToOtlp(
            transaction("http.server", ["db", "http.client"]) as never,
            ADAPTER,
        );

        const scopes = output!.resourceSpans[0]!.scopeSpans;
        expect(scopes.map((entry) => entry.scope?.name)).toEqual([
            "sentry.transaction",
            "sentry.span",
        ]);
        expect(scopes[1]!.spans).toHaveLength(1);
        expect(scopes[1]!.spans[0]!.name).toBe("http.client");
    });

    it("drops a transaction with no HTTP span at all", () => {
        const output = transactionToOtlp(
            transaction("queue.task.celery", ["db"]) as never,
            ADAPTER,
        );

        expect(output).toBeUndefined();
    });

    it("recognises only http* operations", () => {
        expect(keepHttpSpans("http.server")).toBe(true);
        expect(keepHttpSpans("http.client")).toBe(true);
        expect(keepHttpSpans("db")).toBe(false);
        expect(keepHttpSpans("queue.task.celery")).toBe(false);
        expect(keepHttpSpans(undefined)).toBe(false);
    });
});
