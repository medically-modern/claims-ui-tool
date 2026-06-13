import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ExternalLink, RefreshCw, Stethoscope } from "lucide-react";

export function AppHeader({
  title,
  subtitle,
  showBack,
}: {
  title: string;
  subtitle?: string;
  showBack?: boolean;
}) {
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-[1920px] items-start justify-between gap-6 px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="mt-1 grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Stethoscope className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              {showBack && (
                <Link to="/claims" className="text-sm text-muted-foreground hover:text-foreground">
                  ← Queue
                </Link>
              )}
              <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            </div>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <Button variant="outline" size="sm">
            <ExternalLink className="mr-2 h-4 w-4" /> Open Monday Board
          </Button>
        </div>
      </div>
    </header>
  );
}
