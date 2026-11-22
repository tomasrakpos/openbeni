// Main app view ErrorBoundary; change its view behavior here and keep shared state in sync.
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * Last line of defence. A render crash must never leave the user with a blank
 * screen and no way to recover, so we surface the message and offer a reload.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ error, info });
    // Keep the console useful for anyone debugging locally.
    console.error("OpenHarneks crashed:", error, info.componentStack);
  }

  override render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="app-ambient flex min-h-dvh items-center justify-center px-4 py-10">
        <div className="surface-card relative z-10 w-full max-w-[520px] p-6 text-center sm:p-8">
          <div className="mx-auto flex w-fit items-center gap-2">
            <Logo size={34} />
            <span className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">OpenHarneks</span>
          </div>

          <span className="mx-auto mt-5 grid size-11 place-items-center rounded-[14px] bg-[var(--destructive-soft)] text-[var(--destructive)]">
            <AlertTriangle className="size-5" />
          </span>
          <h1 className="mt-3 text-[17px] font-semibold text-foreground">Something went wrong</h1>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--muted-foreground)]">
            Please reload the page to continue.
          </p>

          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button onClick={() => window.location.reload()}>
              <RefreshCw className="size-3.5" /> Reload
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                this.setState({ error: null, info: null });
              }}
            >
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
