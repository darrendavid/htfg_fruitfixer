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
  original_path: string;
  dest_path: string;
  nocodb_id?: number;
  filename: string;
}

export interface ActionResponse {
  success: boolean;
  undo_token: UndoToken;
}
