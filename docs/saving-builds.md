# Saving builds — system design

How the builder persists work. Everything is **client-side** — no server, no
accounts, no cost. Persistence is split into three independent layers.

## Layers

```
┌────────────────────────────────────────────────────────────────────┐
│  1. Working draft (always-on autosave)                               │
│     useTimeline → localStorage["ll-music-reactions-timeline"]        │
│     Every edit (add/remove/update/reorder/clear) writes the current  │
│     entries. Survives reload. One slot — the "current build".        │
├────────────────────────────────────────────────────────────────────┤
│  2. Named builds (explicit save / load)                              │
│     useSavedProjects → localStorage["ll-music-reactions-projects"]   │
│     An array of SavedProject snapshots saved by name and reloaded.   │
├────────────────────────────────────────────────────────────────────┤
│  3. File export / import (portability)                               │
│     Blob download / <input type="file"> → a .json on the user's disk │
│     Cross-device / backup / share. Not storage — just file I/O.      │
└────────────────────────────────────────────────────────────────────┘
```

Layers 1 and 2 use **separate localStorage keys** so named saves never collide
with the live draft. Layer 1 keeps your in-progress work safe across reloads even
if you never explicitly save.

## Data model

```ts
// one row of a build
TimelineEntry = { id, clipId, songId, songStartTime }

// a saved snapshot (localStorage layer 2)
SavedProject = {
  id:      string,           // uuid
  name:    string,           // user-chosen; unique-by-name (case-insensitive)
  savedAt: string,           // ISO timestamp
  entries: TimelineEntry[],  // deep-copied snapshot
}
```

Exported files use `{ version: 1, name, savedAt, entries }` — the `version` field
future-proofs the format.

## Components & data flow

```
App  (owns timeline = useTimeline(); showProjects state)
 ├─ Header
 │    ├─ "New"        → timeline.clearTimeline()        (undoable)
 │    └─ "Save / Load"→ setShowProjects(true)
 └─ ProjectsPanel  (mounted only while open)
      ├─ useSavedProjects()  → { projects, saveProject, deleteProject }
      ├─ Save   → saveProject(name, timeline.entries)      (upsert + persist)
      ├─ Load   → onLoad(project.entries) ──► App: timeline.loadEntries(...)
      ├─ Delete → deleteProject(id)
      ├─ Export → Blob(JSON) → <a download>
      └─ Import → file.text() → JSON.parse → sanitizeEntries → onLoad(...)
```

`ProjectsPanel` never mutates the timeline directly. Loading routes back up
through `App`'s `onLoad` → the existing `timeline.loadEntries`, so a loaded build
re-enters the **same state path** as every other edit (autosave + undo history).
Single source of truth.

### `useSavedProjects` (src/hooks/useSavedProjects.ts)

```
projects = useState(load from localStorage on mount)

saveProject(name, entries): boolean
   project = { uuid, name, ISO-now, deepCopy(entries) }
   next    = upsertProject(projects, project)   // pure, tested
   ok      = persist(next)                       // try/catch → boolean
   setProjects(next); return ok                  // caller warns if !ok

deleteProject(id):  filter → persist → setState
```

Pure, side-effect-free helpers are exported and unit-tested
(`src/hooks/useSavedProjects.test.ts`):

- `upsertProject(list, project)` — add to front, or overwrite an existing
  same-name entry in place (keeps its id and position).
- `sanitizeEntries(raw)` — coerce an untrusted import (a bare array *or*
  `{entries:[…]}`) into clean `TimelineEntry[]`; reject non-object items, default
  missing fields, regenerate missing ids, return `[]` for garbage.

## Design decisions

| Decision | Why |
|---|---|
| Upsert by name (case-insensitive) | Re-saving a name overwrites in place instead of piling up duplicates. |
| Deep-copy entries on save | Freezes the snapshot — later edits to the working timeline can't mutate a saved build in memory. |
| `persist()` returns success; `saveProject` propagates it | localStorage can fail (quota, private mode). The panel shows an error instead of silently "saving" a build that's gone on reload. |
| `sanitizeEntries` validates imports | An imported file is untrusted; bad input can't blank or corrupt the builder. |
| Pure helpers split from the hook | The tricky logic is testable without a DOM/localStorage. |
| Load routes through `timeline.loadEntries` | Reuses the one state path → loaded builds are autosaved + undoable for free. |

## Properties & limits

- **Per-device, per-browser.** localStorage isn't synced — that's why file
  export/import exists (the only cross-device path).
- **No server / no auth / $0**, consistent with the rest of the app.
- **localStorage quota** (~5–10 MB) is ample (entries are tiny id references, not
  media); write failures surface to the user rather than dropping silently.
- **Autosave and named saves are independent** — the live draft is safe across
  reloads whether or not you ever explicitly save.

## Relevant files

| File | Role |
|------|------|
| `src/hooks/useTimeline.ts` | Working draft state + autosave (layer 1); `loadEntries`, `clearTimeline`. |
| `src/hooks/useSavedProjects.ts` | Named builds CRUD (layer 2) + pure helpers. |
| `src/components/projects/ProjectsPanel.tsx` | Save/load/delete UI + file export/import (layer 3). |
| `src/components/layout/Header.tsx` | "New" and "Save / Load" buttons. |
| `src/App.tsx` | Wires the panel to the timeline. |
