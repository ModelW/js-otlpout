/**
 * Wire js-otlpout into Sentry for the toy SvelteKit app.
 *
 * The request span is captured by `otlp.integration()` (the `httpServerRequest`
 * event), so it is emitted for every request **regardless of Sentry's trace
 * sampling** — the point of the e2e test, which runs with `tracesSampleRate: 0`.
 */

import { handleErrorWithSentry, sentryHandle } from "@sentry/sveltekit";
import * as Sentry from "@sentry/sveltekit";
import { sequence } from "@sveltejs/kit/hooks";
import { OtlpOut } from "js-otlpout";

const otlp = new OtlpOut({
    serviceName: "pet-sveltekit",
    serviceNamespace: "pets",
    deploymentEnvironment: "local",
});

Sentry.init({
    // A DSN is required for the Node HTTP integration to run. A placeholder is
    // enough: the OTLP mirror never needs Sentry to actually receive anything.
    dsn: process.env.SENTRY_DSN ?? "https://public@example.invalid/1",
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0"),
    integrations: (defaults) => [...defaults, otlp.integration()],
    beforeSend: otlp.beforeSend,
    beforeSendLog: otlp.beforeSendLog,
});

export const handle = sequence(sentryHandle());
export const handleError = handleErrorWithSentry();
