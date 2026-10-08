// src/json.ts
function dumps(value) {
  return JSON.stringify(value);
}
var LineWriter = class {
  stream;
  constructor(stream) {
    this.stream = stream;
  }
  /** Write one line, terminating it with a newline. */
  writeLine(line) {
    const target = this.stream ?? process.stdout;
    target.write(line.endsWith("\n") ? line : `${line}
`);
  }
};

// src/attributes.ts
var INTEGER_KEYS = /* @__PURE__ */ new Set([
  "client.port",
  "http.request.body.size",
  "http.response.body.size",
  "http.response.status_code",
  "http.status_code",
  "server.port",
  "thread.id"
]);
function conformValue(key, value) {
  if (INTEGER_KEYS.has(key) && typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number.parseInt(value, 10);
  }
  return value;
}
function toAnyValue(value) {
  if (value === null || value === void 0) {
    return void 0;
  }
  if (typeof value === "boolean") {
    return { boolValue: value };
  }
  if (typeof value === "bigint") {
    return { intValue: value.toString() };
  }
  if (typeof value === "number") {
    if (Number.isInteger(value) && Number.isSafeInteger(value)) {
      return { intValue: value.toString() };
    }
    return { doubleValue: value };
  }
  if (typeof value === "string") {
    return { stringValue: value };
  }
  if (value instanceof Date) {
    return { stringValue: value.toISOString() };
  }
  if (value instanceof Uint8Array) {
    return { bytesValue: Buffer.from(value).toString("base64") };
  }
  if (Array.isArray(value)) {
    const values = value.map(toAnyValue).filter(isPresent);
    return { arrayValue: { values } };
  }
  if (typeof value === "object") {
    const values = Object.entries(value).map(([key, item]) => keyValue(key, item)).filter(isPresent);
    return { kvlistValue: { values } };
  }
  return { stringValue: String(value) };
}
function keyValue(key, value) {
  const anyValue = toAnyValue(value);
  if (anyValue === void 0) {
    return void 0;
  }
  return { key, value: anyValue };
}
function attributes(mapping) {
  if (!mapping) {
    return [];
  }
  return Object.entries(mapping).map(([key, value]) => keyValue(key, value)).filter(isPresent);
}
function isPresent(value) {
  return value !== void 0;
}

// src/ids.ts
var TRACE_ID = /^[0-9a-f]{32}$/i;
var SPAN_ID = /^[0-9a-f]{16}$/i;
var ZERO_TRACE_ID = "0".repeat(32);
var ZERO_SPAN_ID = "0".repeat(16);
function traceId(value) {
  return typeof value === "string" && TRACE_ID.test(value) ? value.toLowerCase() : ZERO_TRACE_ID;
}
function spanId(value) {
  return typeof value === "string" && SPAN_ID.test(value) ? value.toLowerCase() : ZERO_SPAN_ID;
}
function optionalSpanId(value) {
  const id = spanId(value);
  return id === ZERO_SPAN_ID ? void 0 : id;
}
function optionalTraceId(value) {
  const id = traceId(value);
  return id === ZERO_TRACE_ID ? void 0 : id;
}

// src/ip.ts
var DEFAULT_IP_PRECEDENCE = [
  "do-connecting-ip",
  "cf-connecting-ip",
  "true-client-ip",
  "x-real-ip",
  "x-forwarded-for"
];
function normaliseHeaders(raw) {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const result = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      result[key.toLowerCase()] = value;
    }
  }
  return result;
}
function clientAddress(event, precedence = DEFAULT_IP_PRECEDENCE) {
  const headers = normaliseHeaders(event.request?.headers);
  for (const name of precedence) {
    const raw = headers[name];
    if (!raw) {
      continue;
    }
    const value = name === "x-forwarded-for" ? (raw.split(",")[0] ?? "").trim() : raw.trim();
    if (value) {
      return value;
    }
  }
  const forwarded = headers["forwarded"];
  if (forwarded) {
    const match = /for=("?\[?[^;,"]+)/i.exec(forwarded);
    if (match?.[1]) {
      return match[1].replace(/^"|"$/g, "");
    }
  }
  const known = event.user?.ip_address;
  return known ? String(known) : void 0;
}

// src/resource.ts
function buildResource(config, event) {
  const values = {
    "service.name": config.serviceName,
    "service.namespace": config.serviceNamespace,
    "service.version": config.serviceVersion ?? event?.release,
    "deployment.environment.name": config.deploymentEnvironment ?? event?.environment,
    "telemetry.sdk.name": "sentry",
    "telemetry.sdk.language": "javascript",
    "telemetry.sdk.version": event?.sdk?.version,
    "host.name": event?.server_name
  };
  Object.assign(values, config.extraResourceAttributes);
  return { attributes: attributes(values) };
}

// src/http.ts
var SENSITIVE_QUERY_PARAMS = /* @__PURE__ */ new Set([
  "X-Amz-Signature",
  "X-Amz-Credential",
  "X-Amz-Security-Token",
  "sig",
  "X-Goog-Signature"
]);
var USER_AGENT = "user-agent";
function normaliseHeaders2(raw) {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const result = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      result[key.toLowerCase()] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      result[key.toLowerCase()] = String(value);
    }
  }
  return result;
}
function redactUrlQuery(query) {
  if (!query) {
    return query;
  }
  return query.split("&").map((pair) => {
    const separator = pair.indexOf("=");
    if (separator === -1) {
      return pair;
    }
    const key = pair.slice(0, separator);
    return SENSITIVE_QUERY_PARAMS.has(key) ? `${key}=REDACTED` : pair;
  }).join("&");
}
function hostWithRedactedCredentials(url) {
  if (!url.username && !url.password) {
    return url.host;
  }
  return `REDACTED:REDACTED@${url.host}`;
}
function addUrl(result, url) {
  const path = url.pathname || "/";
  const query = redactUrlQuery(url.search.replace(/^\?/, ""));
  result["url.full"] = `${url.protocol}//${hostWithRedactedCredentials(url)}${path}${query ? `?${query}` : ""}${url.hash}`;
  result["url.path"] = path;
  if (query) {
    result["url.query"] = query;
  }
  if (url.protocol) {
    result["url.scheme"] = url.protocol.replace(/:$/, "");
  }
}
function forwardedHost(headers) {
  const forwarded = headers["forwarded"];
  if (!forwarded) {
    return void 0;
  }
  for (const element of forwarded.split(",")) {
    for (const pair of element.split(";")) {
      const [key, ...rest] = pair.split("=");
      if (key?.trim().toLowerCase() === "host") {
        return rest.join("=").trim().replace(/^"|"$/g, "");
      }
    }
  }
  return void 0;
}
function addServer(result, headers, url) {
  const candidate = forwardedHost(headers) ?? headers["x-forwarded-host"];
  let source;
  try {
    source = candidate ? new URL(`http://${candidate}`) : url;
  } catch {
    source = url;
  }
  if (source.hostname) {
    result["server.address"] = source.hostname;
  }
  if (source.port) {
    result["server.port"] = Number(source.port);
  }
}
function bodySize(source, keys) {
  for (const key of keys) {
    const value = source[key];
    if (value === void 0 || value === null) {
      continue;
    }
    const parsed = Number.parseInt(String(value), 10);
    return Number.isNaN(parsed) ? void 0 : parsed;
  }
  return void 0;
}
function responseStatus(event) {
  const contexts = event.contexts ?? {};
  const response = contexts.response ?? {};
  const data = contexts.trace?.data ?? {};
  const tags = event.tags ?? {};
  const status = response["status_code"] ?? data["http.response.status_code"] ?? tags["http.status_code"];
  if (status === void 0 || status === null) {
    return void 0;
  }
  const parsed = Number.parseInt(String(status), 10);
  return Number.isNaN(parsed) ? void 0 : parsed;
}
function addHeaders(result, headers, prefix) {
  for (const [name, value] of Object.entries(headers)) {
    result[`${prefix}.${name}`] = [value];
  }
}
function httpAttributes(event) {
  const request = event.request;
  if (!request) {
    return {};
  }
  const result = {};
  const headers = normaliseHeaders2(request.headers);
  let url;
  try {
    url = request.url ? new URL(request.url) : void 0;
  } catch {
    url = void 0;
  }
  if (url) {
    addUrl(result, url);
    addServer(result, headers, url);
  }
  if (request.method) {
    result["http.request.method"] = request.method;
  }
  if (headers[USER_AGENT]) {
    result["user_agent.original"] = headers[USER_AGENT];
  }
  const requestHeaders = { ...headers };
  delete requestHeaders[USER_AGENT];
  addHeaders(result, requestHeaders, "http.request.header");
  const requestSize = bodySize(headers, ["content-length"]);
  if (requestSize !== void 0) {
    result["http.request.body.size"] = requestSize;
  }
  const contexts = event.contexts ?? {};
  const response = contexts.response ?? {};
  const responseHeaders = normaliseHeaders2(response["headers"]);
  const status = responseStatus(event);
  if (status !== void 0) {
    result["http.response.status_code"] = status;
    if (status >= 500) {
      result["error.type"] = String(status);
    }
  }
  let responseSize = bodySize(response, ["body_size", "content_length"]);
  if (responseSize === void 0) {
    responseSize = bodySize(responseHeaders, ["content-length"]);
  }
  if (responseSize !== void 0) {
    result["http.response.body.size"] = responseSize;
  }
  addHeaders(result, responseHeaders, "http.response.header");
  return result;
}

// src/status.ts
var UNSET = /* @__PURE__ */ new Set([void 0, "", "unset"]);
function otlpStatus(status) {
  if (status === void 0 || status === null) {
    return { code: 0 };
  }
  const value = String(status).toLowerCase();
  if (UNSET.has(value)) {
    return { code: 0 };
  }
  if (value === "ok") {
    return { code: 1 };
  }
  return { code: 2, message: String(status) };
}

// src/time.ts
function toUnixNano(value) {
  if (value === void 0 || value === null) {
    return void 0;
  }
  if (value instanceof Date) {
    const millis = value.getTime();
    if (Number.isNaN(millis)) {
      return void 0;
    }
    const seconds2 = Math.floor(millis / 1e3);
    const nanos2 = BigInt(millis - seconds2 * 1e3) * 1000000n;
    return (BigInt(seconds2) * 1000000000n + nanos2).toString();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
      return void 0;
    }
    return toUnixNano(new Date(parsed));
  }
  if (!Number.isFinite(value)) {
    return void 0;
  }
  const seconds = Math.floor(value);
  const nanos = BigInt(Math.round((value - seconds) * 1e9));
  return (BigInt(seconds) * 1000000000n + nanos).toString();
}

// src/spans.ts
var ROOT_SCOPE = "sentry.transaction";
var CHILD_SCOPE = "sentry.span";
function keepHttpSpans(op) {
  return String(op ?? "").toLowerCase().startsWith("http");
}
var CORE_ATTRIBUTE_KEYS = /* @__PURE__ */ new Set([
  "sentry.op",
  "sentry.origin",
  "sentry.transaction",
  "http.request.method",
  "url.path",
  "url.full",
  "url.query",
  "url.scheme",
  "server.address",
  "server.port",
  "network.protocol.version",
  "http.response.status_code",
  "http.response.body.size",
  "error.type",
  "user_agent.original",
  "http.request.header.referer",
  "client.address"
]);
function spanKind(op) {
  const value = String(op ?? "").toLowerCase();
  if (value.startsWith("http.server") || value.startsWith("server")) {
    return 2;
  }
  if (value.startsWith("http.client") || value.startsWith("http")) {
    return 3;
  }
  if (value.startsWith("db") || value.startsWith("cache") || value.startsWith("rpc")) {
    return 3;
  }
  if (value.startsWith("queue") || value.startsWith("producer") || value.startsWith("publish")) {
    return 4;
  }
  if (value.startsWith("consumer") || value.startsWith("receive")) {
    return 5;
  }
  return 1;
}
function structuralAttributes(source) {
  const result = {};
  if (source["op"]) {
    result["sentry.op"] = source["op"];
  }
  if (source["origin"]) {
    result["sentry.origin"] = source["origin"];
  }
  for (const [key, value] of Object.entries(source["data"] ?? {})) {
    result[key] = conformValue(key, value);
  }
  return result;
}
function tagAttributes(tags) {
  const result = {};
  for (const [key, value] of Object.entries(tags ?? {})) {
    result[key] = conformValue(key, value);
  }
  return result;
}
function buildSpan(input) {
  const result = {
    traceId: input.trace,
    spanId: input.span,
    name: input.name || "span",
    kind: input.kind
  };
  const start = toUnixNano(input.start);
  const end = toUnixNano(input.end);
  if (start !== void 0) {
    result.startTimeUnixNano = start;
  }
  if (end !== void 0) {
    result.endTimeUnixNano = end;
  }
  result.attributes = attributes(input.attrs);
  result.status = otlpStatus(input.status);
  if (input.parent) {
    result.parentSpanId = input.parent;
  }
  return result;
}
function transactionToOtlp(event, adapter) {
  const contexts = event.contexts ?? {};
  const trace = contexts.trace ?? {};
  const rootTrace = traceId(trace["trace_id"]);
  const rootSpan = spanId(trace["span_id"]);
  const scopeSpans = [];
  if (adapter.spanFilter(trace["op"])) {
    const rootAttributes = {
      ...structuralAttributes(trace),
      ...tagAttributes(event.tags),
      ...httpAttributes(event)
    };
    const address = clientAddress(event, adapter.ipPrecedence);
    if (address) {
      rootAttributes["client.address"] = address;
    }
    if (event.transaction) {
      rootAttributes["sentry.transaction"] = event.transaction;
    }
    scopeSpans.push({
      scope: { name: ROOT_SCOPE },
      spans: [
        buildSpan({
          trace: rootTrace,
          span: rootSpan,
          parent: optionalSpanId(trace["parent_span_id"]),
          name: event.transaction ?? trace["description"] ?? "transaction",
          kind: spanKind(trace["op"]),
          start: event.start_timestamp,
          end: event.timestamp,
          status: trace["status"],
          attrs: rootAttributes
        })
      ]
    });
  }
  const children = [];
  for (const child of event.spans ?? []) {
    if (!adapter.spanFilter(child.op)) {
      continue;
    }
    const childTrace = traceId(child.trace_id);
    children.push(
      buildSpan({
        trace: childTrace === ZERO_TRACE_ID ? rootTrace : childTrace,
        span: spanId(child.span_id),
        parent: optionalSpanId(child.parent_span_id) ?? rootSpan,
        name: String(child.description ?? child.op ?? "span"),
        kind: spanKind(child.op),
        start: child.start_timestamp,
        end: child.timestamp,
        status: child.status,
        attrs: structuralAttributes(child)
      })
    );
  }
  if (children.length > 0) {
    scopeSpans.push({ scope: { name: CHILD_SCOPE }, spans: children });
  }
  if (scopeSpans.length === 0) {
    return void 0;
  }
  return {
    resourceSpans: [
      { resource: buildResource(adapter, event), scopeSpans }
    ]
  };
}
function reduceEnvelope(envelope2) {
  for (const resourceSpans of envelope2.resourceSpans) {
    for (const scopeSpans of resourceSpans.scopeSpans) {
      for (const span of scopeSpans.spans) {
        span.attributes = (span.attributes ?? []).filter(
          (item) => CORE_ATTRIBUTE_KEYS.has(item.key)
        );
      }
    }
  }
  return envelope2;
}

// src/logs.ts
var EVENT_SCOPE = "sentry.event";
var LOG_SCOPE = "sentry.log";
var LEVELS = {
  trace: [1, "TRACE"],
  debug: [5, "DEBUG"],
  info: [9, "INFO"],
  warn: [13, "WARN"],
  error: [17, "ERROR"],
  fatal: [21, "FATAL"]
};
var DENIED_LOG_LEVELS = /* @__PURE__ */ new Set(["error", "fatal"]);
function severityFromLevel(level) {
  return LEVELS[String(level ?? "").toLowerCase()] ?? [17, "ERROR"];
}
function eventLogger(event) {
  return event.logger ?? EVENT_SCOPE;
}
function eventBody(event) {
  if (event.message) {
    return String(event.message);
  }
  const values = event.exception?.values ?? [];
  const last = values[values.length - 1];
  if (last) {
    return `${last.type ?? "Exception"}: ${last.value ?? ""}`.replace(
      /^: |: $/g,
      ""
    );
  }
  return String(event.transaction ?? "event");
}
function frameSummary(frame) {
  return `${frame["filename"] ?? "?"}:${frame["lineno"] ?? "?"} in ${frame["function"] ?? "?"}`;
}
function eventAttributes(event) {
  const result = {};
  if (event.event_id) {
    result["sentry.event_id"] = event.event_id;
  }
  const values = event.exception?.values ?? [];
  const last = values[values.length - 1];
  if (last) {
    if (last.type) {
      result["exception.type"] = last.type;
    }
    if (last.value) {
      result["exception.message"] = last.value;
    }
    const frames = last.stacktrace?.frames ?? [];
    if (frames.length > 0) {
      result["exception.stacktrace"] = frames.map(frameSummary).join("\n");
    }
  }
  for (const [key, value] of Object.entries(event.tags ?? {})) {
    result[key] ??= conformValue(key, value);
  }
  return result;
}
function envelope(adapter, event, scope, record) {
  return {
    resourceLogs: [
      {
        resource: buildResource(adapter, event),
        scopeLogs: [{ scope: { name: scope }, logRecords: [record] }]
      }
    ]
  };
}
function eventToOtlp(event, adapter) {
  const contexts = event.contexts ?? {};
  const trace = contexts.trace ?? {};
  const [severityNumber, severityText] = severityFromLevel(event.level);
  const attrs = eventAttributes(event);
  const address = clientAddress(event, adapter.ipPrecedence);
  if (address) {
    attrs["client.address"] = address;
  }
  const record = {
    timeUnixNano: toUnixNano(event.timestamp),
    severityNumber,
    severityText,
    body: { stringValue: eventBody(event) },
    attributes: attributes(attrs)
  };
  const traceValue = optionalTraceId(trace["trace_id"]);
  const spanValue = optionalSpanId(trace["span_id"]);
  if (traceValue) {
    record.traceId = traceValue;
  }
  if (spanValue) {
    record.spanId = spanValue;
  }
  return envelope(adapter, event, eventLogger(event), record);
}
function logToOtlp(log, adapter) {
  const [severityNumber, severityText] = severityFromLevel(log.level);
  const attrs = {};
  for (const [key, value] of Object.entries(log.attributes ?? {})) {
    attrs[key] = conformValue(key, value);
  }
  const record = {
    timeUnixNano: toUnixNano(new Date(adapter.now())),
    severityNumber,
    severityText,
    body: { stringValue: String(log.message) },
    attributes: attributes(attrs)
  };
  return envelope(adapter, void 0, LOG_SCOPE, record);
}
function reduceLogEnvelope(envelope2) {
  for (const resourceLogs of envelope2.resourceLogs) {
    for (const scopeLogs of resourceLogs.scopeLogs) {
      for (const record of scopeLogs.logRecords) {
        record.attributes = (record.attributes ?? []).filter(
          (item) => CORE_ATTRIBUTE_KEYS.has(item.key)
        );
        if (record.body && "stringValue" in record.body && record.body.stringValue.length > 4096) {
          record.body.stringValue = record.body.stringValue.slice(
            0,
            4096
          );
        }
      }
    }
  }
  return envelope2;
}

// src/server.ts
import { randomBytes } from "crypto";
function randomTraceId() {
  return randomBytes(16).toString("hex");
}
function randomSpanId() {
  return randomBytes(8).toString("hex");
}
function randomIds() {
  return { traceId: randomTraceId(), spanId: randomSpanId() };
}
function serverRequestToOtlp(input, adapter) {
  const event = {
    request: {
      url: input.url,
      method: input.method,
      headers: input.headers
    },
    contexts: {
      response: {
        status_code: input.statusCode,
        headers: input.responseHeaders
      }
    }
  };
  const attrs = { ...httpAttributes(event) };
  const address = clientAddress(event, adapter.ipPrecedence);
  if (address) {
    attrs["client.address"] = address;
  }
  if (input.protocolVersion) {
    attrs["network.protocol.version"] = input.protocolVersion;
  }
  attrs["sentry.op"] = "http.server";
  const path = typeof attrs["url.path"] === "string" ? attrs["url.path"] : "/";
  const { traceId: traceId2, spanId: spanId2 } = adapter.idFactory();
  const span = {
    traceId: traceId2,
    spanId: spanId2,
    name: `${input.method || "GET"} ${path}`,
    kind: 2,
    // SERVER
    startTimeUnixNano: toUnixNano(input.startedAt),
    endTimeUnixNano: toUnixNano(input.finishedAt),
    attributes: attributes(attrs),
    status: otlpStatus(input.statusCode >= 500 ? "internal_error" : "ok")
  };
  return {
    resourceSpans: [
      {
        resource: buildResource(adapter),
        scopeSpans: [
          { scope: { name: "sentry.transaction" }, spans: [span] }
        ]
      }
    ]
  };
}
function otlpOutIntegration(adapter) {
  return {
    name: "OtlpOut",
    setup(client) {
      const httpClient = client;
      httpClient.on(
        "httpServerRequest",
        (request, response, normalizedRequest) => {
          const startedAt = /* @__PURE__ */ new Date();
          response.on("finish", () => {
            adapter.emitRequest({
              method: (normalizedRequest.method ?? request.method ?? "GET").toUpperCase(),
              url: normalizedRequest.url ?? request.url ?? "/",
              headers: normalizedRequest.headers ?? request.headers,
              protocolVersion: request.httpVersion,
              statusCode: response.statusCode,
              responseHeaders: response.getHeaders(),
              startedAt,
              finishedAt: /* @__PURE__ */ new Date()
            });
          });
        }
      );
    }
  };
}

// src/integration.ts
var DEFAULT_MAX_LINE_BYTES = 16 * 1024;
var OtlpOut = class {
  serviceName;
  serviceVersion;
  serviceNamespace;
  deploymentEnvironment;
  extraResourceAttributes;
  ipPrecedence;
  spanFilter;
  now;
  idFactory;
  mirrorLogs;
  sampleRate;
  maxLineBytes;
  random;
  writer;
  constructor(options) {
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
  beforeSend = (event, _hint) => {
    this.processEvent(event);
    return event;
  };
  /** `beforeSendTransaction` hook: mirror a transaction, return it unchanged. */
  beforeSendTransaction = (event, _hint) => {
    this.processEvent(event);
    return event;
  };
  /** `beforeSendLog` hook: mirror a structured log, return it unchanged. */
  beforeSendLog = (log) => {
    this.processLog(log);
    return log;
  };
  /**
   * The Sentry integration that mirrors every inbound request as an OTLP
   * server span, independent of `tracesSampleRate`. Add it to
   * `Sentry.init({ integrations: (defaults) => [...defaults, otlp.integration()] })`.
   */
  integration() {
    return otlpOutIntegration(this);
  }
  /** Emit one inbound server request as a `resourceSpans` line. */
  emitRequest(input) {
    this.emit(serverRequestToOtlp(input, this));
  }
  /** Convert one Sentry event into an OTLP/JSON line when relevant. */
  processEvent(event) {
    if (event.type === "transaction") {
      this.emit(transactionToOtlp(event, this));
    } else {
      this.emit(eventToOtlp(event, this));
    }
  }
  /** Mirror a Sentry structured log when it passes the configured filters. */
  processLog(log) {
    if (!this.mirrorLogs || DENIED_LOG_LEVELS.has(String(log.level).toLowerCase())) {
      return;
    }
    this.emit(logToOtlp(log, this));
  }
  emit(envelope2) {
    if (!envelope2) {
      return;
    }
    if (this.sampleRate < 1 && this.random() >= this.sampleRate) {
      return;
    }
    let line = dumps(envelope2);
    if (Buffer.byteLength(line, "utf8") > this.maxLineBytes) {
      line = dumps(
        "resourceSpans" in envelope2 ? reduceEnvelope(envelope2) : reduceLogEnvelope(envelope2)
      );
      if (Buffer.byteLength(line, "utf8") > this.maxLineBytes) {
        return;
      }
    }
    this.writer.writeLine(line);
  }
};
export {
  DEFAULT_MAX_LINE_BYTES,
  OtlpOut,
  keepHttpSpans
};
//# sourceMappingURL=index.js.map