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
  /** For type "textarea": show an "Upload file" button that reads a local
   * file's text content into this field, instead of only pasting/typing. */
  allowUpload?: boolean;
  /** `accept` attribute for the upload input, e.g. ".html,.htm,text/html". */
  uploadAccept?: string;
}

export interface NodeSchema {
  type: NodeType;
  description: string;
  nginxContext: string;
  fields: FieldMeta[];
  defaults: Record<string, unknown>;
  schema: z.ZodTypeAny;
}

// Technically RFC 1035 hostname labels only allow letters/digits/hyphens,
// but nginx's `server_name` does not enforce that strictly, and internal
// hostnames with underscores (e.g. "anpr_v1.example.com") are common in
// the wild. Allow underscores alongside hyphens rather than rejecting
// names nginx would happily serve.
const hostname = z
  .string()
  .trim()
  .regex(
    /^(\*\.)?([a-zA-Z0-9_]([a-zA-Z0-9_-]{0,61}[a-zA-Z0-9_])?)(\.[a-zA-Z0-9_]([a-zA-Z0-9_-]{0,61}[a-zA-Z0-9_])?)*$/,
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
    {
      key: "blockExploits",
      label: "Block common exploits",
      type: "switch",
      help: "Blocks common exploit probes (dotfiles, .git, wp-config.php, suspicious query strings, etc.) for this domain.",
    },
    ...commonFields,
  ],
  defaults: {
    hostnames: ["example.com"],
    redirectApex: false,
    blockExploits: false,
    ...commonDefaults,
  },
  schema: z.object({
    hostnames: z.array(hostname).min(1, "At least one hostname"),
    redirectApex: z.boolean(),
    blockExploits: z.boolean().default(false),
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
    {
      key: "forceSsl",
      label: "Force SSL (redirect HTTP → HTTPS)",
      type: "switch",
      help: "Requires an HTTP Listener on this domain too — its traffic 301-redirects to HTTPS instead of proxying.",
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
    {
      key: "leEmail",
      label: "Contact email (for ACME registration)",
      type: "text",
      placeholder: "you@example.com",
      showIf: (v) => Boolean(v.leMode),
    },
    {
      key: "certPem",
      label: "Certificate (PEM)",
      type: "textarea",
      placeholder: "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----",
      help: "Paste the fullchain PEM. Stored securely by the backend — no filesystem path needed.",
      showIf: (v) => !v.leMode,
    },
    {
      key: "keyPem",
      label: "Private key (PEM)",
      type: "textarea",
      placeholder: "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
      help: "Paste the private key PEM. Stored encrypted by the backend.",
      showIf: (v) => !v.leMode,
    },
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
    forceSsl: false,
    leMode: false,
    leChallenge: "http-01",
    leDnsProvider: "cloudflare",
    leDomain: "",
    leEmail: "",
    leStatus: "idle",
    leError: "",
    certPem: "",
    keyPem: "",
    certPath: "",
    keyPath: "",
    protocols: ["TLSv1.2", "TLSv1.3"],
    ciphers: "HIGH:!aNULL:!MD5",
    preferServerCiphers: true,
    hsts: true,
    hstsMaxAge: 31536000,
    ...commonDefaults,
  },
  schema: z.object({
    mode: z.enum(["shared", "per-domain"]),
    forceSsl: z.boolean().default(false),
    leMode: z.boolean().default(false),
    leChallenge: z.enum(["http-01", "dns-01"]).default("http-01"),
    leDnsProvider: z.string().default("cloudflare"),
    leDomain: z.string().default(""),
    leEmail: z.string().default(""),
    leStatus: z.string().default("idle"),
    leError: z.string().default(""),
    certPem: z.string().default(""),
    keyPem: z.string().default(""),
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
    { key: "scheme", label: "Scheme (proxy_pass target)", type: "select", options: [ { value: "http", label: "http://" }, { value: "https", label: "https://" } ] },
    { key: "port", label: "Port", type: "number", min: 1, max: 65535 },
    { key: "weight", label: "Weight", type: "number", min: 1 },
    { key: "maxFails", label: "max_fails", type: "number", min: 0 },
    { key: "failTimeout", label: "fail_timeout", type: "text", placeholder: "10s" },
    { key: "backup", label: "Backup server", type: "switch" },
    {
      key: "websocket",
      label: "WebSocket support",
      type: "switch",
      help: "Adds proxy_http_version 1.1 and Upgrade/Connection headers for this backend.",
    },
    { key: "healthCheck", label: "Active health check", type: "switch" },
    { key: "healthPath", label: "Health path", type: "text", placeholder: "/healthz", showIf: (v) => Boolean(v.healthCheck) },
    { key: "connectTimeout", label: "proxy_connect_timeout", type: "text", placeholder: "5s" },
    { key: "readTimeout", label: "proxy_read_timeout", type: "text", placeholder: "60s" },
    { key: "proxyHeaders", label: "proxy_set_header", type: "headers" },
    ...commonFields,
  ],
  defaults: {
    address: "app-service",
    scheme: "http",
    port: 8080,
    weight: 1,
    maxFails: 3,
    failTimeout: "10s",
    backup: false,
    websocket: false,
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
    scheme: z.enum(["http", "https"]).default("http"),
    port: z.coerce.number().int().min(1).max(65535),
    weight: z.coerce.number().int().min(1),
    maxFails: z.coerce.number().int().min(0),
    failTimeout: z.string().min(1),
    backup: z.boolean(),
    websocket: z.boolean().default(false),
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

const GRPC: NodeSchema = {
  type: "GRPC",
  description: "Upstream gRPC service. Emits `grpc_pass` in the matched location.",
  nginxContext: "location { grpc_pass ... }",
  fields: [
    { key: "address", label: "Address", type: "text", placeholder: "grpc-service" },
    { key: "port", label: "Port", type: "number", min: 1, max: 65535 },
    { key: "tls", label: "TLS (grpcs://)", type: "switch" },
    { key: "connectTimeout", label: "grpc_connect_timeout", type: "text", placeholder: "5s" },
    { key: "readTimeout", label: "grpc_read_timeout", type: "text", placeholder: "60s" },
    { key: "sendTimeout", label: "grpc_send_timeout", type: "text", placeholder: "60s" },
    {
      key: "grpcHeaders",
      label: "grpc_set_header",
      type: "headers",
      help: "Headers forwarded to the gRPC upstream.",
    },
    ...commonFields,
  ],
  defaults: {
    address: "grpc-service",
    port: 50051,
    tls: false,
    connectTimeout: "5s",
    readTimeout: "60s",
    sendTimeout: "60s",
    grpcHeaders: [
      { name: "Host", value: "$host" },
      { name: "X-Real-IP", value: "$remote_addr" },
    ],
    ...commonDefaults,
  },
  schema: z.object({
    address: z.string().min(1),
    port: z.coerce.number().int().min(1).max(65535),
    tls: z.boolean(),
    connectTimeout: z.string().min(1),
    readTimeout: z.string().min(1),
    sendTimeout: z.string().min(1),
    grpcHeaders: z.array(headerEntry).default([]),
    ...commonSchema,
  }),
};

// ---------------- Default Site (Settings-level, not a workflow node) ----------------
// Nginx only allows one `default_server` per address:port, and ProxyForge's
// base nginx.conf already owns that fallback for :80/:443 (see
// docker/nginx.conf). Modeling it as a draggable per-Listener node made it
// possible to create a real conflict (two default_server blocks on the
// same port), so this content model lives here as a single global setting
// instead — same fields/behavior, just not a graph node. Configured from
// the Settings page; see backend/src/lib/defaultSite.ts for generation.
export const defaultSiteFields: FieldMeta[] = [
  {
    key: "mode",
    label: "Mode",
    type: "select",
    options: [
      { value: "congratulations", label: "Congratulations page" },
      { value: "404", label: "404 page" },
      { value: "no-response", label: "No response (close connection)" },
      { value: "redirect", label: "Redirect" },
      { value: "custom", label: "Custom HTML" },
    ],
  },
  {
    key: "redirectUrl",
    label: "Redirect URL",
    type: "text",
    placeholder: "https://example.com",
    showIf: (v) => v.mode === "redirect",
  },
  {
    key: "redirectCode",
    label: "Redirect code",
    type: "select",
    options: [
      { value: "301", label: "301 Permanent" },
      { value: "302", label: "302 Temporary" },
    ],
    showIf: (v) => v.mode === "redirect",
  },
  {
    key: "html",
    label: "Custom HTML",
    type: "textarea",
    placeholder: "<html>...</html>",
    help: "Served as-is with Content-Type: text/html. Upload an .html file, or paste/edit it directly.",
    showIf: (v) => v.mode === "custom",
    allowUpload: true,
    uploadAccept: ".html,.htm,text/html",
  },
];

export const defaultSiteDefaults = {
  mode: "congratulations" as const,
  redirectUrl: "",
  redirectCode: "302" as const,
  html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Welcome</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: linear-gradient(135deg, #0f172a, #1e293b);
    color: #e2e8f0;
    padding: 24px;
  }
  .card {
    max-width: 480px;
    text-align: center;
    padding: 40px 32px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
  h1 { margin: 0 0 12px; font-size: 1.75rem; }
  p { margin: 0; color: #94a3b8; line-height: 1.5; }
</style>
</head>
<body>
  <div class="card">
    <h1>Welcome</h1>
    <p>This site is up and running. Replace this page with your own content, or upload an HTML file.</p>
  </div>
</body>
</html>
`,
};

export const defaultSiteSchema = z
  .object({
    mode: z.enum(["congratulations", "404", "no-response", "redirect", "custom"]),
    redirectUrl: z.string().default(""),
    redirectCode: z.enum(["301", "302"]).default("302"),
    html: z.string().default(""),
  })
  .refine((v) => v.mode !== "redirect" || Boolean(v.redirectUrl.trim()), {
    message: "Redirect URL is required",
    path: ["redirectUrl"],
  });

export function validateDefaultSite(
  properties: Record<string, unknown>,
): { ok: true } | { ok: false; errors: Record<string, string> } {
  const res = defaultSiteSchema.safeParse(properties);
  if (res.success) return { ok: true };
  const errors: Record<string, string> = {};
  for (const issue of res.error.issues) {
    const key = issue.path[0]?.toString() ?? "_";
    if (!errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors };
}

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
  GRPC,
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
