import { z } from "zod";
import type { NodeType } from "@/services/api";

export type FieldType =
  | "text"
  | "number"
  | "select"
  | "switch"
  | "textarea"
  | "multitext"
  | "headers"
  | "multiselect";

export interface FieldMeta {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  showIf?: (values: Record<string, unknown>) => boolean;
}

export interface NodeSchema {
  type: NodeType;
  description: string;
  nginxContext: string;
  fields: FieldMeta[];
  defaults: Record<string, unknown>;
  schema: z.ZodTypeAny;
}

const hostname = z
  .string()
  .trim()
  .regex(
    /^(\*\.)?([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
    { message: "Invalid hostname" },
  );

const headerEntry = z.object({
  name: z.string().trim().min(1, "Header name required"),
  value: z.string().trim().min(1, "Header value required"),
  always: z.boolean().optional(),
});

const commonFields: FieldMeta[] = [
  {
    key: "extraHeaders",
    label: "Additional response headers",
    type: "headers",
    help: "Emits `add_header NAME VALUE [always];`",
  },
  {
    key: "extraDirectives",
    label: "Additional nginx directives",
    type: "textarea",
    placeholder: "# free-form nginx snippet, appended inside the block",
    help: "Free-form nginx directives appended verbatim to this block.",
  },
];

const commonDefaults = { extraHeaders: [], extraDirectives: "" };
const commonSchema = {
  extraHeaders: z.array(headerEntry).default([]),
  extraDirectives: z.string().default(""),
};

// ---------------- Per-node schemas ----------------

const Listener: NodeSchema = {
  type: "Listener",
  description: "Bind an address/port. Compiles to `listen`.",
  nginxContext: "server { listen ... }",
  fields: [
    { key: "port", label: "Port", type: "number", min: 1, max: 65535 },
    {
      key: "protocol",
      label: "Protocol",
      type: "select",
      options: [
        { value: "http", label: "HTTP" },
        { value: "https", label: "HTTPS" },
      ],
    },
    { key: "http2", label: "Enable HTTP/2", type: "switch" },
    { key: "defaultServer", label: "Default server", type: "switch" },
    { key: "proxyProtocol", label: "PROXY protocol", type: "switch" },
    { key: "reuseport", label: "SO_REUSEPORT", type: "switch" },
    ...commonFields,
  ],
  defaults: {
    port: 443,
    protocol: "https",
    http2: true,
    defaultServer: false,
    proxyProtocol: false,
    reuseport: false,
    ...commonDefaults,
  },
  schema: z.object({
    port: z.coerce.number().int().min(1).max(65535),
    protocol: z.enum(["http", "https"]),
    http2: z.boolean(),
    defaultServer: z.boolean(),
    proxyProtocol: z.boolean(),
    reuseport: z.boolean(),
    ...commonSchema,
  }),
};

const Domain: NodeSchema = {
  type: "Domain",
  description: "One or more `server_name` entries.",
  nginxContext: "server { server_name ... }",
  fields: [
    {
      key: "hostnames",
      label: "Hostnames",
      type: "multitext",
      help: "One per line. Wildcards like *.example.com are allowed.",
    },
    { key: "redirectApex", label: "Redirect apex → www", type: "switch" },
    ...commonFields,
  ],
  defaults: { hostnames: ["example.com"], redirectApex: false, ...commonDefaults },
  schema: z.object({
    hostnames: z.array(hostname).min(1, "At least one hostname"),
    redirectApex: z.boolean(),
    ...commonSchema,
  }),
};

const SSL: NodeSchema = {
  type: "SSL",
  description: "TLS certificate configuration.",
  nginxContext: "server { ssl_* }",
  fields: [
    {
      key: "mode",
      label: "Mode",
      type: "select",
      options: [
        { value: "shared", label: "Shared certificate" },
        { value: "per-domain", label: "Per-domain (SNI)" },
      ],
    },
    { key: "leMode", label: "Use Let's Encrypt (ACME)", type: "switch" },
    {
      key: "leChallenge",
      label: "ACME challenge",
      type: "select",
      options: [
        { value: "http-01", label: "HTTP-01 (webroot)" },
        { value: "dns-01", label: "DNS-01" },
      ],
      showIf: (v) => Boolean(v.leMode),
    },
    {
      key: "leDnsProvider",
      label: "DNS provider",
      type: "select",
      options: [
        { value: "cloudflare", label: "Cloudflare" },
        { value: "route53", label: "AWS Route53" },
        { value: "digitalocean", label: "DigitalOcean" },
        { value: "godaddy", label: "GoDaddy" },
        { value: "gcloud", label: "Google Cloud DNS" },
        { value: "azure", label: "Azure DNS" },
        { value: "namecheap", label: "Namecheap" },
      ],
      showIf: (v) => Boolean(v.leMode) && v.leChallenge === "dns-01",
    },
    {
      key: "leDomain",
      label: "Certificate domain",
      type: "text",
      placeholder: "example.com",
      showIf: (v) => Boolean(v.leMode),
    },
    { key: "certPath", label: "ssl_certificate", type: "text", placeholder: "/etc/ssl/fullchain.pem", showIf: (v) => !v.leMode },
    { key: "keyPath", label: "ssl_certificate_key", type: "text", placeholder: "/etc/ssl/privkey.pem", showIf: (v) => !v.leMode },
    {
      key: "protocols",
      label: "Protocols",
      type: "multiselect",
      options: [
        { value: "TLSv1.2", label: "TLSv1.2" },
        { value: "TLSv1.3", label: "TLSv1.3" },
      ],
    },
    { key: "ciphers", label: "Ciphers", type: "text", placeholder: "HIGH:!aNULL:!MD5" },
    { key: "preferServerCiphers", label: "Prefer server ciphers", type: "switch" },
    { key: "hsts", label: "Enable HSTS", type: "switch" },
    {
      key: "hstsMaxAge",
      label: "HSTS max-age (s)",
      type: "number",
      min: 0,
      showIf: (v) => Boolean(v.hsts),
    },
    ...commonFields,
  ],
  defaults: {
    mode: "shared",
    leMode: false,
    leChallenge: "http-01",
    leDnsProvider: "cloudflare",
    leDomain: "",
    leStatus: "idle",
    leError: "",
    certPath: "/etc/letsencrypt/live/example.com/fullchain.pem",
    keyPath: "/etc/letsencrypt/live/example.com/privkey.pem",
    protocols: ["TLSv1.2", "TLSv1.3"],
    ciphers: "HIGH:!aNULL:!MD5",
    preferServerCiphers: true,
    hsts: true,
    hstsMaxAge: 31536000,
    ...commonDefaults,
  },
  schema: z.object({
    mode: z.enum(["shared", "per-domain"]),
    leMode: z.boolean().default(false),
    leChallenge: z.enum(["http-01", "dns-01"]).default("http-01"),
    leDnsProvider: z.string().default("cloudflare"),
    leDomain: z.string().default(""),
    leStatus: z.string().default("idle"),
    leError: z.string().default(""),
    certPath: z.string().default(""),
    keyPath: z.string().default(""),
    protocols: z.array(z.string()).min(1),
    ciphers: z.string().default(""),
    preferServerCiphers: z.boolean(),
    hsts: z.boolean(),
    hstsMaxAge: z.coerce.number().int().min(0),
    ...commonSchema,
  }),
};

const Route: NodeSchema = {
  type: "Route",
  description: "`location` block matching an incoming path.",
  nginxContext: "server { location ... }",
  fields: [
    { key: "path", label: "Path", type: "text", placeholder: "/api/" },
    {
      key: "matchMode",
      label: "Match mode",
      type: "select",
      options: [
        { value: "prefix", label: "Prefix (default)" },
        { value: "exact", label: "Exact (=)" },
        { value: "preferential", label: "Preferential prefix (^~)" },
        { value: "regex", label: "Regex (~)" },
        { value: "regex-ci", label: "Regex case-insensitive (~*)" },
      ],
    },
    { key: "stripPrefix", label: "Strip prefix when proxying", type: "switch" },
    { key: "rewrite", label: "rewrite (optional)", type: "text", placeholder: "^/api/(.*)$ /$1 break" },
    { key: "tryFiles", label: "try_files (optional)", type: "text", placeholder: "$uri $uri/ =404" },
    ...commonFields,
  ],
  defaults: {
    path: "/",
    matchMode: "prefix",
    stripPrefix: false,
    rewrite: "",
    tryFiles: "",
    ...commonDefaults,
  },
  schema: z.object({
    path: z.string().min(1, "Path required").startsWith("/", "Must start with /"),
    matchMode: z.enum(["prefix", "exact", "preferential", "regex", "regex-ci"]),
    stripPrefix: z.boolean(),
    rewrite: z.string().default(""),
    tryFiles: z.string().default(""),
    ...commonSchema,
  }),
};

const Auth: NodeSchema = {
  type: "Auth",
  description: "Access control on the route.",
  nginxContext: "location { auth_* / allow / deny }",
  fields: [
    {
      key: "type",
      label: "Auth type",
      type: "select",
      options: [
        { value: "none", label: "None" },
        { value: "basic", label: "HTTP Basic" },
        { value: "ip-allowlist", label: "IP allowlist" },
        { value: "jwt", label: "JWT (auth_jwt)" },
        { value: "subrequest", label: "Auth subrequest" },
      ],
    },
    { key: "realm", label: "Realm", type: "text", showIf: (v) => v.type === "basic" },
    {
      key: "userFile",
      label: "auth_basic_user_file",
      type: "text",
      placeholder: "/etc/nginx/.htpasswd",
      showIf: (v) => v.type === "basic",
    },
    {
      key: "allowList",
      label: "Allowed CIDRs",
      type: "multitext",
      help: "One CIDR per line. Everything else is denied.",
      showIf: (v) => v.type === "ip-allowlist",
    },
    {
      key: "jwksUri",
      label: "JWKS URI",
      type: "text",
      showIf: (v) => v.type === "jwt",
    },
    {
      key: "subrequestUri",
      label: "Subrequest URI",
      type: "text",
      placeholder: "/_auth",
      showIf: (v) => v.type === "subrequest",
    },
    ...commonFields,
  ],
  defaults: {
    type: "none",
    realm: "Restricted",
    userFile: "/etc/nginx/.htpasswd",
    allowList: ["10.0.0.0/8"],
    jwksUri: "",
    subrequestUri: "/_auth",
    ...commonDefaults,
  },
  schema: z.object({
    type: z.enum(["none", "basic", "ip-allowlist", "jwt", "subrequest"]),
    realm: z.string().default("Restricted"),
    userFile: z.string().default(""),
    allowList: z.array(z.string()).default([]),
    jwksUri: z.string().default(""),
    subrequestUri: z.string().default(""),
    ...commonSchema,
  }),
};

const RateLimit: NodeSchema = {
  type: "RateLimit",
  description: "`limit_req` request throttling.",
  nginxContext: "http { limit_req_zone } / location { limit_req }",
  fields: [
    { key: "zoneName", label: "Zone name", type: "text", placeholder: "api_rl" },
    { key: "zoneSizeMb", label: "Zone size (MB)", type: "number", min: 1 },
    { key: "rate", label: "Rate", type: "text", placeholder: "50r/s" },
    { key: "burst", label: "Burst", type: "number", min: 0 },
    { key: "nodelay", label: "nodelay", type: "switch" },
    { key: "key", label: "Key", type: "text", placeholder: "$binary_remote_addr" },
    ...commonFields,
  ],
  defaults: {
    zoneName: "rl_zone",
    zoneSizeMb: 10,
    rate: "50r/s",
    burst: 100,
    nodelay: true,
    key: "$binary_remote_addr",
    ...commonDefaults,
  },
  schema: z.object({
    zoneName: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Alphanumeric/underscore only"),
    zoneSizeMb: z.coerce.number().int().min(1),
    rate: z.string().regex(/^\d+r\/[sm]$/, "Format like 50r/s or 100r/m"),
    burst: z.coerce.number().int().min(0),
    nodelay: z.boolean(),
    key: z.string().min(1),
    ...commonSchema,
  }),
};

const Cache: NodeSchema = {
  type: "Cache",
  description: "`proxy_cache` response caching.",
  nginxContext: "http { proxy_cache_path } / location { proxy_cache }",
  fields: [
    { key: "zoneName", label: "Cache zone name", type: "text" },
    { key: "zoneSizeMb", label: "Zone size (MB)", type: "number", min: 1 },
    { key: "inactive", label: "Inactive", type: "text", placeholder: "60m" },
    { key: "validCodes", label: "proxy_cache_valid", type: "text", placeholder: "200 302 10m" },
    { key: "key", label: "Cache key", type: "text", placeholder: "$scheme$host$request_uri" },
    { key: "bypass", label: "Bypass condition", type: "text", placeholder: "$http_pragma $http_authorization" },
    ...commonFields,
  ],
  defaults: {
    zoneName: "cache_zone",
    zoneSizeMb: 100,
    inactive: "60m",
    validCodes: "200 302 10m",
    key: "$scheme$host$request_uri",
    bypass: "",
    ...commonDefaults,
  },
  schema: z.object({
    zoneName: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
    zoneSizeMb: z.coerce.number().int().min(1),
    inactive: z.string().min(1),
    validCodes: z.string().min(1),
    key: z.string().min(1),
    bypass: z.string().default(""),
    ...commonSchema,
  }),
};

const LB: NodeSchema = {
  type: "LB",
  description: "`upstream` load balancer for downstream Backends.",
  nginxContext: "upstream <name> { ... }",
  fields: [
    { key: "name", label: "Upstream name", type: "text", placeholder: "api_upstream" },
    {
      key: "algorithm",
      label: "Algorithm",
      type: "select",
      options: [
        { value: "round-robin", label: "Round-robin" },
        { value: "least_conn", label: "least_conn" },
        { value: "ip_hash", label: "ip_hash" },
        { value: "hash", label: "hash <key>" },
      ],
    },
    { key: "hashKey", label: "hash key", type: "text", placeholder: "$request_uri", showIf: (v) => v.algorithm === "hash" },
    { key: "keepalive", label: "keepalive (idle conns)", type: "number", min: 0 },
    ...commonFields,
  ],
  defaults: {
    name: "backend_pool",
    algorithm: "round-robin",
    hashKey: "$request_uri",
    keepalive: 32,
    ...commonDefaults,
  },
  schema: z.object({
    name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
    algorithm: z.enum(["round-robin", "least_conn", "ip_hash", "hash"]),
    hashKey: z.string().default(""),
    keepalive: z.coerce.number().int().min(0),
    ...commonSchema,
  }),
};

const Backend: NodeSchema = {
  type: "Backend",
  description: "Upstream origin server.",
  nginxContext: "upstream { server ... } / proxy_pass",
  fields: [
    { key: "address", label: "Address", type: "text", placeholder: "app-service" },
    { key: "port", label: "Port", type: "number", min: 1, max: 65535 },
    { key: "weight", label: "Weight", type: "number", min: 1 },
    { key: "maxFails", label: "max_fails", type: "number", min: 0 },
    { key: "failTimeout", label: "fail_timeout", type: "text", placeholder: "10s" },
    { key: "backup", label: "Backup server", type: "switch" },
    { key: "healthCheck", label: "Active health check", type: "switch" },
    { key: "healthPath", label: "Health path", type: "text", placeholder: "/healthz", showIf: (v) => Boolean(v.healthCheck) },
    { key: "connectTimeout", label: "proxy_connect_timeout", type: "text", placeholder: "5s" },
    { key: "readTimeout", label: "proxy_read_timeout", type: "text", placeholder: "60s" },
    { key: "proxyHeaders", label: "proxy_set_header", type: "headers" },
    ...commonFields,
  ],
  defaults: {
    address: "app-service",
    port: 8080,
    weight: 1,
    maxFails: 3,
    failTimeout: "10s",
    backup: false,
    healthCheck: false,
    healthPath: "/healthz",
    connectTimeout: "5s",
    readTimeout: "60s",
    proxyHeaders: [
      { name: "Host", value: "$host" },
      { name: "X-Real-IP", value: "$remote_addr" },
      { name: "X-Forwarded-For", value: "$proxy_add_x_forwarded_for" },
      { name: "X-Forwarded-Proto", value: "$scheme" },
    ],
    ...commonDefaults,
  },
  schema: z.object({
    address: z.string().min(1),
    port: z.coerce.number().int().min(1).max(65535),
    weight: z.coerce.number().int().min(1),
    maxFails: z.coerce.number().int().min(0),
    failTimeout: z.string().min(1),
    backup: z.boolean(),
    healthCheck: z.boolean(),
    healthPath: z.string().default(""),
    connectTimeout: z.string().min(1),
    readTimeout: z.string().min(1),
    proxyHeaders: z.array(headerEntry).default([]),
    ...commonSchema,
  }),
};

const TCP: NodeSchema = {
  type: "TCP",
  description: "L4 TCP stream listener.",
  nginxContext: "stream { server { listen <port>; ... } }",
  fields: [
    { key: "port", label: "Port", type: "number", min: 1, max: 65535 },
    { key: "proxyPass", label: "proxy_pass", type: "text", placeholder: "backend:5432" },
    { key: "proxyTimeout", label: "proxy_timeout", type: "text", placeholder: "10m" },
    { key: "proxyConnectTimeout", label: "proxy_connect_timeout", type: "text", placeholder: "5s" },
    ...commonFields,
  ],
  defaults: {
    port: 5432,
    proxyPass: "backend:5432",
    proxyTimeout: "10m",
    proxyConnectTimeout: "5s",
    ...commonDefaults,
  },
  schema: z.object({
    port: z.coerce.number().int().min(1).max(65535),
    proxyPass: z.string().min(1),
    proxyTimeout: z.string().min(1),
    proxyConnectTimeout: z.string().min(1),
    ...commonSchema,
  }),
};

const UDP: NodeSchema = {
  type: "UDP",
  description: "L4 UDP stream listener.",
  nginxContext: "stream { server { listen <port> udp; ... } }",
  fields: [
    { key: "port", label: "Port", type: "number", min: 1, max: 65535 },
    { key: "proxyPass", label: "proxy_pass", type: "text" },
    { key: "proxyResponses", label: "proxy_responses", type: "number", min: 0 },
    { key: "proxyTimeout", label: "proxy_timeout", type: "text", placeholder: "10s" },
    ...commonFields,
  ],
  defaults: {
    port: 53,
    proxyPass: "dns:53",
    proxyResponses: 1,
    proxyTimeout: "10s",
    ...commonDefaults,
  },
  schema: z.object({
    port: z.coerce.number().int().min(1).max(65535),
    proxyPass: z.string().min(1),
    proxyResponses: z.coerce.number().int().min(0),
    proxyTimeout: z.string().min(1),
    ...commonSchema,
  }),
};

export const nodeSchemas: Record<NodeType, NodeSchema> = {
  Listener,
  Domain,
  SSL,
  Route,
  Auth,
  RateLimit,
  Cache,
  LB,
  Backend,
  TCP,
  UDP,
};

export function getDefaults(type: NodeType): Record<string, unknown> {
  return JSON.parse(JSON.stringify(nodeSchemas[type].defaults));
}

export function validateNode(
  type: NodeType,
  properties: Record<string, unknown>,
): { ok: true } | { ok: false; errors: Record<string, string> } {
  const res = nodeSchemas[type].schema.safeParse(properties);
  if (res.success) return { ok: true };
  const errors: Record<string, string> = {};
  for (const issue of res.error.issues) {
    const key = issue.path[0]?.toString() ?? "_";
    if (!errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors };
}

export interface HeaderEntry {
  name: string;
  value: string;
  always?: boolean;
}
