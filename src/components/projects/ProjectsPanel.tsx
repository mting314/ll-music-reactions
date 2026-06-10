import { useRef, useState } from 'react';
import { useSavedProjects, sanitizeEntries } from '@/hooks/useSavedProjects';
import type { TimelineEntry } from '@/types';

interface ProjectsPanelProps {
  entries: TimelineEntry[];
  onLoad: (entries: TimelineEntry[]) => void;
  onClose: () => void;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}

export function ProjectsPanel({ entries, onLoad, onClose }: ProjectsPanelProps) {
  const { projects, saveProject, deleteProject } = useSavedProjects();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    if (!name.trim()) return;
    saveProject(name, entries);
    setName('');
  };

  const handleExport = () => {
    const payload = {
      version: 1 as const,
      name: name.trim() || 'build',
      savedAt: new Date().toISOString(),
      entries,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${payload.name.replace(/[^a-z0-9-_]+/gi, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    setError(null);
    try {
      const parsed = JSON.parse(await file.text());
      const imported = sanitizeEntries(parsed);
      if (imported.length === 0) {
        setError('That file has no builder items.');
        return;
      }
      onLoad(imported);
      onClose();
    } catch {
      setError('Could not read that file (invalid JSON).');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-[#1a1a2e] shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-700 px-6 py-4">
          <h3 className="text-lg font-semibold text-white">Save / Load Builds</h3>
          <button onClick={onClose} className="text-xl text-gray-400 hover:text-white">
            &times;
          </button>
        </div>

        {/* Save current */}
        <div className="space-y-2 border-b border-gray-700 p-4">
          <p className="text-xs font-medium uppercase text-gray-500">
            Save current build ({entries.length} item{entries.length === 1 ? '' : 's'})
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="Build name…"
              className="flex-1 rounded-lg bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-pink-500"
            />
            <button
              onClick={handleSave}
              disabled={!name.trim() || entries.length === 0}
              className="rounded-lg bg-pink-600 px-4 py-2 text-sm font-medium text-white hover:bg-pink-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save
            </button>
          </div>
          <div className="flex gap-3 pt-1 text-xs">
            <button
              onClick={handleExport}
              disabled={entries.length === 0}
              className="text-gray-400 hover:text-white disabled:opacity-40"
            >
              ↧ Export to file
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="text-gray-400 hover:text-white"
            >
              ↥ Import from file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImportFile(file);
                e.target.value = ''; // allow re-importing the same file
              }}
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        {/* Saved builds */}
        <div className="flex-1 overflow-y-auto">
          {projects.length === 0 ? (
            <p className="p-4 text-center text-sm text-gray-500">
              No saved builds yet.
            </p>
          ) : (
            <ul>
              {projects.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-3 border-b border-gray-800 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{p.name}</p>
                    <p className="text-xs text-gray-500">
                      {p.entries.length} item{p.entries.length === 1 ? '' : 's'}
                      {formatWhen(p.savedAt) ? ` · ${formatWhen(p.savedAt)}` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      onLoad(p.entries);
                      onClose();
                    }}
                    className="shrink-0 rounded-md border border-gray-600 px-3 py-1.5 text-xs text-gray-200 hover:border-gray-400 hover:text-white"
                  >
                    Load
                  </button>
                  <button
                    onClick={() => deleteProject(p.id)}
                    className="shrink-0 text-gray-600 hover:text-red-400"
                    title="Delete"
                  >
                    &times;
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
