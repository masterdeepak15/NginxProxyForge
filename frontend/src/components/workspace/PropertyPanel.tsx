import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Trash2, AlertTriangle, ShieldCheck, Loader2 } from "lucide-react";
import type { WorkflowNode } from "@/services/api";
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
  const [busy, setBusy] = useState(false);
  const status = String(node.properties.leStatus ?? "idle");
  const error = String(node.properties.leError ?? "");
  const domain = String(node.properties.leDomain ?? "").trim();

  const run = async () => {
    if (!domain) {
      onChangeProps({ leStatus: "error", leError: "Set a certificate domain first." });
      return;
    }
    setBusy(true);
    onChangeProps({ leStatus: "pending", leError: "" });
    await new Promise((r) => setTimeout(r, 1200));
    // Simulated ACME issuance
    const ok = /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain);
    if (ok) {
      onChangeProps({
        leStatus: "issued",
        leError: "",
        certPath: `/etc/letsencrypt/live/${domain}/fullchain.pem`,
        keyPath: `/etc/letsencrypt/live/${domain}/privkey.pem`,
      });
    } else {
      onChangeProps({ leStatus: "error", leError: `Invalid domain "${domain}".` });
    }
    setBusy(false);
  };

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-xs font-medium">
        <ShieldCheck className="h-3.5 w-3.5 text-primary" /> ACME issuance
      </div>
      <Button size="sm" className="h-8 w-full" onClick={run} disabled={busy}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
        {status === "issued" ? "Renew certificate" : "Generate certificate"}
      </Button>
      {status === "pending" && (
        <p className="text-[11px] text-muted-foreground">Requesting certificate…</p>
      )}
      {status === "issued" && (
        <p className="text-[11px] text-emerald-500">Certificate issued for {domain}.</p>
      )}
      {status === "error" && error && (
        <p className="text-[11px] text-destructive">{error}</p>
      )}
    </div>
  );
}
