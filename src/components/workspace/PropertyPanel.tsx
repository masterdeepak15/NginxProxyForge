import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Trash2, AlertTriangle } from "lucide-react";
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
    </div>
  );
}
