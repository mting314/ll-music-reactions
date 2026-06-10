export interface Song {
  id: string;
  name: string;
  phoneticName: string;
  englishName: string;
  seriesIds: number[];
  releasedOn: string;
  artists: { id: string; variant: string | null }[];
  discographyIds: number[];
  musicVideo?: { videoId: string; videoOffset: number };
  wikiAudioUrl?: string;
}

export interface Artist {
  id: string;
  name: string;
  seriesIds: number[];
  characters?: string[];
}

export interface Discography {
  id: string;
  name: string;
  description: string;
  type: string;
  releasedAt: string;
  seriesIds: number[];
  versions: {
    id: string;
    name: string | null;
    imageUrl: string;
  }[];
  artistVariants: { id: string }[];
}

export interface Series {
  id: number;
  name: string;
  englishName: string;
  color: string;
}

export interface Character {
  id: string;
  name: string;
  englishName: string;
  phoneticName: string;
  school: string;
  seriesIds: number[];
  units: { id: string; name: string }[];
}

export interface Performance {
  id: string;
  tourName: string;
  date: string;
  venue: string;
  seriesIds: string[];
  status: string;
  hasSetlist: boolean;
}

export interface SetlistItem {
  id: string;
  type: string;
  position: number;
  songId: string;
  customSongName: string;
}

export interface Setlist {
  id: string;
  performanceId: string;
  items: SetlistItem[];
  sections: {
    name: string;
    startIndex: number;
    endIndex: number;
    type: string;
  }[];
}

export interface ReactionClip {
  id: string;
  name: string;
  tags: string[];
  filename: string;
  thumbnailFilename: string;
  durationMs: number;
}

export interface TimelineEntry {
  id: string;
  clipId: string | null;
  songId: string | null;
  songStartTime: number | null;
}

export interface ExportSettings {
  resolution: '720p' | '480p';
  overlayPosition: 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left';
  overlaySize: number;
}

export type SongType = 'solo' | 'unit' | 'group';

export interface SongFilter {
  series: number[];
  artists: string[];
  years: number[];
  types: SongType[];
}
