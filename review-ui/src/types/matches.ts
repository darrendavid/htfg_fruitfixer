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
}

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
