// layout feature: HeaderBlur; change its UI/flow here and keep related state/API calls in sync.
import * as React from "react";

/**
 * Progressive blur under the transparent header.
 *
 * Each `<i>` is a full-height backdrop-filter layer masked to a shorter band:
 * the strongest blur reaches least far down, the weakest reaches the whole
 * region. Stacking them fades content out smoothly instead of drawing a hard
 * line. `HeaderBlur` sits below the header in z-order and ignores pointer
 * events, so the pill and buttons stay sharp and clickable.
 *
 * The layer is pinned to the top of the main column rather than the viewport:
 * the column itself never scrolls (only the message list inside it does), so
 * the result is identical to `position: fixed` while the sidebar keeps its own
 * unblurred header area.
 */
export function HeaderBlur({ className }: { className?: string }) {
  return (
    <div className={className ? `header-blur ${className}` : "header-blur"} aria-hidden="true">
      <i style={{ "--blur": "0.6px", "--edge": "100%" } as React.CSSProperties} />
      <i style={{ "--blur": "1.2px", "--edge": "84%" } as React.CSSProperties} />
      <i style={{ "--blur": "2.4px", "--edge": "68%" } as React.CSSProperties} />
      <i style={{ "--blur": "4px", "--edge": "54%" } as React.CSSProperties} />
      <i style={{ "--blur": "6px", "--edge": "42%" } as React.CSSProperties} />
      <i style={{ "--blur": "9px", "--edge": "32%" } as React.CSSProperties} />
    </div>
  );
}
