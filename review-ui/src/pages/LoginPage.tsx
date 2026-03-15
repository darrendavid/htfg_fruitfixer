import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const isExpiredLink = searchParams.get('error') === 'expired';

  // If sent, show CheckEmailPage inline
  if (sent) {
    return <CheckEmailSent email={email} onResend={() => handleSubmit()} />;
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 404) {
          setError('No account found for this email. Register first?');
        } else {
          setError(data.error || 'Something went wrong');
        }
      } else {
        setSent(true);
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>HTFG Image Review</CardTitle>
          <CardDescription>Enter your email to receive a login link</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {isExpiredLink && (
              <Alert variant="destructive">
                <AlertDescription>
                  This login link has expired or already been used. Request a new one.
                </AlertDescription>
              </Alert>
            )}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Sending...' : 'Send Login Link'}
            </Button>
            <p className="text-sm text-muted-foreground text-center">
              Need an account?{' '}
              <Link to="/register" className="text-foreground underline">
                Register
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

function CheckEmailSent({ email, onResend }: { email: string; onResend: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <div className="text-5xl mb-2">📧</div>
          <CardTitle>Check your email!</CardTitle>
          <CardDescription>
            We sent a login link to <strong>{email}</strong>. The link expires in 15 minutes.
          </CardDescription>
        </CardHeader>
        <CardFooter className="justify-center">
          <Button variant="outline" onClick={onResend}>
            Resend email
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
