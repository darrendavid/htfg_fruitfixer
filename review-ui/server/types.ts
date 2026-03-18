// Express Request augmentation
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        email: string;
        first_name: string;
        last_name: string;
        role: string;
      };
    }
  }
}

// DB row types
export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  last_active_at: string | null;
  last_reminded_at: string | null;
  created_at: string;
}

export interface MagicLink {
  id: number;
  email: string;
  token: string;
  expires_at: string;
  used: number;
  created_at: string;
}

export interface Session {
  id: string;
  user_id: number;
  expires_at: string;
  created_at: string;
}

export interface QueueItem {
  id: number;
  image_path: string;
  source_path: string | null;
  queue: string;
  status: string;
  current_plant_id: string | null;
  suggested_plant_id: string | null;
  confidence: string | null;
  match_type: string | null;
  reasoning: string | null;
  thumbnail_path: string | null;
  file_size: number | null;
  sort_key: string | null;
  source_directories: string | null;
  idk_count: number;
  locked_by: number | null;
  locked_at: string | null;
  created_at: string;
}

export interface ReviewDecision {
  id: number;
  image_path: string;
  user_id: number;
  action: 'confirm' | 'reject' | 'classify' | 'discard' | 'idk';
  plant_id: string | null;
  discard_category: string | null;
  notes: string | null;
  decided_at: string;
}

export interface NewPlantRequest {
  id: number;
  common_name: string;
  botanical_name: string | null;
  category: string;
  aliases: string | null;
  requested_by: number;
  status: string;
  generated_id: string;
  phase4b_rerun_needed: number;
  created_at: string;
  first_image_path: string | null;
}

export interface Plant {
  id: string;
  common_name: string;
  botanical_names: string | null;
  aliases: string | null;
  category: string;
}

export interface StaffNote {
  id: number;
  plant_id: string;
  variety_id: number | null;
  user_id: number;
  text: string;
  created_at: string;
  updated_at: string;
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

// API response types
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

export interface AdminStats extends QueueStats {
  idk_flagged_count: number;
  total_users: number;
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

export interface DailySummaryStats {
  date: string;
  decisions_by_action: Record<string, number>;
  by_reviewer: Array<{ name: string; count: number }>;
  swipe_progress: { completed: number; total: number };
  classify_progress: { completed: number; total: number };
  new_plants_today: number;
  idk_escalations_today: number;
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
  progress?: number;
  total?: number;
  message?: string;
}
