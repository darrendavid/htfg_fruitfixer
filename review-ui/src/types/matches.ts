// Types for Phase 4C Match Review UI

export interface MatchItem {
  file_path: string;
  filename: string;
  parent_dir: string;
  grandparent_dir: string;
  plant_id: string | null;
  plant_name: string | null;
  variety_id: number | null;
  variety_name: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
  match_type: string | null;
  signals: string[];
  file_size: number;
  file_type: 'image' | 'document';
  txt_preview?: string; // first ~400 chars of .txt files
}

export interface FolderSummary {
  folder: string;      // full relative path from unclassified root (unique key)
  displayName: string; // last path component (for display)
  count: number;
  matched: number;
}

export interface FoldersResponse {
  total: number;
  groups: FolderSummary[];
}

export interface FolderItemsResponse {
  folder: string;
  total: number;
  matched: number;
  items: MatchItem[];
}

// Legacy — kept for undo reload compatibility
export interface MatchGroup {
  folder: string;
  count: number;
  matches: MatchItem[];
}

export interface MatchesResponse {
  total: number;
  matched: number;
  unmatched: number;
  groups: MatchGroup[];
}

export interface UndoToken {
  type: string;
  original_path?: string;
  dest_path?: string;
  nocodb_id?: number;
  filename?: string;
  image_id?: number;
  variety_id?: number;
}

export interface ActionResponse {
  success: boolean;
  undo_token: UndoToken;
}

// ── Variety suggestion types ────────────────────────────────────────────────

export interface VarietyMatchItem {
  image_id: number;
  file_path: string;
  filename: string;
  plant_id: string;
  plant_name: string;
  source_directory: string | null;
  variety_id: number;
  variety_name: string;
  confidence: 'high' | 'medium' | 'low';
  match_type: string;
  signals: string[];
}

export interface VarietyMatchGroup {
  plant_id: string;
  plant_name: string;
  count: number;
}

export interface VarietyMatchGroupsResponse {
  total: number;
  groups: VarietyMatchGroup[];
}

export interface VarietyMatchItemsResponse {
  plant_id: string;
  plant_name: string;
  total: number;
  items: VarietyMatchItem[];
}

// ── Lost image types ────────────────────────────────────────────────────────

export interface LostImageItem {
  image_id: number;
  plant_id: string;
  plant_name: string;
  original_filepath: string | null;
  source_directory: string;
  old_file_path: string;
  new_file_path: string | null;
  variety_id: number | null;
  status: 'recovered' | 'source_missing' | 'no_original_path';
}

export interface LostImageGroup {
  plant_id: string;
  plant_name: string;
  count: number;
}

export interface LostImageGroupsResponse {
  total: number;
  groups: LostImageGroup[];
}

export interface LostImageItemsResponse {
  plant_id: string;
  plant_name: string;
  total: number;
  items: LostImageItem[];
}

// ── Dedup review types ──────────────────────────────────────────────────────

export interface DedupRecord {
  id: number;
  file_path: string;
  plant_id: string | null;
  variety_id: number | null;
  status: string;
  caption: string | null;
}

export interface DedupGroup {
  original_filepath: string;
  kept: DedupRecord[];
  deleted: DedupRecord[];
}

export interface DedupReviewResponse {
  total: number;
  offset: number;
  limit: number;
  groups: DedupGroup[];
}
