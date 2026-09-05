import { useState } from "react";
import {
  Loader2,
  MoreVertical,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import type { Meal, MealStatus } from "@/lib/types";
import { formatMacro } from "@/lib/dates";
import { parsePortionInput } from "@/lib/gemini";
import { useObjectUrl } from "@/hooks/use-object-url";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<MealStatus, string> = {
  pending: "Pending",
  processing: "Processing",
  logged: "Logged",
  fail: "Fail",
};

function StatusBadge({ status }: { status: MealStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        status === "pending" &&
          "bg-amber-500/15 text-amber-800 dark:text-amber-300",
        status === "processing" &&
          "bg-sky-500/15 text-sky-800 dark:text-sky-300",
        status === "logged" &&
          "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
        status === "fail" &&
          "bg-red-500/15 text-red-800 dark:text-red-300",
      )}
    >
      {status === "pending" || status === "processing" ? (
        <Loader2 className="size-2.5 animate-spin" aria-hidden />
      ) : null}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function MealCard({
  meal,
  onDelete,
  onRescan,
  onUpdatePortion,
}: {
  meal: Meal;
  onDelete?: (id: string) => void;
  onRescan?: (id: string) => void;
  onUpdatePortion?: (id: string, portionRaw: string) => Promise<void>;
}) {
  const url = useObjectUrl(meal.imageBlob, meal.id);
  const isQueued =
    meal.status === "pending" || meal.status === "processing";
  const isFailed = meal.status === "fail";
  const isLabel = meal.scanMode === "label";
  const canEditPortion =
    isLabel && Boolean(onUpdatePortion) && meal.status !== "processing";

  const [portionOpen, setPortionOpen] = useState(false);
  const [portionDraft, setPortionDraft] = useState(meal.portionRaw ?? "");
  const [portionBusy, setPortionBusy] = useState(false);

  const openPortionEditor = () => {
    setPortionDraft(meal.portionRaw ?? "");
    setPortionOpen(true);
  };

  const savePortion = async () => {
    if (!onUpdatePortion) return;
    const parsed = parsePortionInput(portionDraft);
    if (!parsed) {
      toast.error('Enter grams or a portion like "1 teaspoon"');
      return;
    }
    try {
      setPortionBusy(true);
      await onUpdatePortion(meal.id, portionDraft.trim());
      toast.success("Portion updated — re-queued for analysis");
      setPortionOpen(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not update portion",
      );
    } finally {
      setPortionBusy(false);
    }
  };

  return (
    <>
      <Card className="overflow-hidden py-0">
        <CardContent className="flex gap-3 p-3">
          <div className="bg-muted size-20 shrink-0 overflow-hidden rounded-lg">
            {url ? (
              <img
                src={url}
                alt={meal.label}
                className="size-full object-cover"
              />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="truncate font-medium">{meal.label}</p>
                  <StatusBadge status={meal.status} />
                </div>
                <p className="text-muted-foreground text-xs">
                  {format(parseISO(meal.createdAt), "h:mm a")}
                  {isLabel && meal.portionRaw ? (
                    <>
                      {" · "}
                      <button
                        type="button"
                        className="hover:text-foreground underline-offset-2 hover:underline"
                        onClick={canEditPortion ? openPortionEditor : undefined}
                        disabled={!canEditPortion}
                      >
                        {meal.portionRaw}
                      </button>
                    </>
                  ) : null}
                </p>
              </div>
              {onDelete || onRescan || canEditPortion ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                    >
                      <MoreVertical className="size-4" />
                      <span className="sr-only">Meal actions</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canEditPortion ? (
                      <DropdownMenuItem onClick={openPortionEditor}>
                        <Pencil className="size-4" />
                        Edit portion
                      </DropdownMenuItem>
                    ) : null}
                    {onRescan ? (
                      <DropdownMenuItem
                        onClick={() => onRescan(meal.id)}
                        disabled={meal.status === "processing"}
                      >
                        <RefreshCw className="size-4" />
                        Rescan
                      </DropdownMenuItem>
                    ) : null}
                    {onDelete ? (
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => onDelete(meal.id)}
                      >
                        <Trash2 className="size-4" />
                        Delete
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
            {isQueued ? (
              <div className="mt-2 flex items-center gap-2">
                <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
                <p className="text-muted-foreground text-sm">
                  {meal.status === "processing"
                    ? "Analyzing with AI…"
                    : meal.lastError
                      ? `Retrying — ${meal.lastError}`
                      : "Waiting in queue…"}
                </p>
              </div>
            ) : isFailed ? (
              <div className="mt-2 space-y-2">
                <p className="text-muted-foreground text-sm">
                  {meal.lastError ?? "Scan failed after retries"}
                </p>
                <div className="flex flex-wrap gap-2">
                  {canEditPortion ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={openPortionEditor}
                    >
                      <Pencil className="size-3.5" />
                      Edit portion
                    </Button>
                  ) : null}
                  {onRescan ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onRescan(meal.id)}
                    >
                      <RefreshCw className="size-3.5" />
                      Rescan
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <>
                <p className="mt-2 text-lg font-semibold tabular-nums">
                  {Math.round(meal.calories)}{" "}
                  <span className="text-muted-foreground text-sm font-medium">
                    kcal
                  </span>
                </p>
                <p className="text-muted-foreground text-xs tabular-nums">
                  P {formatMacro(meal.proteinG)}g · C{" "}
                  {formatMacro(meal.carbsG)}g · F {formatMacro(meal.fatG)}g
                </p>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {canEditPortion ? (
        <Dialog open={portionOpen} onOpenChange={setPortionOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit portion</DialogTitle>
              <DialogDescription>
                Change the amount eaten. The label photo will be re-analyzed with
                the new portion.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor={`portion-${meal.id}`}>Amount eaten</Label>
              <Input
                id={`portion-${meal.id}`}
                type="text"
                inputMode="text"
                autoComplete="off"
                placeholder='e.g. 150 or 1 row of chocolate'
                value={portionDraft}
                onChange={(e) => setPortionDraft(e.target.value)}
                disabled={portionBusy}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void savePortion();
                  }
                }}
              />
              <p className="text-muted-foreground text-xs">
                Grams, or a portion like &quot;1 row of chocolate&quot; or
                &quot;one teaspoon&quot;.
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPortionOpen(false)}
                disabled={portionBusy}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void savePortion()}
                disabled={portionBusy || !parsePortionInput(portionDraft)}
              >
                {portionBusy ? <Loader2 className="animate-spin" /> : null}
                Save &amp; reanalyze
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
