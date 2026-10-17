import { Moon, Sun } from "lucide-react";

export const THEME_KEY = "tikz-theme";

// Runs in <head> before paint: saved choice, else the system preference. Avoids a light flash in dark mode.
export const themeBootScript = `try{var t=localStorage.getItem("${THEME_KEY}");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="light"}`;

// No React state: CSS shows the icon for the current data-theme, so server and client markup always match.
export default function ThemeToggle({ className = "" }: { className?: string }) {
  const toggle = () => {
    const root = document.documentElement;
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Private mode or blocked storage: the theme still switches for this visit.
    }
  };

  return (
    <button className={`theme-toggle ${className}`} type="button" aria-label="Switch light or dark theme" title="Switch theme" onClick={toggle}>
      <Moon className="theme-icon-moon" aria-hidden size={18} />
      <Sun className="theme-icon-sun" aria-hidden size={18} />
    </button>
  );
}
