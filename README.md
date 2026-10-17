# TikZ Editor UI

A frontend-only Next.js mockup for a dark LaTeX/TikZ editor workspace based on the provided sketch.

This repository contains no LaTeX compiler or server API. The preview is a representative
frontend mock, and project/source downloads are generated entirely in the browser.

## Step By Step

1. Install Node.js 20 or newer.

2. Install dependencies:

```bash
npm install
```

3. Start the development server:

```bash
npm run dev
```

4. Open the local URL printed by Next.js, usually:

```text
http://localhost:3000
```

5. Main files to edit:

- `app/page.tsx` contains the UI structure, toolbar buttons, file list, code sample, and SVG preview.
- `app/globals.css` contains the complete responsive layout and visual styling.
- `app/layout.tsx` contains the app metadata and global stylesheet import.

## UI Sections

- Top tabs: `Generate` and `LaTeX`.
- Left rail: file actions, project files, section layout, and profile.
- Center pane: LaTeX editor toolbar and source surface.
- Right pane: preview refresh/source download controls and a representative TikZ-style diagram.
