import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowRight, Cpu, History, PartyPopper, Shapes, Upload, WandSparkles, X, type LucideIcon } from "lucide-react";
import Logo from "@/components/logo/Logo";
import "./AppTour.css";

type View = "dashboard" | "editor" | "figure";

// A step spotlights `target` (the first visible match) on its `view`; without a target the card sits in the middle.
type Step = { view?: View; target?: string; Icon?: LucideIcon; title: string; body: string; next?: string };

// Only what an Overleaf user wouldn't already know: files, editing, compiling and the PDF preview are left out.
const STEPS: Step[] = [
  {
    title: "Welcome, NAME",
    body: "TikZ Studio is the LaTeX workspace you know, plus AI that writes your LaTeX and draws your figures. Here's what's new.",
    next: "Show me",
  },
  {
    view: "dashboard",
    target: ".upload-project-button",
    Icon: Upload,
    title: "Coming from Overleaf?",
    body: "Download your project from Overleaf as a .zip and upload it here. Files, folders and images all come along.",
    next: "Open a project",
  },
  {
    view: "editor",
    target: ".engine-field",
    Icon: Cpu,
    title: "Pick the right engine",
    body: "pdfLaTeX for most papers, XeLaTeX for system fonts and any script, LuaLaTeX for OpenType fonts and Lua code. Each project remembers its choice.",
  },
  {
    view: "editor",
    target: ".code-surface",
    Icon: WandSparkles,
    title: "Ask for LaTeX in plain words",
    body: "On its own line, type /! a table of my results with 3 columns !/ and press Enter. AI writes the LaTeX right there, using the packages your document loads.",
  },
  {
    view: "editor",
    target: '[aria-label="Generate TikZ figure"]',
    Icon: Shapes,
    title: "Meet Figure Studio",
    body: "Our favourite part: TikZ figures from a description. No coordinates, no trial and error.",
    next: "Open Figure Studio",
  },
  {
    view: "figure",
    target: ".fs-composer",
    Icon: WandSparkles,
    title: "Describe it, then pick",
    body: "Say what you need, like \"a neural network with 3 inputs and 2 outputs\". You get several versions side by side, each previewed with your project's own preamble.",
  },
  {
    view: "figure",
    target: ".fs-history",
    Icon: History,
    title: "Refine, insert, come back",
    body: "Ask for changes by chatting (\"make the arrows thicker\"), then insert the figure: the TikZ packages it needs are added for you. Every chat is saved here.",
  },
  {
    Icon: PartyPopper,
    title: "You're all set",
    body: "Figure Studio is open: describe your first figure and see what comes back.",
    next: "Start drawing",
  },
];

const PAD = 8; // spotlight padding around the target
const GAP = 16; // between spotlight and card
const EDGE = 16; // card's minimum distance from the window edge
const WAIT_MS = 1500; // how long to wait for a target (e.g. while a page opens) before centering the card

type Box = { top: number; left: number; width: number; height: number };
type Layout = { spot: Box | null; card: { top: number; left: number } };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

// Beside the spotlight if there is room (right, left, below, above), else over its lower part; always on screen.
const placeCard = (spot: Box | null, width: number, height: number) => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!spot) return { top: (vh - height) / 2, left: (vw - width) / 2 };
  const right = spot.left + spot.width;
  const bottom = spot.top + spot.height;
  const middleTop = clamp(spot.top + spot.height / 2 - height / 2, EDGE, vh - height - EDGE);
  const middleLeft = clamp(spot.left + spot.width / 2 - width / 2, EDGE, vw - width - EDGE);
  if (vw - right >= width + GAP + EDGE) return { top: middleTop, left: right + GAP };
  if (spot.left >= width + GAP + EDGE) return { top: middleTop, left: spot.left - GAP - width };
  if (vh - bottom >= height + GAP + EDGE) return { top: bottom + GAP, left: middleLeft };
  if (spot.top >= height + GAP + EDGE) return { top: spot.top - GAP - height, left: middleLeft };
  return { top: clamp(bottom - height - EDGE, EDGE, vh - height - EDGE), left: middleLeft };
};

const sameLayout = (a: Layout, b: Layout) => JSON.stringify(a) === JSON.stringify(b);

type Props = {
  view: View;
  step: number;
  name: string;
  onStepChange: (step: number) => void;
  modKey: string;
  // Switch pages when the next step lives on the other one.
  onShowView: (view: View) => void;
  // Finished or skipped: either way the tour isn't shown again.
  onFinish: () => void;
};

export default function AppTour({ view, step: index, name, onStepChange, modKey, onShowView, onFinish }: Props) {
  const [layout, setLayout] = useState<Layout | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;

  // Follow the target every frame, so the spotlight keeps up with page switches, animations and resizes.
  useEffect(() => {
    const startedAt = performance.now();
    let frame = 0;
    const tick = () => {
      const target = step.target
        ? [...document.querySelectorAll(step.target)].find((element) => element.getClientRects().length > 0)
        : null;
      const card = cardRef.current;
      const waiting = Boolean(step.target) && !target && performance.now() - startedAt < WAIT_MS;
      if (waiting) {
        setLayout(null); // hide the card until its target shows up
      } else if (card) {
        const rect = target?.getBoundingClientRect();
        const spot = rect
          ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
          : null;
        const next = { spot, card: placeCard(spot, card.offsetWidth, card.offsetHeight) };
        setLayout((current) => (current && sameLayout(current, next) ? current : next));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [step.target]);

  // Each step puts focus on its main button, so Enter moves on and nothing types into the page behind.
  useEffect(() => {
    primaryRef.current?.focus({ preventScroll: true });
  }, [index]);

  const finish = () => {
    setIsLeaving(true);
    window.setTimeout(onFinish, 260);
  };

  const go = (next: number) => {
    if (next < 0) return;
    if (next >= STEPS.length) {
      finish();
      return;
    }
    const nextView = STEPS[next].view;
    if (nextView && nextView !== view) onShowView(nextView);
    onStepChange(next);
  };

  // Captured before the page's own shortcuts: arrows and Enter steer the tour, Escape skips it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = { ArrowRight: 1, Enter: 1, ArrowLeft: -1, Escape: 0 }[event.key];
      if (action === undefined || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (action === 0) finish();
      else go(index + action);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  const spot = layout?.spot;
  const Icon = step.Icon;

  return (
    <div className={`tour${isLeaving ? " leaving" : ""}`} role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
      {/* Catches clicks so the page behind stays still; the spotlight itself is only a picture. */}
      <div className="tour-blocker" />
      <div
        className={`tour-spot${spot ? "" : " closed"}`}
        style={spot ?? { top: window.innerHeight / 2, left: window.innerWidth / 2, width: 0, height: 0 }}
        aria-hidden="true"
      />
      <div
        ref={cardRef}
        className={`tour-card${layout ? "" : " hidden"}${spot ? "" : " centered"}`}
        style={layout?.card}
      >
        <div className="tour-progress" aria-hidden="true">
          <span style={{ "--progress": (index + 1) / STEPS.length } as CSSProperties} />
        </div>
        <button className="tour-close" type="button" aria-label="Skip the tour" onClick={finish}>
          <X size={15} />
        </button>
        {/* Keyed by step so each one plays its entrance. */}
        <div className="tour-content" key={index}>
          {Icon ? (
            <span className="tour-icon" aria-hidden="true">
              <Icon size={20} />
            </span>
          ) : (
            <span className="tour-logo" aria-hidden="true">
              <Logo size={52} loop />
            </span>
          )}
          <p className="tour-count">
            {index + 1} of {STEPS.length}
          </p>
          <h2 id="tour-title">{step.title.replace("NAME", name.split(" ")[0])}</h2>
          <p id="tour-body">{step.body.replace("MOD", modKey)}</p>
        </div>
        <div className="tour-actions">
          {index > 0 && !isLast ? (
            <button className="tour-skip" type="button" onClick={finish}>
              Skip tour
            </button>
          ) : (
            <span />
          )}
          <div>
            {index > 0 && (
              <button className="tour-back" type="button" aria-label="Previous step" onClick={() => go(index - 1)}>
                <ArrowLeft size={16} />
              </button>
            )}
            <button ref={primaryRef} className="tour-next" type="button" onClick={() => go(index + 1)}>
              {step.next ?? "Next"}
              {!isLast && <ArrowRight size={16} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
