import { useState } from 'react';
import { useClipLibrary, getClipUrl, getClipThumbnailUrl } from '@/hooks/useClipLibrary';

interface ClipPickerProps {
  onSelect: (clipId: string) => void;
  onClose: () => void;
}

export function ClipPicker({ onSelect, onClose }: ClipPickerProps) {
  const { query, setQuery, results } = useClipLibrary();
  const [previewId, setPreviewId] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col bg-[#1a1a2e]">
      <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
        <h3 className="font-semibold text-white">Select Clip</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white text-xl leading-none"
        >
          &times;
        </button>
      </div>

      <div className="border-b border-gray-700 p-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clips by name or emotion..."
          className="w-full rounded-lg bg-gray-800 px-4 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-pink-500"
          autoFocus
        />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {results.length === 0 ? (
          <p className="text-center text-sm text-gray-500">No clips found</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {results.map((clip) => (
              <div key={clip.id} className="group">
                <button
                  onClick={() => onSelect(clip.id)}
                  onMouseEnter={() => setPreviewId(clip.id)}
                  onMouseLeave={() => setPreviewId(null)}
                  className="w-full rounded-lg bg-gray-800 p-2 text-left transition-colors hover:bg-gray-700"
                >
                  <div className="relative mb-2 aspect-video overflow-hidden rounded bg-gray-900">
                    {previewId === clip.id ? (
                      <video
                        src={getClipUrl(clip)}
                        className="h-full w-full object-cover"
                        autoPlay
                        muted
                        loop
                      />
                    ) : (
                      <img
                        src={getClipThumbnailUrl(clip)}
                        alt={clip.name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    )}
                  </div>
                  <p className="text-sm font-medium text-white">{clip.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {clip.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-gray-700 px-2 py-0.5 text-xs text-gray-300"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
