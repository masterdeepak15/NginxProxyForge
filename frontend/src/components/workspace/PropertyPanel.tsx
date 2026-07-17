import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Trash2, AlertTriangle, ShieldCheck, Loader2 } from "lucide-react";
import { apiService, type WorkflowNode } from "@/services/api";
import { nodeSchemas, validateNode } from "@/lib/nodeSchemas";
import { FieldRenderer } from "./FieldRenderer";

interface Props {
  node: WorkflowNode | null;
  onChangeLabel: (label: string) => void;
  onChangeProps: (props: Record<string, unknown>) => void;
  onDelete: () => void;
}

export function PropertyPanel({ node, onChangeLabel, onChangeProps, onDelete }: Props) {
  const schema = node ? nodeSchemas[node.type] : null;
  const validation = useMemo(
    () => (node ? validateNode(node.type, node.properties) : { ok: true as const }),
    [node],
  );

  if (!node || !schema) {
    return (
      <div className="rounded-md border border-dashed border-border/70 p-6 text-center text-xs text-muted-foreground">
        Select a node to edit its nginx properties, or drag one from the palette.
      </div>
    );
  }

  const errors = validation.ok ? {} : validation.errors;

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {schema.type}
          </div>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{schema.description}</p>
        <p className="mt-1 rounded bg-muted/50 px-2 py-1 font-mono text-[10px]">
          {schema.nginxContext}
        </p>
      </div>

      {!validation.ok && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Fix validation errors before deploying.</span>
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Label
        </Label>
        <Input
          value={node.label}
          onChange={(e) => onChangeLabel(e.target.value)}
          className="h-8 text-sm"
        />
      </div>

      <Separator />

      <div className="space-y-3">
        {schema.fields.map((f) => (
          <FieldRenderer
            key={f.key}
            field={f}
            value={node.properties[f.key]}
            values={node.properties}
            error={errors[f.key]}
            onChange={(v) => onChangeProps({ [f.key]: v })}
          />
        ))}
      </div>

      {node.type === "SSL" && Boolean(node.properties.leMode) && (
        <LetsEncryptAction node={node} onChangeProps={onChangeProps} />
      )}
    </div>
  );
}


function LetsEncryptAction({
  node,
  onChangeProps,
}: {
  node: WorkflowNode;
  onChangeProps: (props: Record<string, unknown>) => void;
}) {
  const domain = (node.properties.leDomain as string) || "";
  const email = (node.properties.leEmail as string) || "";
  const challenge = ((node.properties.leChallenge as string) || "http-01") as "http-01" | "dns-01";
  const dnsProvider = node.properties.leDnsProvider as string | undefined;
  const status = (node.properties.leStatus as string) || "idle";
  const error = node.properties.leError as string | undefined;

  const [requesting, setRequesting] = useState(false);

  const request = async () => {
    if (!domain.trim()) {
      onChangeProps({ leStatus: "error", leError: "Enter a domain first" });
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      onChangeProps({ leStatus: "error", leError: "A valid contact email is required for ACME registration" });
      return;
    }

    setRequesting(true);
    onChangeProps({ leStatus: "pending", leError: "" });

    try {
      const { jobId } = await apiService.requestLetsEncrypt({
        domain: domain.trim(),
        email: email.trim(),
        challenge,
        dnsProvider,
      });

      // Poll the real certbot job until it resolves. HTTP-01 issuance
      // typically takes a few seconds; give it up to ~2 minutes.
      const start = Date.now();
      const timeoutMs = 120_000;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise((r) => setTimeout(r, 2000));
        const job = await apiService.getLetsEncryptJob(jobId);
        if (job.status === "issued") {
          onChangeProps({
            leStatus: "issued",
            leError: "",
            certPath: job.certPath || "",
            keyPath: job.keyPath || "",
            certificateId: job.certificateId,
            certExpiresAt: job.expiresAt,
          });
          break;
        }
        if (job.status === "error") {
          onChangeProps({ leStatus: "error", leError: job.error || "Certificate issuance failed" });
          break;
        }
        if (Date.now() - start > timeoutMs) {
          onChangeProps({
            leStatus: "error",
            leError: "Timed out waiting for certbot. Check Logs for details — it may still complete.",
          });
          break;
        }
      }
    } catch (err) {
      onChangeProps({
        leStatus: "error",
        leError: err instanceof Error ? err.message : "Failed to reach the certificate API",
      });
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        onClick={request}
        disabled={requesting || status === "pending"}
      >
        {requesting || status === "pending" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ShieldCheck className="h-3.5 w-3.5" />
        )}
        {requesting || status === "pending" ? "Requesting certificate…" : "Request Let's Encrypt certificate"}
      </Button>
      <p className="text-[11px] text-muted-foreground">
        For HTTP-01, {domain || "the domain"} must already resolve to this server on port 80. Auto-renewal
        runs automatically every 12h server-side — no per-certificate setting needed.
      </p>
      {status === "pending" && (
        <p className="text-[11px] text-muted-foreground">Requesting certificate — this calls real certbot and can take up to a minute…</p>
      )}
      {status === "issued" && (
        <p className="text-[11px] text-emerald-500">
          Certificate issued for {domain}
          {node.properties.certExpiresAt
            ? ` — expires ${new Date(node.properties.certExpiresAt as string).toLocaleDateString()}`
            : ""}
          . Remember to click <strong>Save draft</strong> (or Deploy) so this is persisted.
        </p>
      )}
      {status === "error" && error && (
        <p className="text-[11px] text-destructive">{error}</p>
      )}
    </div>
  );
}
