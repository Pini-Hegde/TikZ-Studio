"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Bold,
  Copy,
  Download,
  FileText,
  HomeIcon,
  Italic,
  LogOut,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Tag,
  Trash2,
  TriangleAlert,
  Type,
  Underline,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import AuthScreen from "./AuthScreen";
import ThemeToggle from "./ThemeToggle";
import FigureChat from "./FigureChat";
import Logo from "./Logo";
import LatexEditor, { type FormatCommand, type LatexEditorHandle } from "./LatexEditor";
import { buildOutline, type OutlineItem } from "./latexOutline";
import { ImportError, MAX_FILE_COUNT, MAX_PROJECT_BYTES, importUploads } from "./projectImport";
import { ApiError, apiFetch, apiJson, errorMessage, type User } from "./api";

type ProjectFile = {
  id: string;
  name: string;
  content: string;
};

type ProjectSummary = {
  id: string;
  title: string;
  owner: string;
  lastModified: string;
  tags: string[];
  isShared: boolean;
  isArchived: boolean;
  files: ProjectFile[];
};

type DashboardFilter = "all" | "yours" | "shared" | "archived";

type ZipEntry = {
  path: string;
  content: string;
};

type CompileOutput =
  | {
      ok: true;
      pdfFileName: string;
      pdfObjectUrl: string;
    }
  | {
      ok: false;
      message: string;
      log: string;
    };

type CompileErrorResponse = {
  success: false;
  error: {
    code: string;
    message: string;
    log?: string;
    details?: Array<{ path: string; message: string }>;
  };
  requestId: string;
};

type StoredProject = {
  id: string;
  title: string;
  tags: string[];
  isArchived: boolean;
  files: ProjectFile[];
  updatedAt: string;
};

type SaveState = { status: "saved" | "saving" } | { status: "error"; message: string };

const fromStoredProject = (project: StoredProject): ProjectSummary => ({
  id: project.id,
  title: project.title,
  owner: "You",
  lastModified: `Saved ${new Date(project.updatedAt).toLocaleString()}`,
  tags: project.tags,
  isShared: false,
  isArchived: project.isArchived,
  files: project.files,
});

// Only these fields are stored; comparing this string tells us what still needs saving.
const toSavePayload = (project: ProjectSummary) =>
  JSON.stringify({
    title: project.title,
    tags: project.tags,
    isArchived: project.isArchived,
    files: project.files.map(({ id, name, content }) => ({ id, name, content })),
  });

const pdfFileNameFromResponse = (contentDisposition: string | null, fallback: string) => {
  const encodedName = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];

  if (encodedName) {
    try {
      return decodeURIComponent(encodedName);
    } catch {
      return fallback;
    }
  }

  return contentDisposition?.match(/filename="([^"]+)"/i)?.[1] ?? fallback;
};

const latexCode = String.raw`\documentclass{article}
\usepackage{tikz}
\usetikzlibrary{arrows.meta, positioning, shapes.geometric}

\begin{document}

\section{Workflow}
This diagram explains the backend compilation workflow.

\subsection{Generated TikZ}
\begin{tikzpicture}[
  node distance=1.6cm,
  block/.style={draw, rounded corners, minimum width=2.5cm},
  decision/.style={draw, diamond, aspect=1.4}
]
  \node[block] (idea) {Prompt};
  \node[block, right=of idea] (data) {Files};
  \node[decision, below=of idea, xshift=2cm] (build) {Valid?};
  \node[block, below=of build] (pdf) {Compile PDF};

  \draw[-{Latex}] (idea) -- (build);
  \draw[-{Latex}] (data) -- (build);
  \draw[-{Latex}] (build) -- (pdf);
\end{tikzpicture}

\section{Notes}
Press Recompile to send this project to the LaTeX backend and receive the generated PDF.

\end{document}`;

const bibCode = String.raw`@article{example2026,
  title={TikZ Workflow Notes},
  author={Knight, Arch},
  journal={Demo References},
  year={2026}
}`;

const initialProjectFiles: ProjectFile[] = [
  {
    id: "main",
    name: "Main.tex",
    content: latexCode,
  },
  {
    id: "bibliography",
    name: "Custome.bib",
    content: bibCode,
  },
];

// First project for a brand-new account.
const createStarterProject = (): ProjectSummary => ({
  id: crypto.randomUUID(),
  title: "TikZ Diagram Workspace",
  owner: "You",
  lastModified: "Just now by You",
  tags: ["Diagrams", "Workflow"],
  isShared: false,
  isArchived: false,
  files: initialProjectFiles.map((file) => ({ ...file })),
});

const sanitizeFileName = (value: string) =>
  value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 90) || "untitled";

const crc32 = (data: Uint8Array) => {
  let crc = 0xffffffff;

  for (const byte of data) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
};

const concatBytes = (parts: Uint8Array[]) => {
  const totalLength = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
};

const createZipBlob = (entries: ZipEntry[]) => {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime =
    (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate =
    ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path);
    const dataBytes = encoder.encode(entry.content);
    const checksum = crc32(dataBytes);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);

    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, dataBytes.length, true);
    localView.setUint32(22, dataBytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, dataBytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);

    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, dataBytes.length, true);
    centralView.setUint32(24, dataBytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  }

  const centralDirectory = concatBytes(centralParts);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);

  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralDirectory.length, true);
  endView.setUint32(16, offset, true);

  return new Blob([concatBytes([...localParts, centralDirectory, endRecord])], {
    type: "application/zip",
  });
};

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

const createProjectZip = (projects: ProjectSummary[]) => {
  const entries = projects.flatMap((project) => {
    const projectFolder = sanitizeFileName(project.title);

    return project.files.map((file) => ({
      path: `${projectFolder}/${sanitizeFileName(file.name)}`,
      content: file.content,
    }));
  });

  return createZipBlob(entries);
};

// Platform check without a server/client mismatch: the server renders "Ctrl", the browser corrects it.
const noopSubscribe = () => () => {};
const isMacPlatform = () => /Mac|iPhone|iPad/.test(navigator.platform);

// The first error in a TeX log, so the preview can point at the line: "./Main.tex:12: message" (the backend runs
// pdflatex with -file-line-error) or "! message" followed by "l.12 ...". TeX hard-wraps its log at 79 characters.
const firstTexError = (log: string) => {
  const lines = log.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const fileLine = /^(?:\.\/)?(.+?\.tex):(\d+): (.*)$/.exec(lines[i]);
    if (fileLine) {
      let message = fileLine[3];
      for (let j = i; lines[j].length === 79 && j + 1 < lines.length; j++) message += lines[j + 1];
      // The backend compiles in a temporary ".../project/" folder; keep only the path inside the project.
      const file = fileLine[1].replace(/^.*\/project\//, "");
      return { file, line: Number(fileLine[2]), message: message.trim() };
    }
    if (lines[i].startsWith("! ")) {
      const at = lines.slice(i + 1, i + 12).find((line) => /^l\.\d+/.test(line));
      return { file: null, line: at ? Number(/^l\.(\d+)/.exec(at)?.[1]) : null, message: lines[i].slice(2).trim() };
    }
  }
  return null;
};

const waitForTransition = (duration = 450) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, duration);
  });

export default function Home() {
  const editorRef = useRef<LatexEditorHandle>(null);
  const [currentView, setCurrentView] = useState<"dashboard" | "editor">("dashboard");
  const [isBooting, setIsBooting] = useState(true);
  const [transitionLabel, setTransitionLabel] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isSessionChecked, setIsSessionChecked] = useState(false);
  const [authError, setAuthError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>({ status: "saved" });
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [activeFileId, setActiveFileId] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  const [uploadNotice, setUploadNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const projectUploadRef = useRef<HTMLInputElement>(null);
  const fileUploadRef = useRef<HTMLInputElement>(null);
  const [collapsedOutlineIds, setCollapsedOutlineIds] = useState<Set<string>>(() => new Set());
  const [isRefreshingPreview, setIsRefreshingPreview] = useState(false);
  const [compileOutput, setCompileOutput] = useState<CompileOutput | null>(null);
  // The last PDF stays on screen while the source changes; this marks it as behind the editor.
  const [isPreviewStale, setIsPreviewStale] = useState(false);
  const [compileSeconds, setCompileSeconds] = useState<number | null>(null);
  const projectSearchRef = useRef<HTMLInputElement>(null);
  const modKey = useSyncExternalStore(noopSubscribe, () => (isMacPlatform() ? "⌘" : "Ctrl"), () => "Ctrl");
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchStatus, setSearchStatus] = useState("");
  const [openFileMenuId, setOpenFileMenuId] = useState<string | null>(null);
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [draftFileName, setDraftFileName] = useState("");
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter>("all");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [projectTags, setProjectTags] = useState<string[]>([]);
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectWarning, setNewProjectWarning] = useState("");
  const [isNewTagModalOpen, setIsNewTagModalOpen] = useState(false);
  const [isFigureModalOpen, setIsFigureModalOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagWarning, setNewTagWarning] = useState("");
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);

  useEffect(
    () => () => {
      if (compileOutput?.ok) {
        URL.revokeObjectURL(compileOutput.pdfObjectUrl);
      }
    },
    [compileOutput],
  );

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? projects[0],
    [activeProjectId, projects],
  );
  const projectFiles = useMemo(() => activeProject?.files ?? [], [activeProject]);
  const activeFile = useMemo(
    () => projectFiles.find((file) => file.id === activeFileId) ?? projectFiles[0],
    [activeFileId, projectFiles],
  );
  const sourceCode = activeFile?.content ?? "";
  const fileName = activeFile?.name ?? "";
  const isTexFile = fileName.toLowerCase().endsWith(".tex");

  const outlineItems = useMemo(
    () => (isTexFile && activeFile ? buildOutline(activeFile.id, projectFiles) : []),
    [isTexFile, activeFile, projectFiles],
  );
  const outlineById = useMemo(
    () => new Map(outlineItems.map((item) => [item.id, item])),
    [outlineItems],
  );
  const isOutlineHidden = (item: OutlineItem) => {
    for (let id = item.parentId; id; id = outlineById.get(id)?.parentId ?? null) {
      if (collapsedOutlineIds.has(id)) {
        return true;
      }
    }
    return false;
  };
  // The heading the cursor sits under; if it is folded away, its nearest visible ancestor.
  let activeOutline = outlineItems.findLast((item) => item.anchor <= cursorPosition);
  while (activeOutline?.parentId && isOutlineHidden(activeOutline)) {
    activeOutline = outlineById.get(activeOutline.parentId);
  }
  const activeOutlineId = activeOutline?.id ?? null;

  const toggleOutlineItem = (id: string) =>
    setCollapsedOutlineIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });

  const searchMatches = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();

    if (!needle) {
      return [];
    }

    const haystack = sourceCode.toLowerCase();
    const matches: number[] = [];
    let nextIndex = haystack.indexOf(needle);

    while (nextIndex !== -1) {
      matches.push(nextIndex);
      nextIndex = haystack.indexOf(needle, nextIndex + needle.length);
    }

    return matches;
  }, [searchQuery, sourceCode]);

  const dashboardCounts = useMemo(
    () => ({
      all: projects.filter((project) => !project.isArchived).length,
      yours: projects.filter((project) => project.owner === "You" && !project.isArchived).length,
      shared: projects.filter((project) => project.isShared && !project.isArchived).length,
      archived: projects.filter((project) => project.isArchived).length,
    }),
    [projects],
  );
  const dashboardTitle = selectedTag
    ? `Tagged: ${selectedTag}`
    : dashboardFilter === "all"
      ? "All projects"
      : dashboardFilter === "yours"
        ? "Your projects"
        : dashboardFilter === "shared"
          ? "Shared with you"
          : "Archived projects";
  const filteredProjects = useMemo(() => {
    const query = projectSearchQuery.trim().toLowerCase();
    const baseProjects = projects.filter((project) => {
      if (selectedTag) {
        return !project.isArchived && project.tags.includes(selectedTag);
      }

      if (dashboardFilter === "yours") {
        return project.owner === "You" && !project.isArchived;
      }

      if (dashboardFilter === "shared") {
        return project.isShared && !project.isArchived;
      }

      if (dashboardFilter === "archived") {
        return project.isArchived;
      }

      return !project.isArchived;
    });

    if (!query) {
      return baseProjects;
    }

    return baseProjects.filter((project) =>
      [project.title, project.owner, ...project.tags].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [dashboardFilter, projectSearchQuery, projects, selectedTag]);
  const selectedProjects = useMemo(
    () => projects.filter((project) => selectedProjectIds.includes(project.id)),
    [projects, selectedProjectIds],
  );

  // Persistence: the last saved payload per project id, and the latest projects for async code.
  const savedProjectsRef = useRef(new Map<string, string>());
  const projectsRef = useRef(projects);
  const saveQueueRef = useRef(Promise.resolve());
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  const loadWorkspace = async (signedInUser: User) => {
    const { projects: storedProjects } = await apiJson<{ projects: StoredProject[] }>("/api/v1/projects");
    const loadedProjects = storedProjects.map(fromStoredProject);

    savedProjectsRef.current = new Map(loadedProjects.map((project) => [project.id, toSavePayload(project)]));

    // A new account starts with one example project; autosave stores it.
    if (loadedProjects.length === 0) {
      loadedProjects.push(createStarterProject());
    }

    lastUserIdRef.current = signedInUser.id;
    setProjects(loadedProjects);
    setActiveProjectId(loadedProjects[0].id);
    setActiveFileId(loadedProjects[0].files[0]?.id ?? "");
    setProjectTags(Array.from(new Set(loadedProjects.flatMap((project) => project.tags))));
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
  }, []);

  const syncProjects = async () => {
    const saved = savedProjectsRef.current;
    const current = new Map(projectsRef.current.map((project) => [project.id, toSavePayload(project)]));
    const changed = [...current].filter(([id, payload]) => saved.get(id) !== payload);
    const removed = [...saved.keys()].filter((id) => !current.has(id));

    if (changed.length === 0 && removed.length === 0) {
      return;
    }

    setSaveState({ status: "saving" });

    try {
      for (const [id, payload] of changed) {
        await apiJson(`/api/v1/projects/${id}`, { method: "PUT", body: payload });
        saved.set(id, payload);
      }

      for (const id of removed) {
        await apiJson(`/api/v1/projects/${id}`, { method: "DELETE" });
        saved.delete(id);
      }

      setSaveState({ status: "saved" });
    } catch (error) {
      setSaveState({ status: "error", message: errorMessage(error) });

      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
      }
    }
  };

  // Saves run one after another so an older save can never overwrite a newer one.
  const queueSync = () => {
    saveQueueRef.current = saveQueueRef.current.then(syncProjects);

    return saveQueueRef.current;
  };

  useEffect(() => {
    if (!user) {
      return;
    }

    const timer = window.setTimeout(() => void queueSync(), 1000);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, user]);

  useEffect(() => {
    const warnAboutUnsavedChanges = (event: BeforeUnloadEvent) => {
      const hasUnsaved = projectsRef.current.some(
        (project) => savedProjectsRef.current.get(project.id) !== toSavePayload(project),
      );

      if (hasUnsaved) {
        event.preventDefault();
      }
    };

    window.addEventListener("beforeunload", warnAboutUnsavedChanges);

    return () => window.removeEventListener("beforeunload", warnAboutUnsavedChanges);
  }, []);

  const handleLogout = async () => {
    setIsProfileMenuOpen(false);
    await queueSync();
    await apiFetch("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);

    savedProjectsRef.current = new Map();
    lastUserIdRef.current = null;
    setProjects([]);
    setActiveProjectId("");
    setActiveFileId("");
    setProjectTags([]);
    setCompileOutput(null);
    setSaveState({ status: "saved" });
    setCurrentView("dashboard");
    setUser(null);
  };

  const saveLabel =
    saveState.status === "saving"
      ? "Saving..."
      : saveState.status === "error"
        ? `Not saved: ${saveState.message}`
        : "All changes saved";

  useEffect(() => {
    // Long enough for the logo to start its story, short enough not to keep anyone waiting.
    const timer = window.setTimeout(() => {
      setIsBooting(false);
    }, 1100);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!openFileMenuId) {
      return;
    }

    const closeFileMenu = (event: MouseEvent) => {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      if (target.closest(".file-options-menu") || target.closest(".file-menu-trigger")) {
        return;
      }

      setOpenFileMenuId(null);
    };

    document.addEventListener("mousedown", closeFileMenu);

    return () => {
      document.removeEventListener("mousedown", closeFileMenu);
    };
  }, [openFileMenuId]);

  useEffect(() => {
    if (!isProfileMenuOpen) {
      return;
    }

    const closeProfileMenu = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(".profile-menu-wrap")) {
        return;
      }

      setIsProfileMenuOpen(false);
    };

    document.addEventListener("mousedown", closeProfileMenu);

    return () => {
      document.removeEventListener("mousedown", closeProfileMenu);
    };
  }, [isProfileMenuOpen]);

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

  const updateActiveFile = (changes: Partial<ProjectFile>) => {
    updateActiveProjectFiles((currentFiles) =>
      currentFiles.map((file) =>
        file.id === activeFileId
          ? {
              ...file,
              ...changes,
            }
          : file,
      ),
    );
  };

  const updateActiveContent = (content: string) => {
    updateActiveFile({ content });
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
    setIsProfileMenuOpen(false);
    void runPageTransition(
      "Preparing your project dashboard",
      () => {
        setCurrentView("dashboard");
      },
    );
  };

  const selectDashboardFilter = (filter: DashboardFilter) => {
    setDashboardFilter(filter);
    setSelectedTag(null);
    setSelectedProjectIds([]);
  };

  const selectProjectTag = (tagName: string) => {
    setSelectedTag(tagName);
    setSelectedProjectIds([]);
  };

  const openNewTagModal = () => {
    setNewTagName("");
    setNewTagWarning("");
    setIsNewTagModalOpen(true);
  };

  const handleCreateFile = () => {
    const nextFile: ProjectFile = {
      id: `file-${Date.now()}`,
      name: `untitled-${projectFiles.length + 1}.tex`,
      content: "",
    };

    updateActiveProjectFiles((currentFiles) => [...currentFiles, nextFile]);
    setActiveFileId(nextFile.id);

    window.requestAnimationFrame(() => editorRef.current?.focus());
  };

  const openProject = (projectId: string) => {
    const project = projects.find((candidate) => candidate.id === projectId);

    if (!project) {
      return;
    }

    void runPageTransition(
      `Preparing your project ${project.title}`,
      () => {
        setActiveProjectId(project.id);
        setActiveFileId(project.files[0]?.id ?? "");
        setCompileOutput(null);
        setCurrentView("editor");

        window.requestAnimationFrame(() => editorRef.current?.focus());
      },
    );
  };

  const openNewProjectModal = () => {
    setNewProjectName("");
    setNewProjectWarning("");
    setIsNewProjectModalOpen(true);
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
          text: `Nothing to import: no text files found${result.skipped.length ? ` (${result.skipped.length} skipped)` : ""}.`,
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
    const newProject: ProjectSummary = {
      id: crypto.randomUUID(),
      title,
      owner: "You",
      lastModified: "Just now by You",
      tags: selectedTag ? [selectedTag] : [],
      isShared: false,
      isArchived: false,
      files: result.files.map((file, index) => ({ id: `file-${stamp}-${index}`, ...file })),
    };

    setProjects((currentProjects) => [newProject, ...currentProjects]);
    setActiveProjectId(newProject.id);
    setActiveFileId(newProject.files[0].id);
    setCompileOutput(null);
    setDashboardFilter("all");

    void runPageTransition(`Preparing your project ${newProject.title}`, () => {
      setCurrentView("editor");
      window.requestAnimationFrame(() => editorRef.current?.focus());
    });
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

  const uploadNoticeBanner = uploadNotice && (
    <div className={`upload-notice ${uploadNotice.tone}`} role={uploadNotice.tone === "error" ? "alert" : "status"}>
      <p>{uploadNotice.text}</p>
      <button type="button" aria-label="Dismiss" onClick={() => setUploadNotice(null)}>
        <X size={15} />
      </button>
    </div>
  );

  const handleGenerateProject = () => {
    const projectName = newProjectName.trim();

    if (!projectName) {
      setNewProjectWarning("Project name is required.");
      return;
    }

    if (projects.some((project) => project.title.toLowerCase() === projectName.toLowerCase())) {
      setNewProjectWarning("A project with this name already exists.");
      return;
    }

    const newProject: ProjectSummary = {
      id: crypto.randomUUID(),
      title: projectName,
      owner: "You",
      lastModified: "Just now by You",
      tags: selectedTag ? [selectedTag] : [],
      isShared: false,
      isArchived: false,
      files: [
        {
          id: `main-${Date.now()}`,
          name: "Main.tex",
          content: String.raw`\documentclass{article}
\usepackage{tikz}

\begin{document}

\section{New Diagram}
Start writing your TikZ code here.

\end{document}`,
        },
        {
          id: `bibliography-${Date.now()}`,
          name: "references.bib",
          content: "",
        },
      ],
    };

    setProjects((currentProjects) => [newProject, ...currentProjects]);
    setActiveProjectId(newProject.id);
    setActiveFileId(newProject.files[0].id);
    setCompileOutput(null);
    setNewProjectName("");
    setNewProjectWarning("");
    setIsNewProjectModalOpen(false);
    setDashboardFilter("all");

    void runPageTransition(
      `Preparing your project ${newProject.title}`,
      () => {
        setCurrentView("editor");

        window.requestAnimationFrame(() => editorRef.current?.focus());
      },
    );
  };

  const handleSelectFile = (fileId: string) => {
    setActiveFileId(fileId);
    setOpenFileMenuId(null);

    window.requestAnimationFrame(() => {
      const editor = editorRef.current;

      editor?.focus();
      editor?.setSelectionRange(0, 0);
    });
  };

  const beginRenameFile = (file: ProjectFile) => {
    setActiveFileId(file.id);
    setDraftFileName(file.name);
    setRenamingFileId(file.id);
    setOpenFileMenuId(null);
  };

  const commitRenameFile = (fileId: string) => {
    const nextName = draftFileName.trim();

    if (nextName) {
      updateActiveProjectFiles((currentFiles) =>
        currentFiles.map((file) =>
          file.id === fileId
            ? {
                ...file,
                name: nextName,
              }
            : file,
        ),
      );
    }

    setRenamingFileId(null);
    setDraftFileName("");
  };

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>, fileId: string) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitRenameFile(fileId);
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setRenamingFileId(null);
      setDraftFileName("");
    }
  };

  const deleteFile = (fileId: string) => {
    const remainingFiles = projectFiles.filter((file) => file.id !== fileId);

    updateActiveProjectFiles(() => remainingFiles);
    setOpenFileMenuId(null);
    setRenamingFileId(null);
    setDraftFileName("");
    setIsPreviewStale(true);

    if (activeFileId === fileId) {
      setActiveFileId(remainingFiles[0]?.id ?? "");
    }
  };

  const deleteProject = (projectId: string) => {
    const remainingProjects = projects.filter((project) => project.id !== projectId);

    setProjects(remainingProjects);
    setSelectedProjectIds((currentIds) => currentIds.filter((id) => id !== projectId));

    if (activeProjectId === projectId) {
      setActiveProjectId(remainingProjects[0]?.id ?? "");
      setActiveFileId(remainingProjects[0]?.files[0]?.id ?? "");
    }
  };

  const archiveProject = (projectId: string) => {
    setProjects((currentProjects) =>
      currentProjects.map((project) =>
        project.id === projectId
          ? {
              ...project,
              isArchived: true,
              lastModified: "Just now by You",
            }
          : project,
      ),
    );
    setSelectedProjectIds((currentIds) => currentIds.filter((id) => id !== projectId));
  };

  const restoreProject = (projectId: string) => {
    setProjects((currentProjects) =>
      currentProjects.map((project) =>
        project.id === projectId
          ? {
              ...project,
              isArchived: false,
              lastModified: "Just now by You",
            }
          : project,
      ),
    );
    setSelectedProjectIds((currentIds) => currentIds.filter((id) => id !== projectId));
  };

  const duplicateProject = (project: ProjectSummary) => {
    const nextProject: ProjectSummary = {
      ...project,
      id: crypto.randomUUID(),
      title: `${project.title} Copy`,
      owner: "You",
      isShared: false,
      isArchived: false,
      lastModified: "Just now by You",
      files: project.files.map((file) => ({
        ...file,
        id: `${file.id}-copy-${Date.now()}`,
      })),
    };

    setProjects((currentProjects) => [nextProject, ...currentProjects]);
    setDashboardFilter("all");
    setSelectedTag(null);
    setSelectedProjectIds([]);
  };

  const downloadProject = (project: ProjectSummary) => {
    downloadBlob(createProjectZip([project]), `${sanitizeFileName(project.title)}.zip`);
  };

  const toggleProjectSelection = (projectId: string) => {
    setSelectedProjectIds((currentIds) =>
      currentIds.includes(projectId)
        ? currentIds.filter((id) => id !== projectId)
        : [...currentIds, projectId],
    );
  };

  const toggleAllVisibleProjects = () => {
    const visibleProjectIds = filteredProjects.map((project) => project.id);
    const allVisibleSelected = visibleProjectIds.every((projectId) =>
      selectedProjectIds.includes(projectId),
    );

    setSelectedProjectIds((currentIds) =>
      allVisibleSelected
        ? currentIds.filter((projectId) => !visibleProjectIds.includes(projectId))
        : Array.from(new Set([...currentIds, ...visibleProjectIds])),
    );
  };

  const deleteSelectedProjects = () => {
    const selectedIds = new Set(selectedProjectIds);
    const remainingProjects = projects.filter((project) => !selectedIds.has(project.id));

    setProjects(remainingProjects);
    setSelectedProjectIds([]);

    if (activeProjectId && selectedIds.has(activeProjectId)) {
      setActiveProjectId(remainingProjects[0]?.id ?? "");
      setActiveFileId(remainingProjects[0]?.files[0]?.id ?? "");
    }
  };

  const archiveSelectedProjects = () => {
    const selectedIds = new Set(selectedProjectIds);

    setProjects((currentProjects) =>
      currentProjects.map((project) =>
        selectedIds.has(project.id)
          ? {
              ...project,
              isArchived: true,
              lastModified: "Just now by You",
            }
          : project,
      ),
    );
    setSelectedProjectIds([]);
  };

  const restoreSelectedProjects = () => {
    const selectedIds = new Set(selectedProjectIds);

    setProjects((currentProjects) =>
      currentProjects.map((project) =>
        selectedIds.has(project.id)
          ? {
              ...project,
              isArchived: false,
              lastModified: "Just now by You",
            }
          : project,
      ),
    );
    setSelectedProjectIds([]);
  };

  const downloadSelectedProjects = () => {
    if (selectedProjects.length === 0) {
      return;
    }

    downloadBlob(createProjectZip(selectedProjects), "tikz-projects.zip");
  };

  const handleCreateTag = () => {
    const tagName = newTagName.trim();

    if (!tagName) {
      setNewTagWarning("Tag name is required.");
      return;
    }

    if (projectTags.some((tag) => tag.toLowerCase() === tagName.toLowerCase())) {
      setNewTagWarning("A tag with this name already exists.");
      return;
    }

    setProjectTags((currentTags) => [...currentTags, tagName]);

    if (selectedProjectIds.length > 0) {
      const selectedIds = new Set(selectedProjectIds);

      setProjects((currentProjects) =>
        currentProjects.map((project) =>
          selectedIds.has(project.id)
            ? {
                ...project,
                tags: Array.from(new Set([...project.tags, tagName])),
                lastModified: "Just now by You",
              }
            : project,
        ),
      );
    }

    setSelectedTag(tagName);
    setSelectedProjectIds([]);
    setNewTagName("");
    setNewTagWarning("");
    setIsNewTagModalOpen(false);
  };

  const jumpToOutlineItem = (item: OutlineItem) => {
    if (item.fileId !== activeFile?.id) {
      handleSelectFile(item.fileId);
      window.requestAnimationFrame(() => editorRef.current?.setSelectionRange(item.start, item.start));
      return;
    }
    editorRef.current?.setSelectionRange(item.start, item.start);
  };

  const selectEditorRange = (start: number, end: number) => {
    editorRef.current?.setSelectionRange(start, end);
  };

  const handleSearch = (direction: "next" | "previous" = "next") => {
    const needle = searchQuery.trim();
    const editor = editorRef.current;

    if (!needle) {
      setSearchStatus("");
      editor?.focus();
      return;
    }

    if (searchMatches.length === 0) {
      setSearchStatus("0/0");
      editor?.focus();
      return;
    }

    const currentSelectionStart = editor?.selectionStart ?? 0;
    const currentSelectionEnd = editor?.selectionEnd ?? 0;
    const currentMatchIndex = searchMatches.findIndex(
      (matchStart) =>
        matchStart === currentSelectionStart && matchStart + needle.length === currentSelectionEnd,
    );
    const fallbackIndex =
      direction === "next"
        ? searchMatches.findIndex((matchStart) => matchStart >= currentSelectionEnd)
        : searchMatches.findLastIndex((matchStart) => matchStart < currentSelectionStart);
    const nextIndex =
      currentMatchIndex === -1
        ? fallbackIndex === -1
          ? direction === "next"
            ? 0
            : searchMatches.length - 1
          : fallbackIndex
        : direction === "next"
          ? (currentMatchIndex + 1) % searchMatches.length
          : (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    const nextMatch = searchMatches[nextIndex];

    selectEditorRange(nextMatch, nextMatch + needle.length);
    setSearchStatus(`${nextIndex + 1}/${searchMatches.length}`);
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
      const response = await apiFetch("/api/v1/compile", {
        method: "POST",
        body: JSON.stringify({
          mainFileName: mainFile.name,
          files: projectFiles.map((file) => ({ name: file.name, content: file.content })),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const result = (await response.json()) as CompileErrorResponse;

        setCompileOutput({
          ok: false,
          message: result.error.message,
          log:
            result.error.log ??
            result.error.details?.map((detail) => `${detail.path}: ${detail.message}`).join("\n") ??
            "",
        });
        return;
      }

      const contentType = response.headers.get("content-type") ?? "";

      if (!contentType.toLowerCase().startsWith("application/pdf")) {
        throw new Error("The backend did not return a PDF document.");
      }

      const pdfBlob = await response.blob();
      const fallbackFileName = `${sanitizeFileName(mainFile.name.replace(/\.tex$/i, ""))}.pdf`;

      setCompileOutput({
        ok: true,
        pdfFileName: pdfFileNameFromResponse(
          response.headers.get("content-disposition"),
          fallbackFileName,
        ),
        pdfObjectUrl: URL.createObjectURL(pdfBlob),
      });
      setIsPreviewStale(false);
      setCompileSeconds((performance.now() - startedAt) / 1000);
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

  const handleDownloadCompiledPdf = () => {
    if (!compileOutput?.ok) {
      return;
    }

    const link = document.createElement("a");

    link.href = compileOutput.pdfObjectUrl;
    link.download = compileOutput.pdfFileName;
    link.click();
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

    window.requestAnimationFrame(() => selectEditorRange(start, end));
  };

  // Shortcuts: Mod+Enter / Mod+S compile (the editor handles them itself when focused), "/" focuses project
  // search, Escape closes open menus and dialogs. Re-subscribed each render so it always sees current state.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      const mod = event.metaKey || event.ctrlKey;

      const isCompileKey = mod && (event.key === "Enter" || event.key.toLowerCase() === "s");

      if (currentView === "editor" && user && !isFigureModalOpen && isCompileKey) {
        event.preventDefault();
        void handleRefreshPreview();
        return;
      }

      if (event.key === "Escape") {
        setIsProfileMenuOpen(false);
        setOpenFileMenuId(null);
        setIsNewProjectModalOpen(false);
        setIsNewTagModalOpen(false);
        return;
      }

      const isTyping =
        event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable='true']");

      if (currentView === "dashboard" && event.key === "/" && !mod && !isTyping) {
        event.preventDefault();
        projectSearchRef.current?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const beforeCursor = sourceCode.slice(0, cursorPosition);
  const cursorLine = beforeCursor.split("\n").length;
  const cursorColumn = beforeCursor.length - beforeCursor.lastIndexOf("\n");
  const texError = compileOutput && !compileOutput.ok ? firstTexError(compileOutput.log) : null;
  // Only offer the jump when the error is in one of the project's own files (not a system .tex file).
  const canJumpToError =
    Boolean(texError?.line) && (!texError?.file || projectFiles.some((file) => file.name === texError.file));
  const compileChip = isRefreshingPreview
    ? { tone: "busy", label: "Compiling…" }
    : compileOutput?.ok
      ? isPreviewStale
        ? { tone: "stale", label: "Out of date" }
        : { tone: "ok", label: compileSeconds ? `Compiled in ${compileSeconds.toFixed(1)}s` : "Compiled" }
      : compileOutput
        ? { tone: "error", label: "Compile failed" }
        : null;

  if (isBooting || !isSessionChecked) {
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

  if (!user) {
    return <AuthScreen error={authError} onSignedIn={(signedInUser) => void handleSignedIn(signedInUser)} />;
  }

  if (currentView === "dashboard") {
    return (
      <main className="dashboard-shell">
        {uploadNoticeBanner}
        {transitionLabel && (
          <div className="transition-overlay" aria-live="polite">
            <div className="loading-logo compact" aria-hidden="true">
              <Logo size={68} loop />
            </div>
            <div className="loading-copy transition-copy">
              <h1>TikZ Studio</h1>
              <p>{transitionLabel}</p>
            </div>
          </div>
        )}

        <aside className="dashboard-sidebar" aria-label="Project navigation">
          <div className="dashboard-actions">
            <button className="new-project-button" type="button" onClick={openNewProjectModal}>
              <Plus size={19} />
              New project
            </button>
            <button
              className="upload-project-button"
              type="button"
              title="Upload a .zip of a whole project, or single .tex/.bib files"
              onClick={() => projectUploadRef.current?.click()}
            >
              <Upload size={17} />
              Upload project
            </button>
            <input
              ref={projectUploadRef}
              type="file"
              accept=".zip,.tex,.bib,.sty,.cls,.bst,.txt"
              multiple
              hidden
              onChange={(event) => void handleUploadProject(event.currentTarget)}
            />
          </div>

          <nav className="dashboard-nav" aria-label="Project filters">
            <button
              className={
                dashboardFilter === "all" && !selectedTag
                  ? "dashboard-nav-item active"
                  : "dashboard-nav-item"
              }
              type="button"
              onClick={() => selectDashboardFilter("all")}
            >
              <span>All projects</span>
              <strong>{dashboardCounts.all}</strong>
            </button>
            <button
              className={
                dashboardFilter === "yours" && !selectedTag
                  ? "dashboard-nav-item active"
                  : "dashboard-nav-item"
              }
              type="button"
              onClick={() => selectDashboardFilter("yours")}
            >
              <span>Your projects</span>
              <strong>{dashboardCounts.yours}</strong>
            </button>
            <button
              className={
                dashboardFilter === "shared" && !selectedTag
                  ? "dashboard-nav-item active"
                  : "dashboard-nav-item"
              }
              type="button"
              onClick={() => selectDashboardFilter("shared")}
            >
              <span>Shared with you</span>
              <strong>{dashboardCounts.shared}</strong>
            </button>
            <button
              className={
                dashboardFilter === "archived" && !selectedTag
                  ? "dashboard-nav-item active"
                  : "dashboard-nav-item"
              }
              type="button"
              onClick={() => selectDashboardFilter("archived")}
            >
              <span>Archived projects</span>
              <strong>{dashboardCounts.archived}</strong>
            </button>
          </nav>

          <section className="dashboard-tags" aria-label="Tags">
            <h2>Organize Tags</h2>
            <div className="tag-filter-list">
              {projectTags.map((tagName) => {
                const taggedCount = projects.filter(
                  (project) => !project.isArchived && project.tags.includes(tagName),
                ).length;

                return (
                  <button
                    className={selectedTag === tagName ? "tag-filter active" : "tag-filter"}
                    type="button"
                    key={tagName}
                    onClick={() => selectProjectTag(tagName)}
                  >
                    <Tag size={15} />
                    <span>{tagName}</span>
                    <strong>{taggedCount}</strong>
                  </button>
                );
              })}
            </div>
            <button className="new-tag-button" type="button" onClick={openNewTagModal}>
              <Plus size={17} />
              New tag
            </button>
          </section>

          <div className="dashboard-brand">
            <Logo size={30} loop />
            <span>TikZ Studio</span>
          </div>
        </aside>

        <section className="projects-page" aria-label={dashboardTitle}>
          <header className="projects-header">
            <h1>{dashboardTitle}</h1>
            <div className="plan-pill">
              <span className="save-status">
                <span className={`save-dot ${saveState.status}`} aria-hidden="true" />
                <strong>{user.email}</strong> · {saveLabel}
              </span>
              <ThemeToggle />
              <button type="button" onClick={() => void handleLogout()}>
                Sign out
              </button>
            </div>
          </header>

          <label className="project-search">
            <Search size={19} />
            <span className="sr-only">Search projects</span>
            <input
              ref={projectSearchRef}
              placeholder={`Search in ${dashboardTitle.toLowerCase()}...`}
              value={projectSearchQuery}
              onChange={(event) => setProjectSearchQuery(event.target.value)}
            />
            <kbd className="search-kbd" title="Press / to search">/</kbd>
          </label>

          {selectedProjectIds.length > 0 && (
            <div className="bulk-actions" aria-label="Selected project actions">
              <span>{selectedProjectIds.length} projects selected</span>
              <button type="button" onClick={downloadSelectedProjects}>
                <Download size={17} />
                Download
              </button>
              {dashboardFilter === "archived" && !selectedTag ? (
                <button type="button" onClick={restoreSelectedProjects}>
                  <ArchiveRestore size={17} />
                  Restore
                </button>
              ) : (
                <button type="button" onClick={archiveSelectedProjects}>
                  <Archive size={17} />
                  Archive
                </button>
              )}
              <button className="danger" type="button" onClick={deleteSelectedProjects}>
                <Trash2 size={17} />
                Delete
              </button>
            </div>
          )}

          <div className="projects-table" role="table" aria-label="TikZ projects">
            <div className="projects-table-row header" role="row">
              <label className="project-title-header" role="columnheader">
                <input
                  type="checkbox"
                  checked={
                    filteredProjects.length > 0 &&
                    filteredProjects.every((project) => selectedProjectIds.includes(project.id))
                  }
                  onChange={toggleAllVisibleProjects}
                />
                Title
              </label>
              <span role="columnheader">Owner</span>
              <span role="columnheader">Last modified</span>
              <span role="columnheader">Tags</span>
              <span role="columnheader">Actions</span>
            </div>

            {filteredProjects.map((project, index) => (
              <div
                className="projects-table-row project-row"
                role="row"
                key={project.id}
                style={{ "--i": Math.min(index, 12) } as CSSProperties}
              >
                <div className="project-title-cell">
                  <input
                    type="checkbox"
                    checked={selectedProjectIds.includes(project.id)}
                    aria-label={`Select ${project.title}`}
                    onChange={() => toggleProjectSelection(project.id)}
                  />
                  <button type="button" onClick={() => openProject(project.id)}>
                    <FileText size={18} />
                    <span>
                      {project.title}
                      <small>{project.files.length} files</small>
                    </span>
                  </button>
                </div>
                <span>{project.owner}</span>
                <span>{project.lastModified}</span>
                <div className="project-tags-cell">
                  {project.tags.length > 0 ? (
                    project.tags.map((tagName) => (
                      <button
                        type="button"
                        key={tagName}
                        onClick={() => selectProjectTag(tagName)}
                      >
                        {tagName}
                      </button>
                    ))
                  ) : (
                    <span>No tags</span>
                  )}
                </div>
                <div className="project-actions">
                  <button
                    type="button"
                    aria-label={`Open ${project.title}`}
                    onClick={() => openProject(project.id)}
                  >
                    <FileText size={17} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Duplicate ${project.title}`}
                    onClick={() => duplicateProject(project)}
                  >
                    <Copy size={17} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Download ${project.title}`}
                    onClick={() => downloadProject(project)}
                  >
                    <Download size={17} />
                  </button>
                  {project.isArchived ? (
                    <button
                      type="button"
                      aria-label={`Restore ${project.title}`}
                      onClick={() => restoreProject(project.id)}
                    >
                      <ArchiveRestore size={17} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Archive ${project.title}`}
                      onClick={() => archiveProject(project.id)}
                    >
                      <Archive size={17} />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Delete ${project.title}`}
                    onClick={() => deleteProject(project.id)}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>
            ))}

            {filteredProjects.length === 0 && (
              <div className="projects-empty">
                <Logo size={56} />
                <h2>{projectSearchQuery.trim() ? "No projects match your search" : "Nothing here yet"}</h2>
                <p>
                  {projectSearchQuery.trim()
                    ? "Try a different word, or clear the search."
                    : "Projects you create or upload will show up here."}
                </p>
                <button className="new-project-button" type="button" onClick={openNewProjectModal}>
                  <Plus size={17} />
                  New project
                </button>
              </div>
            )}
          </div>
        </section>

        {isNewProjectModalOpen && (
          <div
            className="modal-backdrop"
            role="presentation"
            onMouseDown={(event) => event.target === event.currentTarget && setIsNewProjectModalOpen(false)}
          >
            <form
              className="new-project-modal"
              aria-label="Create new project"
              onSubmit={(event) => {
                event.preventDefault();
                handleGenerateProject();
              }}
            >
              <header>
                <h2>New project</h2>
                <button
                  type="button"
                  aria-label="Close new project dialog"
                  onClick={() => setIsNewProjectModalOpen(false)}
                >
                  <X size={17} />
                </button>
              </header>

              <label>
                Project name
                <input
                  autoFocus
                  value={newProjectName}
                  onChange={(event) => {
                    setNewProjectName(event.target.value);
                    setNewProjectWarning("");
                  }}
                  placeholder="Example: Research flowchart"
                />
              </label>

              {newProjectWarning && <p className="modal-warning">{newProjectWarning}</p>}

              <div className="modal-actions">
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setIsNewProjectModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit">Create project</button>
              </div>
            </form>
          </div>
        )}

        {isNewTagModalOpen && (
          <div
            className="modal-backdrop"
            role="presentation"
            onMouseDown={(event) => event.target === event.currentTarget && setIsNewTagModalOpen(false)}
          >
            <form
              className="new-project-modal"
              aria-label="Create new tag"
              onSubmit={(event) => {
                event.preventDefault();
                handleCreateTag();
              }}
            >
              <header>
                <h2>New tag</h2>
                <button
                  type="button"
                  aria-label="Close new tag dialog"
                  onClick={() => setIsNewTagModalOpen(false)}
                >
                  <X size={17} />
                </button>
              </header>

              <label>
                Tag name
                <input
                  autoFocus
                  value={newTagName}
                  onChange={(event) => {
                    setNewTagName(event.target.value);
                    setNewTagWarning("");
                  }}
                  placeholder="Example: Thesis"
                />
              </label>

              {selectedProjectIds.length > 0 && (
                <p className="modal-help">
                  This tag will be added to {selectedProjectIds.length} selected project
                  {selectedProjectIds.length === 1 ? "" : "s"}.
                </p>
              )}
              {newTagWarning && <p className="modal-warning">{newTagWarning}</p>}

              <div className="modal-actions">
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setIsNewTagModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit">Create tag</button>
              </div>
            </form>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="workspace-shell">
      {uploadNoticeBanner}
      {transitionLabel && (
        <div className="transition-overlay" aria-live="polite">
          <div className="loading-logo compact" aria-hidden="true">
            <Logo size={68} loop />
          </div>
          <div className="loading-copy transition-copy">
            <h1>TikZ Studio</h1>
            <p>{transitionLabel}</p>
          </div>
        </div>
      )}

      <section className="app-frame" aria-label="TikZ editor workspace">
        <div className="workspace-grid">
          <aside className="file-rail" aria-label="Project navigation">
            <div className="rail-toolbar">
              <button
                className="home-logo-button"
                type="button"
                aria-label="Home"
                title="Home"
                onClick={goToDashboard}
              >
                <Logo size={34} />
              </button>
              <span className="rail-project-title" title={activeProject?.title}>
                {activeProject?.title}
              </span>
            </div>

            <nav className="file-card" aria-label="Files">
              <div className="panel-header">
                <span className="panel-title">Files</span>
                <button
                  className="panel-action"
                  type="button"
                  aria-label="Upload files"
                  title="Upload files or a .zip"
                  onClick={() => fileUploadRef.current?.click()}
                >
                  <Upload size={15} strokeWidth={2.4} />
                </button>
                <input
                  ref={fileUploadRef}
                  type="file"
                  accept=".zip,.tex,.bib,.sty,.cls,.bst,.txt"
                  multiple
                  hidden
                  onChange={(event) => void handleUploadFiles(event.currentTarget)}
                />
                <button
                  className="panel-action"
                  type="button"
                  aria-label="Add file"
                  title="New file"
                  onClick={handleCreateFile}
                >
                  <Plus size={15} strokeWidth={2.6} />
                </button>
                <button
                  className="panel-action"
                  type="button"
                  aria-label="Generate TikZ figure"
                  title="Generate TikZ figure"
                  onClick={() => setIsFigureModalOpen(true)}
                >
                  <Sparkles size={15} strokeWidth={2.4} />
                </button>
              </div>
              {projectFiles.map((file) => (
                <div
                  className={file.id === activeFileId ? "file-row active" : "file-row"}
                  data-ext={file.name.split(".").pop()?.toLowerCase()}
                  key={file.id}
                >
                  {renamingFileId === file.id ? (
                    <input
                      className="file-rename-input"
                      value={draftFileName}
                      autoFocus
                      onChange={(event) => setDraftFileName(event.target.value)}
                      onBlur={() => commitRenameFile(file.id)}
                      onKeyDown={(event) => handleRenameKeyDown(event, file.id)}
                    />
                  ) : (
                    <button
                      className={file.id === activeFileId ? "file-link active" : "file-link"}
                      type="button"
                      onClick={() => handleSelectFile(file.id)}
                    >
                      <FileText size={16} />
                      <span>{file.name}</span>
                    </button>
                  )}

                  <button
                    className="file-menu-trigger"
                    type="button"
                    aria-label={`Open options for ${file.name}`}
                    aria-haspopup="menu"
                    aria-expanded={openFileMenuId === file.id}
                    onClick={() =>
                      setOpenFileMenuId((currentFileId) =>
                        currentFileId === file.id ? null : file.id,
                      )
                    }
                  >
                    <MoreVertical size={16} />
                  </button>

                  {openFileMenuId === file.id && (
                    <div className="file-options-menu" role="menu" aria-label={`${file.name} options`}>
                      <button
                        className="file-options-item"
                        type="button"
                        role="menuitem"
                        onClick={() => beginRenameFile(file)}
                      >
                        <Pencil size={15} />
                        <span>Rename</span>
                      </button>
                      <button
                        className="file-options-item danger"
                        type="button"
                        role="menuitem"
                        onClick={() => deleteFile(file.id)}
                      >
                        <Trash2 size={15} />
                        <span>Delete</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </nav>

            <details className="section-layout" open>
              <summary className="panel-title">
                <ChevronDown className="panel-chevron" size={14} strokeWidth={2.6} aria-hidden />
                File outline
              </summary>
              <div className="outline-list">
                {outlineItems.length > 0 ? (
                  outlineItems.map((item) =>
                    isOutlineHidden(item) ? null : (
                      <div
                        className={item.id === activeOutlineId ? "outline-row active" : "outline-row"}
                        key={item.id}
                        style={{ paddingLeft: 6 + item.depth * 14 }}
                      >
                        {item.hasChildren ? (
                          <button
                            className="outline-toggle"
                            type="button"
                            aria-label={`${collapsedOutlineIds.has(item.id) ? "Expand" : "Collapse"} ${item.title}`}
                            aria-expanded={!collapsedOutlineIds.has(item.id)}
                            onClick={() => toggleOutlineItem(item.id)}
                          >
                            <ChevronDown size={13} strokeWidth={2.6} aria-hidden />
                          </button>
                        ) : (
                          <span className="outline-toggle" aria-hidden />
                        )}
                        <button
                          className="outline-item"
                          data-level={item.level}
                          type="button"
                          title={`\\${item.command} · line ${item.line}`}
                          onClick={() => jumpToOutlineItem(item)}
                        >
                          {item.title}
                        </button>
                      </div>
                    ),
                  )
                ) : (
                  <p className="empty-outline">
                    {isTexFile ? "No sections" : "Outline available for .tex files"}
                  </p>
                )}
              </div>
            </details>

            <div className="profile-menu-wrap">
              {isProfileMenuOpen && (
                <div className="profile-menu" role="menu" aria-label="Profile menu">
	                  <button
	                    className="profile-menu-item"
	                    type="button"
	                    role="menuitem"
	                    onClick={goToDashboard}
	                  >
                    <HomeIcon size={17} />
                    <span>Home</span>
                  </button>
                  <button
                    className="profile-menu-item"
                    type="button"
                    role="menuitem"
                    onClick={() => void handleLogout()}
                  >
                    <LogOut size={17} />
                    <span>Logout</span>
                  </button>
                </div>
              )}

              <button
                className="profile-button"
                type="button"
                aria-haspopup="menu"
                aria-expanded={isProfileMenuOpen}
                onClick={() => setIsProfileMenuOpen((isOpen) => !isOpen)}
              >
                <UserRound size={18} />
                <span className="profile-email">{user.email}</span>
              </button>
            </div>
          </aside>

          <section className="editor-pane" aria-label="LaTeX code editor">
            <div className="editor-toolbar" aria-label="Editor formatting toolbar">
              <div className="format-buttons">
                <button
                  className="tool-button"
                  type="button"
                  aria-label="Bold selected text"
                  title={`Bold (${modKey}B)`}
                  aria-keyshortcuts="Control+B Meta+B"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyTextCommand("textbf")}
                >
                  <Bold size={21} />
                </button>
                <button
                  className="tool-button"
                  type="button"
                  aria-label="Italicize selected text"
                  title={`Italic (${modKey}I)`}
                  aria-keyshortcuts="Control+I Meta+I"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyTextCommand("textit")}
                >
                  <Italic size={21} />
                </button>
                <button
                  className="tool-button boxed"
                  type="button"
                  aria-label="Underline selected text"
                  title={`Underline (${modKey}U)`}
                  aria-keyshortcuts="Control+U Meta+U"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyTextCommand("underline")}
                >
                  <Underline size={18} />
                </button>
                <button
                  className="tool-button boxed"
                  type="button"
                  aria-label="Upright Roman text"
                  title="Upright Roman text (\\textrm)"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyTextCommand("textrm")}
                >
                  <Type size={18} />
                </button>
              </div>

              <label className="file-name-field">
                <span className="sr-only">File name</span>
                <input
                  value={fileName}
                  onChange={(event) => updateActiveFile({ name: event.target.value })}
                />
              </label>

              <div className="search-field" role="search">
                <button
                  className="search-button"
                  type="button"
                  aria-label="Search LaTeX source"
                  onClick={() => handleSearch("next")}
                >
                  <Search size={17} />
                </button>
                <span className="sr-only">Search LaTeX source</span>
                <input
                  placeholder="Search"
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setSearchStatus("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleSearch(event.shiftKey ? "previous" : "next");
                    }
                  }}
                />
                {searchStatus && <span className="search-status">{searchStatus}</span>}
                {searchQuery.trim() && (
                  <div className="search-nav" aria-label="Search result navigation">
                    <button
                      className="search-nav-button"
                      type="button"
                      aria-label="Previous search result"
                      disabled={searchMatches.length === 0}
                      onClick={() => handleSearch("previous")}
                    >
                      <ChevronUp size={15} />
                    </button>
                    <button
                      className="search-nav-button"
                      type="button"
                      aria-label="Next search result"
                      disabled={searchMatches.length === 0}
                      onClick={() => handleSearch("next")}
                    >
                      <ChevronDown size={15} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="code-surface">
              <LatexEditor
                ref={editorRef}
                docId={activeFile?.id ?? ""}
                value={sourceCode}
                onChange={updateActiveContent}
                onCursor={setCursorPosition}
                onFormat={applyTextCommand}
                onGenerateError={(text) => setUploadNotice({ tone: "error", text })}
                onCompile={() => void handleRefreshPreview()}
              />
            </div>
            <div className="editor-status" aria-label="Editor status">
              <span>
                Ln {cursorLine}, Col {cursorColumn}
              </span>
              <span className="save-status">
                <span className={`save-dot ${saveState.status}`} aria-hidden="true" />
                {saveLabel}
              </span>
              <span className="editor-status-hint">
                <kbd>{modKey}</kbd>
                <kbd>↵</kbd> compile
              </span>
            </div>
          </section>

          <section className="preview-pane" aria-label="LaTeX preview">
            <div className="preview-toolbar">
              <button
                className="preview-refresh-button"
                type="button"
                title={`Recompile (${modKey}↵ or ${modKey}S)`}
                onClick={handleRefreshPreview}
                disabled={isRefreshingPreview}
                aria-busy={isRefreshingPreview}
              >
                <RefreshCw
                  className={isRefreshingPreview ? "preview-refresh-icon spinning" : "preview-refresh-icon"}
                  size={17}
                />
                {isRefreshingPreview ? "Compiling" : "Recompile"}
              </button>
              <button
                className="download-button"
                type="button"
                aria-label="Download compiled PDF"
                disabled={!compileOutput?.ok}
                onClick={handleDownloadCompiledPdf}
              >
                <Download size={23} />
              </button>
              {compileChip && (
                <span className={`compile-chip ${compileChip.tone}`} role="status" aria-live="polite">
                  <span className="compile-chip-dot" aria-hidden="true" />
                  {compileChip.label}
                  {compileChip.tone === "stale" && (
                    <span className="compile-chip-keys" aria-hidden="true">
                      <kbd>{modKey}</kbd>
                      <kbd>↵</kbd>
                    </span>
                  )}
                </span>
              )}
            </div>

            <div className="diagram-canvas" aria-label="TikZ diagram preview">
              {compileOutput?.ok ? (
                <div className={isPreviewStale ? "preview-frame stale" : "preview-frame"}>
                  <iframe
                    key={compileOutput.pdfObjectUrl}
                    className="compiled-preview-pdf"
                    src={compileOutput.pdfObjectUrl}
                    title="Compiled LaTeX PDF preview"
                  />
                  {isRefreshingPreview && (
                    <div className="preview-compiling-veil" role="status" aria-live="polite">
                      <Logo size={56} loop />
                      <p>Compiling LaTeX source</p>
                    </div>
                  )}
                </div>
              ) : isRefreshingPreview ? (
                <div className="preview-loading-panel" role="status" aria-live="polite">
                  <Logo size={72} loop />
                  <p>Compiling LaTeX source</p>
                </div>
              ) : compileOutput ? (
                <div className="compile-output-panel" role="status" aria-live="polite">
                  <div className="compile-error-head">
                    <TriangleAlert size={20} aria-hidden="true" />
                    <h2>{compileOutput.message}</h2>
                  </div>
                  {texError && (
                    <div className="compile-error-card">
                      <code>{texError.message}</code>
                      {canJumpToError && (
                        <button
                          type="button"
                          onClick={() => goToSourceLine(texError.file, texError.line as number)}
                        >
                          Go to line {texError.line}
                          {texError.file ? ` in ${texError.file}` : ""}
                          <ArrowRight size={15} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  )}
                  {compileOutput.log ? (
                    <details className="compile-log" open={!texError}>
                      <summary>Full compiler log</summary>
                      <pre>{compileOutput.log}</pre>
                    </details>
                  ) : (
                    <p>Check that the backend container is running.</p>
                  )}
                </div>
              ) : (
                <div className="preview-empty-panel">
                  <Logo size={64} />
                  <h2>No compiled PDF yet</h2>
                  <p>
                    Press Recompile or <kbd>{modKey}</kbd> <kbd>↵</kbd> to see your document here.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      </section>

      {/* Stays mounted while closed so the conversation survives; a new project starts a fresh one. */}
      <FigureChat
        key={activeProject?.id}
        open={isFigureModalOpen}
        files={projectFiles.map(({ name, content }) => ({ name, content }))}
        activeFileName={fileName}
        onClose={() => setIsFigureModalOpen(false)}
      />
    </main>
  );
}
