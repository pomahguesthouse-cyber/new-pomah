import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";
import { getDashboardOverview } from "@/lib/dashboard.functions";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/admin/ai")({
  component: AiPage,
});

function AiPage() {
  const fn = useServerFn(getDashboardOverview);
  const { data } = useQuery({ queryKey: ["dashboard"], queryFn: () => fn() });
  useRealtimeInvalidate(
    "admin-ai-stream",
    ["ai_suggestions", "ai_conversation_logs"],
    [["dashboard"]],
  );
  const suggestions = data?.suggestions ?? [];

  return (
    <div className="space-y-6 p-6 md:p-10">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">Manager Assistant</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">AI Suggestions</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Insights surfaced by the AI front office: revenue opportunities, operational nudges, guest sentiment.
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {suggestions.map((s) => (
          <Card key={s.id} className="p-5">
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 h-4 w-4 text-accent" />
              <div className="flex-1">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{s.kind}</p>
                <h3 className="mt-1 font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
              </div>
            </div>
          </Card>
        ))}
        {suggestions.length === 0 && <p className="text-sm text-muted-foreground">No suggestions yet.</p>}
      </div>
    </div>
  );
}
