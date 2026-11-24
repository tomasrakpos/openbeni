// App bootstrap: change app mounting and top-level view selection here.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/fonts.css";
import App from "@/App";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@/index.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root container is missing");

/**
 * `/admin` is a completely separate page: its own bundle, its own password
 * gate, no chat shell. It is never linked from the public app, and the public
 * app never imports it, so none of its strings or routes reach visitors.
 */
const isAdminRoute = /^\/admin(\/|$)/.test(window.location.pathname);

async function render(): Promise<void> {
  const Page = isAdminRoute
    ? (await import("@/features/admin/AdminApp")).AdminApp
    : App;

  createRoot(container!).render(
    <StrictMode>
      <ErrorBoundary>
        <TooltipProvider delayDuration={200} skipDelayDuration={400}>
          <Page />
        </TooltipProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
}

void render();
