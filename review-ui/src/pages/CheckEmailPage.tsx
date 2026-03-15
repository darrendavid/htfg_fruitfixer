import { useSearchParams, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

export function CheckEmailPage() {
  const [params] = useSearchParams();
  const email = params.get('email') ?? 'your inbox';
  const error = params.get('error');

  if (error === 'expired') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <Card className="w-full max-w-sm text-center">
          <CardHeader>
            <div className="text-5xl mb-2">⚠️</div>
            <CardTitle>Link Expired</CardTitle>
            <CardDescription>
              This login link has expired or already been used. Request a new one.
            </CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Link to="/login">
              <Button>Request New Link</Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

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
          <Link to="/login">
            <Button variant="outline">Back to Login</Button>
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
