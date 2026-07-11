import { cn } from "@/lib/utils";

const styles: Record<string, string> = {
  deployed: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  success: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  valid: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  drifted: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  expiring: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  in_progress: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  failed: "bg-red-500/10 text-red-500 border-red-500/20",
  expired: "bg-red-500/10 text-red-500 border-red-500/20",
  rolled_back: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  draft: "bg-muted text-muted-foreground border-border",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize",
        styles[status] ?? "bg-muted text-muted-foreground border-border",
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status.replace("_", " ")}
    </span>
  );
}
