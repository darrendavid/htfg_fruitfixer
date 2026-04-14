import { useState, useEffect, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { imgUrlFromFilePath } from '@/lib/gallery-utils';
import type {
  AttachmentOcrGroupsResponse,
  AttachmentOcrPlantGroup,
  AttachmentOcrPlantResponse,
  AttachmentOcrResult,
  AttachmentOcrExtraction,
} from '@/types/matches';

// ── Sidebar ──────────────────────────────────────────────────────────────────

function OcrSidebar({
  groups,
  selectedId,
  liveCounts,
  isLoading,
  onSelect,
}: {
  groups: AttachmentOcrPlantGroup[];
  selectedId: string | null;
  liveCounts: Map<string, number>;
  isLoading: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="w-[250px] shrink-0 border-r flex flex-col overflow-hidden">
      <div className="p-3 border-b">
        <h2 className="text-sm font-semibold">Attachment OCR</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {groups.reduce((n, g) => n + g.count, 0)} images across {groups.length} plants
        </p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-3 space-y-1">
            {[1, 2, 3].map(n => <Skeleton key={n} className="h-7 w-full" />)}
          </div>
        ) : groups.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">No OCR data found. Run the extraction script first.</p>
        ) : (
          groups.map(g => {
            const pending = liveCounts.get(g.plant_id) ?? g.pending;
            const isDone = pending === 0;
            return (
              <button
                key={g.plant_id}
                className={`w-full text-left px-3 py-2 text-xs transition-colors border-b truncate ${
                  selectedId === g.plant_id
                    ? 'bg-accent font-medium'
                    : isDone ? 'opacity-40 hover:bg-muted' : 'hover:bg-muted'
                }`}
                onClick={() => onSelect(g.plant_id)}
                title={g.plant_name}
              >
                {g.plant_name}
                <span className={`float-right ${isDone ? 'text-green-600' : 'text-muted-foreground'}`}>
                  {isDone ? '✓' : pending}
                </span>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}

// ── Field row: editable value + Accept/Ignore buttons ───────────────────────

function FieldRow({
  label,
  fieldKey,
  value,
  decision,
  existing,
  onAccept,
  onIgnore,
  editable = true,
}: {
  label: string;
  fieldKey: string;
  value: string;
  decision: 'accepted' | 'ignored' | undefined;
  existing: string | null | undefined;
  onAccept: (key: string, val: string) => void;
  onIgnore: (key: string) => void;
  editable?: boolean;
}) {
  const [editedValue, setEditedValue] = useState(value);

  if (decision === 'ignored') {
    return (
      <div className="flex items-start gap-2 py-1.5 opacity-40">
        <span className="text-[10px] font-semibold text-muted-foreground w-24 shrink-0 pt-0.5">{label}</span>
        <span className="text-[11px] text-muted-foreground line-through flex-1">{value}</span>
        <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0">ignored</Badge>
      </div>
    );
  }

  if (decision === 'accepted') {
    return (
      <div className="flex items-start gap-2 py-1.5">
        <span className="text-[10px] font-semibold text-muted-foreground w-24 shrink-0 pt-0.5">{label}</span>
        <span className="text-[11px] flex-1 text-green-700">{editedValue}</span>
        <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0 bg-green-50 text-green-700">✓ accepted</Badge>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="text-[10px] font-semibold text-muted-foreground w-24 shrink-0 pt-0.5">{label}</span>
      <div className="flex-1 min-w-0">
        {existing && (
          <p className="text-[10px] text-muted-foreground mb-1">
            <span className="font-semibold">Existing:</span> {existing}
          </p>
        )}
        {editable ? (
          <Textarea
            value={editedValue}
            onChange={e => setEditedValue(e.target.value)}
            className="text-[11px] min-h-[60px] resize-y p-1.5"
          />
        ) : (
          <p className="text-[11px]">{editedValue}</p>
        )}
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[10px] bg-green-50 hover:bg-green-100 text-green-700 border-green-200"
          onClick={() => onAccept(fieldKey, editedValue)}
        >
          Accept
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[10px] text-muted-foreground"
          onClick={() => onIgnore(fieldKey)}
        >
          Ignore
        </Button>
      </div>
    </div>
  );
}

// ── Variety row ──────────────────────────────────────────────────────────────

function VarietyRow({
  variety,
  fieldKey,
  decision,
  isSimilar,
  existingMatch,
  onAccept,
  onIgnore,
}: {
  variety: { name: string; notes: string | null };
  fieldKey: string;
  decision: 'accepted' | 'ignored' | undefined;
  isSimilar: boolean;
  existingMatch: string | null;
  onAccept: (key: string, name: string, notes: string | null) => void;
  onIgnore: (key: string) => void;
}) {
  if (decision === 'ignored') {
    return (
      <div className="flex items-center gap-2 py-1 opacity-40">
        <span className="text-[11px] line-through flex-1">{variety.name}</span>
        <Badge variant="outline" className="text-[9px] h-4 px-1">ignored</Badge>
      </div>
    );
  }

  if (decision === 'accepted') {
    return (
      <div className="flex items-center gap-2 py-1">
        <span className="text-[11px] flex-1 text-green-700">{variety.name}</span>
        <Badge variant="outline" className="text-[9px] h-4 px-1 bg-green-50 text-green-700">✓ added</Badge>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 py-1">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium">{variety.name}</span>
          {isSimilar && existingMatch && (
            <Badge variant="outline" className="text-[9px] h-4 px-1 bg-amber-50 text-amber-700">
              similar: {existingMatch}
            </Badge>
          )}
        </div>
        {variety.notes && (
          <p className="text-[10px] text-muted-foreground">{variety.notes}</p>
        )}
      </div>
      <div className="flex gap-1 shrink-0">
        {!isSimilar ? (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[10px] bg-green-50 hover:bg-green-100 text-green-700 border-green-200"
            onClick={() => onAccept(fieldKey, variety.name, variety.notes)}
          >
            Add
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[10px] bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200"
            onClick={() => onAccept(fieldKey, variety.name, variety.notes)}
          >
            Add Anyway
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[10px] text-muted-foreground"
          onClick={() => onIgnore(fieldKey)}
        >
          Ignore
        </Button>
      </div>
    </div>
  );
}

// ── Levenshtein distance for variety similarity ───────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

function findSimilarVariety(name: string, existing: string[]): string | null {
  const norm = name.toLowerCase().trim();
  for (const ev of existing) {
    const enorm = ev.toLowerCase().trim();
    if (enorm === norm) return ev;
    if (levenshtein(norm, enorm) <= 3) return ev;
    // Substring match
    if (enorm.includes(norm) || norm.includes(enorm)) return ev;
  }
  return null;
}

// ── Single result panel ──────────────────────────────────────────────────────

function ResultPanel({
  result,
  existingPlant,
  existingVarietyNames,
  onDecision,
}: {
  result: AttachmentOcrResult;
  existingPlant: Record<string, any> | null;
  existingVarietyNames: string[];
  onDecision: (fieldKey: string, action: 'accepted' | 'ignored') => void;
}) {
  const e = result.extraction as AttachmentOcrExtraction;
  const dec = result.decisions;

  async function acceptField(fieldKey: string, value: string, fieldType: string) {
    try {
      const res = await fetch('/api/matches/accept-ocr-field', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_path: result.file_path,
          field_key: fieldKey,
          plant_id: result.plant_id,
          field_type: fieldType,
          value,
        }),
      });
      if (res.ok) {
        toast.success(`Accepted: ${fieldKey}`);
        onDecision(fieldKey, 'accepted');
      } else {
        toast.error('Failed to accept field');
      }
    } catch { toast.error('Network error'); }
  }

  async function ignoreField(fieldKey: string) {
    try {
      await fetch('/api/matches/ignore-ocr-field', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: result.file_path, field_key: fieldKey }),
      });
      onDecision(fieldKey, 'ignored');
    } catch { toast.error('Network error'); }
  }

  async function acceptVariety(fieldKey: string, name: string, notes: string | null) {
    try {
      const res = await fetch('/api/matches/accept-ocr-variety', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_path: result.file_path,
          field_key: fieldKey,
          plant_id: result.plant_id,
          variety_name: name,
          variety_notes: notes,
        }),
      });
      if (res.ok) {
        toast.success(`Added variety: ${name}`);
        onDecision(fieldKey, 'accepted');
      } else {
        toast.error('Failed to add variety');
      }
    } catch { toast.error('Network error'); }
  }

  // Image URL — attachment is in assigned/{plant}/attachments/
  // /images route serves from the assigned/ directory
  const imageUrl = (() => {
    const fp = result.file_path.replace(/\\/g, '/');
    const idx = fp.indexOf('/assigned/');
    if (idx >= 0) {
      const rel = fp.slice(idx + '/assigned/'.length);
      return `/images/${rel.split('/').map(encodeURIComponent).join('/')}`;
    }
    return '';
  })();

  return (
    <div className="border rounded-lg p-3 mb-4 bg-card">
      <div className="flex gap-3 mb-3">
        {/* Thumbnail */}
        {imageUrl && (
          <a href={imageUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
            <img
              src={imageUrl}
              alt={result.basename}
              className="w-32 h-24 object-contain border rounded bg-muted"
              loading="lazy"
            />
          </a>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate">{result.basename}</p>
          {e.title && <p className="text-[11px] text-muted-foreground">{e.title}</p>}
          <div className="flex gap-1 mt-1">
            {e.content_type && <Badge variant="outline" className="text-[9px] h-4 px-1">{e.content_type}</Badge>}
            {e.source_context && <Badge variant="outline" className="text-[9px] h-4 px-1">{e.source_context}</Badge>}
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t pt-2 space-y-0.5">
        {/* Scientific name */}
        {e.scientific_name && (
          <FieldRow
            label="Scientific Name"
            fieldKey="scientific_name"
            value={e.scientific_name}
            decision={dec['scientific_name'] as any}
            existing={existingPlant?.Botanical_Names}
            onAccept={(k, v) => acceptField(k, v, 'plant_field')}
            onIgnore={ignoreField}
          />
        )}

        {/* Description */}
        {e.description && (
          <FieldRow
            label="Description"
            fieldKey="description"
            value={e.description}
            decision={dec['description'] as any}
            existing={existingPlant?.Description ? existingPlant.Description.slice(0, 100) + '…' : null}
            onAccept={(k, v) => acceptField(k, v, 'plant_field')}
            onIgnore={ignoreField}
          />
        )}

        {/* Origin */}
        {e.origin && (
          <FieldRow
            label="Origin"
            fieldKey="origin"
            value={e.origin}
            decision={dec['origin'] as any}
            existing={existingPlant?.Origin}
            onAccept={(k, v) => acceptField(k, v, 'plant_field')}
            onIgnore={ignoreField}
          />
        )}

        {/* Key facts */}
        {e.key_facts?.map((fact, i) => {
          const fk = `fact:${fact.field}`;
          return (
            <FieldRow
              key={i}
              label={fact.field}
              fieldKey={fk}
              value={fact.value}
              decision={dec[fk] as any}
              existing={null}
              onAccept={(k, v) => acceptField(k, v, 'key_fact')}
              onIgnore={ignoreField}
              editable={false}
            />
          );
        })}

        {/* Nutrition */}
        {e.nutrition?.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] font-semibold text-muted-foreground mb-1">Nutrition Facts</p>
            {e.nutrition.map((n, i) => {
              const nk = `nutrition:${n.nutrient}`;
              return (
                <FieldRow
                  key={i}
                  label={n.nutrient}
                  fieldKey={nk}
                  value={n.value}
                  decision={dec[nk] as any}
                  existing={null}
                  onAccept={(k, v) => acceptField(k, v, 'nutrition')}
                  onIgnore={ignoreField}
                  editable={false}
                />
              );
            })}
          </div>
        )}

        {/* Varieties */}
        {e.varieties?.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] font-semibold text-muted-foreground mb-1">
              Varieties ({e.varieties.length})
            </p>
            {e.varieties.map((v, i) => {
              const vk = `variety:${v.name}`;
              const similar = findSimilarVariety(v.name, existingVarietyNames);
              const isSimilar = similar !== null && similar.toLowerCase() !== v.name.toLowerCase();
              return (
                <VarietyRow
                  key={i}
                  variety={v}
                  fieldKey={vk}
                  decision={dec[vk] as any}
                  isSimilar={isSimilar}
                  existingMatch={isSimilar ? similar : null}
                  onAccept={acceptVariety}
                  onIgnore={ignoreField}
                />
              );
            })}
          </div>
        )}

        {/* Extracted text (collapsed) */}
        {e.extracted_text && (
          <details className="mt-2">
            <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">
              Raw extracted text ({e.extracted_text.length} chars)
            </summary>
            <pre className="text-[10px] whitespace-pre-wrap mt-1 p-2 bg-muted rounded max-h-48 overflow-y-auto">
              {e.extracted_text}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

// ── Main tab component ───────────────────────────────────────────────────────

export function AttachmentOcrTab() {
  const [groups, setGroups] = useState<AttachmentOcrPlantGroup[]>([]);
  const [liveCounts, setLiveCounts] = useState<Map<string, number>>(new Map());
  const [selectedPlant, setSelectedPlant] = useState<string | null>(null);
  const [plantData, setPlantData] = useState<AttachmentOcrPlantResponse | null>(null);
  const [isLoadingGroups, setIsLoadingGroups] = useState(true);
  const [isLoadingPlant, setIsLoadingPlant] = useState(false);

  useEffect(() => {
    fetch('/api/matches/attachment-ocr', { credentials: 'include' })
      .then(r => r.json())
      .then((data: AttachmentOcrGroupsResponse) => {
        setGroups(data.groups);
        setLiveCounts(new Map(data.groups.map(g => [g.plant_id, g.pending])));
        if (data.groups.length > 0) loadPlant(data.groups[0].plant_id);
      })
      .catch(() => {})
      .finally(() => setIsLoadingGroups(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPlant = useCallback((plantId: string) => {
    setSelectedPlant(plantId);
    setIsLoadingPlant(true);
    setPlantData(null);
    fetch(`/api/matches/attachment-ocr-plant/${encodeURIComponent(plantId)}`, { credentials: 'include' })
      .then(r => r.json())
      .then((data: AttachmentOcrPlantResponse) => setPlantData(data))
      .catch(() => {})
      .finally(() => setIsLoadingPlant(false));
  }, []);

  const handleDecision = useCallback((filePath: string, fieldKey: string, action: 'accepted' | 'ignored') => {
    setPlantData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        results: prev.results.map(r =>
          r.file_path === filePath
            ? { ...r, decisions: { ...r.decisions, [fieldKey]: action } }
            : r
        ),
      };
    });

    // Update sidebar pending count
    if (action === 'accepted' || action === 'ignored') {
      setLiveCounts(prev => {
        const next = new Map(prev);
        const cur = next.get(selectedPlant ?? '') ?? 0;
        next.set(selectedPlant ?? '', Math.max(0, cur - 1));
        return next;
      });
    }
  }, [selectedPlant]);

  const existingVarietyNames = plantData?.existing_varieties.map(v => v.name) ?? [];

  return (
    <div className="flex h-full overflow-hidden">
      <OcrSidebar
        groups={groups}
        selectedId={selectedPlant}
        liveCounts={liveCounts}
        isLoading={isLoadingGroups}
        onSelect={loadPlant}
      />

      <main className="flex-1 overflow-y-auto p-4">
        {!selectedPlant ? (
          <p className="text-sm text-muted-foreground text-center mt-12">Select a plant to review OCR data.</p>
        ) : isLoadingPlant ? (
          <div className="space-y-3">
            {[1, 2, 3].map(n => <Skeleton key={n} className="h-32 w-full rounded-lg" />)}
          </div>
        ) : !plantData ? (
          <p className="text-sm text-muted-foreground text-center mt-12">Failed to load OCR data.</p>
        ) : plantData.results.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center mt-12">No OCR data for this plant.</p>
        ) : (
          <>
            <div className="mb-3">
              <h2 className="text-sm font-semibold">{plantData.plant_name}</h2>
              <p className="text-xs text-muted-foreground">
                {plantData.results.length} attachment{plantData.results.length !== 1 ? 's' : ''} with OCR data
                {plantData.existing_varieties.length > 0 && (
                  <span> · {plantData.existing_varieties.length} existing varieties</span>
                )}
              </p>
            </div>
            {plantData.results.map(result => (
              <ResultPanel
                key={result.file_path}
                result={result}
                existingPlant={plantData.existing_plant}
                existingVarietyNames={existingVarietyNames}
                onDecision={(fk, action) => handleDecision(result.file_path, fk, action)}
              />
            ))}
          </>
        )}
      </main>
    </div>
  );
}
