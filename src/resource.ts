/** Build OTLP `resource` blocks from the adapter configuration and event metadata. */

import type { Event } from "@sentry/core";

import { attributes } from "./attributes.js";
import type { OtlpOutConfig } from "./config.js";
import type { Resource } from "./otlp.js";

/**
 * Return the OTLP `resource` shared by every record of an event.
 *
 * The named attributes follow the OpenTelemetry resource semantic conventions.
 * Configuration wins over event metadata; anything outside the standard
 * vocabulary is supplied through `extraResourceAttributes` and merged last, so a
 * caller can override a convention value if they really mean to.
 */
export function buildResource(config: OtlpOutConfig, event?: Event): Resource {
    const values: Record<string, unknown> = {
        "service.name": config.serviceName,
        "service.namespace": config.serviceNamespace,
        "service.version": config.serviceVersion ?? event?.release,
        "deployment.environment.name":
            config.deploymentEnvironment ?? event?.environment,
        "telemetry.sdk.name": "sentry",
        "telemetry.sdk.language": "javascript",
        "telemetry.sdk.version": event?.sdk?.version,
        "host.name": event?.server_name,
    };
    Object.assign(values, config.extraResourceAttributes);
    return { attributes: attributes(values) };
}
