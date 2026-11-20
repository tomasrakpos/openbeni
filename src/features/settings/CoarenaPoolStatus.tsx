// settings feature: CoarenaPoolStatus; change its UI/flow here and keep related state/API calls in sync.
import { KeyRound } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { COARENA_ENDPOINTS } from "@/lib/http";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface PoolKey {
  index: number;
  status: "ok" | "cooling";
  retryInSeconds: number;
  reason?: string;
}

interface PoolStatus {
  total: number;
  healthy: number;
  keys: PoolKey[];
}

/**
 * Server-managed Coarena pool health.
 *
 * Shows counts only. The endpoint never returns a key, a prefix, or a hash, so
 * nothing sensitive can end up in the DOM.
 */
export function CoarenaPoolStatus() {
  const t = useT();
  const [status, setStatus] = React.useState<PoolStatus | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(COARENA_ENDPOINTS.status, {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (!response.ok) throw new Error("status failed");
        const payload = (await response.json()) as { data?: PoolStatus };
        if (!cancelled && payload.data) {
          setStatus(payload.data);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="space-y-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)]/40 px-2.5 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-[11.5px] text-foreground">
          <KeyRound className="size-3.5 text-[var(--primary)]" />
          {t("settings.coarenaPool")}
        </span>
        {status && status.total > 0 ? (
          <Badge variant={status.healthy > 0 ? "free" : "unknown"}>
            {t("providers.poolStatus", { healthy: status.healthy, total: status.total })}
          </Badge>
        ) : (
          <Badge variant="unknown">{failed ? t("settings.coarenaOffline") : t("settings.coarenaUnknown")}</Badge>
        )}
      </div>
      {status && status.total > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5" aria-hidden="true">
            {status.keys.map((key) => (
              <span
                key={key.index}
                title={`#${key.index}`}
                className={cn(
                  "size-2.5 rounded-full",
                  key.status === "ok" ? "bg-[var(--success)]" : "bg-[var(--warning)]",
                )}
              />
            ))}
          </div>
          <p className="text-[10px] leading-relaxed text-[var(--faint)]">{t("settings.coarenaPoolDesc")}</p>
        </>
      ) : status ? (
        <p className="text-[10px] leading-relaxed text-[var(--faint)]">{t("settings.coarenaNotConfigured")}</p>
      ) : null}
    </div>
  );
}
