// auth feature: AuthPanel; change its UI/flow here and keep related state/API calls in sync.
import { LogOut, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";
import { formatTokens } from "@/lib/tokens";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";

/**
 * Account sheet for a signed-in visitor. Signing in happens on the dedicated
 * Google-only `/` gate (`SmokeLogin`), so this dialog never renders a form.
 */
export function AuthPanel() {
  const t = useT();
  const open = useUiStore((s) => s.authOpen);
  const setOpen = useUiStore((s) => s.setAuthOpen);
  const signedIn = useAuthStore((s) => s.signedIn);
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:w-[min(460px,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <UserRound className="size-4 text-[var(--primary)]" />
            {t("auth.account")}
          </DialogTitle>
          <DialogDescription className="text-[12px] leading-relaxed">
            {signedIn && profile ? t("auth.signedInAs", { email: profile.email }) : t("auth.tagline")}
          </DialogDescription>
        </DialogHeader>

        {signedIn && profile ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-glass)] p-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{profile.displayName}</p>
                  <p className="truncate text-[11px] text-[var(--faint)]">{profile.email}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-[var(--muted-foreground)]">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-[var(--faint)]">{t("auth.dailyLimit")}</p>
                  <p>{profile.dailyTokenLimit ? formatTokens(profile.dailyTokenLimit) : t("auth.unlimited")}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-[var(--faint)]">{t("auth.monthlyLimit")}</p>
                  <p>{profile.monthlyTokenLimit ? formatTokens(profile.monthlyTokenLimit) : t("auth.unlimited")}</p>
                </div>
              </div>
            </div>
            {profile.status === "blocked" ? (
              <p className="rounded-[12px] border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 p-3 text-[12px] text-[var(--destructive)]">
                {t("auth.blocked")}
              </p>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  void signOut();
                  setOpen(false);
                }}
              >
                <LogOut className="size-4" />
                {t("auth.signOut")}
              </Button>
            </div>
          </div>
        ) : (
          <p className="rounded-[12px] border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[12px] text-[var(--muted-foreground)]">
            {t("auth.localMode")}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
