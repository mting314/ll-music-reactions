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

export function getClipUrl(clip: ReactionClip): string {
  return `/clips/${clip.filename}`;
}

export function getClipThumbnailUrl(clip: ReactionClip): string {
  return `/thumbnails/${clip.thumbnailFilename}`;
}
