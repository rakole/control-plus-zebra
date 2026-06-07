import { Clock3 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  emitRetentionJobStatus,
  getRetentionJobStatus,
  getSettings,
  onRetentionJobChanged,
  updateSettings,
  type RetentionJobStatus,
  type UpdateSettingsRequest
} from "../../../bridge/settings.js";
import { PageHeader } from "../../../components/app/page-header.js";
import { RoutePage } from "../../../components/app/route-page.js";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "../../../components/ui/alert-dialog.js";
import { Button } from "../../../components/ui/button.js";
import { Spinner } from "../../../components/ui/spinner.js";
import { cn } from "../../../lib/utils.js";

type RetentionDays = 3 | 7 | 30;

const retentionOptions = [
  { value: 3, label: "3 days" },
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" }
] as const;

export function SettingsRoute() {
  const [savedRetentionDays, setSavedRetentionDays] = useState<RetentionDays>(7);
  const [selectedRetentionDays, setSelectedRetentionDays] = useState<RetentionDays>(7);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<UpdateSettingsRequest | null>(null);
  const observedActiveJobRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    async function loadSettings() {
      setIsLoading(true);
      setLoadFailed(false);

      const response = await getSettings();

      if (!mounted) {
        return;
      }

      if (!response.ok) {
        setLoadFailed(true);
        setIsLoading(false);
        return;
      }

      setSavedRetentionDays(response.settings.retentionDays);
      setSelectedRetentionDays(response.settings.retentionDays);
      setIsLoading(false);
    }

    async function hydrateRoute() {
      const response = await getRetentionJobStatus();

      if (!mounted || !response.ok) {
        await loadSettings();
        return;
      }

      observedActiveJobRef.current = isNonTerminalJobStatus(response.job);
      await loadSettings();
    }

    void hydrateRoute();
    const unsubscribe = onRetentionJobChanged((status) => {
      if (!mounted) {
        return;
      }

      if (isNonTerminalJobStatus(status)) {
        observedActiveJobRef.current = true;
        return;
      }

      if (observedActiveJobRef.current && isTerminalJobStatus(status)) {
        observedActiveJobRef.current = false;
        void loadSettings();
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  async function persist(request: UpdateSettingsRequest) {
    setIsSaving(true);

    try {
      const response = await updateSettings(request);

      if (!response.ok) {
        return;
      }

      if (response.result.status === "confirmation-required") {
        setPendingConfirmation({
          retentionDays: response.result.requestedSettings.retentionDays,
          confirmDestructiveRescan: true
        });
        return;
      }

      if (response.result.status === "job-started") {
        observedActiveJobRef.current = true;
        setSelectedRetentionDays(request.retentionDays);
        emitRetentionJobStatus(response.result.job);
        setPendingConfirmation(null);
        return;
      }

      setSavedRetentionDays(response.result.settings.retentionDays);
      setSelectedRetentionDays(response.result.settings.retentionDays);
      setPendingConfirmation(null);
    } finally {
      setIsSaving(false);
    }
  }

  const hasChanges = selectedRetentionDays !== savedRetentionDays;

  return (
    <RoutePage aria-label="Settings route">
      <PageHeader
        eyebrow="Retention"
        title="Settings"
        description="Choose how much local session history Control + Zebra keeps in app-owned storage."
      />

      <section className="max-w-3xl space-y-5">
        <div className="rounded-lg border border-border/70 bg-card p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background">
              <Clock3 className="size-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Session Timeframe</h2>
                <p className="mt-1 text-xs/relaxed text-muted-foreground">
                  Retention is based on when each session started. User source files are never modified.
                </p>
              </div>

              {isLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner size="sm" />
                  Loading settings
                </div>
              ) : null}

              {!isLoading && loadFailed ? (
                <p className="text-xs text-destructive">Settings could not be loaded.</p>
              ) : null}

              {!isLoading && !loadFailed ? (
                <>
                  <fieldset className="space-y-2">
                    <legend className="sr-only">Session timeframe</legend>
                    <div aria-label="Session timeframe" className="grid grid-cols-3 gap-2" role="radiogroup">
                      {retentionOptions.map((option) => (
                        <label className="block" key={option.value}>
                          <input
                            checked={selectedRetentionDays === option.value}
                            className="sr-only peer"
                            disabled={isSaving}
                            name="retention-days"
                            onChange={() => setSelectedRetentionDays(option.value)}
                            type="radio"
                            value={option.value}
                          />
                          <span
                            className={cn(
                              "flex h-9 items-center justify-center rounded-md border border-border/70 px-3 text-xs font-medium transition-colors",
                              "peer-disabled:cursor-not-allowed peer-disabled:opacity-60",
                              selectedRetentionDays === option.value
                                ? "border-primary bg-primary text-primary-foreground"
                                : "bg-background text-foreground hover:bg-accent"
                            )}
                          >
                            {option.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <div className="flex items-center justify-end gap-2">
                    <Button
                      disabled={!hasChanges || isSaving}
                      onClick={() => void persist({ retentionDays: selectedRetentionDays })}
                      type="button"
                    >
                      {isSaving ? <Spinner size="sm" /> : null}
                      Save
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <AlertDialog
        open={Boolean(pendingConfirmation)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingConfirmation(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rescan Stored Sources</AlertDialogTitle>
            <AlertDialogDescription>
              Increasing the timeframe clears app-owned session data for scanned local sources and
              rescans them. User source files are not changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingConfirmation) {
                  void persist(pendingConfirmation);
                }
              }}
            >
              Clear and Rescan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </RoutePage>
  );
}

function isTerminalJobStatus(status: RetentionJobStatus): boolean {
  return status.state === "failed" || status.state === "idle";
}

function isNonTerminalJobStatus(status: RetentionJobStatus): boolean {
  return status.state === "trimming" || status.state === "clearing" || status.state === "rescanning";
}
