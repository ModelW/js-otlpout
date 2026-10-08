/** The configuration shape shared by the conversion modules. */

export interface OtlpOutConfig {
    serviceName: string;
    serviceVersion?: string;
    serviceNamespace?: string;
    deploymentEnvironment?: string;
    extraResourceAttributes: Record<string, unknown>;
    ipPrecedence?: readonly string[];
}
