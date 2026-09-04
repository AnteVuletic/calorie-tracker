import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Camera,
  ClipboardList,
  ImagePlus,
  Loader2,
  Utensils,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useObjectUrl } from "@/hooks/use-object-url";
import { useOnlineStatus } from "@/hooks/use-meals";
import {
  analyzeMealImage,
  analyzeNutritionLabel,
  estimatePortionGrams,
  formatPortionSuffix,
  parsePortionInput,
  scaleLabelNutrition,
  type LabelScanResult,
  type PortionInput,
  type ScanMode,
  type ScanResult,
} from "@/lib/gemini";
import { compressImage, compressOptionsForMode } from "@/lib/image";
import { getGeminiApiKey } from "@/lib/db";
import { roundMacro } from "@/lib/dates";
import type { NewMealInput } from "@/lib/db";
import { processPendingScans } from "@/lib/scan-queue";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (result: NewMealInput) => Promise<void>;
};

type EditableMacros = {
  label: string;
  calories: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
};

function toEditable(scan: ScanResult): EditableMacros {
  return {
    label: scan.label,
    calories: String(Math.round(scan.calories)),
    proteinG: String(roundMacro(scan.proteinG)),
    carbsG: String(roundMacro(scan.carbsG)),
    fatG: String(roundMacro(scan.fatG)),
  };
}

function fromEditable(edit: EditableMacros): ScanResult | null {
  const calories = Number(edit.calories);
  const proteinG = Number(edit.proteinG);
  const carbsG = Number(edit.carbsG);
  const fatG = Number(edit.fatG);
  if (![calories, proteinG, carbsG, fatG].every((n) => Number.isFinite(n))) {
    return null;
  }
  return {
    label: edit.label.trim() || "Meal",
    calories: Math.max(0, Math.round(calories)),
    proteinG: Math.max(0, roundMacro(proteinG)),
    carbsG: Math.max(0, roundMacro(carbsG)),
    fatG: Math.max(0, roundMacro(fatG)),
  };
}

export function AddMealDialog({ open, onOpenChange, onSaved }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const requestGen = useRef(0);
  const online = useOnlineStatus();

  const [mode, setMode] = useState<ScanMode | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [labelScan, setLabelScan] = useState<LabelScanResult | null>(null);
  const [edit, setEdit] = useState<EditableMacros | null>(null);
  const [portionRaw, setPortionRaw] = useState("");
  const [resolvedGrams, setResolvedGrams] = useState<number | null>(null);
  const [resolvedPortion, setResolvedPortion] = useState<PortionInput | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const previewUrl = useObjectUrl(blob);

  const portionParsed = parsePortionInput(portionRaw);
  const scaledLabel =
    labelScan && resolvedGrams != null
      ? scaleLabelNutrition(labelScan, resolvedGrams)
      : null;
  const needsPortionEstimate = portionParsed?.kind === "description";
  const portionReady =
    resolvedGrams != null &&
    resolvedPortion != null &&
    ((portionParsed?.kind === "grams" &&
      resolvedPortion.kind === "grams" &&
      resolvedPortion.grams === portionParsed.grams) ||
      (portionParsed?.kind === "description" &&
        resolvedPortion.kind === "description" &&
        resolvedPortion.text === portionParsed.text));

  const hasScanResult = Boolean(scan || labelScan);

  const bumpGeneration = () => {
    requestGen.current += 1;
  };

  const reset = () => {
    bumpGeneration();
    setMode(null);
    setBlob(null);
    setScan(null);
    setLabelScan(null);
    setEdit(null);
    setPortionRaw("");
    setResolvedGrams(null);
    setResolvedPortion(null);
    setBusy(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const clearPhoto = () => {
    bumpGeneration();
    setBlob(null);
    setScan(null);
    setLabelScan(null);
    setEdit(null);
    setPortionRaw("");
    setResolvedGrams(null);
    setResolvedPortion(null);
  };

  const onFile = async (file: File | undefined) => {
    if (!file || !mode) return;
    const gen = ++requestGen.current;
    try {
      setBusy(true);
      setScan(null);
      setLabelScan(null);
      setEdit(null);
      setPortionRaw("");
      setResolvedGrams(null);
      setResolvedPortion(null);
      const compressed = await compressImage(
        file,
        compressOptionsForMode(mode),
      );
      if (gen !== requestGen.current) return;
      setBlob(compressed);
    } catch (err) {
      if (gen !== requestGen.current) return;
      toast.error(err instanceof Error ? err.message : "Could not read photo");
    } finally {
      if (gen === requestGen.current) setBusy(false);
    }
  };

  const handleFileChange = (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = "";
    void onFile(file);
  };

  const savePending = async (errorMessage?: string) => {
    if (!blob || !mode) return;
    try {
      setBusy(true);
      await onSaved({
        imageBlob: blob,
        label: "Pending scan…",
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        status: "pending",
        scanMode: mode,
        lastError: errorMessage,
      });
      toast.success(
        online
          ? "Saved as pending — will retry scan shortly"
          : "Saved offline — will scan when you're back online",
      );
      handleOpenChange(false);
      if (navigator.onLine) {
        void processPendingScans({ silent: true });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save meal");
    } finally {
      setBusy(false);
    }
  };

  const analyze = async () => {
    if (!blob || !mode) return;
    if (!online) {
      await savePending();
      return;
    }
    const gen = ++requestGen.current;
    setBusy(true);
    try {
      const apiKey = await getGeminiApiKey();
      if (gen !== requestGen.current) return;
      if (!apiKey) {
        toast.error("Add your Gemini API key in Settings");
        return;
      }
      if (mode === "meal") {
        const result = await analyzeMealImage(apiKey, blob);
        if (gen !== requestGen.current) return;
        setScan(result);
        setLabelScan(null);
        setEdit(toEditable(result));
      } else {
        const result = await analyzeNutritionLabel(apiKey, blob);
        if (gen !== requestGen.current) return;
        setLabelScan(result);
        setScan(null);
        setPortionRaw(String(result.basisGrams));
        setResolvedGrams(result.basisGrams);
        setResolvedPortion({ kind: "grams", grams: result.basisGrams });
        const scaled = scaleLabelNutrition(result, result.basisGrams);
        setEdit(scaled ? toEditable(scaled) : null);
      }
    } catch (err) {
      if (gen !== requestGen.current) return;
      const message = err instanceof Error ? err.message : "Scan failed";
      toast.error(message, {
        action: {
          label: "Save pending",
          onClick: () => void savePending(message),
        },
      });
    } finally {
      if (gen === requestGen.current) setBusy(false);
    }
  };

  const resolvePortionGrams = async (
    portion: PortionInput,
  ): Promise<number | null> => {
    if (!labelScan || !blob) return null;
    if (portion.kind === "grams") return portion.grams;
    if (!online) {
      toast.error("You need internet to estimate a portion description");
      return null;
    }
    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      toast.error("Add your Gemini API key in Settings");
      return null;
    }
    return estimatePortionGrams(
      apiKey,
      blob,
      labelScan.label,
      labelScan.basisGrams,
      portion.text,
    );
  };

  const applyPortionResolution = (portion: PortionInput, grams: number) => {
    setResolvedGrams(grams);
    setResolvedPortion(portion);
    if (!labelScan) return;
    const scaled = scaleLabelNutrition(labelScan, grams);
    if (scaled) setEdit(toEditable(scaled));
  };

  const estimatePortion = async () => {
    if (!labelScan || !portionParsed || portionParsed.kind !== "description") {
      return;
    }
    const gen = ++requestGen.current;
    setBusy(true);
    try {
      const grams = await resolvePortionGrams(portionParsed);
      if (gen !== requestGen.current || grams == null) return;
      applyPortionResolution(portionParsed, grams);
    } catch (err) {
      if (gen !== requestGen.current) return;
      toast.error(
        err instanceof Error ? err.message : "Could not estimate portion",
      );
    } finally {
      if (gen === requestGen.current) setBusy(false);
    }
  };

  const save = async () => {
    if (!blob || !mode) {
      toast.error("Add a photo first");
      return;
    }
    let payload: ScanResult | null = null;
    if (mode === "meal") {
      if (!scan || !edit) return;
      payload = fromEditable(edit);
    } else {
      if (!labelScan || !portionParsed) {
        toast.error('Enter grams or a portion like "1 teaspoon"');
        return;
      }
      const gen = ++requestGen.current;
      setBusy(true);
      try {
        const wasReady = portionReady;
        let grams = wasReady ? resolvedGrams : null;
        let portion = wasReady ? resolvedPortion : portionParsed;
        if (grams == null || portion == null) {
          grams = await resolvePortionGrams(portionParsed);
          if (gen !== requestGen.current) return;
          if (grams == null) return;
          portion = portionParsed;
          applyPortionResolution(portion, grams);
        }
        const scaled = scaleLabelNutrition(labelScan, grams);
        if (!scaled) {
          toast.error('Enter grams or a portion like "1 teaspoon"');
          return;
        }
        // Only keep manual macro tweaks when this portion was already applied.
        const edited =
          wasReady && edit ? fromEditable(edit) : scaled;
        if (!edited) {
          toast.error("Check the nutrition numbers");
          return;
        }
        payload = {
          ...edited,
          label: `${edited.label} (${formatPortionSuffix(portion, grams)})`,
        };
        await onSaved({
          ...payload,
          imageBlob: blob,
          status: "logged",
          scanMode: mode,
        });
        toast.success("Meal added");
        handleOpenChange(false);
      } catch (err) {
        if (gen !== requestGen.current) return;
        toast.error(err instanceof Error ? err.message : "Could not save meal");
      } finally {
        if (gen === requestGen.current) setBusy(false);
      }
      return;
    }
    if (!payload) {
      toast.error("Check the nutrition numbers");
      return;
    }
    try {
      setBusy(true);
      await onSaved({
        ...payload,
        imageBlob: blob,
        status: "logged",
        scanMode: mode,
      });
      toast.success("Meal added");
      handleOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save meal");
    } finally {
      setBusy(false);
    }
  };

  // Scale macros when the user types a gram amount; descriptions need Estimate.
  const onPortionChange = (next: string) => {
    setPortionRaw(next);
    const parsed = parsePortionInput(next);
    if (!parsed || parsed.kind !== "grams") {
      setResolvedGrams(null);
      setResolvedPortion(null);
      return;
    }
    applyPortionResolution(parsed, parsed.grams);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {!mode
              ? "Add meal"
              : mode === "meal"
                ? "Scan meal"
                : "Scan nutrition label"}
          </DialogTitle>
          <DialogDescription>
            {!mode
              ? "Choose how you want to log this food."
              : mode === "meal"
                ? "Photograph the plate, then analyze with Gemini."
                : "Photograph the nutrition facts panel, then enter grams or a portion description."}
          </DialogDescription>
        </DialogHeader>

        {!online ? (
          <Alert>
            <WifiOff className="size-4" />
            <AlertTitle>Offline</AlertTitle>
            <AlertDescription>
              You can still save a photo as pending. It will scan automatically
              when you&apos;re back online.
            </AlertDescription>
          </Alert>
        ) : null}

        {!mode ? (
          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => setMode("meal")}
              className="hover:bg-secondary/80 border-border flex items-start gap-3 rounded-xl border p-4 text-left transition-colors"
            >
              <span className="bg-secondary text-primary rounded-lg p-2">
                <Utensils className="size-5" />
              </span>
              <span>
                <span className="block font-medium">Meal photo</span>
                <span className="text-muted-foreground mt-1 block text-sm">
                  Estimate calories from a photo of what you ate.
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMode("label")}
              className="hover:bg-secondary/80 border-border flex items-start gap-3 rounded-xl border p-4 text-left transition-colors"
            >
              <span className="bg-secondary text-primary rounded-lg p-2">
                <ClipboardList className="size-5" />
              </span>
              <span>
                <span className="block font-medium">Nutrition label</span>
                <span className="text-muted-foreground mt-1 block text-sm">
                  Read macros from the package label, then enter grams or a
                  portion.
                </span>
              </span>
            </button>
          </div>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-mt-1 w-fit px-2"
              onClick={() => {
                clearPhoto();
                setMode(null);
              }}
              disabled={busy}
            >
              <ArrowLeft />
              Change mode
            </Button>

            {mode === "label" ? (
              <Alert>
                <AlertTitle>Photograph the nutrition facts</AlertTitle>
                <AlertDescription>
                  Capture the macro breakdown on the label (calories, protein,
                  carbs, fat). Do not photograph the barcode — the AI needs the
                  actual nutrition panel.
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="flex gap-2">
              <Button
                type="button"
                className="flex-1"
                onClick={() => cameraRef.current?.click()}
                disabled={busy}
              >
                <Camera />
                Camera
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => galleryRef.current?.click()}
                disabled={busy}
              >
                <ImagePlus />
                Gallery
              </Button>
            </div>

            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => handleFileChange(e.currentTarget)}
            />
            <input
              ref={galleryRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFileChange(e.currentTarget)}
            />

            {previewUrl ? (
              <div className="bg-muted overflow-hidden rounded-xl">
                <img
                  src={previewUrl}
                  alt={mode === "label" ? "Label preview" : "Meal preview"}
                  className="max-h-64 w-full object-cover"
                />
              </div>
            ) : (
              <div className="text-muted-foreground border-border flex h-40 items-center justify-center rounded-xl border border-dashed text-sm">
                No photo yet
              </div>
            )}

            {labelScan ? (
              <div className="space-y-3 rounded-xl border p-3">
                <p className="text-muted-foreground text-xs tabular-nums">
                  Label basis: {Math.round(labelScan.calories)} kcal · P{" "}
                  {roundMacro(labelScan.proteinG)}g · C{" "}
                  {roundMacro(labelScan.carbsG)}g · F{" "}
                  {roundMacro(labelScan.fatG)}g per {labelScan.basisGrams}g
                </p>
                <div className="grid gap-2">
                  <Label htmlFor="portion">Amount eaten</Label>
                  <Input
                    id="portion"
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    placeholder='e.g. 150 or 1 row of chocolate'
                    value={portionRaw}
                    onChange={(e) => onPortionChange(e.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">
                    Grams, or a portion like &quot;1 row of chocolate&quot; or
                    &quot;one teaspoon&quot;.
                  </p>
                  {needsPortionEstimate ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void estimatePortion()}
                        disabled={busy || !online}
                      >
                        {busy ? <Loader2 className="animate-spin" /> : null}
                        Estimate portion
                      </Button>
                      {portionReady && resolvedGrams != null ? (
                        <span className="text-muted-foreground text-xs tabular-nums">
                          ≈ {roundMacro(resolvedGrams)}g
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {edit && hasScanResult && (mode !== "label" || portionReady) ? (
              <div className="grid gap-2 rounded-xl border p-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="food-label">Name</Label>
                  <Input
                    id="food-label"
                    value={edit.label}
                    onChange={(e) =>
                      setEdit({ ...edit, label: e.target.value })
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="kcal">Calories</Label>
                    <Input
                      id="kcal"
                      type="number"
                      inputMode="decimal"
                      value={edit.calories}
                      onChange={(e) =>
                        setEdit({ ...edit, calories: e.target.value })
                      }
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="protein">Protein (g)</Label>
                    <Input
                      id="protein"
                      type="number"
                      inputMode="decimal"
                      value={edit.proteinG}
                      onChange={(e) =>
                        setEdit({ ...edit, proteinG: e.target.value })
                      }
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="carbs">Carbs (g)</Label>
                    <Input
                      id="carbs"
                      type="number"
                      inputMode="decimal"
                      value={edit.carbsG}
                      onChange={(e) =>
                        setEdit({ ...edit, carbsG: e.target.value })
                      }
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="fat">Fat (g)</Label>
                    <Input
                      id="fat"
                      type="number"
                      inputMode="decimal"
                      value={edit.fatG}
                      onChange={(e) =>
                        setEdit({ ...edit, fatG: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>
            ) : null}

            <p className="text-muted-foreground text-xs">
              Missing a key?{" "}
              <Link
                to="/settings"
                className="text-primary underline"
                onClick={() => handleOpenChange(false)}
              >
                Open Settings
              </Link>
            </p>

            <DialogFooter className="gap-2 sm:gap-2">
              {hasScanResult ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void analyze()}
                    disabled={!blob || busy || !online}
                  >
                    {busy ? <Loader2 className="animate-spin" /> : null}
                    Re-analyze
                  </Button>
                  <Button
                    onClick={() => void save()}
                    disabled={
                      busy ||
                      !blob ||
                      (mode === "label"
                        ? !portionParsed ||
                          (portionParsed.kind === "grams" && !scaledLabel)
                        : !edit)
                    }
                  >
                    {busy ? <Loader2 className="animate-spin" /> : null}
                    Save meal
                  </Button>
                </>
              ) : (
                <>
                  {!online && blob ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void savePending()}
                      disabled={busy}
                    >
                      {busy ? <Loader2 className="animate-spin" /> : null}
                      Save for later
                    </Button>
                  ) : null}
                  <Button
                    onClick={() => void analyze()}
                    disabled={!blob || busy}
                  >
                    {busy ? <Loader2 className="animate-spin" /> : null}
                    {online ? "Analyze" : "Save pending"}
                  </Button>
                </>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
