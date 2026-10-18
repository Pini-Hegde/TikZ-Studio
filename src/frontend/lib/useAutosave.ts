import { useEffect, useRef, useState } from "react";
import { ApiError, apiJson, errorMessage } from "@/lib/api";
import { toSavePayload, type ProjectSummary } from "@/lib/projects";

export type SaveState = { status: "saved" | "saving" } | { status: "error"; message: string };

export const saveLabel = (saveState: SaveState) =>
  saveState.status === "saving"
    ? "Saving..."
    : saveState.status === "error"
      ? `Not saved: ${saveState.message}`
      : "All changes saved";

// Autosave: one second after the last change, changed projects are PUT and removed ones DELETEd.
export function useAutosave(projects: ProjectSummary[], enabled: boolean, onSessionExpired: () => void) {
  const [saveState, setSaveState] = useState<SaveState>({ status: "saved" });
  // The last saved payload per project id, and the latest projects for async code.
  const savedProjectsRef = useRef(new Map<string, string>());
  const projectsRef = useRef(projects);
  const saveQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

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
        onSessionExpired();
      }
    }
  };

  // Saves run one after another so an older save can never overwrite a newer one.
  const flush = () => {
    saveQueueRef.current = saveQueueRef.current.then(syncProjects);

    return saveQueueRef.current;
  };

  // Marks these projects as already stored: after loading a workspace, or [] after signing out.
  const markSaved = (storedProjects: ProjectSummary[]) => {
    savedProjectsRef.current = new Map(storedProjects.map((project) => [project.id, toSavePayload(project)]));
    setSaveState({ status: "saved" });
  };

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const timer = window.setTimeout(() => void flush(), 1000);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, enabled]);

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

  return { saveState, flush, markSaved };
}
