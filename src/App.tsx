import { useState } from 'react';
import { Header } from '@/components/layout/Header';
import { Timeline } from '@/components/timeline/Timeline';
import { SongPicker } from '@/components/song-picker/SongPicker';
import { ClipPicker } from '@/components/clip-picker/ClipPicker';
import { SetlistLoader } from '@/components/setlist/SetlistLoader';
import { PreviewPlayer } from '@/components/preview/PreviewPlayer';
import { ExportDialog } from '@/components/export/ExportDialog';
import { useTimeline } from '@/hooks/useTimeline';
import {
  useSongs,
  useArtistMap,
  useDiscographyMap,
  useSeries,
} from '@/hooks/useData';

type PickerMode =
  | { type: 'none' }
  | { type: 'song'; entryId: string }
  | { type: 'clip'; entryId: string }
  | { type: 'setlist' }
  | { type: 'preview' }
  | { type: 'export' };

export default function App() {
  const songs = useSongs();
  const artistMap = useArtistMap();
  const discographyMap = useDiscographyMap();
  const series = useSeries();
  const timeline = useTimeline();
  const [picker, setPicker] = useState<PickerMode>({ type: 'none' });

  const songMap = new Map(songs.map((s) => [s.id, s]));

  const handleSelectSong = (songId: string) => {
    if (picker.type === 'song') {
      timeline.updateEntry(picker.entryId, { songId });
      setPicker({ type: 'none' });
    }
  };

  const handleSelectClip = (clipId: string) => {
    if (picker.type === 'clip') {
      timeline.updateEntry(picker.entryId, { clipId });
      setPicker({ type: 'none' });
    }
  };

  const handleLoadSetlist = (entries: import('@/types').TimelineEntry[]) => {
    timeline.loadEntries(entries);
    setPicker({ type: 'none' });
  };

  return (
    <div className="flex h-screen flex-col">
      <Header
        onLoadSetlist={() => setPicker({ type: 'setlist' })}
        onPreview={() => setPicker({ type: 'preview' })}
        onExport={() => setPicker({ type: 'export' })}
        hasEntries={timeline.entries.length > 0}
      />

      <main className="flex min-h-0 flex-1">
        {picker.type === 'song' && (
          <div className="w-96 border-r border-gray-700 overflow-y-auto">
            <SongPicker
              songs={songs}
              series={series}
              artistMap={artistMap}
              discographyMap={discographyMap}
              onSelect={handleSelectSong}
              onClose={() => setPicker({ type: 'none' })}
            />
          </div>
        )}

        {picker.type === 'clip' && (
          <div className="w-96 border-r border-gray-700 overflow-y-auto">
            <ClipPicker
              onSelect={handleSelectClip}
              onClose={() => setPicker({ type: 'none' })}
            />
          </div>
        )}

        <div className="flex flex-1 flex-col items-center justify-center p-8">
          {timeline.entries.length === 0 ? (
            <div className="text-center">
              <h2 className="mb-4 text-2xl font-bold text-white">
                LL Music Reactions
              </h2>
              <p className="mb-6 max-w-md text-gray-400">
                Create reaction meme videos by matching Love Live songs with
                reaction clips. Load a concert setlist or start adding entries
                manually.
              </p>
              <div className="flex gap-4">
                <button
                  onClick={() => {
                    timeline.addEntry();
                    setPicker({ type: 'none' });
                  }}
                  className="rounded-lg bg-pink-600 px-6 py-3 font-medium text-white hover:bg-pink-500"
                >
                  + Add Entry
                </button>
                <button
                  onClick={() => setPicker({ type: 'setlist' })}
                  className="rounded-lg border border-gray-600 px-6 py-3 font-medium text-gray-300 hover:border-gray-400"
                >
                  Load Setlist
                </button>
              </div>
            </div>
          ) : (
            <p className="text-gray-500">
              Select an entry below to assign a song or clip
            </p>
          )}
        </div>
      </main>

      <Timeline
        entries={timeline.entries}
        songMap={songMap}
        discographyMap={discographyMap}
        onAdd={() => timeline.addEntry()}
        onRemove={timeline.removeEntry}
        onReorder={timeline.reorderEntries}
        onPickSong={(entryId) => setPicker({ type: 'song', entryId })}
        onPickClip={(entryId) => setPicker({ type: 'clip', entryId })}
      />

      {picker.type === 'setlist' && (
        <SetlistLoader
          onLoad={handleLoadSetlist}
          onClose={() => setPicker({ type: 'none' })}
        />
      )}

      {picker.type === 'preview' && (
        <PreviewPlayer
          entries={timeline.entries}
          songMap={songMap}
          discographyMap={discographyMap}
          onClose={() => setPicker({ type: 'none' })}
        />
      )}

      {picker.type === 'export' && (
        <ExportDialog
          entries={timeline.entries}
          songMap={songMap}
          discographyMap={discographyMap}
          onClose={() => setPicker({ type: 'none' })}
        />
      )}
    </div>
  );
}
