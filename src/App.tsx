import { useState } from 'react';
import { Header, type AppView } from '@/components/layout/Header';
import { DataViewer } from '@/components/data-viewer/DataViewer';
import { Timeline } from '@/components/timeline/Timeline';
import { SongPicker } from '@/components/song-picker/SongPicker';
import { ClipPicker } from '@/components/clip-picker/ClipPicker';
import { SetlistLoader } from '@/components/setlist/SetlistLoader';
import { EntryList } from '@/components/entry-list/EntryList';
import { PreviewPlayer } from '@/components/preview/PreviewPlayer';
import { ExportPanel } from '@/components/export/ExportPanel';
import { useTimeline } from '@/hooks/useTimeline';
import { useVideoExport } from '@/hooks/useVideoExport';
import {
  useSongs,
  useArtistMap,
  useDiscographyMap,
  useClips,
  useSeries,
} from '@/hooks/useData';

type PickerMode =
  | { type: 'none' }
  | { type: 'song'; entryId: string }
  | { type: 'clip'; entryId: string }
  | { type: 'setlist' }
  | { type: 'preview' };

export default function App() {
  const songs = useSongs();
  const artistMap = useArtistMap();
  const discographyMap = useDiscographyMap();
  const clips = useClips();
  const series = useSeries();
  const timeline = useTimeline();
  const videoExport = useVideoExport();
  const [picker, setPicker] = useState<PickerMode>({ type: 'none' });
  const [showExport, setShowExport] = useState(false);
  const [view, setView] = useState<AppView>('builder');

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
        view={view}
        onChangeView={setView}
        onLoadSetlist={() => setPicker({ type: 'setlist' })}
        onPreview={() => setPicker({ type: 'preview' })}
        onExport={() => setShowExport(true)}
        onUndo={timeline.undo}
        onRedo={timeline.redo}
        canUndo={timeline.canUndo}
        canRedo={timeline.canRedo}
        hasEntries={timeline.entries.length > 0}
      />

      {view === 'data' && <DataViewer />}

      {view === 'builder' && (
      <>
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

        <div className="flex flex-1 flex-col items-center overflow-y-auto p-8">
          {timeline.entries.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
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
            <EntryList
              entries={timeline.entries}
              songMap={songMap}
              discographyMap={discographyMap}
              clips={clips}
              onPickSong={(entryId) => setPicker({ type: 'song', entryId })}
              onPickClip={(entryId) => setPicker({ type: 'clip', entryId })}
              onRemove={timeline.removeEntry}
              onUpdateStartTime={(entryId, time) =>
                timeline.updateEntry(entryId, { songStartTime: time })
              }
            />
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

      {(showExport || videoExport.isExporting) && (
        <ExportPanel
          validCount={timeline.entries.filter((e) => e.clipId && e.songId).length}
          isExporting={videoExport.isExporting}
          error={videoExport.error}
          status={videoExport.status}
          elapsedMs={videoExport.elapsedMs}
          onStartExport={(settings) =>
            videoExport.startExport(timeline.entries, songMap, discographyMap, settings)
          }
          onDismiss={() => setShowExport(false)}
        />
      )}
      </>
      )}
    </div>
  );
}
