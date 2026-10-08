/** Hook behaviour and the sampling-independent request integration. */

import { EventEmitter } from "node:events";
import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { OtlpOut } from "../src/integration.js";

class Collector extends Writable {
    readonly lines: string[] = [];

    override _write(
        chunk: Buffer,
        _encoding: string,
        callback: () => void,
    ): void {
        this.lines.push(chunk.toString());
        callback();
    }
}

function fakeResponse(): EventEmitter & {
    statusCode: number;
    getHeaders: () => Record<string, string>;
} {
    const response = new EventEmitter() as EventEmitter & {
        statusCode: number;
        getHeaders: () => Record<string, string>;
    };
    response.statusCode = 200;
    response.getHeaders = () => ({ "content-type": "application/json" });
    return response;
}

describe("OtlpOut request integration", () => {
    it("emits a server span for every request, regardless of sampling", () => {
        const stream = new Collector();
        const otlp = new OtlpOut({ serviceName: "svc", stream });
        // A bare EventEmitter stands in for the Sentry client: the integration
        // never depends on a sampled Sentry span.
        const client = new EventEmitter();

        otlp.integration().setup!(client as never);

        const request = {
            method: "GET",
            url: "/pets/42?q=1",
            httpVersion: "1.1",
            headers: {
                host: "example.com",
                "user-agent": "Mozilla/5.0 (compatible; GPTBot/1.2)",
                "x-forwarded-for": "203.0.113.7, 10.0.0.1",
                referer: "http://ref.example.com/?x=1",
            },
        };
        const response = fakeResponse();
        const normalizedRequest = {
            method: "GET",
            url: "http://example.com/pets/42?q=1",
            headers: request.headers,
        };

        client.emit("httpServerRequest", request, response, normalizedRequest);
        response.emit("finish");

        expect(stream.lines).toHaveLength(1);
        const payload = JSON.parse(stream.lines[0]!);
        const span = payload.resourceSpans[0].scopeSpans[0].spans[0];
        const attrs = Object.fromEntries(
            span.attributes.map((item: any) => [item.key, item.value]),
        );

        expect(span.kind).toBe(2);
        expect(span.name).toBe("GET /pets/42");
        expect(attrs["http.request.method"]).toEqual({ stringValue: "GET" });
        expect(attrs["url.path"]).toEqual({ stringValue: "/pets/42" });
        expect(attrs["client.address"]).toEqual({ stringValue: "203.0.113.7" });
        expect(attrs["network.protocol.version"]).toEqual({
            stringValue: "1.1",
        });
        expect(attrs["http.response.status_code"]).toEqual({
            intValue: "200",
        });
    });

    it("keeps the hooks' inputs unchanged", () => {
        const otlp = new OtlpOut({
            serviceName: "svc",
            stream: new Collector(),
        });

        const event = { level: "error", event_id: "e".repeat(32) };
        expect(otlp.beforeSend(event as any)).toBe(event);

        const log = { level: "warn", message: "hi" };
        expect(otlp.beforeSendLog(log as any)).toBe(log);
    });

    it("mirrors structured logs below error", () => {
        const stream = new Collector();
        const otlp = new OtlpOut({
            serviceName: "svc",
            stream,
            now: () => 1704067200000,
        });

        otlp.beforeSendLog({ level: "warn", message: "kept" } as any);
        otlp.beforeSendLog({ level: "error", message: "dropped" } as any);

        expect(stream.lines).toHaveLength(1);
        expect(stream.lines[0]).toContain("kept");
    });

    it("mirrors captured errors as resourceLogs", () => {
        const stream = new Collector();
        const otlp = new OtlpOut({ serviceName: "svc", stream });

        otlp.beforeSend({
            level: "error",
            event_id: "e".repeat(32),
            message: "boom",
            timestamp: 1704067200,
        } as any);

        expect(stream.lines).toHaveLength(1);
        expect(JSON.parse(stream.lines[0]!)).toHaveProperty("resourceLogs");
    });
});
