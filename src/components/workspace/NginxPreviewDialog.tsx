import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import type { Workflow } from "@/services/api";
import { generateNginxConfig } from "@/lib/nginxGenerator";

interface Props {
  workflow: Workflow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export function NginxPreviewDialog({ workflow, open, onOpenChange }: Props) {
  const [copied, setCopied] = useState(false);
  const config = workflow ? generateNginxConfig(workflow) : "";

  const copy = async () => {
    await navigator.clipboard.writeText(config);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Generated nginx.conf</span>
            <Button size="sm" variant="outline" onClick={copy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </DialogTitle>
        </DialogHeader>
        <pre className="max-h-[60vh] overflow-auto rounded-md border border-border/60 bg-muted/40 p-4 font-mono text-xs leading-relaxed">
          {config}
        </pre>
      </DialogContent>
    </Dialog>
  );
}
