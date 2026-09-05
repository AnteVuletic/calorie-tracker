import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Camera,
  ClipboardList,
  ImagePlus,
  Loader2,
  Search,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useObjectUrl } from "@/hooks/use-object-url";
import { useOnlineStatus } from "@/hooks/use-meals";
import { parsePortionInput, type ScanMode } from "@/lib/gemini";
import { compressImage, compressOptionsForMode } from "@/lib/image";
import { getGeminiApiKey, getLoggedLabelMeals } from "@/lib/db";
import type { NewMealInput } from "@/lib/db";
import { processPendingScans } from "@/lib/scan-queue";
import {
  dedupeBySimilarName,
  filterByFoodQuery,
  productNameFromLabel,
} from "@/lib/food-match";
import type { Meal } from "@/lib/types";
import { formatMacro } from "@/lib/dates";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (result: NewMealInput) => Promise<void>;
};

type LabelSourceTab = "new" | "previous";

export function AddMealDialog({ open, onOpenChange, onSaved }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const requestGen = useRef(0);
  const online = useOnlineStatus();

  const [mode, setMode] = useState<ScanMode | null>(null);
  const [labelTab, setLabelTab] = useState<LabelSourceTab>("new");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [portionRaw, setPortionRaw] = useState("");
  const [busy, setBusy] = useState(false);

  const [previousLoading, setPreviousLoading] = useState(false);
  const [previousEntries, setPreviousEntries] = useState<Meal[]>([]);
  const [searchDraft, setSearchDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPrevious, setSelectedPrevious] = useState<Meal | null>(null);

  const previewUrl = useObjectUrl(blob);
  const selectedPreviewUrl = useObjectUrl(selectedPrevious?.imageBlob ?? null);

  const portionParsed = parsePortionInput(portionRaw);
  const canAnalyzeNew =
    Boolean(blob) &&
    !busy &&
    (mode === "meal" || (mode === "label" && Boolean(portionParsed)));
  const canAnalyzePrevious =
    Boolean(selectedPrevious) && !busy && Boolean(portionParsed);

  const bumpGeneration = () => {
    requestGen.current += 1;
  };

  const reset = () => {
    bumpGeneration();
    setMode(null);
    setLabelTab("new");
    setBlob(null);
    setPortionRaw("");
    setBusy(false);
    setPreviousLoading(false);
    setPreviousEntries([]);
    setSearchDraft("");
    setSearchQuery("");
    setSelectedPrevious(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const clearPhoto = () => {
    bumpGeneration();
    setBlob(null);
    setPortionRaw("");
  };

  useEffect(() => {
    if (!open || mode !== "label" || labelTab !== "previous") return;
    let cancelled = false;
    setPreviousLoading(true);
    void getLoggedLabelMeals()
      .then((meals) => {
        if (cancelled) return;
        setPreviousEntries(dedupeBySimilarName(meals));
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(
          err instanceof Error ? err.message : "Could not load previous labels",
        );
        setPreviousEntries([]);
      })
      .finally(() => {
        if (!cancelled) setPreviousLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, mode, labelTab]);

  const onFile = async (file: File | undefined) => {
    if (!file || !mode) return;
    const gen = ++requestGen.current;
    try {
      setBusy(true);
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

  const queueLabelOrMeal = async (
    imageBlob: Blob,
    scanMode: ScanMode,
    portion?: string,
  ) => {
    if (scanMode === "label" && !parsePortionInput(portion ?? "")) {
      toast.error('Enter grams or a portion like "1 teaspoon"');
      return;
    }

    if (online) {
      const apiKey = await getGeminiApiKey();
      if (!apiKey?.trim()) {
        toast.error("Add your Gemini API key in Settings");
        return;
      }
    }

    try {
      setBusy(true);
      await onSaved({
        imageBlob,
        label: "Pending scan…",
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        status: "pending",
        scanMode,
        portionRaw: scanMode === "label" ? portion?.trim() : undefined,
        retryCount: 0,
        nextAttemptAt: undefined,
      });
      toast.success(
        online
          ? "Queued for analysis"
          : "Saved offline — will scan when you're back online",
      );
      handleOpenChange(false);
      if (navigator.onLine) {
        void processPendingScans({ silent: true });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not queue meal");
    } finally {
      setBusy(false);
    }
  };

  /** Queue the scan as pending; Gemini runs in the background queue. */
  const analyze = async () => {
    if (mode === "label" && labelTab === "previous") {
      if (!selectedPrevious) return;
      await queueLabelOrMeal(
        selectedPrevious.imageBlob,
        "label",
        portionRaw,
      );
      return;
    }
    if (!blob || !mode) return;
    await queueLabelOrMeal(blob, mode, portionRaw);
  };

  const filteredPrevious = filterByFoodQuery(previousEntries, searchQuery);

  const applySearch = () => {
    setSearchQuery(searchDraft.trim());
  };

  const selectPrevious = (meal: Meal) => {
    setSelectedPrevious(meal);
    setPortionRaw("");
  };

  const renderPortionField = (id: string) => (
    <div className="grid gap-2">
      <Label htmlFor={id}>Amount eaten</Label>
      <Input
        id={id}
        type="text"
        inputMode="text"
        autoComplete="off"
        placeholder='e.g. 150 or 1 row of chocolate'
        value={portionRaw}
        onChange={(e) => setPortionRaw(e.target.value)}
        disabled={busy}
      />
      <p className="text-muted-foreground text-xs">
        Required. Grams, or a portion like &quot;1 row of chocolate&quot; or
        &quot;one teaspoon&quot;.
      </p>
    </div>
  );

  const renderNewLabelFlow = () => (
    <>
      <Alert>
        <AlertTitle>Photograph the nutrition facts</AlertTitle>
        <AlertDescription>
          Capture the macro breakdown on the label (calories, protein, carbs,
          fat). Do not photograph the barcode — the AI needs the actual
          nutrition panel. Enter how much you ate before analyzing.
        </AlertDescription>
      </Alert>

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
            alt="Label preview"
            className="max-h-64 w-full object-cover"
          />
        </div>
      ) : (
        <div className="text-muted-foreground border-border flex h-40 items-center justify-center rounded-xl border border-dashed text-sm">
          No photo yet
        </div>
      )}

      {renderPortionField("portion-new")}
    </>
  );

  const renderPreviousLabelFlow = () => {
    if (selectedPrevious) {
      const name = productNameFromLabel(selectedPrevious.label);
      return (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-mt-1 w-fit px-2"
            onClick={() => {
              setSelectedPrevious(null);
              setPortionRaw("");
            }}
            disabled={busy}
          >
            <ArrowLeft />
            Back to list
          </Button>

          <div className="flex gap-3 rounded-xl border p-3">
            <div className="bg-muted size-16 shrink-0 overflow-hidden rounded-lg">
              {selectedPreviewUrl ? (
                <img
                  src={selectedPreviewUrl}
                  alt={name}
                  className="size-full object-cover"
                />
              ) : null}
            </div>
            <div className="min-w-0">
              <p className="truncate font-medium">{name}</p>
              <p className="text-muted-foreground text-xs tabular-nums">
                Last logged · {Math.round(selectedPrevious.calories)} kcal · P{" "}
                {formatMacro(selectedPrevious.proteinG)}g · C{" "}
                {formatMacro(selectedPrevious.carbsG)}g · F{" "}
                {formatMacro(selectedPrevious.fatG)}g
              </p>
            </div>
          </div>

          {renderPortionField("portion-previous")}
        </>
      );
    }

    return (
      <>
        <div className="flex gap-2">
          <Input
            type="search"
            inputMode="search"
            autoComplete="off"
            placeholder="Search previous labels…"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applySearch();
              }
            }}
            disabled={busy || previousLoading}
          />
          <Button
            type="button"
            variant="outline"
            onClick={applySearch}
            disabled={busy || previousLoading}
          >
            <Search />
            Search
          </Button>
        </div>

        {previousLoading ? (
          <div className="text-muted-foreground flex h-40 items-center justify-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            Loading previous labels…
          </div>
        ) : filteredPrevious.length === 0 ? (
          <div className="text-muted-foreground border-border flex h-40 items-center justify-center rounded-xl border border-dashed px-4 text-center text-sm">
            {previousEntries.length === 0
              ? "No previous nutrition labels yet. Scan one in the New tab."
              : "No labels match that search."}
          </div>
        ) : (
          <ul className="max-h-64 space-y-2 overflow-y-auto">
            {filteredPrevious.map((meal) => {
              const name = productNameFromLabel(meal.label);
              return (
                <li key={meal.id}>
                  <button
                    type="button"
                    onClick={() => selectPrevious(meal)}
                    disabled={busy}
                    className={cn(
                      "hover:bg-secondary/80 border-border flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                    )}
                  >
                    <PreviousThumb blob={meal.imageBlob} alt={name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{name}</span>
                      <span className="text-muted-foreground mt-0.5 block text-xs tabular-nums">
                        {Math.round(meal.calories)} kcal · P{" "}
                        {formatMacro(meal.proteinG)}g · C{" "}
                        {formatMacro(meal.carbsG)}g · F{" "}
                        {formatMacro(meal.fatG)}g
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </>
    );
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
                ? "Photograph the plate, then queue it for analysis."
                : labelTab === "previous"
                  ? "Pick a previously scanned label and enter how much you ate."
                  : "Photograph the nutrition facts panel and enter the amount eaten, then queue for analysis."}
          </DialogDescription>
        </DialogHeader>

        {!online ? (
          <Alert>
            <WifiOff className="size-4" />
            <AlertTitle>Offline</AlertTitle>
            <AlertDescription>
              You can still queue a photo as pending. It will scan automatically
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
                  Read macros from the package label with image and portion
                  together.
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
                setSelectedPrevious(null);
                setLabelTab("new");
                setMode(null);
              }}
              disabled={busy}
            >
              <ArrowLeft />
              Change mode
            </Button>

            {mode === "label" ? (
              <Tabs
                value={labelTab}
                onValueChange={(v) => {
                  const next = v as LabelSourceTab;
                  setLabelTab(next);
                  setPortionRaw("");
                  setSelectedPrevious(null);
                  if (next === "new") {
                    /* keep photo if user switches back */
                  } else {
                    setBlob(null);
                  }
                }}
              >
                <TabsList className="w-full">
                  <TabsTrigger value="new" className="flex-1">
                    New
                  </TabsTrigger>
                  <TabsTrigger value="previous" className="flex-1">
                    Previous
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="new" className="grid gap-3">
                  {renderNewLabelFlow()}
                </TabsContent>
                <TabsContent value="previous" className="grid gap-3">
                  {renderPreviousLabelFlow()}
                </TabsContent>
              </Tabs>
            ) : (
              <>
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
                      alt="Meal preview"
                      className="max-h-64 w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="text-muted-foreground border-border flex h-40 items-center justify-center rounded-xl border border-dashed text-sm">
                    No photo yet
                  </div>
                )}
              </>
            )}

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

            {(mode === "meal" ||
              labelTab === "new" ||
              selectedPrevious) && (
              <DialogFooter className="gap-2 sm:gap-2">
                <Button
                  onClick={() => void analyze()}
                  disabled={
                    mode === "label" && labelTab === "previous"
                      ? !canAnalyzePrevious
                      : !canAnalyzeNew
                  }
                >
                  {busy ? <Loader2 className="animate-spin" /> : null}
                  {online ? "Analyze" : "Save pending"}
                </Button>
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PreviousThumb({ blob, alt }: { blob: Blob; alt: string }) {
  const url = useObjectUrl(blob);
  return (
    <span className="bg-muted size-12 shrink-0 overflow-hidden rounded-lg">
      {url ? (
        <img src={url} alt={alt} className="size-full object-cover" />
      ) : null}
    </span>
  );
}
