export type ProjectFile = {
  id: string;
  name: string;
  content: string;
};

export type ProjectSummary = {
  id: string;
  title: string;
  owner: string;
  lastModified: string;
  tags: string[];
  isShared: boolean;
  isArchived: boolean;
  // The LaTeX engine, as stored by the backend; unset on a project that hasn't been saved yet (backend default).
  engine?: string;
  files: ProjectFile[];
};

export type DashboardFilter = "all" | "yours" | "shared" | "archived";

export type StoredProject = {
  id: string;
  title: string;
  tags: string[];
  isArchived: boolean;
  engine: string;
  files: ProjectFile[];
  updatedAt: string;
};

export const fromStoredProject = (project: StoredProject): ProjectSummary => ({
  id: project.id,
  title: project.title,
  owner: "You",
  lastModified: `Saved ${new Date(project.updatedAt).toLocaleString()}`,
  tags: project.tags,
  isShared: false,
  isArchived: project.isArchived,
  engine: project.engine,
  files: project.files,
});

// Only these fields are stored; comparing this string tells us what still needs saving.
export const toSavePayload = (project: ProjectSummary) =>
  JSON.stringify({
    title: project.title,
    tags: project.tags,
    isArchived: project.isArchived,
    engine: project.engine,
    files: project.files.map(({ id, name, content }) => ({ id, name, content })),
  });

export const sanitizeFileName = (value: string) =>
  value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 90) || "untitled";

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

// A project made in this browser (created, uploaded or the starter), not saved yet.
export const newProject = (title: string, tags: string[], files: ProjectFile[]): ProjectSummary => ({
  id: crypto.randomUUID(),
  title,
  owner: "You",
  lastModified: "Just now by You",
  tags,
  isShared: false,
  isArchived: false,
  files,
});

// First project for a brand-new account.
export const createStarterProject = () =>
  newProject("TikZ Diagram Workspace", ["Diagrams", "Workflow"], initialProjectFiles.map((file) => ({ ...file })));

// What "New project" creates.
export const createBlankProject = (title: string, tags: string[]) =>
  newProject(title, tags, [
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
  ]);
