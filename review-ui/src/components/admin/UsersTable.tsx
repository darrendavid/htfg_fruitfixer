import { useState, useEffect } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { User } from '@/types/api';

export function UsersTable() {
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    fetch('/api/admin/users', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setUsers(d.users ?? []))
      .catch(() => {});
  }, []);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Last Active</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((u) => (
          <TableRow key={u.id}>
            <TableCell>{u.first_name} {u.last_name}</TableCell>
            <TableCell className="text-sm">{u.email}</TableCell>
            <TableCell>
              <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>{u.role}</Badge>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {u.last_active_at ? new Date(u.last_active_at).toLocaleDateString() : 'Never'}
            </TableCell>
          </TableRow>
        ))}
        {users.length === 0 && (
          <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No users yet</TableCell></TableRow>
        )}
      </TableBody>
    </Table>
  );
}
