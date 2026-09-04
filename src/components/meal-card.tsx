import { MoreVertical, RefreshCw, Trash2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import type { Meal, MealStatus } from "@/lib/types";
import { formatMacro } from "@/lib/dates";
import { useObjectUrl } from "@/hooks/use-object-url";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<MealStatus, string> = {
  pending: "Pending",
  scanned: "Scanned",
  logged: "Logged",
};

function StatusBadge({ status }: { status: MealStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        status === "pending" &&
          "bg-amber-500/15 text-amber-800 dark:text-amber-300",
        status === "scanned" &&
          "bg-sky-500/15 text-sky-800 dark:text-sky-300",
        status === "logged" &&
          "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function MealCard({
  meal,
  onDelete,
  onRescan,
}: {
  meal: Meal;
  onDelete?: (id: string) => void;
  onRescan?: (id: string) => void;
}) {
  const url = useObjectUrl(meal.imageBlob);
  const isPending = meal.status === "pending";

  return (
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
              </p>
            </div>
            {onDelete || onRescan ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-8 shrink-0">
                    <MoreVertical className="size-4" />
                    <span className="sr-only">Meal actions</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {onRescan ? (
                    <DropdownMenuItem onClick={() => onRescan(meal.id)}>
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
          {isPending ? (
            <div className="mt-2 space-y-2">
              <p className="text-muted-foreground text-sm">
                Waiting for scan
                {meal.lastError ? ` — ${meal.lastError}` : ""}
              </p>
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
          ) : (
            <>
              <p className="mt-2 text-lg font-semibold tabular-nums">
                {Math.round(meal.calories)}{" "}
                <span className="text-muted-foreground text-sm font-medium">
                  kcal
                </span>
              </p>
              <p className="text-muted-foreground text-xs tabular-nums">
                P {formatMacro(meal.proteinG)}g · C {formatMacro(meal.carbsG)}g ·
                F {formatMacro(meal.fatG)}g
              </p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
