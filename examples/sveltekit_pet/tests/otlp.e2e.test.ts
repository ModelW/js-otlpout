/**
 * End-to-end test: a real SvelteKit SSR request produces OTLP/JSON on stdout.
 *
 * The app is built with `@sveltejs/adapter-node`, its `handler` is served in
 * this process, and `process.stdout` is captured while a real request is made.
 *
 * The app runs with `tracesSampleRate: 0` (and a placeholder DSN), proving the
 * request span does **not** depend on Sentry sampling.
 */

import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const WORKSPACE = path.resolve(ROOT, "../..");

let server: Server;
let port: number;

interface Envelope {
    resourceSpans?: any[];
    resourceLogs?: any[];
}

function textValue(value: any): any {
    return (
        value?.stringValue ?? value?.intValue ?? value?.boolValue ?? undefined
    );
}

beforeAll(async () => {
    execFileSync("pnpm", ["--filter", "js-otlpout", "build"], {
        cwd: WORKSPACE,
        stdio: "inherit",
    });
    execFileSync("pnpm", ["build"], { cwd: ROOT, stdio: "inherit" });

    const { handler } = await import(path.join(ROOT, "build/handler.js"));
    server = createServer(handler);
    await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
    );
    port = (server.address() as { port: number }).port;
}, 600_000);

afterAll(async () => {
    if (server) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});

describe("SvelteKit SSR request", () => {
    it("emits an OTLP server span even with tracesSampleRate 0", async () => {
        const captured: string[] = [];
        const original = process.stdout.write.bind(process.stdout);
        process.stdout.write = ((chunk: string | Uint8Array) => {
            captured.push(chunk.toString());
            return true;
        }) as typeof process.stdout.write;

        try {
            const response = await fetch(
                `http://127.0.0.1:${port}/pets/42?q=1`,
                {
                    headers: {
                        "x-forwarded-for": "203.0.113.7, 10.0.0.1",
                        "user-agent": "Mozilla/5.0 (compatible; GPTBot/1.2)",
                    },
                },
            );
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ id: "42", name: "Rex" });
            await new Promise((resolve) => setTimeout(resolve, 300));
        } finally {
            process.stdout.write = original;
        }

        const envelopes: Envelope[] = captured
            .join("")
            .split("\n")
            .filter(Boolean)
            .flatMap((line) => {
                try {
                    return [JSON.parse(line) as Envelope];
                } catch {
                    return [];
                }
            });

        const trace = envelopes.find((envelope) => envelope.resourceSpans);
        expect(
            trace,
            "a resourceSpans envelope should have been emitted",
        ).toBeDefined();

        const span = trace!.resourceSpans![0].scopeSpans[0].spans[0];
        const attrs = Object.fromEntries(
            span.attributes.map((item: any) => [
                item.key,
                textValue(item.value),
            ]),
        );
        expect(attrs["http.request.method"]).toBe("GET");
        expect(attrs["url.path"]).toBe("/pets/42");
        expect(attrs["client.address"]).toBe("203.0.113.7");
        expect(attrs["user_agent.original"]).toBe(
            "Mozilla/5.0 (compatible; GPTBot/1.2)",
        );
        expect(attrs["http.response.status_code"]).toBe("200");

        const log = envelopes.find((envelope) => envelope.resourceLogs);
        expect(
            log,
            "a resourceLogs envelope should have been emitted",
        ).toBeDefined();
        expect(JSON.stringify(log)).toContain("fetching pet");
    });
});
