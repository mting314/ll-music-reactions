import { useState, useMemo } from 'react';
import type { ReactionClip } from '@/types';
import { useClips } from './useData';

export function useClipLibrary() {
  const clips = useClips();
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    if (!query.trim()) return clips;

    const q = query.toLowerCase();
    return clips.filter(
      (clip) =>
        clip.name.toLowerCase().includes(q) ||
        clip.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [clips, query]);

  return { query, setQuery, results, allClips: clips };
}

// Prefix with Vite's BASE_URL so assets resolve under the GitHub Pages
// project path (/ll-music-reactions/) in production and "/" in dev.
// BASE_URL always ends with a trailing slash.
export function getClipUrl(clip: ReactionClip): string {
  return `${import.meta.env.BASE_URL}clips/${clip.filename}`;
}

export function getClipThumbnailUrl(clip: ReactionClip): string {
  return `${import.meta.env.BASE_URL}thumbnails/${clip.thumbnailFilename}`;
}
