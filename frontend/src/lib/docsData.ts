import type { NodeType } from "@/services/api";

export type NodeCategory = "Entry" | "Routing" | "Upstream" | "L4 Stream";

export interface NodeDocField {
  name: string;
  desc: string;
}

export interface NodeDocExample {
  title: string;
  details: string[];
  nginx: string;
}

export interface NodeDoc {
  type: NodeType;
  category: NodeCategory;
  tagline: string;
  description: string;
  connectsFrom: string;
  connectsTo: string;
  keyFields: NodeDocField[];
  example: NodeDocExample;
}

export const nodeDocs: NodeDoc[] = [
  {
    type: "Listener",
    category: "Entry",
    tagline: "Bind an address/port",
    description:
      "The root of every HTTP workflow. A Listener opens a port and protocol that nginx accepts connections on. Every canvas needs at least one Listener before anything else will generate a valid server block.",
    connectsFrom: "Nothing — it's always a root node",
    connectsTo: "Domain",
    keyFields: [
      { name: "port", desc: "TCP port to bind, 1–65535." },
      {
        name: "protocol",
        desc: "http or https. https requires an SSL node downstream on the Domain.",
      },
      { name: "http2", desc: "Adds the http2 flag to the listen directive." },
      {
        name: "defaultServer",
        desc: "Marks this as the fallback server for unmatched Host headers on this port.",
      },
      {
        name: "proxyProtocol",
        desc: "Enables PROXY protocol parsing, for traffic behind an L4 load balancer.",
      },
      { name: "reuseport", desc: "Adds SO_REUSEPORT for multi-worker socket sharing." },
    ],
    example: {
      title: "Public HTTPS edge on 443",
      details: ["port: 443", "protocol: https", "http2: on"],
      nginx: "listen 443 ssl http2;",
    },
  },
  {
    type: "Domain",
    category: "Entry",
    tagline: "server_name — which hosts this block answers",
    description:
      "Attaches to a Listener and declares which hostnames it answers for. A Domain node is the hub everything else hangs off: SSL for certificates, Route for path-based rules, and Auth/RateLimit/Cache/LB/Backend/GRPC directly for a catch-all root location.",
    connectsFrom: "Listener",
    connectsTo: "SSL, Route, Auth, RateLimit, Cache, LB, Backend, GRPC",
    keyFields: [
      {
        name: "hostnames",
        desc: "One or more server_name entries, one per line. Wildcards like *.example.com are allowed.",
      },
      { name: "redirectApex", desc: "Redirects the bare apex domain to the www subdomain." },
      {
        name: "blockExploits",
        desc: "Adds a standard ruleset blocking dotfiles, .git, wp-config.php, and common exploit query strings.",
      },
    ],
    example: {
      title: "api.example.com",
      details: ['hostnames: ["api.example.com"]'],
      nginx: "server_name api.example.com;",
    },
  },
  {
    type: "SSL",
    category: "Entry",
    tagline: "TLS certificate — Let's Encrypt or manual PEM",
    description:
      "Attaches to a Domain to serve it over TLS. Either issues/renews a Let's Encrypt certificate (HTTP-01 or DNS-01 challenge) or accepts a manually pasted certificate and key. Also carries the Force SSL toggle, which turns a plain-HTTP Listener on the same hostname into a 301 redirect to HTTPS.",
    connectsFrom: "Domain",
    connectsTo: "Nothing — terminal, only ever a target of Domain",
    keyFields: [
      { name: "leMode", desc: "On: Let's Encrypt issuance. Off: paste certPem/keyPem directly." },
      { name: "leChallenge", desc: "http-01 (webroot) or dns-01, when leMode is on." },
      {
        name: "leDnsProvider",
        desc: "Cloudflare, Route53, DigitalOcean, GoDaddy, Google Cloud DNS, Azure, or Namecheap — for dns-01.",
      },
      {
        name: "forceSsl",
        desc: "301-redirects HTTP → HTTPS. Needs an HTTP Listener on the same hostname to carry the redirect.",
      },
      {
        name: "protocols / ciphers / hsts",
        desc: "TLS hardening: allowed protocol versions, cipher string, and Strict-Transport-Security.",
      },
    ],
    example: {
      title: "Let's Encrypt via Cloudflare DNS-01",
      details: [
        "leMode: on",
        "leChallenge: dns-01",
        "leDnsProvider: cloudflare",
        "leDomain: api.example.com",
        "hsts: on, hstsMaxAge: 31536000",
      ],
      nginx:
        'ssl_certificate /data/certs/letsencrypt/config/live/api.example.com/fullchain.pem;\nssl_certificate_key /data/certs/letsencrypt/config/live/api.example.com/privkey.pem;\nssl_protocols TLSv1.2 TLSv1.3;\nadd_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;',
    },
  },
  {
    type: "Route",
    category: "Routing",
    tagline: "location block matching an incoming path",
    description:
      "Splits a Domain's traffic by path. Everything connected downstream of a Route (Auth, RateLimit, Cache, LB, Backend, GRPC) only applies inside that location block — traffic outside the path falls through to the Domain's root location or another Route.",
    connectsFrom: "Domain",
    connectsTo: "Auth, RateLimit, Cache, LB, Backend, GRPC",
    keyFields: [
      { name: "path", desc: "The location path, e.g. /api/." },
      {
        name: "matchMode",
        desc: "prefix (default), exact (=), preferential (^~), regex (~), regex-ci (~*).",
      },
      { name: "stripPrefix", desc: "Strips the matched prefix before proxying upstream." },
      { name: "rewrite / tryFiles", desc: "Optional raw rewrite or try_files directives." },
    ],
    example: {
      title: "/api/ prefix match",
      details: ["path: /api/", "matchMode: prefix"],
      nginx: "location /api/ {\n  ...\n}",
    },
  },
  {
    type: "Auth",
    category: "Routing",
    tagline: "Access control on a Domain or Route",
    description:
      "Gatekeeps everything downstream of it: HTTP Basic auth, an IP allowlist, JWT validation, or an nginx auth_request subrequest to an external validator.",
    connectsFrom: "Domain or Route",
    connectsTo: "Route, LB, Backend, GRPC",
    keyFields: [
      { name: "type", desc: "none, basic, ip-allowlist, jwt, or subrequest." },
      { name: "userFile", desc: "Path to the htpasswd file, for basic auth." },
      {
        name: "allowList",
        desc: "CIDRs allowed through; everything else is denied, for ip-allowlist.",
      },
      {
        name: "jwksUri / subrequestUri",
        desc: "External validator endpoint, for jwt / subrequest.",
      },
    ],
    example: {
      title: "HTTP Basic auth on the staging realm",
      details: ["type: basic", "realm: Staging", "userFile: /etc/nginx/.htpasswd"],
      nginx: 'auth_basic "Staging";\nauth_basic_user_file /etc/nginx/.htpasswd;',
    },
  },
  {
    type: "RateLimit",
    category: "Routing",
    tagline: "limit_req request throttling",
    description:
      "Caps request rate for everything downstream, keyed by a variable such as $binary_remote_addr. Declares a shared-memory zone at the http{} level and applies it in the matched location.",
    connectsFrom: "Domain or Route",
    connectsTo: "Route, LB, Backend, GRPC",
    keyFields: [
      { name: "zoneName / zoneSizeMb", desc: "Shared memory zone name and size in MB." },
      { name: "rate", desc: "e.g. 50r/s or 100r/m." },
      {
        name: "burst / nodelay",
        desc: "Burst queue size, and whether to serve bursts immediately instead of delaying them.",
      },
      { name: "key", desc: "The variable requests are grouped by. Default $binary_remote_addr." },
    ],
    example: {
      title: "50 requests/sec, burst 100, no delay",
      details: ["zoneName: api_rl", "zoneSizeMb: 10", "rate: 50r/s", "burst: 100", "nodelay: on"],
      nginx:
        "limit_req_zone $binary_remote_addr zone=api_rl:10m rate=50r/s;\n...\nlocation /api/ {\n  limit_req zone=api_rl burst=100 nodelay;\n}",
    },
  },
  {
    type: "Cache",
    category: "Routing",
    tagline: "proxy_cache response caching",
    description:
      "Caches upstream responses to disk for everything downstream. Declares a proxy_cache_path zone and applies proxy_cache/proxy_cache_valid/proxy_cache_key in the matched location.",
    connectsFrom: "Domain or Route",
    connectsTo: "Route, LB, Backend, GRPC",
    keyFields: [
      {
        name: "zoneName / zoneSizeMb / inactive",
        desc: "Cache zone name, size, and how long unused entries survive.",
      },
      { name: "validCodes", desc: 'proxy_cache_valid, e.g. "200 302 10m".' },
      { name: "key", desc: "Cache key expression, default $scheme$host$request_uri." },
      { name: "bypass", desc: "Optional condition to skip the cache, e.g. auth headers." },
    ],
    example: {
      title: "10-minute cache on 200/302 responses",
      details: [
        "zoneName: api_cache",
        "zoneSizeMb: 100",
        "inactive: 60m",
        'validCodes: "200 302 10m"',
      ],
      nginx:
        "proxy_cache_path /var/cache/nginx/api_cache levels=1:2 keys_zone=api_cache:100m inactive=60m;\n...\nlocation /api/ {\n  proxy_cache api_cache;\n  proxy_cache_valid 200 302 10m;\n  proxy_cache_key $scheme$host$request_uri;\n}",
    },
  },
  {
    type: "LB",
    category: "Upstream",
    tagline: "upstream load balancer for downstream Backends",
    description:
      "Groups two or more Backend nodes into a single nginx upstream{} pool with a chosen balancing algorithm. Everything routed to the LB is proxied to whichever Backend the algorithm picks.",
    connectsFrom: "Domain, Route, Auth, RateLimit, or Cache",
    connectsTo: "Backend, GRPC",
    keyFields: [
      { name: "name", desc: "The upstream{} block name." },
      { name: "algorithm", desc: "round-robin (default), least_conn, ip_hash, or hash <key>." },
      { name: "keepalive", desc: "Idle keepalive connections kept open to backends." },
    ],
    example: {
      title: "least_conn across two backends",
      details: [
        "name: backend_pool",
        "algorithm: least_conn",
        "Backend 1: app1:8080",
        "Backend 2: app2:8080",
      ],
      nginx:
        "upstream backend_pool {\n  least_conn;\n  server app1:8080 max_fails=3 fail_timeout=10s;\n  server app2:8080 max_fails=3 fail_timeout=10s;\n}",
    },
  },
  {
    type: "Backend",
    category: "Upstream",
    tagline: "The upstream origin server",
    description:
      "The terminal node most chains end at — an actual origin server. Standalone, it becomes a direct proxy_pass; grouped under an LB, it becomes a server line inside that upstream{} pool. Also carries WebSocket support and active health checks.",
    connectsFrom: "Domain, Route, Auth, RateLimit, Cache, LB, TCP, or UDP",
    connectsTo: "Nothing — terminal",
    keyFields: [
      {
        name: "address / scheme / port",
        desc: "Where the origin lives, and whether proxy_pass uses http:// or https://.",
      },
      {
        name: "weight / maxFails / failTimeout / backup",
        desc: "Load-balancing and failover tuning, used when grouped under an LB.",
      },
      { name: "websocket", desc: "Adds proxy_http_version 1.1 and Upgrade/Connection headers." },
      { name: "healthCheck / healthPath", desc: "Active health check toggle and path." },
      {
        name: "proxyHeaders",
        desc: "proxy_set_header entries forwarded upstream, e.g. Host, X-Real-IP.",
      },
    ],
    example: {
      title: "Node app with WebSocket support",
      details: ["address: app-service", "scheme: http", "port: 8080", "websocket: on"],
      nginx:
        'proxy_set_header Host $host;\nproxy_set_header X-Real-IP $remote_addr;\nproxy_http_version 1.1;\nproxy_set_header Upgrade $http_upgrade;\nproxy_set_header Connection "upgrade";\nproxy_pass http://app-service:8080;',
    },
  },
  {
    type: "GRPC",
    category: "Upstream",
    tagline: "Upstream gRPC service",
    description:
      "A gRPC-flavored Backend: emits grpc_pass instead of proxy_pass, plus grpc_set_header and the grpc_* timeout directives.",
    connectsFrom: "Domain, Route, Auth, RateLimit, Cache, or LB",
    connectsTo: "Nothing — terminal",
    keyFields: [
      {
        name: "address / port / tls",
        desc: "Target host:port, and whether to use grpc:// or grpcs://.",
      },
      {
        name: "connectTimeout / readTimeout / sendTimeout",
        desc: "grpc_connect_timeout / grpc_read_timeout / grpc_send_timeout.",
      },
      { name: "grpcHeaders", desc: "grpc_set_header entries forwarded to the upstream." },
    ],
    example: {
      title: "Internal gRPC service, plaintext",
      details: ["address: grpc-service", "port: 50051", "tls: off"],
      nginx:
        "grpc_set_header Host $host;\ngrpc_connect_timeout 5s;\ngrpc_read_timeout 60s;\ngrpc_send_timeout 60s;\ngrpc_pass grpc://grpc-service:50051;",
    },
  },
  {
    type: "TCP",
    category: "L4 Stream",
    tagline: "L4 TCP stream listener",
    description:
      "A root node for raw TCP passthrough — no Domain, SSL, or Route involved. Compiles to a stream{} server block instead of an http{} one. Used for anything that isn't HTTP: databases, mail, custom TCP protocols.",
    connectsFrom: "Nothing — it's a root node, same as Listener",
    connectsTo: "Backend",
    keyFields: [
      { name: "port", desc: "TCP port to listen on." },
      { name: "proxyPass", desc: "Fallback target if no Backend is connected, e.g. backend:5432." },
      {
        name: "proxyTimeout / proxyConnectTimeout",
        desc: "Idle and connect timeouts for the stream.",
      },
    ],
    example: {
      title: "Postgres passthrough",
      details: ["port: 5432", "Backend: db-primary:5432"],
      nginx:
        "server {\n  listen 5432;\n  proxy_pass db-primary:5432;\n  proxy_timeout 10m;\n  proxy_connect_timeout 5s;\n}",
    },
  },
  {
    type: "UDP",
    category: "L4 Stream",
    tagline: "L4 UDP stream listener",
    description:
      "Same idea as TCP but for datagram protocols — DNS, syslog, game servers. Compiles to a stream{} server block with listen ... udp;.",
    connectsFrom: "Nothing — it's a root node, same as Listener",
    connectsTo: "Backend",
    keyFields: [
      { name: "port", desc: "UDP port to listen on." },
      { name: "proxyResponses", desc: "Expected number of datagram responses per request." },
      { name: "proxyTimeout", desc: "Idle timeout for the stream." },
    ],
    example: {
      title: "DNS passthrough",
      details: ["port: 53", "Backend: dns:53", "proxyResponses: 1"],
      nginx:
        "server {\n  listen 53 udp;\n  proxy_pass dns:53;\n  proxy_timeout 10s;\n  proxy_responses 1;\n}",
    },
  },
];

export const nodeCategoryOrder: NodeCategory[] = ["Entry", "Routing", "Upstream", "L4 Stream"];

// ---------------- Workflow (end-to-end) examples ----------------

export interface WorkflowExampleStep {
  label: string;
  detail: string;
}

export interface WorkflowExample {
  id: string;
  title: string;
  difficulty: "Beginner" | "Intermediate" | "Advanced";
  scenario: string;
  nodeChain: string;
  steps: WorkflowExampleStep[];
  nginxPreview: string;
}

export const workflowExamples: WorkflowExample[] = [
  {
    id: "https-site",
    title: "Public HTTPS site with Let's Encrypt",
    difficulty: "Beginner",
    scenario:
      "You have a single app (app-service:8080) and want it served at https://app.example.com, with plain HTTP requests redirected to HTTPS.",
    nodeChain:
      "Listener(443) → Domain → SSL → Backend, plus Listener(80) → Domain → SSL (force redirect)",
    steps: [
      {
        label: "1. Add the HTTPS Listener",
        detail:
          "Drag a Listener from the palette. Set port 443, protocol https, and enable HTTP/2.",
      },
      {
        label: "2. Add the Domain",
        detail:
          "Drag a Domain node, connect the Listener's handle to it, and set hostnames to app.example.com.",
      },
      {
        label: "3. Add SSL",
        detail:
          "Drag an SSL node onto the Domain. Turn on Let's Encrypt, pick a challenge type, set the certificate domain and contact email.",
      },
      {
        label: "4. Add the Backend",
        detail: "Drag a Backend node onto the Domain too. Set address app-service, port 8080.",
      },
      {
        label: "5. Redirect HTTP → HTTPS",
        detail:
          "Add a second Listener on port 80, its own Domain with the same hostname, and an SSL node with Force SSL turned on. Plain HTTP requests now 301 to HTTPS.",
      },
      {
        label: "6. Preview & deploy",
        detail: "Open the nginx preview to sanity-check the generated config, then hit Deploy.",
      },
    ],
    nginxPreview:
      "server {\n  listen 80;\n  server_name app.example.com;\n  return 301 https://$host$request_uri;\n}\n\nserver {\n  listen 443 ssl http2;\n  server_name app.example.com;\n  ssl_certificate .../fullchain.pem;\n  ssl_certificate_key .../privkey.pem;\n  location / {\n    proxy_pass http://app-service:8080;\n  }\n}",
  },
  {
    id: "lb-api",
    title: "Load-balanced API with rate limiting and caching",
    difficulty: "Intermediate",
    scenario:
      "An /api/ path needs to be spread across two app instances, throttled per client IP, and have GET responses cached for a few minutes.",
    nodeChain:
      "Listener → Domain → SSL, Domain → Route(/api/) → RateLimit → Cache → LB → Backend ×2",
    steps: [
      {
        label: "1. Entry",
        detail:
          "Listener on 443 (https, http2) → Domain api.example.com → SSL node with your certificate.",
      },
      {
        label: "2. Scope to /api/",
        detail: "Add a Route connected to the Domain. path: /api/, matchMode: prefix.",
      },
      {
        label: "3. Throttle",
        detail: "Add a RateLimit connected to the Route. rate: 50r/s, burst: 100, nodelay on.",
      },
      {
        label: "4. Cache",
        detail: 'Add a Cache connected to the RateLimit. validCodes: "200 302 10m".',
      },
      { label: "5. Balance", detail: "Add an LB connected to the Cache. algorithm: least_conn." },
      {
        label: "6. Backends",
        detail: "Add two Backend nodes, both connected to the LB — app1:8080 and app2:8080.",
      },
      {
        label: "7. Preview & deploy",
        detail:
          "Check the compiled config shows one upstream{} block and both server lines, then deploy.",
      },
    ],
    nginxPreview:
      "upstream backend_pool {\n  least_conn;\n  server app1:8080 max_fails=3 fail_timeout=10s;\n  server app2:8080 max_fails=3 fail_timeout=10s;\n}\n\nlocation /api/ {\n  limit_req zone=api_rl burst=100 nodelay;\n  proxy_cache api_cache;\n  proxy_cache_valid 200 302 10m;\n  proxy_pass http://backend_pool;\n}",
  },
  {
    id: "tcp-postgres",
    title: "Postgres over TCP passthrough",
    difficulty: "Beginner",
    scenario:
      "You need to expose a Postgres instance on its native port, with no HTTP involved at all.",
    nodeChain: "TCP(5432) → Backend",
    steps: [
      {
        label: "1. Add a TCP node",
        detail:
          "Drag a TCP node from the L4 Stream group. Set port 5432. It's a root node — no Listener or Domain needed.",
      },
      {
        label: "2. Add the Backend",
        detail:
          "Drag a Backend node, connect the TCP node to it, set address db-primary, port 5432.",
      },
      {
        label: "3. Preview & deploy",
        detail:
          "The preview shows a stream{} block, not http{} — that's expected for TCP/UDP workflows.",
      },
    ],
    nginxPreview:
      "stream {\n  server {\n    listen 5432;\n    proxy_pass db-primary:5432;\n    proxy_timeout 10m;\n    proxy_connect_timeout 5s;\n  }\n}",
  },
  {
    id: "grpc-jwt",
    title: "Internal gRPC service behind JWT auth",
    difficulty: "Advanced",
    scenario:
      "An internal gRPC microservice should only accept requests carrying a valid JWT, verified against your identity provider's JWKS.",
    nodeChain: "Listener → Domain → SSL, Domain → Route(/) → Auth(jwt) → GRPC",
    steps: [
      {
        label: "1. Entry",
        detail:
          "Listener 443 → Domain grpc.internal.example.com → SSL (manual cert or Let's Encrypt).",
      },
      {
        label: "2. Route",
        detail: "Add a Route with path / and matchMode prefix, connected to the Domain.",
      },
      {
        label: "3. Auth",
        detail:
          "Add an Auth node connected to the Route. type: jwt, jwksUri: your identity provider's JWKS endpoint.",
      },
      {
        label: "4. gRPC upstream",
        detail:
          "Add a GRPC node connected to the Auth node. address: grpc-service, port: 50051, tls: off (internal network).",
      },
      {
        label: "5. Preview & deploy",
        detail:
          "Confirm auth_jwt appears before grpc_pass in the compiled location block, then deploy.",
      },
    ],
    nginxPreview:
      'location / {\n  auth_jwt "closed area";\n  # auth_jwt_key_request /_jwks;\n  grpc_pass grpc://grpc-service:50051;\n}',
  },
];

// ---------------- API reference (condensed from frontend/API.md) ----------------

export interface ApiEndpoint {
  method: string;
  path: string;
  desc: string;
}

export interface ApiSection {
  title: string;
  endpoints: ApiEndpoint[];
}

export const apiSections: ApiSection[] = [
  {
    title: "Auth",
    endpoints: [
      { method: "POST", path: "/auth/login", desc: "Exchange email/password for a session token." },
      { method: "POST", path: "/auth/logout", desc: "Invalidate the current session token." },
      { method: "GET", path: "/auth/me", desc: "Fetch the current session's user." },
    ],
  },
  {
    title: "Workflows",
    endpoints: [
      { method: "GET", path: "/workflows", desc: "List all workflows (summary view)." },
      {
        method: "GET",
        path: "/workflows/:id",
        desc: "Fetch a full workflow, including its node/edge graph.",
      },
      { method: "POST", path: "/workflows", desc: "Create a new, empty workflow." },
      { method: "PATCH", path: "/workflows/:id", desc: "Save draft changes to nodes/edges." },
      { method: "DELETE", path: "/workflows/:id", desc: "Delete a workflow." },
      {
        method: "POST",
        path: "/workflows/:id/validate",
        desc: "Server-side re-validation of every node's properties.",
      },
      {
        method: "POST",
        path: "/workflows/:id/compile",
        desc: "Generate the nginx.conf for this workflow.",
      },
      { method: "GET", path: "/workflows/:id/versions", desc: "List saved versions." },
      {
        method: "POST",
        path: "/workflows/:id/rollback",
        desc: "Restore an earlier version as the new head.",
      },
    ],
  },
  {
    title: "Deployments",
    endpoints: [
      {
        method: "GET",
        path: "/deployments",
        desc: "List deployments, optionally filtered by workflow/status.",
      },
      {
        method: "POST",
        path: "/workflows/:id/deploy",
        desc: "Deploy the current workflow version.",
      },
      {
        method: "POST",
        path: "/deployments/:id/rollback",
        desc: "Roll back to a previous deployment.",
      },
      {
        method: "GET",
        path: "/deployments/:id",
        desc: "Fetch a single deployment, with logs when available.",
      },
    ],
  },
  {
    title: "Certificates & Let's Encrypt",
    endpoints: [
      { method: "GET", path: "/certificates", desc: "List all certificates." },
      {
        method: "POST",
        path: "/certificates/lets-encrypt",
        desc: "Kick off async ACME issuance for a domain.",
      },
      {
        method: "GET",
        path: "/certificates/lets-encrypt/:jobId",
        desc: "Poll an issuance job's status.",
      },
      { method: "POST", path: "/certificates", desc: "Upload a manual cert/key pair (PEM)." },
      { method: "DELETE", path: "/certificates/:id", desc: "Delete a certificate." },
    ],
  },
  {
    title: "Metrics & Logs",
    endpoints: [
      {
        method: "GET",
        path: "/metrics/traffic",
        desc: "Time-series requests/errors/latency for a range.",
      },
      { method: "GET", path: "/metrics/stats", desc: "Dashboard KPI summary." },
      {
        method: "GET",
        path: "/metrics/nodes/:nodeId",
        desc: "Live per-node request counter, polled by the workspace canvas.",
      },
      { method: "GET", path: "/logs", desc: "Paginated access/error log records." },
      {
        method: "GET",
        path: "/logs/stream",
        desc: "Server-Sent Events stream of live log records.",
      },
    ],
  },
  {
    title: "Settings",
    endpoints: [
      { method: "GET", path: "/settings", desc: "Fetch account/appearance/integration settings." },
      {
        method: "PATCH",
        path: "/settings",
        desc: "Update settings (theme, Default Site, retention, etc).",
      },
    ],
  },
];
