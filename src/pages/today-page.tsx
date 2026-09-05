import { useState } from "react";
import { Plus } from "lucide-react";
import { formatDisplayDate } from "@/lib/dates";
import { useLocalDayKey, useMealsForDay } from "@/hooks/use-meals";
import { MacroSummary } from "@/components/macro-summary";
import { MealCard } from "@/components/meal-card";
import { AddMealDialog } from "@/components/add-meal-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function TodayPage() {
  const dayKey = useLocalDayKey();
  const { meals, loading, error, totals, create, remove, rescan, updatePortion, updateContext } =
    useMealsForDay(dayKey);
  const [open, setOpen] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 pt-4 pb-4">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-sm">Today</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {formatDisplayDate(dayKey)}
          </h1>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus />
          Add
        </Button>
      </header>

      <MacroSummary totals={totals} />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Meals</h2>
        {loading ? (
          <>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </>
        ) : error ? (
          <div className="border-border text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
            {error}
          </div>
        ) : meals.length === 0 ? (
          <div className="border-border text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
            No meals yet. Snap a photo to log your first one.
          </div>
        ) : (
          meals.map((meal) => (
            <MealCard
              key={meal.id}
              meal={meal}
              onDelete={(id) => void remove(id)}
              onRescan={(id) => void rescan(id)}
              onUpdatePortion={(id, portionRaw) =>
                updatePortion(id, portionRaw).then(() => undefined)
              }
              onUpdateContext={(id, extraContext) =>
                updateContext(id, extraContext).then(() => undefined)
              }
            />
          ))
        )}
      </section>

      <AddMealDialog
        open={open}
        onOpenChange={setOpen}
        onSaved={async (result) => {
          await create(result);
        }}
      />
    </div>
  );
}