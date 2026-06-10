import { useMemo, useState, type ReactNode } from 'react';
import {
  useSongs,
  useArtists,
  useDiscography,
  useDiscographyMap,
  useSeries,
  usePerformances,
  useSetlists,
  useClips,
  useBuildInfo,
  getAlbumArtUrl,
} from '@/hooks/useData';
import type { Series } from '@/types';

// A read-only browser over the loaded dataset, modeled on sekai-viewer's
// per-entity list pages — so people can see what data is present and what's
// missing (gaps are surfaced explicitly). It reads from DataProvider, so it
// reflects exactly what the live app loaded.

type Tab =
  | 'overview'
  | 'songs'
  | 'artists'
  | 'discographies'
  | 'series'
  | 'performances'
  | 'setlists'
  | 'clips';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'songs', label: 'Songs' },
  { id: 'artists', label: 'Artists' },
  { id: 'discographies', label: 'Discographies' },
  { id: 'series', label: 'Series' },
  { id: 'performances', label: 'Performances' },
  { id: 'setlists', label: 'Setlists' },
  { id: 'clips', label: 'Clips' },
];

const ROW_CAP = 300; // render at most this many rows; search to narrow

function Badge({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
        ok ? 'bg-emerald-900/60 text-emerald-300' : 'bg-amber-900/60 text-amber-300'
      }`}
    >
      {children}
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-lg border border-gray-700 bg-[#1a1a2e] p-4">
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-sm text-gray-400">{label}</div>
      {hint && <div className="mt-1 text-xs text-gray-500">{hint}</div>}
    </div>
  );
}

export function DataViewer() {
  const songs = useSongs();
  const artists = useArtists();
  const discographies = useDiscography();
  const discographyMap = useDiscographyMap();
  const series = useSeries();
  const performances = usePerformances();
  const setlists = useSetlists();
  const clips = useClips();
  const build = useBuildInfo();

  const [tab, setTab] = useState<Tab>('overview');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const seriesMap = useMemo(() => {
    const m = new Map<number, Series>();
    for (const s of series) m.set(s.id, s);
    return m;
  }, [series]);

  const songIds = useMemo(() => new Set(songs.map((s) => s.id)), [songs]);

  // ---- data-integrity / "what's missing" checks ----------------------------
  const gaps = useMemo(() => {
    const songsNoArt = songs.filter((s) => !getAlbumArtUrl(s, discographyMap)).length;
    const songsNoAudio = songs.filter((s) => !s.wikiAudioUrl).length;
    const discsNoImage = discographies.filter(
      (d) => !d.versions?.[0]?.imageUrl,
    ).length;
    const perfsClaimSetlist = performances.filter((p) => p.hasSetlist);
    const perfsMissingSetlist = perfsClaimSetlist.filter(
      (p) => !setlists[p.id],
    ).length;
    // Setlist items pointing at songs that aren't in the catalog.
    let orphanSetlistRefs = 0;
    for (const sl of Object.values(setlists)) {
      for (const it of sl.items ?? []) {
        if (it.songId && !songIds.has(it.songId)) orphanSetlistRefs++;
      }
    }
    return {
      songsNoArt,
      songsNoAudio,
      discsNoImage,
      perfsMissingSetlist,
      orphanSetlistRefs,
    };
  }, [songs, discographies, discographyMap, performances, setlists, songIds]);

  const placeholder =
    tab === 'overview' || tab === 'series'
      ? 'Filter…'
      : `Search ${tab}…`;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#0f0f1e]">
      {/* entity tabs */}
      <div className="flex flex-wrap gap-1 border-b border-gray-700 bg-[#14142a] px-4 py-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id);
              setQuery('');
            }}
            className={`rounded px-3 py-1.5 text-sm ${
              tab === t.id
                ? 'bg-pink-600 text-white'
                : 'text-gray-300 hover:bg-gray-700'
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-xs opacity-60">
              {t.id === 'overview'
                ? ''
                : t.id === 'songs'
                  ? songs.length
                  : t.id === 'artists'
                    ? artists.length
                    : t.id === 'discographies'
                      ? discographies.length
                      : t.id === 'series'
                        ? series.length
                        : t.id === 'performances'
                          ? performances.length
                          : t.id === 'setlists'
                            ? Object.keys(setlists).length
                            : clips.length}
            </span>
          </button>
        ))}
      </div>

      {tab !== 'overview' && (
        <div className="border-b border-gray-700 px-4 py-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="w-full max-w-md rounded border border-gray-600 bg-[#1a1a2e] px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-pink-500 focus:outline-none"
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'overview' && (
          <div className="space-y-6">
            <div>
              <h2 className="mb-1 text-lg font-bold text-white">Dataset overview</h2>
              <p className="text-sm text-gray-400">
                {build?.generatedAt
                  ? `Data generated ${new Date(build.generatedAt).toLocaleString('en-US', { timeZone: 'UTC', timeZoneName: 'short' })}`
                  : 'No build timestamp available'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <Stat label="Songs" value={songs.length} />
              <Stat label="Artists" value={artists.length} />
              <Stat label="Discographies" value={discographies.length} />
              <Stat label="Series" value={series.length} />
              <Stat label="Performances" value={performances.length} />
              <Stat label="Setlists" value={Object.keys(setlists).length} />
              <Stat label="Reaction clips" value={clips.length} hint="bundled" />
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-gray-300">
                Gaps / data quality
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                <Stat
                  label="Songs without album art"
                  value={gaps.songsNoArt}
                  hint={`${songs.length - gaps.songsNoArt} have art`}
                />
                <Stat
                  label="Songs without audio"
                  value={gaps.songsNoAudio}
                  hint="no wikiAudioUrl"
                />
                <Stat
                  label="Discographies without image"
                  value={gaps.discsNoImage}
                />
                <Stat
                  label="Performances missing setlist"
                  value={gaps.perfsMissingSetlist}
                  hint="hasSetlist=true but no setlist"
                />
                <Stat
                  label="Orphan setlist song refs"
                  value={gaps.orphanSetlistRefs}
                  hint="songId not in catalog"
                />
              </div>
            </div>
          </div>
        )}

        {tab === 'songs' && (
          <EntityList
            items={songs.filter((s) =>
              !q ||
              s.name.toLowerCase().includes(q) ||
              s.englishName?.toLowerCase().includes(q) ||
              s.phoneticName?.toLowerCase().includes(q),
            )}
            total={songs.length}
            renderRow={(s) => (
              <div key={s.id} className="flex items-center gap-3 border-b border-gray-800 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-white">{s.name}</div>
                  <div className="truncate text-xs text-gray-500">
                    {s.englishName || s.phoneticName}
                    {s.releasedOn ? ` · ${s.releasedOn}` : ''}
                    {s.seriesIds?.length
                      ? ` · ${s.seriesIds.map((id) => seriesMap.get(id)?.englishName ?? id).join(', ')}`
                      : ''}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Badge ok={!!getAlbumArtUrl(s, discographyMap)}>art</Badge>
                  <Badge ok={!!s.wikiAudioUrl}>audio</Badge>
                  <Badge ok={!!s.musicVideo}>MV</Badge>
                </div>
              </div>
            )}
          />
        )}

        {tab === 'artists' && (
          <EntityList
            items={artists.filter((a) => !q || a.name.toLowerCase().includes(q))}
            total={artists.length}
            renderRow={(a) => (
              <div key={a.id} className="flex items-center gap-3 border-b border-gray-800 py-2">
                <div className="min-w-0 flex-1 truncate text-sm text-white">{a.name}</div>
                <div className="shrink-0 text-xs text-gray-500">
                  {a.seriesIds?.length ?? 0} series · {a.characters?.length ?? 0} chars
                </div>
              </div>
            )}
          />
        )}

        {tab === 'discographies' && (
          <EntityList
            items={discographies.filter((d) => !q || d.name.toLowerCase().includes(q))}
            total={discographies.length}
            renderRow={(d) => (
              <div key={d.id} className="flex items-center gap-3 border-b border-gray-800 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-white">{d.name}</div>
                  <div className="truncate text-xs text-gray-500">
                    {d.type}
                    {d.releasedAt ? ` · ${d.releasedAt}` : ''} · {d.versions?.length ?? 0} ver.
                  </div>
                </div>
                <Badge ok={!!d.versions?.[0]?.imageUrl}>image</Badge>
              </div>
            )}
          />
        )}

        {tab === 'series' && (
          <EntityList
            items={series.filter(
              (s) =>
                !q ||
                s.name.toLowerCase().includes(q) ||
                s.englishName?.toLowerCase().includes(q),
            )}
            total={series.length}
            renderRow={(s) => (
              <div key={s.id} className="flex items-center gap-3 border-b border-gray-800 py-2">
                <span
                  className="h-4 w-4 shrink-0 rounded"
                  style={{ backgroundColor: s.color }}
                />
                <div className="min-w-0 flex-1 truncate text-sm text-white">
                  {s.englishName || s.name}
                </div>
                <div className="shrink-0 text-xs text-gray-500">id {s.id}</div>
              </div>
            )}
          />
        )}

        {tab === 'performances' && (
          <EntityList
            items={performances.filter(
              (p) =>
                !q ||
                p.tourName?.toLowerCase().includes(q) ||
                p.venue?.toLowerCase().includes(q),
            )}
            total={performances.length}
            renderRow={(p) => (
              <div key={p.id} className="flex items-center gap-3 border-b border-gray-800 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-white">{p.tourName}</div>
                  <div className="truncate text-xs text-gray-500">
                    {p.date}
                    {p.venue ? ` · ${p.venue}` : ''}
                    {p.status ? ` · ${p.status}` : ''}
                  </div>
                </div>
                <Badge ok={!!setlists[p.id]}>setlist</Badge>
              </div>
            )}
          />
        )}

        {tab === 'setlists' && (
          <EntityList
            items={Object.values(setlists).filter(
              (sl) => !q || sl.performanceId?.toLowerCase().includes(q),
            )}
            total={Object.keys(setlists).length}
            renderRow={(sl) => (
              <div key={sl.id} className="flex items-center gap-3 border-b border-gray-800 py-2">
                <div className="min-w-0 flex-1 truncate text-sm text-white">
                  {sl.performanceId}
                </div>
                <div className="shrink-0 text-xs text-gray-500">
                  {sl.items?.length ?? 0} items · {sl.sections?.length ?? 0} sections
                </div>
              </div>
            )}
          />
        )}

        {tab === 'clips' && (
          <EntityList
            items={clips.filter(
              (c) =>
                !q ||
                c.name.toLowerCase().includes(q) ||
                c.tags?.some((t) => t.toLowerCase().includes(q)),
            )}
            total={clips.length}
            renderRow={(c) => (
              <div key={c.id} className="flex items-center gap-3 border-b border-gray-800 py-2">
                <div className="min-w-0 flex-1 truncate text-sm text-white">{c.name}</div>
                <div className="shrink-0 text-xs text-gray-500">
                  {c.tags?.join(', ')}
                </div>
              </div>
            )}
          />
        )}
      </div>
    </div>
  );
}

function EntityList<T>({
  items,
  total,
  renderRow,
}: {
  items: T[];
  total: number;
  renderRow: (item: T) => ReactNode;
}) {
  const shown = items.slice(0, ROW_CAP);
  return (
    <div>
      <div className="mb-2 text-xs text-gray-500">
        {items.length === total
          ? `${total} items`
          : `${items.length} of ${total} match`}
        {shown.length < items.length ? ` · showing first ${shown.length}` : ''}
      </div>
      {items.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-500">No matching items.</div>
      ) : (
        <div>{shown.map(renderRow)}</div>
      )}
    </div>
  );
}
