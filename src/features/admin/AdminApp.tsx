/**
 * Standalone admin page (`/admin`).
 *
 * This module is only ever loaded by `src/main.tsx` when the address starts with
 * `/admin`, so the public chat app never imports it. The page has its own
 * password gate: the password is verified by `POST /api/admin/login`, which
 * returns a short-lived signed token, and the panel talks to `/api/admin/*`
 * only. It does not use (or need) a visitor account.
 *
 * Nothing in the public app links here; a visitor cannot discover it by
 * browsing. Knowing the URL is not enough without the password.
 */

import { ArrowLeft, Eye, EyeOff, KeyRound, Languages, Loader2, LogOut, Moon, RefreshCw, ShieldCheck, Sun } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminPage, type AdminDiagnostics } from "@/features/admin/AdminPage";
import { useAdminT } from "@/features/admin/adminStrings";
import { clearAdminSession, getAdminSession, saveAdminSession, type AdminSession } from "@/lib/adminSession";
import { ApiError, apiFetch } from "@/lib/api";
import { useDocumentLanguage } from "@/lib/i18n";
import { useSettingsStore } from "@/stores/settings";

type Phase = "checking" | "locked" | "ready";

export function AdminApp() {
  const t = useAdminT();
  useDocumentLanguage();

  const settings = useSettingsStore((s) => s.settings);
  const toggleTheme = useSettingsStore((s) => s.toggleTheme);
  const toggleLang = useSettingsStore((s) => s.toggleLang);

  const [session, setSession] = React.useState<AdminSession | null>(() => getAdminSession());
  const [phase, setPhase] = React.useState<Phase>(() => (getAdminSession() ? "checking" : "locked"));
  const [diagnostics, setDiagnostics] = React.useState<AdminDiagnostics | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  // Theme and language live in the same local settings store as the public app.
  React.useEffect(() => {
    void useSettingsStore.getState().load();
  }, []);

  React.useEffect(() => {
    document.title = `${t("app.name")} · ${t("admin.title")}`;
  }, [t]);

  const lock = React.useCallback((message?: string) => {
    clearAdminSession();
    setSession(null);
    setDiagnostics(null);
    setPhase("locked");
    setNotice(message ?? null);
  }, []);

  // A stored token is only trusted after the server confirms it.
  const verify = React.useCallback(
    async (token: AdminSession) => {
      setPhase("checking");
      try {
        const result = await apiFetch<AdminDiagnostics>("/api/admin/diagnostics");
        if (!getAdminSession()) saveAdminSession(token);
        setDiagnostics(result);
        setPhase("ready");
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          lock(t("admin.sessionExpired"));
          return;
        }
        // Server unreachable: keep the token, show the panel's own error strip.
        setNotice(error instanceof Error ? error.message : t("admin.diagUnavailable"));
        setPhase("ready");
      }
    },
    [lock, t],
  );

  React.useEffect(() => {
    if (phase === "checking" && session) void verify(session);
    // Run only when the phase/session change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, session]);

  const signOut = () => {
    lock();
    setNotice(t("admin.signedOut"));
  };

  const topbar = (
    <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--primary-soft)] text-[var(--primary)]">
          <ShieldCheck className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold tracking-[-0.01em]">{t("app.name")}</p>
          <p className="truncate text-[11px] text-[var(--muted-foreground)]">{t("admin.title")}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <a
          href="/"
          className="inline-flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-[12px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground"
        >
          <ArrowLeft className="size-3.5 rtl:rotate-180" />
          <span className="hidden sm:inline">{t("admin.backToSite")}</span>
        </a>
        <Button size="icon" variant="ghost" aria-label={t("palette.toggleTheme")} onClick={() => void toggleTheme()}>
          {settings.theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
        <Button size="icon" variant="ghost" aria-label={t("palette.toggleLang")} onClick={() => void toggleLang()}>
          <Languages className="size-4" />
        </Button>
        {session ? (
          <Button size="sm" variant="secondary" onClick={signOut}>
            <LogOut className="size-4" />
            <span className="hidden sm:inline">{t("admin.signOut")}</span>
          </Button>
        ) : null}
      </div>
    </header>
  );

  if (phase !== "ready") {
    return (
      <div className="flex min-h-dvh flex-col bg-[var(--background)] text-foreground">
        {topbar}
        <main className="flex flex-1 items-center justify-center px-4 py-10">
          {phase === "checking" ? (
            <div className="flex flex-col items-center gap-2 text-[var(--muted-foreground)]">
              <Loader2 className="size-5 animate-spin" />
              <p className="text-[12px]">{t("admin.diagChecking")}</p>
            </div>
          ) : (
            <LoginCard
              notice={notice}
              onUnlock={(next) => {
                saveAdminSession(next);
                setSession(next);
                setNotice(null);
                setPhase("checking");
              }}
            />
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[var(--background)] text-foreground">
      {topbar}
      {notice ? (
        <div className="mx-auto max-w-[1120px] px-4 pt-3 sm:px-6">
          <p className="rounded-[11px] border border-[var(--warning)]/35 bg-[var(--warning-soft)] px-3 py-2 text-[11.5px] text-[var(--warning)]">
            {notice}
          </p>
        </div>
      ) : null}
      <AdminPage initialDiagnostics={diagnostics ?? undefined} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Password gate                                                              */
/* -------------------------------------------------------------------------- */

function LoginCard({
  notice,
  onUnlock,
}: {
  notice: string | null;
  onUnlock: (session: AdminSession) => void;
}) {
  const t = useAdminT();
  const [password, setPassword] = React.useState("");
  const [visible, setVisible] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(notice);

  React.useEffect(() => setError(notice), [notice]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password) {
      setError(t("admin.enterPassword"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const session = await apiFetch<AdminSession>("/api/admin/login", {
        method: "POST",
        body: { password },
        auth: false,
      });
      setPassword("");
      onUnlock(session);
    } catch (cause) {
      if (cause instanceof ApiError) {
        if (cause.status === 401) setError(t("admin.wrongPassword"));
        else if (cause.status === 429) setError(t("admin.tooManyAttempts"));
        else if (cause.status === 503 || cause.code === "admin_not_configured") setError(t("admin.notConfigured"));
        else setError(cause.message);
      } else {
        setError(t("error.generic"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-[380px]">
      <div className="rounded-[20px] border border-[var(--border)] bg-[var(--surface-glass)] p-6 shadow-xl backdrop-blur-2xl">
        <span className="mb-4 grid size-11 place-items-center rounded-[13px] bg-[var(--primary-soft)] text-[var(--primary)]">
          <KeyRound className="size-5" />
        </span>
        <h1 className="text-[17px] font-semibold tracking-[-0.01em]">{t("admin.loginTitle")}</h1>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted-foreground)]">{t("admin.loginSubtitle")}</p>

        <form className="mt-5 flex flex-col gap-3" onSubmit={submit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-password">{t("admin.password")}</Label>
            <div className="relative">
              <Input
                id="admin-password"
                type={visible ? "text" : "password"}
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t("admin.passwordPlaceholder")}
                className="pe-10"
              />
              <button
                type="button"
                onClick={() => setVisible((value) => !value)}
                aria-label={visible ? t("admin.hidePassword") : t("admin.showPassword")}
                className="absolute inset-y-0 end-1.5 my-auto grid size-7 place-items-center rounded-[8px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground"
              >
                {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          {error ? (
            <p role="alert" className="rounded-[10px] border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 px-3 py-2 text-[11.5px] text-[var(--destructive)]">
              {error}
            </p>
          ) : null}

          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            {busy ? t("admin.signingIn") : t("admin.signIn")}
          </Button>
        </form>

        <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-[var(--faint)]">
          <RefreshCw className="mt-0.5 size-3 shrink-0" />
          {t("admin.loginNote")}
        </p>
      </div>
    </div>
  );
}
