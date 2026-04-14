/**
 * SwapCandidatesTab — classify/ tab
 *
 * Shows triage images whose perceptual hash matches an already-assigned image
 * at Hamming distance ≤ 2.  Highlights cases where the triage copy has higher
 * pixel resolution than the currently-assigned copy (potential swap candidates).
 *
 * All filtering is read-only — no reassignments happen here.
 */

import { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { imgUrlFromFilePath } from '@/lib/gallery-utils';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ImageInfo {
  id: number;
  file_path: string | null;
  plant_id: string | null;
  variety_id: number | null;
  caption: string | null;
  size_bytes: number | null;
  pixels: number | null;
}

interface Match {
  distance: number;
  confidence: 'certain' | 'very_high' | 'high';
  assigned: ImageInfo;
}

interface Candidate {
  triage: ImageInfo;
  best_match: Match;
  resolution: 'triage_higher' | 'assigned_higher' | 'similar';
  all_matches: Array<{
    distance: number;
    assigned_id: number;
    plant_id: string | null;
    variety_id: number | null;
    file_path: string | null;
    pixels: number | null;
  }>;
}

interface ApiResponse {
  generated_at: string | null;
  threshold: number | null;
  totals: Record<string, number>;
  total: number;
  offset: number;
  limit: number;
  candidates: Candidate[];
}

type ResolutionFilter = 'all' | 'triage_higher' | 'similar' | 'assigned_higher';

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtPx(px: number | null): string {
  if (!px) return '?';
  if (px >= 1_000_000) return `${(px / 1_000_000).toFixed(1)} MP`;
  return `${(px / 1000).toFixed(0)} Kpx`;
}

function fmtKB(bytes: number | null): string {
  if (!bytes) return '?';
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function confidenceBadge(c: string) {
  if (c === 'certain')   return <Badge className="bg-red-600 text-white text-[10px]">dist=0 certain</Badge>;
  if (c === 'very_high') return <Badge className="bg-orange-500 text-white text-[10px]">dist=1 very high</Badge>;
  return <Badge className="bg-yellow-500 text-white text-[10px]">dist=2 high</Badge>;
}

function resLabel(r: string) {
  if (r === 'triage_higher')   return <Badge className="bg-green-600 text-white text-[10px]">↑ triage higher res</Badge>;
  if (r === 'assigned_higher') return <Badge className="bg-blue-600 text-white text-[10px]">↓ assigned higher res</Badge>;
  return <Badge variant="outline" className="text-[10px]">≈ similar res</Badge>;
}

// ── Image pair card ────────────────────────────────────────────────────────────

function CandidateCard({ candidate }: { candidate: Candidate }) {
  const { triage: t, best_match: bm, resolution } = candidate;
  const a = bm.assigned;

  const triageUrl   = t.file_path   ? imgUrlFromFilePath(t.file_path)   : null;
  const assignedUrl = a.file_path   ? imgUrlFromFilePath(a.file_path)   : null;

  const tName = t.file_path?.split('/').pop() ?? `id:${t.id}`;
  const aName = a.file_path?.split('/').pop() ?? `id:${a.id}`;

  return (
    <div className={`border rounded-lg overflow-hidden ${
      resolution === 'triage_higher'
        ? 'border-green-500 ring-1 ring-green-500/40'
        : 'border-border'
    }`}>
      {/* Header */}
      <div className="px-3 py-2 bg-muted/40 flex items-center gap-2 flex-wrap border-b">
        {confidenceBadge(bm.confidence)}
        {resLabel(resolution)}
        <span className="text-xs text-muted-foreground ml-auto">
          {candidate.all_matches.length > 1
            ? `${candidate.all_matches.length} assigned matches`
            : '1 assigned match'}
        </span>
      </div>

      {/* Two-up image comparison */}
      <div className="grid grid-cols-2 gap-0 divide-x">
        {/* Triage side */}
        <div className="p-2 space-y-1">
          <p className="text-[11px] font-semibold text-orange-600 uppercase tracking-wide">Triage (candidate)</p>
          <div className="aspect-square bg-muted rounded overflow-hidden">
            {triageUrl ? (
              <img
                src={triageUrl}
                alt={tName}
                className="w-full h-full object-contain"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">No image</div>
            )}
          </div>
          <p className="text-xs truncate font-mono" title={t.file_path ?? ''}>{tName}</p>
          <div className="flex items-center gap-1 flex-wrap">
            {t.plant_id && <Badge variant="outline" className="text-[10px]">{t.plant_id}</Badge>}
            <span className="text-[10px] text-muted-foreground">{fmtPx(t.pixels)}</span>
            <span className="text-[10px] text-muted-foreground">{fmtKB(t.size_bytes)}</span>
          </div>
        </div>

        {/* Assigned side */}
        <div className="p-2 space-y-1">
          <p className="text-[11px] font-semibold text-blue-600 uppercase tracking-wide">Assigned (current)</p>
          <div className="aspect-square bg-muted rounded overflow-hidden">
            {assignedUrl ? (
              <img
                src={assignedUrl}
                alt={aName}
                className="w-full h-full object-contain"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">No image</div>
            )}
          </div>
          <p className="text-xs truncate font-mono" title={a.file_path ?? ''}>{aName}</p>
          <div className="flex items-center gap-1 flex-wrap">
            {a.plant_id && <Badge variant="secondary" className="text-[10px]">{a.plant_id}</Badge>}
            {a.variety_id && <Badge variant="outline" className="text-[10px]">var:{a.variety_id}</Badge>}
            <span className="text-[10px] text-muted-foreground">{fmtPx(a.pixels)}</span>
            <span className="text-[10px] text-muted-foreground">{fmtKB(a.size_bytes)}</span>
          </div>
        </div>
      </div>

      {/* Additional matches */}
      {candidate.all_matches.length > 1 && (
        <div className="px-3 py-1.5 bg-muted/20 border-t text-[11px] text-muted-foreground">
          Also matches: {candidate.all_matches.slice(1, 4).map(m =>
            `${m.plant_id ?? '?'} (dist=${m.distance})`
          ).join(', ')}
          {candidate.all_matches.length > 4 && ` +${candidate.all_matches.length - 4} more`}
        </div>
      )}
    </div>
  );
}

// ── Main tab ───────────────────────────────────────────────────────────────────

const LIMIT = 20;

export function SwapCandidatesTab() {
  const [data, setData]         = useState<ApiResponse | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [filter, setFilter]     = useState<ResolutionFilter>('triage_higher');
  const [offset, setOffset]     = useState(0);

  const fetchPage = useCallback((off: number, res: ResolutionFilter) => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(LIMIT), offset: String(off) });
    if (res !== 'all') params.set('resolution', res);
    fetch(`/api/matches/swap-candidates?${params}`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { setData(d); setOffset(off); })
      .catch(e => console.error('swap-candidates fetch error', e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchPage(0, filter); }, [fetchPage, filter]);

  const totals = data?.totals;

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="shrink-0 border-b px-3 py-2 flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-muted-foreground">Show:</span>
        {([
          ['triage_higher',   '↑ Triage higher res'],
          ['similar',         '≈ Similar res'],
          ['assigned_higher', '↓ Assigned higher res'],
          ['all',             'All matches'],
        ] as [ResolutionFilter, string][]).map(([val, label]) => (
          <Button
            key={val}
            size="sm"
            variant={filter === val ? 'default' : 'outline'}
            onClick={() => setFilter(val)}
            className="h-7 text-xs"
          >
            {label}
          </Button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {isLoading ? 'Loading…' : `${data?.total ?? 0} candidates`}
        </span>
      </div>

      {/* Stats bar */}
      {totals && !isLoading && (
        <div className="shrink-0 border-b px-3 py-1.5 flex items-center gap-4 text-xs text-muted-foreground bg-muted/20">
          <span>threshold: dist≤{data?.threshold}</span>
          <span className="text-green-700 font-medium">↑ triage higher: {totals.triage_higher_res}</span>
          <span>≈ similar: {totals.similar_res}</span>
          <span>↓ assigned higher: {totals.assigned_higher_res}</span>
          {data?.generated_at && (
            <span className="ml-auto">built {new Date(data.generated_at).toLocaleDateString()}</span>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-64 w-full rounded-lg" />
            ))}
          </div>
        ) : !data?.candidates.length ? (
          <div className="py-16 text-center text-muted-foreground text-sm">
            {filter === 'triage_higher'
              ? 'No triage images found that are higher resolution than their assigned match.'
              : 'No candidates in this category.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.candidates.map(c => (
              <CandidateCard key={`${c.triage.id}`} candidate={c} />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {!isLoading && (data?.total ?? 0) > LIMIT && (
        <div className="shrink-0 border-t px-3 py-2 flex items-center justify-between">
          <Button
            size="sm" variant="outline"
            disabled={offset === 0}
            onClick={() => fetchPage(Math.max(0, offset - LIMIT), filter)}
          >← Prev</Button>
          <span className="text-xs text-muted-foreground">
            {offset + 1}–{Math.min(offset + LIMIT, data?.total ?? 0)} of {data?.total}
          </span>
          <Button
            size="sm" variant="outline"
            disabled={offset + LIMIT >= (data?.total ?? 0)}
            onClick={() => fetchPage(offset + LIMIT, filter)}
          >Next →</Button>
        </div>
      )}
    </div>
  );
}
