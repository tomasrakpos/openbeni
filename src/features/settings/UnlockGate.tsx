// settings feature: UnlockGate; change its UI/flow here and keep related state/API calls in sync.
import { KeyRound, Loader2, Lock, ShieldCheck } from "lucide-react";
import * as React from "react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n";
import { useSettingsStore } from "@/stores/settings";

export function UnlockGate() {
  const t = useT();
  const ready = useSettingsStore((s) => s.ready);
  const locked = useSettingsStore((s) => s.locked);
  const error = useSettingsStore((s) => s.error);
  const unlock = useSettingsStore((s) => s.unlock);

  const [passphrase, setPassphrase] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [shake, setShake] = React.useState(0);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!passphrase || busy) return;
    setBusy(true);
    try {
      const ok = await unlock(passphrase);
      if (!ok) {
        setShake((value) => value + 1);
        setPassphrase("");
      }
    } finally {
      setBusy(false);
    }
  };

  if (!ready || !locked) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-[color-mix(in_oklab,var(--background)_86%,transparent)] px-4 py-10 backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unlock-title"
      aria-describedby="unlock-desc"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(46rem_30rem_at_50%_-10%,var(--primary-soft),transparent_70%)]" />

      <div key={shake} className="surface-card relative z-10 w-full max-w-[420px] p-6 sm:p-7">
        <div className="flex items-center gap-2.5">
          <Logo size={34} />
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold tracking-[-0.01em] text-foreground">{t("app.name")}</span>
            <span className="block truncate text-[10px] text-[var(--faint)]">{t("app.tagline")}</span>
          </span>
          <span className="ml-auto grid size-8 place-items-center rounded-[10px] bg-[var(--warning-soft)] text-[var(--warning)]">
            <Lock className="size-4" />
          </span>
        </div>

        <div className="mt-5 flex items-start gap-2.5">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[11px] bg-[var(--primary-soft)] text-[var(--primary)]">
            <KeyRound className="size-4" />
          </span>
          <div className="min-w-0">
            <h1 id="unlock-title" className="text-[16px] font-semibold text-foreground">
              {t("settings.unlockTitle")}
            </h1>
            <p id="unlock-desc" className="mt-1 text-[11.5px] leading-relaxed text-[var(--muted-foreground)]">
              {t("settings.unlockDesc")}
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-3">
          <div className="grid gap-1.5">
            <Label htmlFor="vault-passphrase" className="text-[11.5px]">
              {t("settings.passphrase")}
            </Label>
            <Input
              id="vault-passphrase"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              placeholder="••••••••"
              className="h-10 font-mono"
              aria-invalid={!!error}
              aria-describedby={error ? "vault-error" : undefined}
            />
            {error ? (
              <p id="vault-error" role="alert" className="text-[11px] font-medium text-[var(--destructive)]">
                {t(error)}
              </p>
            ) : null}
          </div>

          <Button type="submit" className="h-10 w-full" disabled={!passphrase || busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            {busy ? t("settings.unlocking") : t("settings.unlock")}
          </Button>
        </form>
      </div>
    </div>
  );
}
