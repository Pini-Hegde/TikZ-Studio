import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";
import type { PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import "./PdfViewer.css";

// PDF.js's own viewer, the one Overleaf's preview is built on: continuous pages, text selection, working links.
// Loaded on first use: pdf_viewer.mjs reads the library from globalThis.pdfjsLib, so that has to be set first.
const loadPdfjs = async () => {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  (globalThis as { pdfjsLib?: unknown }).pdfjsLib = pdfjs;
  return { pdfjs, lib: await import("pdfjs-dist/web/pdf_viewer.mjs") };
};
let pdfjsLoading: ReturnType<typeof loadPdfjs> | null = null;

const ZOOMS = [
  ["page-width", "Fit to width"],
  ["page-fit", "Fit to page"],
  ["0.5", "50%"],
  ["0.75", "75%"],
  ["1", "100%"],
  ["1.5", "150%"],
  ["2", "200%"],
  ["4", "400%"],
];

// `task` is the shown document's loading task; destroying it frees the document.
type Viewer = { viewer: PDFViewer; linkService: PDFLinkService; task?: PDFDocumentLoadingTask };

export default function PdfViewer({ url, className = "" }: { url: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  // Zoom and scroll to put back once the next PDF's pages are laid out: a recompile keeps your place, like Overleaf.
  const restoreRef = useRef({ zoom: "page-width", top: 0, left: 0 });
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState({ value: "page-width", scale: 1 });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    void (async () => {
      const { pdfjs, lib } = await (pdfjsLoading ??= loadPdfjs());
      const container = containerRef.current;
      if (cancelled || !container) return;

      if (!viewerRef.current) {
        const eventBus = new lib.EventBus();
        const linkService = new lib.PDFLinkService({ eventBus, externalLinkTarget: lib.LinkTarget.BLANK });
        const viewer = new lib.PDFViewer({ container, eventBus, linkService });
        linkService.setViewer(viewer);
        eventBus.on("pagesinit", () => {
          const { zoom: value, top, left } = restoreRef.current;
          viewer.currentScaleValue = value;
          container.scrollTop = top;
          container.scrollLeft = left;
          setPageCount(viewer.pagesCount);
        });
        eventBus.on("pagechanging", ({ pageNumber }: { pageNumber: number }) => setPage(pageNumber));
        eventBus.on("scalechanging", ({ scale, presetValue }: { scale: number; presetValue?: string }) =>
          setZoom({ value: presetValue ?? String(scale), scale }),
        );
        viewerRef.current = { viewer, linkService };
      }

      const task = pdfjs.getDocument({ url });
      loadingTask = task;
      const doc = await task.promise;
      loadingTask = null;
      if (cancelled) {
        void task.destroy();
        return;
      }
      const current = viewerRef.current;
      restoreRef.current = {
        zoom: current.viewer.currentScaleValue || "page-width",
        top: container.scrollTop,
        left: container.scrollLeft,
      };
      const previous = current.task;
      current.viewer.setDocument(doc);
      current.linkService.setDocument(doc);
      current.task = task;
      setFailed(false);
      void previous?.destroy();
    })().catch(() => {
      if (!cancelled) setFailed(true);
    });

    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [url]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // "Fit to width/page" follow the pane as it is resized.
    const resize = new ResizeObserver(() => {
      const viewer = viewerRef.current?.viewer;
      if (viewer?.pagesCount && Number.isNaN(Number(viewer.currentScaleValue))) {
        viewer.currentScaleValue = viewer.currentScaleValue;
      }
    });
    resize.observe(container);

    // Ctrl/⌘ + wheel (and trackpad pinch) zooms the PDF instead of the whole page.
    const wheel = (event: WheelEvent) => {
      const viewer = viewerRef.current?.viewer;
      if (!(event.ctrlKey || event.metaKey) || !viewer) return;
      event.preventDefault();
      if (event.deltaY < 0) viewer.increaseScale();
      else viewer.decreaseScale();
    };
    container.addEventListener("wheel", wheel, { passive: false });

    return () => {
      resize.disconnect();
      container.removeEventListener("wheel", wheel);
      void viewerRef.current?.task?.destroy();
      viewerRef.current = null;
    };
  }, []);

  const viewer = () => viewerRef.current?.viewer;

  return (
    <div className={`pdf-viewer ${className}`}>
      <div className="pdf-viewer-scroll" ref={containerRef}>
        <div className="pdfViewer" />
      </div>
      {failed && <p className="pdf-viewer-failed">This PDF couldn&apos;t be displayed. Try downloading it.</p>}
      {pageCount > 0 && (
        <div className="pdf-viewer-controls" aria-label="PDF controls">
          <label className="pdf-viewer-page">
            <input
              type="number"
              aria-label="Page number"
              min={1}
              max={pageCount}
              value={page}
              onChange={(event) => {
                const target = Number(event.target.value);
                const current = viewer();
                if (current && target >= 1 && target <= pageCount) current.currentPageNumber = target;
              }}
            />
            <span>/ {pageCount}</span>
          </label>
          <button type="button" aria-label="Zoom out" onClick={() => viewer()?.decreaseScale()}>
            <Minus size={15} />
          </button>
          <button type="button" aria-label="Zoom in" onClick={() => viewer()?.increaseScale()}>
            <Plus size={15} />
          </button>
          <select
            aria-label="Zoom"
            value={zoom.value}
            onChange={(event) => {
              const current = viewer();
              if (current) current.currentScaleValue = event.target.value;
            }}
          >
            {!ZOOMS.some(([value]) => value === zoom.value) && (
              <option value={zoom.value}>{Math.round(zoom.scale * 100)}%</option>
            )}
            {ZOOMS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
