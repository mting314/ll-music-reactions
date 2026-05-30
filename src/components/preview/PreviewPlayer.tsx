import { useState, useRef, useCallback, useEffect } from 'react';
import { getAlbumArtUrl, useClips } from '@/hooks/useData';
import { getClipUrl } from '@/hooks/useClipLibrary';
import type { TimelineEntry, Song, Discography } from '@/types';

interface PreviewPlayerProps {
  entries: TimelineEntry[];
  songMap: Map<string, Song>;
  discographyMap: Map<string, Discography>;
  onClose: () => void;
}

export function PreviewPlayer({
  entries,
  songMap,
  discographyMap,
  onClose,
}: PreviewPlayerProps) {
  const clips = useClips();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const validEntries = entries.filter((e) => e.clipId && e.songId);

  const currentEntry = validEntries[currentIndex];
  const currentClip = currentEntry
    ? clips.find((c) => c.id === currentEntry.clipId)
    : null;
  const currentSong = currentEntry?.songId
    ? songMap.get(currentEntry.songId)
    : null;
  const currentArtUrl = currentSong
    ? getAlbumArtUrl(currentSong, discographyMap)
    : null;

  const playNext = useCallback(() => {
    if (currentIndex < validEntries.length - 1) {
      setCurrentIndex((i) => i + 1);
    } else {
      setIsPlaying(false);
    }
  }, [currentIndex, validEntries.length]);

  useEffect(() => {
    if (isPlaying && videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, [currentIndex, isPlaying]);

  const handlePlay = () => {
    setIsPlaying(true);
    videoRef.current?.play().catch(() => {});
  };

  if (validEntries.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
        <div className="rounded-xl bg-[#1a1a2e] p-8 text-center">
          <p className="mb-4 text-gray-400">
            No complete entries to preview. Assign both a clip and a song to at
            least one entry.
          </p>
          <button
            onClick={onClose}
            className="rounded bg-gray-700 px-4 py-2 text-white hover:bg-gray-600"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90">
      <div className="relative w-full max-w-2xl">
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 text-gray-400 hover:text-white text-xl"
        >
          &times; Close
        </button>

        <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
          {currentClip && (
            <video
              ref={videoRef}
              key={currentClip.id + '-' + currentIndex}
              src={getClipUrl(currentClip)}
              className="h-full w-full object-contain"
              onEnded={playNext}
            />
          )}

          {currentArtUrl && (
            <div className="absolute right-4 top-4">
              <img
                src={currentArtUrl}
                alt=""
                className="h-20 w-20 rounded-lg shadow-lg"
              />
            </div>
          )}

          {currentSong && (
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
              <p className="text-sm font-medium text-white">
                {currentSong.name}
              </p>
              <p className="text-xs text-gray-300">
                {currentSong.englishName}
              </p>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-center gap-4">
          <button
            onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
            disabled={currentIndex === 0}
            className="rounded px-3 py-1 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-40"
          >
            Prev
          </button>

          <button
            onClick={handlePlay}
            className="rounded-full bg-pink-600 px-6 py-2 text-sm font-medium text-white hover:bg-pink-500"
          >
            {isPlaying ? 'Playing' : 'Play'}
          </button>

          <button
            onClick={playNext}
            disabled={currentIndex >= validEntries.length - 1}
            className="rounded px-3 py-1 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-40"
          >
            Next
          </button>

          <span className="text-xs text-gray-500">
            {currentIndex + 1} / {validEntries.length}
          </span>
        </div>
      </div>
    </div>
  );
}
