import type { MacroTotals } from "@/lib/types";
import { formatMacro } from "@/lib/dates";
import { Card, CardContent } from "@/components/ui/card";

export function MacroSummary({
  totals,
  title,
}: {
  totals: MacroTotals;
  title?: string;
}) {
  return (
    <Card className="border-primary/20 bg-card/90">
      <CardContent className="pt-1">
        {title ? (
          <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
            {title}
          </p>
        ) : null}
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-muted-foreground text-sm">Calories</p>
            <p className="text-4xl font-semibold tracking-tight tabular-nums">
              {Math.round(totals.calories)}
              <span className="text-muted-foreground ml-1 text-base font-medium">
                kcal
              </span>
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center text-sm">
            <Macro label="Protein" value={totals.proteinG} />
            <Macro label="Carbs" value={totals.carbsG} />
            <Macro label="Fat" value={totals.fatG} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Macro({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-muted-foreground text-[0.7rem]">{label}</p>
      <p className="font-semibold tabular-nums">{formatMacro(value)}g</p>
    </div>
  );
}