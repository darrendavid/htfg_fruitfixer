export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: 'reviewer' | 'admin';
  last_active_at: string | null;
}

export interface QueueItem {
  id: number;
  image_path: string;
  source_path: string | null;
  queue: string;
  status: string;
  current_plant_id: string | null;
  suggested_plant_id: string | null;
  current_plant_name: string | null;
  suggested_plant_name: string | null;
  confidence: string | null;
  match_type: string | null;
  reasoning: string | null;
  thumbnail_path: string | null;
  file_size: number | null;
  sort_key: string | null;
  source_directories: string | null;
  idk_count: number;
}

export interface QueueStats {
  swipe_pending: number;
  swipe_in_progress: number;
  swipe_completed: number;
  classify_pending: number;
  classify_in_progress: number;
  classify_completed: number;
  classify_flagged_idk: number;
  ocr_review_pending: number;
  ocr_review_in_progress: number;
  ocr_review_completed: number;
  decisions_by_action: Record<string, number>;
  today_by_user: Array<{ user_id: number; first_name: string; last_name: string; count: number }>;
  new_plant_rerun_count: number;
}

export interface OcrExtraction {
  id: number;
  queue_item_id: number;
  image_path: string;
  title: string | null;
  content_type: string | null;
  extracted_text: string | null;
  plant_associations: string | null; // JSON array
  key_facts: string | null; // JSON array of {field, value, status}
  source_context: string | null;
  reviewer_notes: string | null;
  status: string;
  reviewed_by: number | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface KeyFact {
  field: string;
  value: string;
  status: 'keep' | 'remove';
}

export interface OcrStats {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
}

export interface Plant {
  id: string;
  common_name: string;
  botanical_names: string | null;
  aliases: string | null;
  category: string;
}

export interface CsvCandidate {
  provisional_id?: string;
  fruit_type?: string;
  common_name?: string;
  scientific_name?: string;
  genus?: string;
  sample_varieties?: string[];
}

export interface ReferenceImage {
  path: string;
  thumbnail: string;
}

export interface LeaderboardEntry {
  rank: number;
  display_name: string;
  count: number;
  user_id: number;
}

export interface UserStats {
  today_count: number;
  all_time_count: number;
  rank: number;
}

export interface AdminStats extends QueueStats {
  idk_flagged_count: number;
  total_users: number;
}

export interface CompletionLogRow {
  id: number;
  image_path: string;
  thumbnail_path: string | null;
  action: string;
  reviewer_name: string;
  plant_id: string | null;
  decided_at: string;
}

export interface ImportStatus {
  status: 'idle' | 'running' | 'complete' | 'error';
  step?: string;
  progress?: number;
  total?: number;
  message?: string;
  counts?: { plants: number; swipe: number; classify: number; total: number };
}
