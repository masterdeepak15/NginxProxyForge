import { useRef } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, Upload } from "lucide-react";
import type { FieldMeta } from "@/lib/nodeSchemas";
import type { HeaderEntry } from "@/lib/nodeSchemas";
import { cn } from "@/lib/utils";

interface Props {
  field: FieldMeta;
  value: unknown;
  values: Record<string, unknown>;
  error?: string;
  onChange: (v: unknown) => void;
}

export function FieldRenderer({ field, value, values, error, onChange }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (field.showIf && !field.showIf(values)) return null;

  const label = (
    <div className="flex items-center justify-between">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {field.label}
      </Label>
      {error && <span className="text-[10px] text-destructive">{error}</span>}
    </div>
  );

  const errorClass = error ? "border-destructive focus-visible:ring-destructive" : "";

  switch (field.type) {
    case "text":
      return (
        <div className="space-y-1">
          {label}
          <Input
            value={(value as string) ?? ""}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
            className={cn("h-8 text-sm font-mono", errorClass)}
          />
          {field.help && <p className="text-[10px] text-muted-foreground">{field.help}</p>}
        </div>
      );
    case "number":
      return (
        <div className="space-y-1">
          {label}
          <Input
            type="number"
            value={(value as number) ?? ""}
            min={field.min}
            max={field.max}
            onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
            className={cn("h-8 text-sm font-mono", errorClass)}
          />
        </div>
      );
    case "textarea":
      return (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {field.label}
            </Label>
            <div className="flex items-center gap-2">
              {error && <span className="text-[10px] text-destructive">{error}</span>}
              {field.allowUpload && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={field.uploadAccept}
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => onChange(String(reader.result ?? ""));
                      reader.readAsText(file);
                      e.target.value = ""; // allow re-selecting the same file later
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary"
                  >
                    <Upload className="h-3 w-3" />
                    Upload file
                  </button>
                </>
              )}
            </div>
          </div>
          <Textarea
            value={(value as string) ?? ""}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
            className={cn("min-h-[80px] text-xs font-mono", errorClass)}
          />
          {field.help && <p className="text-[10px] text-muted-foreground">{field.help}</p>}
        </div>
      );
    case "switch":
      return (
        <div className="flex items-center justify-between rounded-md border border-border/50 px-2 py-1.5">
          <Label className="text-xs">{field.label}</Label>
          <Switch checked={Boolean(value)} onCheckedChange={onChange} />
        </div>
      );
    case "select":
      return (
        <div className="space-y-1">
          {label}
          <Select value={(value as string) ?? ""} onValueChange={onChange}>
            <SelectTrigger className={cn("h-8 text-sm", errorClass)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    case "multiselect": {
      const arr = (Array.isArray(value) ? value : []) as string[];
      return (
        <div className="space-y-1">
          {label}
          <div className="space-y-1 rounded-md border border-border/50 p-2">
            {field.options?.map((o) => (
              <label key={o.value} className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={arr.includes(o.value)}
                  onCheckedChange={(c) => {
                    if (c) onChange([...arr, o.value]);
                    else onChange(arr.filter((v) => v !== o.value));
                  }}
                />
                {o.label}
              </label>
            ))}
          </div>
        </div>
      );
    }
    case "multitext": {
      const arr = (Array.isArray(value) ? value : []) as string[];
      return (
        <div className="space-y-1">
          {label}
          <div className="space-y-1">
            {arr.map((v, i) => (
              <div key={i} className="flex gap-1">
                <Input
                  value={v}
                  onChange={(e) => {
                    const next = arr.slice();
                    next[i] = e.target.value;
                    onChange(next);
                  }}
                  className="h-8 text-sm font-mono"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => onChange(arr.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-full"
              onClick={() => onChange([...arr, ""])}
            >
              <Plus className="h-3 w-3" /> Add
            </Button>
          </div>
          {field.help && <p className="text-[10px] text-muted-foreground">{field.help}</p>}
        </div>
      );
    }
    case "headers": {
      const arr = (Array.isArray(value) ? value : []) as HeaderEntry[];
      return (
        <div className="space-y-1">
          {label}
          <div className="space-y-1">
            {arr.map((h, i) => (
              <div key={i} className="flex gap-1">
                <Input
                  placeholder="Name"
                  value={h.name}
                  onChange={(e) => {
                    const next = arr.slice();
                    next[i] = { ...h, name: e.target.value };
                    onChange(next);
                  }}
                  className="h-8 flex-1 text-xs font-mono"
                />
                <Input
                  placeholder="Value"
                  value={h.value}
                  onChange={(e) => {
                    const next = arr.slice();
                    next[i] = { ...h, value: e.target.value };
                    onChange(next);
                  }}
                  className="h-8 flex-1 text-xs font-mono"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => onChange(arr.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-full"
              onClick={() => onChange([...arr, { name: "", value: "" }])}
            >
              <Plus className="h-3 w-3" /> Add header
            </Button>
          </div>
          {field.help && <p className="text-[10px] text-muted-foreground">{field.help}</p>}
        </div>
      );
    }
    default:
      return null;
  }
}
