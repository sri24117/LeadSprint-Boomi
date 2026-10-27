import { Link } from 'wouter';
import { AlertCircle } from 'lucide-react';
import { Button, PageHeader, Section } from '@/components/common';

export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center bg-[hsl(var(--background))] px-5">
      <Section className="w-full max-w-md p-6">
        <div className="flex mb-4 gap-2">
          <AlertCircle className="h-6 w-6 text-[hsl(var(--destructive))]" />
          <h1 className="text-xl font-bold text-[hsl(var(--foreground))]">
            404 Page not found
          </h1>
        </div>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          This desk view does not exist.
        </p>
        <div className="mt-6">
          <Link href="/workspace" className="text-xs font-bold text-[hsl(var(--primary))] hover:underline">
            Return to dashboard
          </Link>
        </div>
      </Section>
    </div>
  );
}
