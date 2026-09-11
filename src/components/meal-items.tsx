import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { macrosForItem, mealHasEditableItems } from "@/lib/meal-items";
import { formatMacro } from "@/lib/dates";
import type { Meal, MealItem, MealItemEdit } from "@/lib/types";
import { Button } from "@/components/ui/button";
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

type DraftRow = { id: string; name: string; grams: string };

function parseDraftGrams(raw: string): number | null {
  const grams = Number(raw.trim().replace(",", "."));
  if (!Number.isFinite(grams) || grams <= 0) return null;
  return grams;
}

function rowsFromItems(items: MealItem[]): DraftRow[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    grams: String(item.grams),
  }));
}

function editsFromDraft(
  original: MealItem[],
  draft: DraftRow[],
): MealItemEdit[] | string {
  if (draft.length === 0) {
    return "Keep at least one item, or Rescan the meal";
  }

  const remaining = new Map(draft.map((row) => [row.id, row]));
  const edits: MealItemEdit[] = [];

  for (const item of original) {
    if (!remaining.has(item.id)) {
      edits.push({ kind: "remove", itemId: item.id });
    }
  }

  for (const row of draft) {
    const grams = parseDraftGrams(row.grams);
    if (grams == null) {
      return `Enter a positive gram amount for ${row.name}`;
    }
    const orig = original.find((item) => item.id === row.id);
    if (orig && orig.grams !== grams) {
      edits.push({ kind: "setGrams", itemId: row.id, grams });
    }
  }

  return edits;
}

export function MealItemSummary({ meal }: { meal: Meal }) {
  if (!mealHasEditableItems(meal) || !meal.items) return null;

  return (
    <ul className="mt-2 space-y-1">
      {meal.items.map((item) => {
        const macros = macrosForItem(item);
        return (
          <li
            key={item.id}
            className="text-muted-foreground flex items-baseline justify-between gap-2 text-xs tabular-nums"
          >
            <span className="text-foreground min-w-0 truncate">{item.name}</span>
            <span className="shrink-0">
              {formatMacro(item.grams)}g · {macros.calories} kcal
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function MealItemsEditor({
  meal,
  open,
  onOpenChange,
  onSave,
}: {
  meal: Meal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (edits: readonly MealItemEdit[]) => Promise<void>;
}) {
  const items = meal.items;
  const [draft, setDraft] = useState<DraftRow[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && items) setDraft(rowsFromItems(items));
  }, [open, items]);

  const updateGrams = (id: string, grams: string) => {
    setDraft((rows) =>
      rows.map((row) => (row.id === id ? { ...row, grams } : row)),
    );
  };

  const removeRow = (id: string) => {
    if (draft.length <= 1) {
      toast.error("Keep at least one item, or Rescan the meal");
      return;
    }
    setDraft((rows) => rows.filter((row) => row.id !== id));
  };

  const scaleDraft = (factor: number) => {
    setDraft((rows) =>
      rows.map((row) => {
        const grams = parseDraftGrams(row.grams);
        if (grams == null) return row;
        return { ...row, grams: String(grams * factor) };
      }),
    );
  };

  const save = async () => {
    if (!items) return;
    const result = editsFromDraft(items, draft);
    if (typeof result === "string") {
      toast.error(result);
      return;
    }
    if (result.length === 0) {
      onOpenChange(false);
      return;
    }
    try {
      setBusy(true);
      await onSave(result);
      toast.success("Amounts updated");
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not update amounts",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit amounts</DialogTitle>
          <DialogDescription>
            Change how much you ate. Totals update immediately without a new
            scan.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {draft.map((row) => (
            <div key={row.id} className="flex items-end gap-2">
              <div className="grid min-w-0 flex-1 gap-1.5">
                <Label htmlFor={`grams-${row.id}`}>{row.name}</Label>
                <Input
                  id={`grams-${row.id}`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={row.grams}
                  onChange={(e) => updateGrams(row.id, e.target.value)}
                  disabled={busy}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-10 shrink-0"
                onClick={() => removeRow(row.id)}
                disabled={busy || draft.length <= 1}
                aria-label={`Remove ${row.name}`}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => scaleDraft(0.5)}
            disabled={busy}
          >
            I ate half
          </Button>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={busy}
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
