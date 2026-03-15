import { ApiError } from '@/lib/ApiError';
import type {
  User,
  QueueItem,
  QueueStats,
  Plant,
  CsvCandidate,
  ReferenceImage,
  LeaderboardEntry,
  UserStats,
  AdminStats,
  CompletionLogRow,
  ImportStatus,
} from '@/types/api';

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...options });
  if (!res.ok) {
    let message = res.statusText;
    try { const body = await res.json(); message = body.error || message; } catch {}
    throw new ApiError(res.status, message);
  }
  // Handle 204 No Content
  if (res.status === 204) return undefined as T;
  return res.json();
}

// Auth

export async function registerUser(email: string, firstName: string, lastName: string): Promise<void> {
  await fetchApi<void>('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, first_name: firstName, last_name: lastName }),
  });
}

export async function loginUser(email: string): Promise<void> {
  await fetchApi<void>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

export async function logoutUser(): Promise<void> {
  await fetchApi<void>('/api/auth/logout', { method: 'POST' });
}

export async function getMe(): Promise<User> {
  const data = await fetchApi<{ user: User }>('/api/auth/me');
  return data.user;
}

export async function adminLogin(email: string, password: string): Promise<User> {
  const data = await fetchApi<{ user: User }>('/api/auth/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return data.user;
}

// Queue

export async function getNextQueueItem(type: 'swipe' | 'classify'): Promise<{ item: QueueItem | null; remaining: number }> {
  return fetchApi<{ item: QueueItem | null; remaining: number }>(`/api/queue/next?type=${type}`);
}

export async function getQueueStats(): Promise<QueueStats> {
  const data = await fetchApi<{ stats: QueueStats }>('/api/queue/stats');
  return data.stats;
}

export async function releaseQueueItem(id: number): Promise<void> {
  await fetchApi<void>(`/api/queue/${id}/release`, { method: 'POST' });
}

// Review

export async function confirmReview(imagePath: string): Promise<void> {
  await fetchApi<void>('/api/review/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_path: imagePath }),
  });
}

export async function rejectReview(imagePath: string): Promise<void> {
  await fetchApi<void>('/api/review/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_path: imagePath }),
  });
}

export async function classifyReview(imagePath: string, plantId: string): Promise<void> {
  await fetchApi<void>('/api/review/classify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_path: imagePath, plant_id: plantId }),
  });
}

export async function discardReview(imagePath: string, category: string, notes: string | null): Promise<void> {
  await fetchApi<void>('/api/review/discard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_path: imagePath, category, notes }),
  });
}

export async function idkReview(imagePath: string): Promise<{ idk_count: number; escalated: boolean }> {
  return fetchApi<{ idk_count: number; escalated: boolean }>('/api/review/idk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_path: imagePath }),
  });
}

// Plants

export async function searchPlants(query: string): Promise<Plant[]> {
  const data = await fetchApi<{ plants: Plant[] }>(`/api/plants?search=${encodeURIComponent(query)}`);
  return data.plants;
}

export async function getAllPlants(): Promise<Plant[]> {
  const data = await fetchApi<{ plants: Plant[] }>('/api/plants');
  return data.plants;
}

export async function getReferenceImages(plantId: string): Promise<ReferenceImage[]> {
  const data = await fetchApi<{ images: ReferenceImage[] }>(`/api/plants/${plantId}/reference-images`);
  return data.images;
}

export async function createNewPlant(data: { common_name: string; botanical_name?: string; category?: string; aliases?: string }): Promise<{ id: string; common_name: string }> {
  const result = await fetchApi<{ plant: { id: string; common_name: string } }>('/api/plants/new', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return result.plant;
}

export async function searchCsvCandidates(query: string): Promise<CsvCandidate[]> {
  const data = await fetchApi<{ candidates: CsvCandidate[] }>(`/api/plants/csv-candidates?search=${encodeURIComponent(query)}`);
  return data.candidates;
}

// Stats & Leaderboard

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  const data = await fetchApi<{ leaderboard: LeaderboardEntry[] }>('/api/leaderboard');
  return data.leaderboard;
}

export async function getMyStats(): Promise<UserStats> {
  return fetchApi<UserStats>('/api/me/stats');
}

// Admin

export async function getAdminStats(): Promise<AdminStats> {
  const data = await fetchApi<{ stats: AdminStats }>('/api/admin/stats');
  return data.stats;
}

export async function getAdminLeaderboard(): Promise<LeaderboardEntry[]> {
  const data = await fetchApi<{ leaderboard: LeaderboardEntry[] }>('/api/admin/leaderboard');
  return data.leaderboard;
}

export async function getAdminLog(params: { page?: number; limit?: number; action?: string; user_id?: number; date_from?: string; date_to?: string }): Promise<{ rows: CompletionLogRow[]; total: number; page: number; limit: number }> {
  const qs = new URLSearchParams();
  if (params.page !== undefined) qs.set('page', String(params.page));
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.action !== undefined) qs.set('action', params.action);
  if (params.user_id !== undefined) qs.set('user_id', String(params.user_id));
  if (params.date_from !== undefined) qs.set('date_from', params.date_from);
  if (params.date_to !== undefined) qs.set('date_to', params.date_to);
  const query = qs.toString();
  return fetchApi<{ rows: CompletionLogRow[]; total: number; page: number; limit: number }>(`/api/admin/log${query ? `?${query}` : ''}`);
}

export async function getIdkFlagged(): Promise<QueueItem[]> {
  const data = await fetchApi<{ images: QueueItem[] }>('/api/admin/idk-flagged');
  return data.images;
}

export async function getAdminUsers(): Promise<User[]> {
  const data = await fetchApi<{ users: User[] }>('/api/admin/users');
  return data.users;
}

export async function triggerImport(): Promise<void> {
  await fetchApi<void>('/api/admin/import', { method: 'POST' });
}

export async function getImportStatus(): Promise<ImportStatus> {
  return fetchApi<ImportStatus>('/api/admin/import-status');
}
