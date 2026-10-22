"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import AppTour from "@/components/app-tour/AppTour";
import AuthScreen from "@/components/auth-screen/AuthScreen";
import Dashboard from "@/components/dashboard/Dashboard";
import EditorPane from "@/components/editor-pane/EditorPane";
import FigureChat from "@/components/figure-chat/FigureChat";
import FileRail from "@/components/file-rail/FileRail";
import FileTree from "@/components/file-tree/FileTree";
import type { FormatCommand, LatexEditorHandle } from "@/components/latex-editor/LatexEditor";
import LoadingScreen, { TransitionOverlay } from "@/components/loading-screen/LoadingScreen";
import Notice, { type NoticeMessage } from "@/components/notice/Notice";
import OutlinePanel from "@/components/outline-panel/OutlinePanel";
import PreviewPane from "@/components/preview-pane/PreviewPane";
import ProfileMenu from "@/components/profile-menu/ProfileMenu";
import { ApiError, apiFetch, apiJson, emailName, errorMessage, type User } from "@/lib/api";
import { compileProject, type CompileOutput } from "@/lib/compile";
import type { OutlineItem } from "@/lib/latexOutline";
import { ImportError, MAX_FILE_COUNT, MAX_PROJECT_BYTES, UPLOAD_ACCEPT, importUploads } from "@/lib/projectImport";
import { withFigureLibraries } from "@/lib/tikzLibraries";
import {
  createStarterProject,
  fromStoredProject,
  newProject,
  type DashboardFilter,
  type ProjectFile,
  type ProjectSummary,
  type StoredProject,
} from "@/lib/projects";
import { useAutosave } from "@/lib/useAutosave";
import "./page.css";

// Platform check without a server/client mismatch: the server renders "Ctrl", the browser corrects it.
const noopSubscribe = () => () => {};
const isMacPlatform = () => /Mac|iPhone|iPad/.test(navigator.platform);

// Next.js keeps usePathname in sync with these, without remounting the page.
const navigate = (path: string, replace = false) => window.history[replace ? "replaceState" : "pushState"](null, "", path);

const waitForTransition = (duration = 450) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, duration);
  });

export default function Home() {
  const editorRef = useRef<LatexEditorHandle>(null);
  const [isBooting, setIsBooting] = useState(true);
  const [transitionLabel, setTransitionLabel] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isSessionChecked, setIsSessionChecked] = useState(false);
  const [authError, setAuthError] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeFileId, setActiveFileId] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  const [uploadNotice, setUploadNotice] = useState<NoticeMessage | null>(null);
  const fileUploadRef = useRef<HTMLInputElement>(null);
  const [collapsedOutlineIds, setCollapsedOutlineIds] = useState<Set<string>>(() => new Set());
  const [isRefreshingPreview, setIsRefreshingPreview] = useState(false);
  const [compileOutput, setCompileOutput] = useState<CompileOutput | null>(null);
  // The last PDF stays on screen while the source changes; this marks it as behind the editor.
  const [isPreviewStale, setIsPreviewStale] = useState(false);
  const [compileSeconds, setCompileSeconds] = useState<number | null>(null);
  const modKey = useSyncExternalStore(noopSubscribe, () => (isMacPlatform() ? "⌘" : "Ctrl"), () => "Ctrl");
  // The file sidebar can fold down to a slim strip; remembered per browser.
  const [isRailCollapsed, setIsRailCollapsed] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem("tikz-rail-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter>("all");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [projectTags, setProjectTags] = useState<string[]>([]);
  // From the profile's show_tour flag: true until the user finishes or skips the app tour.
  const [showTour, setShowTour] = useState(false);
  // profiles.display_name: the name given at sign-up, shown across the app instead of the email.
  const [displayName, setDisplayName] = useState("");
  // Kept here, not in the tour: the dashboard and the editor each mount their own copy of it.
  const [tourStep, setTourStep] = useState(0);
  const lastUserIdRef = useRef<string | null>(null);
  const autosave = useAutosave(projects, Boolean(user), () => setUser(null));

  useEffect(
    () => () => {
      if (compileOutput?.ok) {
        URL.revokeObjectURL(compileOutput.pdfObjectUrl);
      }
    },
    [compileOutput],
  );

  // The URL is the view: /login, /signup, / (dashboard), /project/<id> (editor), /project/<id>/figure (Figure Studio).
  const pathname = usePathname();
  const [, section = "", routeId = "", panel = ""] = pathname.split("/");
  const activeProject = useMemo(
    () => (section === "project" ? projects.find((project) => project.id === routeId) : undefined),
    [section, routeId, projects],
  );
  const activeProjectId = activeProject?.id ?? "";
  const isFigureOpen = activeProject !== undefined && panel === "figure";
  const figurePushedRef = useRef(false);

  // Another project opened (click, link, back/forward): start on its first file, without the old PDF.
  const [shownProjectId, setShownProjectId] = useState("");
  if (shownProjectId !== activeProjectId) {
    setShownProjectId(activeProjectId);
    setActiveFileId(activeProject?.files[0]?.id ?? "");
    setCompileOutput(null);
  }

  // Signed-out visitors land on /login (a project link stays put, to open after signing in); signed-in ones skip the
  // auth pages, and unknown paths or projects that don't exist fall back to the dashboard.
  const isValidPath = user
    ? pathname === "/" || (activeProject !== undefined && (panel === "" || panel === "figure"))
    : pathname === "/login" || pathname === "/signup" || section === "project";
  useEffect(() => {
    if (isSessionChecked && !isValidPath) {
      navigate(user ? "/" : "/login", true);
    }
  }, [isSessionChecked, isValidPath, user]);
  const projectFiles = useMemo(() => activeProject?.files ?? [], [activeProject]);
  const activeFile = useMemo(
    () => projectFiles.find((file) => file.id === activeFileId) ?? projectFiles[0],
    [activeFileId, projectFiles],
  );
  const sourceCode = activeFile?.content ?? "";
  const fileName = activeFile?.name ?? "";
  const isTexFile = fileName.toLowerCase().endsWith(".tex");

  const toggleOutlineItem = (id: string) =>
    setCollapsedOutlineIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });

  const loadWorkspace = async (signedInUser: User) => {
    const [{ projects: storedProjects }, profile] = await Promise.all([
      apiJson<{ projects: StoredProject[] }>("/api/v1/projects"),
      // Name and tour flag are niceties: if the profile can't be read, sign-in still works without them.
      apiJson<{ displayName: string | null; showTour: boolean }>("/api/v1/profile").catch(() => ({
        displayName: null,
        showTour: false,
      })),
    ]);
    const loadedProjects = storedProjects.map(fromStoredProject);

    autosave.markSaved(loadedProjects);

    // A new account starts with one example project; autosave stores it.
    if (loadedProjects.length === 0) {
      loadedProjects.push(createStarterProject());
    }

    lastUserIdRef.current = signedInUser.id;
    setProjects(loadedProjects);
    setProjectTags(Array.from(new Set(loadedProjects.flatMap((project) => project.tags))));
    setShowTour(profile.showTour);
    setDisplayName(profile.displayName || emailName(signedInUser));
    setUser(signedInUser);
  };

  const handleSignedIn = async (signedInUser: User) => {
    setAuthError("");

    // Session expired mid-work and the same person signed back in: keep their unsaved edits.
    if (signedInUser.id === lastUserIdRef.current) {
      setUser(signedInUser);
      return;
    }

    try {
      await loadWorkspace(signedInUser);
    } catch (error) {
      setAuthError(errorMessage(error));
    }
  };

  useEffect(() => {
    // The backend's email-confirmation callback reports failures as ?auth_error=...; show it once, then drop it from the URL.
    const linkError = new URLSearchParams(window.location.search).get("auth_error");
    if (linkError) {
      window.history.replaceState(null, "", window.location.pathname);
    }

    apiJson<{ user: User }>("/api/v1/auth/me")
      .then(({ user: sessionUser }) => loadWorkspace(sessionUser))
      .catch((error) => {
        if (!(error instanceof ApiError && error.status === 401)) {
          setAuthError(errorMessage(error));
        }
      })
      .finally(() => {
        if (linkError) {
          setAuthError(linkError);
        }
        setIsSessionChecked(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = async () => {
    await autosave.flush();
    await apiFetch("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);

    autosave.markSaved([]);
    lastUserIdRef.current = null;
    setProjects([]);
    setProjectTags([]);
    setShowTour(false);
    setUser(null);
    navigate("/login");
  };

  useEffect(() => {
    // Long enough for the logo to start its story, short enough not to keep anyone waiting.
    const timer = window.setTimeout(() => {
      setIsBooting(false);
    }, 1100);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("tikz-rail-collapsed", isRailCollapsed ? "1" : "0");
    } catch {
      // Storage blocked: the sidebar just won't remember its state.
    }
  }, [isRailCollapsed]);

  // Information toasts leave on their own; errors stay until dismissed.
  useEffect(() => {
    if (uploadNotice?.tone !== "info") {
      return;
    }

    const timer = window.setTimeout(() => setUploadNotice(null), 6000);

    return () => window.clearTimeout(timer);
  }, [uploadNotice]);

  const updateActiveProjectFiles = (
    updater: (currentFiles: ProjectFile[]) => ProjectFile[],
  ) => {
    setProjects((currentProjects) =>
      currentProjects.map((project) =>
        project.id === activeProjectId
          ? {
              ...project,
              files: updater(project.files),
              lastModified: "Just now by You",
            }
          : project,
      ),
    );
  };

  const updateActiveContent = (content: string) => {
    updateActiveProjectFiles((currentFiles) =>
      currentFiles.map((file) => (file.id === activeFileId ? { ...file, content } : file)),
    );
    setIsPreviewStale(true);
  };

  const runPageTransition = async (
    label: string,
    nextStep: () => void,
  ) => {
    setTransitionLabel(label);

    try {
      await waitForTransition();
      nextStep();
    } finally {
      setTransitionLabel(null);
    }
  };

  const goToDashboard = () => {
    void runPageTransition("Preparing your project dashboard", () => navigate("/"));
  };

  const openProject = (projectId: string) => {
    const project = projects.find((candidate) => candidate.id === projectId);

    if (!project) {
      return;
    }

    void runPageTransition(
      `Preparing your project ${project.title}`,
      () => {
        navigate(`/project/${project.id}`);
        window.requestAnimationFrame(() => editorRef.current?.focus());
      },
    );
  };

  // A new project (created or uploaded) goes to the top of the list and opens in the editor.
  const startProject = (project: ProjectSummary) => {
    setProjects((currentProjects) => [project, ...currentProjects]);
    setDashboardFilter("all");

    void runPageTransition(`Preparing your project ${project.title}`, () => {
      navigate(`/project/${project.id}`);
      window.requestAnimationFrame(() => editorRef.current?.focus());
    });
  };

  const readUpload = async (input: HTMLInputElement) => {
    const picked = [...(input.files ?? [])];
    input.value = ""; // so picking the same file again still fires onChange
    if (picked.length === 0) {
      return null;
    }
    try {
      const result = await importUploads(picked);
      if (result.files.length === 0) {
        setUploadNotice({
          tone: "error",
          text: `Nothing to import: no usable files found${result.skipped.length ? ` (${result.skipped.length} skipped)` : ""}.`,
        });
        return null;
      }
      const skippedText = result.skipped.map((file) => `${file.name} (${file.reason})`).join(", ");
      setUploadNotice(
        result.skipped.length
          ? { tone: "info", text: `Imported ${result.files.length} files. Skipped: ${skippedText}.` }
          : null,
      );
      return result;
    } catch (error) {
      setUploadNotice({
        tone: "error",
        text: error instanceof ImportError ? error.message : "Couldn't read that upload.",
      });
      return null;
    }
  };

  // Upload project: a .zip or loose files become a new project, like Overleaf's "Upload project".
  const handleUploadProject = async (input: HTMLInputElement) => {
    const result = await readUpload(input);
    if (!result) {
      return;
    }

    const taken = new Set(projects.map((project) => project.title.toLowerCase()));
    let title = result.title.trim() || "Uploaded project";
    for (let n = 2; taken.has(title.toLowerCase()); n++) {
      title = `${result.title} (${n})`;
    }

    const stamp = Date.now();
    startProject(
      newProject(
        title,
        selectedTag ? [selectedTag] : [],
        result.files.map((file, index) => ({ id: `file-${stamp}-${index}`, ...file })),
      ),
    );
  };

  // Upload into the open project: same-name files are replaced, the rest are added.
  const handleUploadFiles = async (input: HTMLInputElement) => {
    const result = await readUpload(input);
    if (!result) {
      return;
    }

    const incoming = new Map(result.files.map((file) => [file.name, file.content]));
    const stamp = Date.now();
    const merged = [
      ...projectFiles.map((file) =>
        incoming.has(file.name) ? { ...file, content: incoming.get(file.name)! } : file,
      ),
      ...result.files
        .filter((file) => !projectFiles.some((existing) => existing.name === file.name))
        .map((file, index) => ({ id: `file-${stamp}-${index}`, ...file })),
    ];
    const totalBytes = merged.reduce((sum, file) => sum + new TextEncoder().encode(file.content).length, 0);
    if (merged.length > MAX_FILE_COUNT || totalBytes > MAX_PROJECT_BYTES) {
      setUploadNotice({
        tone: "error",
        text: `That would put the project over its limit of ${MAX_FILE_COUNT} files or ${MAX_PROJECT_BYTES / 1024 / 1024} MB. Nothing was added.`,
      });
      return;
    }

    updateActiveProjectFiles(() => merged);
    const first = merged.find((file) => file.name === result.files[0].name);
    if (first) {
      handleSelectFile(first.id);
    }
  };

  // "Take the tour" from the dashboard or the profile menu: replays it from the start.
  const startTour = () => {
    setTourStep(0);
    setShowTour(true);
  };

  // Finished or skipped: stored, so the tour doesn't come back. If saving fails it simply shows again next sign-in.
  const finishTour = () => {
    setShowTour(false);
    void apiJson("/api/v1/profile", { method: "PATCH", body: JSON.stringify({ showTour: false }) }).catch(() => undefined);
  };

  const openFigureStudio = () => {
    figurePushedRef.current = true;
    navigate(`/project/${activeProjectId}/figure`);
  };

  // Go back to the entry Figure Studio was opened from, so Back doesn't reopen it; after a reload there is none.
  const closeFigureStudio = () => {
    if (figurePushedRef.current) {
      window.history.back();
    } else {
      navigate(`/project/${activeProjectId}`, true);
    }
    figurePushedRef.current = false;
  };

  const handleSelectFile = (fileId: string) => {
    setActiveFileId(fileId);

    window.requestAnimationFrame(() => {
      const editor = editorRef.current;

      editor?.focus();
      editor?.setSelectionRange(0, 0);
    });
  };

  const jumpToOutlineItem = (item: OutlineItem) => {
    if (item.fileId !== activeFile?.id) {
      handleSelectFile(item.fileId);
      window.requestAnimationFrame(() => editorRef.current?.setSelectionRange(item.start, item.start));
      return;
    }
    editorRef.current?.setSelectionRange(item.start, item.start);
  };

  const applyTextCommand = (command: FormatCommand) => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    const selectionStart = editor.selectionStart;
    const selectionEnd = editor.selectionEnd;
    const selectedText = sourceCode.slice(selectionStart, selectionEnd);
    const prefix = `\\${command}{`;
    const suffix = "}";
    const nextSourceCode =
      sourceCode.slice(0, selectionStart) +
      prefix +
      selectedText +
      suffix +
      sourceCode.slice(selectionEnd);

    updateActiveContent(nextSourceCode);

    window.requestAnimationFrame(() => {
      editor.focus();

      const formattedStart = selectionStart + prefix.length;
      const formattedEnd = formattedStart + selectedText.length;
      editor.setSelectionRange(formattedStart, formattedEnd);
    });
  };

  // The document to compile: the open .tex file if it is a whole document, otherwise the project's file with
  // \documentclass, so compiling while a chapter or the .bib is open still builds the whole project.
  const mainFile =
    (isTexFile && activeFile?.content.includes("\\documentclass") ? activeFile : undefined) ??
    projectFiles.find((file) => /\.tex$/i.test(file.name) && file.content.includes("\\documentclass")) ??
    (isTexFile ? activeFile : undefined);

  const handleRefreshPreview = async () => {
    if (isRefreshingPreview) {
      return;
    }

    if (!mainFile) {
      setCompileOutput({
        ok: false,
        message: "Add a .tex file with \\documentclass to compile.",
        log: "",
      });
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 60_000);
    const startedAt = performance.now();

    // The previous PDF stays visible under a "compiling" veil until the new one arrives.
    setIsRefreshingPreview(true);

    try {
      const output = await compileProject(mainFile, projectFiles, activeProject?.engine, controller.signal);

      setCompileOutput(output);
      if (output.ok) {
        setIsPreviewStale(false);
        setCompileSeconds((performance.now() - startedAt) / 1000);
      }
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "AbortError";

      setCompileOutput({
        ok: false,
        message: timedOut
          ? "The compile request timed out."
          : "The compile backend could not be reached.",
        log: timedOut ? "" : error instanceof Error ? error.message : String(error),
      });
    } finally {
      window.clearTimeout(timeout);
      setIsRefreshingPreview(false);
    }
  };

  // Figure Studio's "Insert": the code goes at the editor's cursor, on its own lines, then gets selected.
  const insertFigure = (code: string) => {
    const editor = editorRef.current;
    const figure = code.trim();

    if (!editor || !activeFile || !/\.(tex|tikz|pgf)$/i.test(activeFile.name)) {
      setUploadNotice({ tone: "error", text: "Open a .tex file in the editor to insert the figure there." });
      return;
    }

    // A figure can't go in the preamble: if the cursor is there, place it at the end of the document body.
    const bodyStart = sourceCode.indexOf("\\begin{document}");
    const bodyEnd = sourceCode.lastIndexOf("\\end{document}");
    const inPreamble = bodyStart !== -1 && editor.selectionStart <= bodyStart;
    const start = inPreamble ? (bodyEnd !== -1 ? bodyEnd : sourceCode.length) : editor.selectionStart;
    const end = inPreamble ? start : editor.selectionEnd;
    const before = sourceCode.slice(0, start);
    const after = sourceCode.slice(end);
    const lead = before === "" || before.endsWith("\n") ? "" : "\n";
    const trail = after.startsWith("\n") || after === "" ? (after === "" ? "\n" : "") : "\n";

    // The main document also needs \usepackage{tikz} and the libraries Figure Studio's previews load.
    const inserted = before + lead + figure + trail + after;
    const next = mainFile?.id === activeFile.id ? withFigureLibraries(inserted) : inserted;
    const shift = next.length - inserted.length; // lines added to the preamble, above the figure
    const otherMain = mainFile && mainFile.id !== activeFile.id ? withFigureLibraries(mainFile.content) : null;
    updateActiveContent(next);
    if (otherMain !== null && otherMain !== mainFile?.content) {
      updateActiveProjectFiles((currentFiles) =>
        currentFiles.map((file) => (file.id === mainFile?.id ? { ...file, content: otherMain } : file)),
      );
    }
    const addedTikz = shift > 0 || (otherMain !== null && otherMain !== mainFile?.content);
    setUploadNotice({
      tone: "info",
      text:
        (inPreamble
          ? `Figure inserted at the end of ${activeFile.name}, before \\end{document} (your cursor was in the preamble).`
          : `Figure inserted into ${activeFile.name}.`) +
        (addedTikz ? ` Added \\usepackage{tikz} and the TikZ libraries it needs to the preamble of ${mainFile?.name}.` : ""),
    });
    window.requestAnimationFrame(() => {
      editor.focus();
      editor.setSelectionRange(start + shift + lead.length, start + shift + lead.length + figure.length);
    });
  };

  // Jump the editor to a line (from a compile error), opening that file first if needed.
  const goToSourceLine = (name: string | null, line: number) => {
    const target = (name && projectFiles.find((file) => file.name === name.replace(/^\.\//, ""))) || mainFile;

    if (!target) {
      return;
    }

    const lines = target.content.split("\n");
    const start = lines.slice(0, line - 1).reduce((offset, text) => offset + text.length + 1, 0);
    const end = start + (lines[line - 1]?.length ?? 0);

    if (target.id !== activeFileId) {
      setActiveFileId(target.id);
    }

    window.requestAnimationFrame(() => editorRef.current?.setSelectionRange(start, end));
  };

  // Editor shortcuts: Mod+Enter / Mod+S compile (the editor handles them itself when focused), Mod+\ folds the file
  // sidebar. The dashboard and menus handle their own keys. Re-subscribed each render so it always sees current state.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || !activeProject) {
        return;
      }

      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key === "\\") {
        event.preventDefault();
        setIsRailCollapsed((collapsed) => !collapsed);
        return;
      }

      const isCompileKey = mod && (event.key === "Enter" || event.key.toLowerCase() === "s");

      if (user && !isFigureOpen && isCompileKey) {
        event.preventDefault();
        void handleRefreshPreview();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (isBooting || !isSessionChecked) {
    return <LoadingScreen />;
  }

  if (!user) {
    return (
      <AuthScreen
        mode={pathname === "/signup" ? "signup" : "login"}
        onModeChange={(mode) => navigate(`/${mode}`)}
        error={authError}
        onSignedIn={(signedInUser) => void handleSignedIn(signedInUser)}
      />
    );
  }

  const overlays = (
    <>
      {uploadNotice && <Notice notice={uploadNotice} onDismiss={() => setUploadNotice(null)} />}
      {transitionLabel && <TransitionOverlay label={transitionLabel} />}
      {showTour && (
        <AppTour
          view={isFigureOpen ? "figure" : activeProject ? "editor" : "dashboard"}
          step={tourStep}
          name={displayName}
          modKey={modKey}
          onStepChange={setTourStep}
          onShowView={(view) => {
            const project = projects.find((candidate) => !candidate.isArchived) ?? projects[0];
            if (view === "dashboard") goToDashboard();
            else if (view === "figure") openFigureStudio();
            else if (isFigureOpen) closeFigureStudio();
            else if (project) openProject(project.id);
          }}
          onFinish={finishTour}
        />
      )}
    </>
  );

  if (!activeProject) {
    return (
      <Dashboard
        name={displayName}
        saveState={autosave.saveState}
        projects={projects}
        onProjectsChange={setProjects}
        tags={projectTags}
        onTagsChange={setProjectTags}
        filter={dashboardFilter}
        onFilterChange={setDashboardFilter}
        selectedTag={selectedTag}
        onSelectedTagChange={setSelectedTag}
        search={projectSearchQuery}
        onSearchChange={setProjectSearchQuery}
        onOpenProject={openProject}
        onCreateProject={startProject}
        onUploadProject={(input) => void handleUploadProject(input)}
        onTour={startTour}
        onLogout={() => void handleLogout()}
      >
        {overlays}
      </Dashboard>
    );
  }

  return (
    <main className="workspace-shell">
      {overlays}
      <input
        ref={fileUploadRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        multiple
        hidden
        onChange={(event) => void handleUploadFiles(event.currentTarget)}
      />

      <section className="app-frame" aria-label="TikZ editor workspace">
        <div className={isRailCollapsed ? "workspace-grid rail-collapsed" : "workspace-grid"}>
          <FileRail
            projectTitle={activeProject?.title}
            isCollapsed={isRailCollapsed}
            onCollapsedChange={setIsRailCollapsed}
            modKey={modKey}
            onHome={goToDashboard}
            onFigure={openFigureStudio}
            footer={<ProfileMenu name={displayName} email={user.email} onHome={goToDashboard} onTour={startTour} onLogout={() => void handleLogout()} />}
          >
            <FileTree
              files={projectFiles}
              activeFileId={activeFileId}
              mainFileId={mainFile?.id}
              onSelect={handleSelectFile}
              onChange={(nextFiles, nextActiveId) => {
                updateActiveProjectFiles(() => nextFiles);
                setIsPreviewStale(true);
                if (nextActiveId !== undefined) {
                  setActiveFileId(nextActiveId);
                  window.requestAnimationFrame(() => editorRef.current?.focus());
                }
              }}
              onUpload={() => fileUploadRef.current?.click()}
              onFigure={openFigureStudio}
              onError={(text) => setUploadNotice({ tone: "error", text })}
            />
            <OutlinePanel
              activeFile={activeFile}
              files={projectFiles}
              isTexFile={isTexFile}
              cursorPosition={cursorPosition}
              collapsedIds={collapsedOutlineIds}
              onToggle={toggleOutlineItem}
              onJump={jumpToOutlineItem}
            />
          </FileRail>

          <EditorPane
            editorRef={editorRef}
            docId={activeFile?.id ?? ""}
            fileName={fileName}
            value={sourceCode}
            cursorPosition={cursorPosition}
            saveState={autosave.saveState}
            modKey={modKey}
            onChange={updateActiveContent}
            onCursor={setCursorPosition}
            onFormat={applyTextCommand}
            onGenerateError={(text) => setUploadNotice({ tone: "error", text })}
            onCompile={() => void handleRefreshPreview()}
          />

          <PreviewPane
            output={compileOutput}
            isCompiling={isRefreshingPreview}
            isStale={isPreviewStale}
            compileSeconds={compileSeconds}
            fileNames={projectFiles.map((file) => file.name)}
            engine={activeProject?.engine}
            modKey={modKey}
            onEngineChange={(engine) => {
              // Saved with the project by autosave.
              setProjects((currentProjects) =>
                currentProjects.map((project) =>
                  project.id === activeProjectId ? { ...project, engine, lastModified: "Just now by You" } : project,
                ),
              );
              setIsPreviewStale(true);
            }}
            onRecompile={() => void handleRefreshPreview()}
            onGoToLine={goToSourceLine}
          />
        </div>
      </section>

      {/* Stays mounted while closed so the conversation survives; a new project starts a fresh one. */}
      <FigureChat
        key={activeProject.id}
        open={isFigureOpen}
        files={projectFiles.map(({ name, content }) => ({ name, content }))}
        activeFileName={fileName}
        projectId={activeProject?.id}
        onClose={closeFigureStudio}
        onInsert={insertFigure}
      />
    </main>
  );
}
