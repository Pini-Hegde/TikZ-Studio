import { useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Archive, ArchiveRestore, Copy, Download, FileText, Plus, Search, Tag, Trash2, Upload } from "lucide-react";
import Logo from "@/components/logo/Logo";
import SaveStatus from "@/components/save-status/SaveStatus";
import ThemeToggle from "@/components/theme-toggle/ThemeToggle";
import { createBlankProject, sanitizeFileName, type DashboardFilter, type ProjectSummary } from "@/lib/projects";
import type { SaveState } from "@/lib/useAutosave";
import { createProjectZip, downloadBlob } from "@/lib/zip";
import NameDialog from "./NameDialog";
import "./Dashboard.css";

type Props = {
  // Toasts and the page-transition overlay, drawn over the dashboard.
  children?: ReactNode;
  email: string | null;
  saveState: SaveState;
  projects: ProjectSummary[];
  onProjectsChange: Dispatch<SetStateAction<ProjectSummary[]>>;
  tags: string[];
  onTagsChange: Dispatch<SetStateAction<string[]>>;
  // Filter, tag and search live with the page, so they are still set when you come back from a project.
  filter: DashboardFilter;
  onFilterChange: (filter: DashboardFilter) => void;
  selectedTag: string | null;
  onSelectedTagChange: (tag: string | null) => void;
  search: string;
  onSearchChange: (search: string) => void;
  onOpenProject: (projectId: string) => void;
  onCreateProject: (project: ProjectSummary) => void;
  onUploadProject: (input: HTMLInputElement) => void;
  onLogout: () => void;
};

const filterLabels: Record<DashboardFilter, string> = {
  all: "All projects",
  yours: "Your projects",
  shared: "Shared with you",
  archived: "Archived projects",
};

export default function Dashboard({
  children,
  email,
  saveState,
  projects,
  onProjectsChange: setProjects,
  tags: projectTags,
  onTagsChange: setProjectTags,
  filter: dashboardFilter,
  onFilterChange: setDashboardFilter,
  selectedTag,
  onSelectedTagChange: setSelectedTag,
  search: projectSearchQuery,
  onSearchChange: setProjectSearchQuery,
  onOpenProject,
  onCreateProject,
  onUploadProject,
  onLogout,
}: Props) {
  const projectUploadRef = useRef<HTMLInputElement>(null);
  const projectSearchRef = useRef<HTMLInputElement>(null);
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectWarning, setNewProjectWarning] = useState("");
  const [isNewTagModalOpen, setIsNewTagModalOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagWarning, setNewTagWarning] = useState("");
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);

  const dashboardCounts = useMemo(
    () => ({
      all: projects.filter((project) => !project.isArchived).length,
      yours: projects.filter((project) => project.owner === "You" && !project.isArchived).length,
      shared: projects.filter((project) => project.isShared && !project.isArchived).length,
      archived: projects.filter((project) => project.isArchived).length,
    }),
    [projects],
  );
  const dashboardTitle = selectedTag ? `Tagged: ${selectedTag}` : filterLabels[dashboardFilter];
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

  // "/" focuses project search; Escape closes the dialogs.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      if (event.key === "Escape") {
        setIsNewProjectModalOpen(false);
        setIsNewTagModalOpen(false);
        return;
      }

      const mod = event.metaKey || event.ctrlKey;
      const isTyping =
        event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable='true']");

      if (event.key === "/" && !mod && !isTyping) {
        event.preventDefault();
        projectSearchRef.current?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Archive or restore projects, and drop them from the selection.
  const setArchived = (projectIds: Set<string>, isArchived: boolean) => {
    setProjects((currentProjects) =>
      currentProjects.map((project) =>
        projectIds.has(project.id)
          ? {
              ...project,
              isArchived,
              lastModified: "Just now by You",
            }
          : project,
      ),
    );
    setSelectedProjectIds((currentIds) => currentIds.filter((id) => !projectIds.has(id)));
  };

  const deleteProjects = (projectIds: Set<string>) => {
    setProjects((currentProjects) => currentProjects.filter((project) => !projectIds.has(project.id)));
    setSelectedProjectIds((currentIds) => currentIds.filter((id) => !projectIds.has(id)));
  };

  const selectDashboardFilter = (nextFilter: DashboardFilter) => {
    setDashboardFilter(nextFilter);
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

  const openNewProjectModal = () => {
    setNewProjectName("");
    setNewProjectWarning("");
    setIsNewProjectModalOpen(true);
  };

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

    setNewProjectName("");
    setNewProjectWarning("");
    setIsNewProjectModalOpen(false);
    onCreateProject(createBlankProject(projectName, selectedTag ? [selectedTag] : []));
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

  return (
    <main className="dashboard-shell">
      {children}

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
            onChange={(event) => onUploadProject(event.currentTarget)}
          />
        </div>

        <nav className="dashboard-nav" aria-label="Project filters">
          {(Object.keys(filterLabels) as DashboardFilter[]).map((filterName) => (
            <button
              key={filterName}
              className={
                dashboardFilter === filterName && !selectedTag
                  ? "dashboard-nav-item active"
                  : "dashboard-nav-item"
              }
              type="button"
              onClick={() => selectDashboardFilter(filterName)}
            >
              <span>{filterLabels[filterName]}</span>
              <strong>{dashboardCounts[filterName]}</strong>
            </button>
          ))}
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
            <SaveStatus state={saveState}>
              <strong>{email}</strong> ·{" "}
            </SaveStatus>
            <ThemeToggle />
            <button type="button" onClick={onLogout}>
              Sign out
            </button>
          </div>
        </header>

        <label className="project-search underline-field">
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
              <button type="button" onClick={() => setArchived(new Set(selectedProjectIds), false)}>
                <ArchiveRestore size={17} />
                Restore
              </button>
            ) : (
              <button type="button" onClick={() => setArchived(new Set(selectedProjectIds), true)}>
                <Archive size={17} />
                Archive
              </button>
            )}
            <button className="danger" type="button" onClick={() => deleteProjects(new Set(selectedProjectIds))}>
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
                <button type="button" onClick={() => onOpenProject(project.id)}>
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
                  onClick={() => onOpenProject(project.id)}
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
                    onClick={() => setArchived(new Set([project.id]), false)}
                  >
                    <ArchiveRestore size={17} />
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={`Archive ${project.title}`}
                    onClick={() => setArchived(new Set([project.id]), true)}
                  >
                    <Archive size={17} />
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Delete ${project.title}`}
                  onClick={() => deleteProjects(new Set([project.id]))}
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
        <NameDialog
          noun="project"
          placeholder="Example: Research flowchart"
          value={newProjectName}
          warning={newProjectWarning}
          onChange={(value) => {
            setNewProjectName(value);
            setNewProjectWarning("");
          }}
          onClose={() => setIsNewProjectModalOpen(false)}
          onSubmit={handleGenerateProject}
        />
      )}

      {isNewTagModalOpen && (
        <NameDialog
          noun="tag"
          placeholder="Example: Thesis"
          value={newTagName}
          warning={newTagWarning}
          help={
            selectedProjectIds.length > 0 && (
              <p className="modal-help">
                This tag will be added to {selectedProjectIds.length} selected project
                {selectedProjectIds.length === 1 ? "" : "s"}.
              </p>
            )
          }
          onChange={(value) => {
            setNewTagName(value);
            setNewTagWarning("");
          }}
          onClose={() => setIsNewTagModalOpen(false)}
          onSubmit={handleCreateTag}
        />
      )}
    </main>
  );
}
