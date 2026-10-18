import Logo from "@/components/logo/Logo";
import "./LoadingScreen.css";

export default function LoadingScreen() {
  return (
    <main className="loading-screen" aria-label="Loading TikZ Studio">
      <div className="loading-logo" aria-hidden="true">
        <Logo size={96} loop />
      </div>
      <div className="loading-copy">
        <h1>TikZ Studio</h1>
        <p>Preparing your project workspace</p>
      </div>
    </main>
  );
}

// Covers the page while it switches between the dashboard and a project.
export function TransitionOverlay({ label }: { label: string }) {
  return (
    <div className="transition-overlay" aria-live="polite">
      <div className="loading-logo compact" aria-hidden="true">
        <Logo size={68} loop />
      </div>
      <div className="loading-copy transition-copy">
        <h1>TikZ Studio</h1>
        <p>{label}</p>
      </div>
    </div>
  );
}
