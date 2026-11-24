// auth feature: AuthPanel; change its UI/flow here and keep related state/API calls in sync.
import { Check, Coins, Copy, KeyRound, Loader2, LogOut, Plus, Trash2, UserRound } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n";
import { DEFAULT_SIGNUP_CREDITS, useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";

/**
 * Account, credits and personal API token manager for signed-in users.
 */
export function AuthPanel() {
  const t = useT();
  const open = useUiStore((s) => s.authOpen);
  const setOpen = useUiStore((s) => s.setAuthOpen);
  const setAuthGateOpen = useUiStore((s) => s.setAuthGateOpen);

  const signedIn = useAuthStore((s) => s.signedIn);
  const profile = useAuthStore((s) => s.profile);
  const tokens = useAuthStore((s) => s.tokens);
  const tokensLoading = useAuthStore((s) => s.tokensLoading);
  const loadTokens = useAuthStore((s) => s.loadTokens);
  const createToken = useAuthStore((s) => s.createToken);
  const revokeToken = useAuthStore((s) => s.revokeToken);
  const signOut = useAuthStore((s) => s.signOut);

  const [tokenName, setTokenName] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [freshSecret, setFreshSecret] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [revokingId, setRevokingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open && signedIn) {
      void loadTokens();
    } else if (!open) {
      setFreshSecret(null);
      setCopied(false);
    }
  }, [open, signedIn, loadTokens]);

  const credits = profile?.credits ?? 0;
  const creditPct = Math.max(0, Math.min(100, Math.round((credits / DEFAULT_SIGNUP_CREDITS) * 100)));

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!tokenName.trim() || creating) return;
    setCreating(true);
    try {
      const result = await createToken(tokenName);
      setFreshSecret(result.secret);
      setCopied(false);
      setTokenName("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error.generic"));
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!freshSecret) return;
    try {
      await navigator.clipboard.writeText(freshSecret);
      setCopied(true);
      toast.success(t("auth.tokenCopied"));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("error.generic"));
    }
  };

  const handleRevoke = async (id: string) => {
    setRevokingId(id);
    try {
      await revokeToken(id);
      toast.success(t("auth.tokenRevoked"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error.generic"));
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[min(86vh,720px)] overflow-y-auto sm:w-[min(520px,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <UserRound className="size-4 text-[var(--primary)]" />
            {t("auth.account")}
          </DialogTitle>
          <DialogDescription className="text-[12px] leading-relaxed">
            {signedIn && profile ? t("auth.signedInAs", { email: profile.email }) : t("auth.signInToUnlockDesc")}
          </DialogDescription>
        </DialogHeader>

        {signedIn && profile ? (
          <div className="flex flex-col gap-3.5">
            {/* Profile + Credits summary */}
            <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface-glass)] p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-semibold">{profile.displayName}</p>
                  <p className="truncate text-[11.5px] text-[var(--faint)]">{profile.email}</p>
                </div>
              </div>

              <div className="mt-4 rounded-[12px] border border-[var(--border)] bg-[var(--surface-2)]/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--muted-foreground)]">
                    <Coins className="size-3.5 text-[var(--primary)]" />
                    {t("auth.creditsLabel")}
                  </span>
                  <span className="text-[14px] font-semibold tabular-nums text-foreground">
                    {t("auth.creditsRemaining", { n: credits })}
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
                  <div
                    className="h-full rounded-full bg-[var(--primary)] transition-all duration-300"
                    style={{ width: `${creditPct}%` }}
                  />
                </div>
                <p className="mt-2 text-[11px] text-[var(--faint)]">
                  {credits > 0 ? t("auth.creditsHint") : t("auth.creditsEmpty")}
                </p>
              </div>
            </div>

            {profile.status === "blocked" ? (
              <p className="rounded-[12px] border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 p-3 text-[12px] text-[var(--destructive)]">
                {t("auth.blocked")}
              </p>
            ) : null}

            {/* Personal API Token creator & manager */}
            <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface-glass)] p-4">
              <div className="flex items-center gap-2">
                <KeyRound className="size-4 text-[var(--primary)]" />
                <h3 className="text-[13px] font-semibold">{t("auth.tokensTitle")}</h3>
              </div>
              <p className="mt-0.5 text-[11.5px] text-[var(--muted-foreground)]">{t("auth.tokensDesc")}</p>

              <form onSubmit={(event) => void handleCreate(event)} className="mt-3 flex items-center gap-2">
                <Input
                  value={tokenName}
                  onChange={(event) => setTokenName(event.target.value)}
                  placeholder={t("auth.tokenNamePlaceholder")}
                  maxLength={64}
                  disabled={creating}
                  className="h-9 flex-1 text-[12.5px]"
                />
                <Button type="submit" size="sm" disabled={creating || !tokenName.trim()} className="h-9 shrink-0">
                  {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                  {t("auth.tokenCreate")}
                </Button>
              </form>

              {freshSecret ? (
                <div className="mt-3 rounded-[12px] border border-[var(--primary)]/40 bg-[var(--primary)]/10 p-3">
                  <p className="text-[11px] font-medium text-foreground">{t("auth.tokenCreatedNote")}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2.5 py-1.5 font-mono text-[11.5px] select-all" dir="ltr">
                      {freshSecret}
                    </code>
                    <Button type="button" size="sm" variant="secondary" onClick={() => void handleCopy()} className="h-8 shrink-0">
                      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      {copied ? t("common.done") : "Copy"}
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="mt-3 flex flex-col gap-1.5">
                {tokensLoading ? (
                  <div className="flex items-center gap-2 py-2 text-[11.5px] text-[var(--muted-foreground)]">
                    <Loader2 className="size-3.5 animate-spin" />
                    {t("common.loading")}
                  </div>
                ) : tokens.length === 0 ? (
                  <p className="py-2 text-[11.5px] text-[var(--faint)]">{t("auth.tokensEmpty")}</p>
                ) : (
                  tokens.map((token) => (
                    <div
                      key={token.id}
                      className="flex items-center justify-between gap-2 rounded-[11px] border border-[var(--border)] bg-[var(--surface-2)]/60 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[12.5px] font-medium">{token.name}</p>
                        <p className="truncate font-mono text-[11px] text-[var(--faint)]" dir="ltr">
                          {token.prefix}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={revokingId === token.id}
                        onClick={() => void handleRevoke(token.id)}
                        className="h-7 shrink-0 text-[11.5px] text-[var(--destructive)] hover:text-[var(--destructive)]"
                      >
                        {revokingId === token.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                        {t("auth.tokenRevoke")}
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>

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
          <div className="flex flex-col items-center gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--surface-2)] p-5 text-center">
            <p className="text-[12.5px] text-[var(--muted-foreground)]">{t("auth.signInToUnlockDesc")}</p>
            <Button
              onClick={() => {
                setOpen(false);
                setAuthGateOpen(true);
              }}
            >
              <Coins className="size-4" />
              {t("auth.signInGetCredits")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
