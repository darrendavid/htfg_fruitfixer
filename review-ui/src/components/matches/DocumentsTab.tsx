import { useState, useEffect, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PlantAutocomplete, type PlantSuggestion } from '@/components/browse/PlantAutocomplete';
import { toast } from 'sonner';

const EXT_COLORS: Record<string, string> = {
  pdf: 'bg-red-500',
  doc: 'bg-blue-500', docx: 'bg-blue-500',
  ppt: 'bg-orange-500', pptx: 'bg-orange-500',
  xls: 'bg-green-500', xlsx: 'bg-green-500',
  txt: 'bg-gray-400', psd: 'bg-purple-500',
};

interface BinaryDoc {
  Id: number;
  Title: string | null;
  File_Path: string | null;
  File_Name: string | null;
  File_Type: string | null;
  Size_Bytes: number | null;
  Plant_Id: string | null;
  Status: string | null;
  Excluded: boolean | null;
  Description: string | null;
}

function fileExt(doc: BinaryDoc): string {
  return (doc.File_Type || doc.File_Name?.split('.').pop() || '').toLowerCase();
}

function docUrl(doc: BinaryDoc): string {
  if (!doc.File_Path) return '';
  const encode = (p: string) => p.split('/').map(s => encodeURIComponent(s)).join('/');
  return `/content-files/${encode(doc.File_Path.replace(/^content\//, ''))}`;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface DocRowProps {
  doc: BinaryDoc;
  onAssign: (doc: BinaryDoc, plant: PlantSuggestion) => void;
  onHide: (doc: BinaryDoc) => void;
  onDelete: (doc: BinaryDoc) => void;
}

function DocRow({ doc, onAssign, onHide, onDelete }: DocRowProps) {
  const [showAssign, setShowAssign] = useState(false);
  const ext = fileExt(doc);
  const badgeColor = EXT_COLORS[ext] || 'bg-gray-500';
  const name = doc.File_Name || doc.File_Path?.split('/').pop() || `doc_${doc.Id}`;

  return (
    <div className="flex items-center gap-3 py-2 px-3 border-b last:border-0 hover:bg-muted/40">
      {/* File type badge */}
      <span className={`${badgeColor} text-white text-[10px] font-bold px-1.5 py-0.5 rounded uppercase min-w-[30px] text-center`}>
        {ext || '?'}
      </span>

      {/* Name + metadata */}
      <div className="flex-1 min-w-0">
        <a
          href={docUrl(doc)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium hover:underline truncate block"
          title={doc.File_Path || ''}
        >
          {name}
        </a>
        <div className="text-xs text-muted-foreground flex gap-2">
          {doc.Plant_Id && <span className="text-blue-600">→ {doc.Plant_Id}</span>}
          {doc.Size_Bytes && <span>{formatBytes(doc.Size_Bytes)}</span>}
          {doc.Status && <Badge variant="outline" className="text-[10px] py-0 h-4">{doc.Status}</Badge>}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {showAssign ? (
          <div className="w-52">
            <PlantAutocomplete
              value={null}
              onChange={(plant) => {
                if (plant) { onAssign(doc, plant); setShowAssign(false); }
              }}
              placeholder="Choose plant…"
            />
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setShowAssign(true)}>
            Assign
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => onHide(doc)} title="Hide">
          Hide
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onDelete(doc)} title="Delete record">
          Del
        </Button>
      </div>
    </div>
  );
}

type FilterStatus = 'triage' | 'assigned' | 'hidden' | 'all';

export function DocumentsTab() {
  const [docs, setDocs] = useState<BinaryDoc[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<FilterStatus>('triage');
  const LIMIT = 50;

  const fetchPage = useCallback((off: number, st: FilterStatus) => {
    setIsLoading(true);
    const params = new URLSearchParams({ limit: String(LIMIT), offset: String(off) });
    if (st !== 'all') params.set('status', st);
    fetch(`/api/browse/binary-documents?${params}`, { credentials: 'include' })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        setDocs(data.list || []);
        setTotalRows(data.pageInfo?.totalRows ?? 0);
        setOffset(off);
      })
      .catch((e) => toast.error(`Failed to load documents: ${e.message}`))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => { fetchPage(0, status); }, [fetchPage, status]);

  const handleAssign = useCallback(async (doc: BinaryDoc, plant: PlantSuggestion) => {
    try {
      const r = await fetch(`/api/browse/binary-documents/${doc.Id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ plant_id: plant.slug }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast.success(`Assigned to ${plant.name}`);
      fetchPage(offset, status);
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
    }
  }, [offset, status, fetchPage]);

  const handleHide = useCallback(async (doc: BinaryDoc) => {
    try {
      const r = await fetch(`/api/browse/binary-documents/${doc.Id}/hide`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!r.ok) throw new Error(await r.text());
      toast.success('Document hidden');
      fetchPage(offset, status);
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
    }
  }, [offset, status, fetchPage]);

  const handleDelete = useCallback(async (doc: BinaryDoc) => {
    try {
      const r = await fetch(`/api/browse/binary-documents/${doc.Id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!r.ok) throw new Error(await r.text());
      toast.success('Record deleted');
      setDocs(prev => prev.filter(d => d.Id !== doc.Id));
      setTotalRows(prev => prev - 1);
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
    }
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="shrink-0 border-b px-3 py-2 flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Status:</span>
        {(['triage', 'assigned', 'hidden', 'all'] as FilterStatus[]).map(s => (
          <Button
            key={s}
            size="sm"
            variant={status === s ? 'default' : 'outline'}
            onClick={() => setStatus(s)}
            className="capitalize h-7 text-xs"
          >
            {s}
          </Button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {isLoading ? 'Loading…' : `${totalRows} documents`}
        </span>
      </div>

      {/* Document list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : docs.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            No documents with status "{status}"
          </div>
        ) : (
          <div>
            {docs.map(doc => (
              <DocRow
                key={doc.Id}
                doc={doc}
                onAssign={handleAssign}
                onHide={handleHide}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {!isLoading && totalRows > LIMIT && (
        <div className="shrink-0 border-t px-3 py-2 flex items-center justify-between">
          <Button
            size="sm"
            variant="outline"
            disabled={offset === 0}
            onClick={() => fetchPage(Math.max(0, offset - LIMIT), status)}
          >
            ← Prev
          </Button>
          <span className="text-xs text-muted-foreground">
            {offset + 1}–{Math.min(offset + LIMIT, totalRows)} of {totalRows}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={offset + LIMIT >= totalRows}
            onClick={() => fetchPage(offset + LIMIT, status)}
          >
            Next →
          </Button>
        </div>
      )}
    </div>
  );
}
