import { useMemo, useState } from "react";
import {
  endOfMonth,
  format,
  startOfMonth,
  startOfWeek,
  endOfWeek,
  addWeeks,
} from "date-fns";
import {
  toDayKey,
  weekDayKeys,
  formatDisplayDate,
  isNotFuture,
  clampToToday,
  parseDayKey,
} from "@/lib/dates";
import { useMealsForDay, useMealsRange } from "@/hooks/use-meals";
import { MacroSummary } from "@/components/macro-summary";
import { MealCard } from "@/components/meal-card";
import { Calendar } from "@/components/ui/calendar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

type ViewMode = "month" | "week" | "day";

export function HistoryPage() {
  const today = new Date();
  const todayKey = toDayKey(today);
  const [selected, setSelected] = useState<Date>(() => clampToToday(today, today));
  const [displayMonth, setDisplayMonth] = useState<Date>(() =>
    startOfMonth(today),
  );
  const [mode, setMode] = useState<ViewMode>("month");
  const selectedKey = toDayKey(selected);

  const range = useMemo(() => {
    if (mode === "week") {
      return {
        from: toDayKey(startOfWeek(selected, { weekStartsOn: 1 })),
        to: toDayKey(endOfWeek(selected, { weekStartsOn: 1 })),
      };
    }
    if (mode === "month") {
      return {
        from: toDayKey(startOfMonth(displayMonth)),
        to: toDayKey(endOfMonth(displayMonth)),
      };
    }
    return { from: selectedKey, to: selectedKey };
  }, [mode, selected, selectedKey, displayMonth]);

  // Don't query future days within the current week/month.
  const clampedTo = range.to > todayKey ? todayKey : range.to;
  const wasClamped = clampedTo !== range.to;

  const { caloriesByDay, loading: rangeLoading, totals: rangeTotals, refresh: refreshRange } =
    useMealsRange(range.from, clampedTo);

  const dayState = useMealsForDay(selectedKey);
  const weekKeys = weekDayKeys(selected);

  const periodTitle =
    mode === "day"
      ? formatDisplayDate(selectedKey)
      : mode === "week"
        ? wasClamped
          ? `${format(parseDayKey(range.from), "MMM d")} – ${format(parseDayKey(clampedTo), "MMM d")}`
          : `Week of ${format(startOfWeek(selected, { weekStartsOn: 1 }), "MMM d")}`
        : wasClamped
          ? `${format(parseDayKey(range.from), "MMM d")} – ${format(parseDayKey(clampedTo), "MMM d")}`
          : format(displayMonth, "MMMM yyyy");

  const selectDay = (date: Date) => {
    const next = clampToToday(date, today);
    setSelected(next);
    setDisplayMonth(startOfMonth(next));
  };

  const shiftWeek = (delta: number) => {
    selectDay(addWeeks(selected, delta));
  };

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 pb-28 pt-4">
      <header>
        <p className="text-muted-foreground text-sm">History</p>
        <h1 className="text-2xl font-semibold tracking-tight">All meals</h1>
      </header>

      <Tabs value={mode} onValueChange={(v) => setMode(v as ViewMode)}>
        <TabsList className="w-full">
          <TabsTrigger value="month" className="flex-1">
            Month
          </TabsTrigger>
          <TabsTrigger value="week" className="flex-1">
            Week
          </TabsTrigger>
          <TabsTrigger value="day" className="flex-1">
            Day
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {mode === "day" || mode === "month" ? (
        <div className="bg-card space-y-3 rounded-xl border p-2">
          <Calendar
            mode="single"
            weekStartsOn={1}
            selected={selected}
            month={displayMonth}
            onMonthChange={(m) =>
              setDisplayMonth(startOfMonth(clampToToday(m, today)))
            }
            onSelect={(d) => d && selectDay(d)}
            endMonth={today}
            disabled={(date) => !isNotFuture(toDayKey(date), today)}
            modifiers={
              mode === "month"
                ? {
                    hasMeals: Object.keys(caloriesByDay).map((key) =>
                      parseDayKey(key),
                    ),
                  }
                : undefined
            }
            modifiersClassNames={{
              hasMeals: "font-semibold underline decoration-primary",
            }}
          />
          {mode === "month" ? (
            <div className="text-muted-foreground grid grid-cols-2 gap-2 px-2 pb-2 text-xs">
              {Object.entries(caloriesByDay)
                .sort(([a], [b]) => b.localeCompare(a))
                .map(([key, kcal]) => (
                  <button
                    key={key}
                    type="button"
                    className={cn(
                      "hover:bg-secondary rounded-md px-2 py-1 text-left tabular-nums",
                      key === selectedKey && "bg-secondary text-foreground",
                    )}
                    onClick={() => selectDay(parseDayKey(key))}
                  >
                    {format(parseDayKey(key), "MMM d")} · {Math.round(kcal)}{" "}
                    kcal
                  </button>
                ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {mode === "week" ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => shiftWeek(-1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <p className="text-sm font-medium">{periodTitle}</p>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => shiftWeek(1)}
              disabled={
                toDayKey(startOfWeek(addWeeks(selected, 1), { weekStartsOn: 1 })) >
                todayKey
              }
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {weekKeys.map((key) => {
              const active = key === selectedKey;
              const selectable = isNotFuture(key, today);
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!selectable}
                  onClick={() => selectDay(parseDayKey(key))}
                  className={cn(
                    "rounded-lg border p-2 text-center text-xs",
                    active && "border-primary bg-secondary",
                    !selectable && "opacity-40",
                  )}
                >
                  <div className="text-muted-foreground">
                    {format(parseDayKey(key), "EEE")}
                  </div>
                  <div className="font-medium">
                    {format(parseDayKey(key), "d")}
                  </div>
                  <div className="text-muted-foreground mt-1 tabular-nums">
                    {key in caloriesByDay
                      ? Math.round(caloriesByDay[key]!)
                      : "—"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {wasClamped && mode !== "day" ? (
        <p className="text-muted-foreground text-xs">
          Partial period — totals include only days through today.
        </p>
      ) : null}

      <MacroSummary
        totals={mode === "day" ? dayState.totals : rangeTotals}
        title={periodTitle}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">
          {mode === "day" ? "Meals that day" : "Selected day meals"}
        </h2>
        {dayState.loading ? (
          <Skeleton className="h-24 w-full" />
        ) : dayState.error ? (
          <div className="border-border text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
            {dayState.error}
          </div>
        ) : dayState.meals.length === 0 ? (
          <div className="border-border text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
            No meals logged for {formatDisplayDate(selectedKey)}.
          </div>
        ) : (
          dayState.meals.map((meal) => (
            <MealCard
              key={meal.id}
              meal={meal}
              onDelete={(id) =>
                void dayState.remove(id).then(() => refreshRange())
              }
              onRescan={(id) =>
                void dayState.rescan(id).then(() => refreshRange())
              }
              onUpdatePortion={(id, portionRaw) =>
                dayState
                  .updatePortion(id, portionRaw)
                  .then(() => refreshRange())
              }
            />
          ))
        )}
      </section>

      {mode !== "day" && !rangeLoading ? (
        <p className="text-muted-foreground text-xs tabular-nums">
          Period total: {Math.round(rangeTotals.calories)} kcal · P{" "}
          {rangeTotals.proteinG.toFixed(1)}g · C {rangeTotals.carbsG.toFixed(1)}
          g · F {rangeTotals.fatG.toFixed(1)}g
        </p>
      ) : null}
    </div>
  );
}
