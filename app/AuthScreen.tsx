import { useState, type CSSProperties } from "react";
import { Lock, Mail } from "lucide-react";
import ThemeToggle from "./ThemeToggle";
import { apiJson, errorMessage, type User } from "./api";

type AuthScreenProps = {
  error: string;
  onSignedIn: (user: User) => void;
};

type Mode = "login" | "signup";

const ENVIRONMENT: Record<Mode, string> = {
  login: "session",
  signup: "account",
};

// Typed code first, then the heading "compiles" in. The delay waits for the panel slide after a switch.
function introStyle(code: string, delay: number): CSSProperties {
  return {
    "--delay": `${delay}s`,
    "--chars": code.length,
    "--type": `${code.length * 45}ms`,
  } as CSSProperties;
}

// A tiny TikZ picture drawn stroke by stroke: (from) -> (to).
function Sketch({ from, to }: { from: string; to: string }) {
  return (
    <svg className="auth-sketch" viewBox="0 0 240 64" aria-hidden>
      <rect
        className="draw s0"
        x="2"
        y="14"
        width="84"
        height="36"
        rx="8"
        pathLength={1}
      />
      <text className="label s0" x="44" y="37" textAnchor="middle">
        {from}
      </text>
      <path className="draw s1" d="M92 32 H146" pathLength={1} />
      <path className="draw s2" d="M138 25 L147 32 L138 39" pathLength={1} />
      <rect
        className="draw s3"
        x="154"
        y="14"
        width="84"
        height="36"
        rx="8"
        pathLength={1}
      />
      <text className="label s3" x="196" y="37" textAnchor="middle">
        {to}
      </text>
    </svg>
  );
}

export default function AuthScreen({ error, onSignedIn }: AuthScreenProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [warning, setWarning] = useState("");
  const [notice, setNotice] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [hasSwitched, setHasSwitched] = useState(false);
  const isSignup = mode === "signup";

  const switchTo = (next: Mode) => {
    setMode(next);
    setHasSwitched(true);
    setWarning("");
    setNotice("");
  };

  const submit = async () => {
    setIsBusy(true);
    setWarning("");
    setNotice("");

    try {
      const result = await apiJson<{ user: User | null }>(
        `/api/v1/auth/${mode}`,
        {
          method: "POST",
          body: JSON.stringify({ email, password }),
        },
      );

      if (result.user) {
        onSignedIn(result.user);
      } else {
        setMode("login");
        setNotice("Check your email to confirm your account, then sign in.");
      }
    } catch (submitError) {
      setWarning(errorMessage(submitError));
    } finally {
      setIsBusy(false);
    }
  };

  // Both forms stay mounted so the panel can slide between them; the hidden one is inert.
  const renderForm = (formMode: Mode) => {
    const isLogin = formMode === "login";
    const isActive = formMode === mode;
    const message = isActive ? warning || error : "";
    const environment = ENVIRONMENT[formMode];
    const opening = `\\begin{${environment}}`;

    return (
      <div className={`auth-form-box ${formMode}`} inert={!isActive}>
        <form
          key={String(isActive)} // remount on activation so the intro replays
          className="auth-intro"
          style={introStyle(opening, hasSwitched ? 1.25 : 0.15)}
          aria-label={isLogin ? "Sign in" : "Create account"}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <p className="auth-eyebrow">
            <span className="auth-type">{opening}</span>
          </p>
          <h1>
            {isLogin ? "Log in to TikZ " : "Create your "}
            <em>{isLogin ? "Studio" : "account"}</em>
          </h1>

          <label className="auth-input">
            <span className="sr-only">Email</span>
            <span className="auth-field">
              <input
                autoFocus={isActive}
                required
                type="email"
                placeholder="Email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <Mail aria-hidden size={17} />
            </span>
          </label>

          <label className="auth-input">
            <span className="sr-only">Password</span>
            <span className="auth-field">
              <input
                required
                type="password"
                placeholder={isLogin ? "Password" : "Password (8+ characters)"}
                minLength={8}
                maxLength={72}
                autoComplete={isLogin ? "current-password" : "new-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <Lock aria-hidden size={17} />
            </span>
          </label>

          {isActive && notice && <p className="auth-notice">{notice}</p>}
          {message && <p className="auth-warning">{message}</p>}

          <button className="auth-btn" type="submit" disabled={isBusy}>
            {isBusy && isActive
              ? "Please wait"
              : isLogin
                ? "Log in"
                : "Create account"}
          </button>

          <p
            className="auth-eyebrow auth-end"
            aria-hidden
          >{`\\end{${environment}}`}</p>
        </form>
      </div>
    );
  };

  return (
    <main className="loading-screen auth-screen">
      <ThemeToggle className="corner" />
      <div className={`auth-card${isSignup ? " active" : ""}`}>
        {renderForm("login")}
        {renderForm("signup")}

        <div className="auth-toggle-box">
          <div className="auth-toggle-panel toggle-left" inert={isSignup}>
            {/* Remounts (not the sliding panel itself) so the drawing replays each time this side shows. */}
            <div
              key={String(isSignup)}
              className="auth-intro panel-intro"
              style={introStyle("", hasSwitched ? 1.4 : 0.3)}
            >
              <h1>
                New to TikZ <em>Studio?</em>
              </h1>
              <Sketch from="idea" to="figure" />
              <code className="auth-snippet">
                {"\\draw[->] (idea) -- (figure);"}
              </code>
              <button
                className="auth-btn ghost"
                type="button"
                onClick={() => switchTo("signup")}
              >
                Sign up
              </button>
            </div>
          </div>

          <div className="auth-toggle-panel toggle-right" inert={!isSignup}>
            {/* Remounts (not the sliding panel itself) so the drawing replays each time this side shows. */}
            <div
              key={String(!isSignup)}
              className="auth-intro panel-intro"
              style={introStyle("", hasSwitched ? 1.4 : 0.3)}
            >
              <h1>
                Already drawing <em>with us?</em>
              </h1>
              <Sketch from="you" to="projects" />
              <code className="auth-snippet">
                {"\\draw[->] (you) -- (projects);"}
              </code>
              <button
                className="auth-btn ghost"
                type="button"
                onClick={() => switchTo("login")}
              >
                Log in
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
