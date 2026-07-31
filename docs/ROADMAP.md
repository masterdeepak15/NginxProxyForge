# Feature Roadmap — NginxProxyForge

Ideas for where the product could go next, grouped by theme. Not commitments
or a sequenced backlog — a menu to pick from.

## Access control

- **Role enforcement.** `admin` / `operator` / `viewer` already exist on
  every user but aren't enforced anywhere (see `docs/SECURITY_AUDIT.md`).
  Making `viewer` genuinely read-only and gating deploy/delete/settings
  behind `admin`/`operator` is the highest-leverage next step here.
- **API tokens.** The Settings page already has a placeholder "API tokens"
  section. Scoped personal-access tokens (with an expiry and a revoke
  button) would unlock scripting deploys from CI, which is a natural next
  step for a tool that already round-trips through a documented REST API.
- **Audit log.** A dedicated "who did what, when" view — who deployed,
  who deleted a workflow, who rotated a cert — beyond the existing
  activity log entries.

## Workflow canvas

- **Node groups / sub-flows.** Let a set of nodes (e.g. RateLimit → Cache →
  LB → 2 Backends) be saved as a reusable template and dropped into other
  workflows in one action, instead of rebuilding the same chain per domain.
- **Multi-domain workflows in one canvas.** Right now each Domain needs its
  own Listener even when they share a port; a "one Listener, many Domains"
  view could reduce canvas clutter for people running many low-traffic
  sites behind one instance.
- **Inline diff on save.** Show what changed between the draft and the last
  deployed version before committing — currently you only see the compiled
  nginx output, not a diff against what's live.
- **Undo/redo on the canvas** (separate from the Version History rollback,
  which is a full save-point restore, not per-action undo).

## Observability

- **Per-node request/error sparkline in the canvas itself** (the workspace
  already polls `/metrics/nodes/:nodeId` for live counts — visualizing that
  inline on each node, not just in the side panel, would make hot paths
  visible at a glance).
- **Alerting.** Threshold-based alerts (error rate spike, cert expiring in
  <7 days, backend marked down) delivered via webhook/email/Slack.
- **Structured access log export.** CSV/JSON export of the Logs page's
  filtered view, for people who want to pull data into their own tooling.

## Certificates

- **Certificate auto-renewal visibility.** Renewal already runs on a timer
  (`index.ts`); surfacing "last renewal check" and "next scheduled check"
  in the Certificates page would make the automatic behavior less opaque.
- **Multi-domain (SAN) certificates** in the Let's Encrypt issuance flow —
  currently one domain per certificate.
- **Wildcard cert helper UI** — DNS-01 already supports the major
  providers; a guided flow (pick provider → paste API token → done) would
  lower the barrier versus manually setting up DNS credentials.

## Import / export

- **Export a workflow back to a portable nginx config** — the reverse of
  the existing "import an nginx config" flow, for people who want to hand
  a config to something outside ProxyForge, or keep it in their own git
  repo as a backup.
- **Workflow templates library** — starter templates for the common
  patterns already documented in the in-app Documentation page (HTTPS
  site, load-balanced API, TCP passthrough, gRPC+JWT) that create a
  pre-wired canvas instead of a blank one.

## Operational

- **Config drift detection beyond "drifted" status** — a diff view showing
  exactly which directives differ between the DB-tracked workflow and
  what's actually running in `conf.d`, for cases where someone edited the
  container's files by hand.
- **Backup/restore for the whole instance** (DB + `data/certs` +
  `data/nginx`), beyond the per-deploy conf.d backups that already exist
  in `processManager.ts`.
- **Multi-instance / clustering** — if ProxyForge is ever meant to manage
  more than one nginx host, that's a bigger architectural shift (today
  everything assumes a single local nginx process it directly controls).
