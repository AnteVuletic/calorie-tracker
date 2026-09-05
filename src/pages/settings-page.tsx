import { useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import { useApiKey } from "@/hooks/use-meals";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SettingsPage() {
  const { apiKey, loaded, save, clear, wipeAll } = useApiKey();
  const [draft, setDraft] = useState("");
  const [show, setShow] = useState(false);
  const [dirty, setDirty] = useState(false);

  const value = dirty ? draft : apiKey;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 pb-28 pt-4">
      <header>
        <p className="text-muted-foreground text-sm">Settings</p>
        <h1 className="text-2xl font-semibold tracking-tight">Preferences</h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Gemini API key</CardTitle>
          <CardDescription>
            Stored only on this device in IndexedDB. Needed to scan meal photos.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-2">
            <Label htmlFor="apiKey">API key</Label>
            <div className="flex gap-2">
              <Input
                id="apiKey"
                type={show ? "text" : "password"}
                autoComplete="off"
                placeholder="Paste key"
                value={value}
                onChange={(e) => {
                  setDirty(true);
                  setDraft(e.target.value);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? "Hide key" : "Show key"}
              >
                {show ? <EyeOff /> : <Eye />}
              </Button>
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            Restrict this key in Google AI Studio (HTTP referrer + Generative
            Language API only) and set a spend cap — the key lives in the
            browser by design.
          </p>
          <div className="flex gap-2">
            <Button
              onClick={() =>
                void (async () => {
                  await save(value);
                  setDirty(false);
                  toast.success("API key saved");
                })()
              }
              disabled={!loaded}
            >
              Save
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                void (async () => {
                  await clear();
                  setDraft("");
                  setDirty(false);
                  toast.success("API key cleared");
                })()
              }
            >
              Clear key
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Install on iPhone</CardTitle>
          <CardDescription>
            Safari never shows an Install / Add app button. You install manually.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground space-y-2 text-sm">
          <ol className="list-decimal space-y-1 pl-4">
            <li>Open this site in <strong className="text-foreground">Safari</strong> (not Chrome)</li>
            <li>Tap the Share button (square with ↑)</li>
            <li>Scroll and tap <strong className="text-foreground">Add to Home Screen</strong></li>
            <li>Tap Add</li>
          </ol>
          <p>
            Use an <strong className="text-foreground">https://</strong> URL for
            offline caching. A plain LAN <code className="text-foreground">http://192.168…</code>{" "}
            link still works while your PC is serving, but the service worker may
            not install.
          </p>
        </CardContent>
      </Card>

      <Alert>
        <AlertTitle>Data & privacy</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>
            Meals, photos, and your API key are stored in this browser until you
            delete them.
          </p>
          <p>
            When you scan a photo, that image is sent to Google Gemini to
            estimate nutrition. Logs you save stay on-device afterward.
          </p>
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Danger zone</CardTitle>
          <CardDescription>
            Erase all meals and the saved API key.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            onClick={() =>
              void (async () => {
                if (!confirm("Delete all local data?")) return;
                await wipeAll();
                setDraft("");
                setDirty(false);
                toast.success("All local data cleared");
              })()
            }
          >
            <Trash2 />
            Clear all data
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}