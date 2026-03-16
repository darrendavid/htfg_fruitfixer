import { useState, useEffect } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { CompletionLogRow } from '@/types/api';

export function CompletionLog() {
  const [rows, setRows] = useState<CompletionLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ action: '', date_from: '', date_to: '' });
  const limit = 50;

  async function loadLog() {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (filters.action) params.set('action', filters.action);
    if (filters.date_from) params.set('date_from', filters.date_from);
    if (filters.date_to) params.set('date_to', filters.date_to);
    try {
      const res = await fetch(`/api/admin/log?${params}`, { credentials: 'include' });
      const data = await res.json();
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
    } catch {}
  }

  useEffect(() => { loadLog(); }, [page, filters]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <Select value={filters.action || 'all'} onValueChange={v => { setFilters(f => ({ ...f, action: v === 'all' ? '' : v })); setPage(1); }}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="All actions" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {['confirm', 'reject', 'classify', 'discard', 'idk'].map(a => (
              <SelectItem key={a} value={a}>{a}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="date" className="h-8 text-xs w-36" value={filters.date_from}
          onChange={e => { setFilters(f => ({ ...f, date_from: e.target.value })); setPage(1); }} />
        <Input type="date" className="h-8 text-xs w-36" value={filters.date_to}
          onChange={e => { setFilters(f => ({ ...f, date_to: e.target.value })); setPage(1); }} />
      </div>

      <ScrollArea className="h-[400px]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Thumb</TableHead>
              <TableHead>Image Path</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Reviewer</TableHead>
              <TableHead>Plant</TableHead>
              <TableHead>Timestamp</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  {row.thumbnail_path && (
                    <img
                      src={`/thumbnails/${row.thumbnail_path}`}
                      alt=""
                      className="w-12 h-12 object-cover rounded"
                    />
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs max-w-[200px] truncate">{row.image_path}</TableCell>
                <TableCell><span className="capitalize">{row.action}</span></TableCell>
                <TableCell>{row.reviewer_name}</TableCell>
                <TableCell className="text-xs">{row.plant_id ?? '—'}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(row.decided_at).toLocaleString()}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No records found</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </ScrollArea>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{total} total</span>
        <div className="flex gap-2 items-center">
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</Button>
          <span>{page} / {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</Button>
        </div>
      </div>
    </div>
  );
}
