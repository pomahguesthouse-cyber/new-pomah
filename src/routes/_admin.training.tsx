import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ThumbsUp, ThumbsDown, Download } from "lucide-react";
import {
  listConversationLogs,
  rateConversationLog,
  exportTrainingData,
} from "@/admin/modules/training/training.functions";
import { useRealtimeInvalidate } from "@/admin/hooks/use-realtime-invalidate";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { formatDateTimeID } from "@/lib/utils";

export const Route = createFileRoute("/_admin/training")({
  component: TrainingPage,
});

type Filter = "all" | "good" | "bad" | "unrated";

function TrainingPage() {
  const fn = useServerFn(listConversationLogs);
  const rate = useServerFn(rateConversationLog);
  const exp = useServerFn(exportTrainingData);
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const { data } = useQuery({
    queryKey: ["ai-logs", filter],
    queryFn: () => fn({ data: { rating: filter } }),
  });
  useRealtimeInvalidate("admin-training-stream", ["ai_conversation_logs"], [["ai-logs"]]);

  const m = useMutation({
    mutationFn: (v: { id: string; rating: "good" | "bad" | null; correction?: string | null }) =>
      rate({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-logs"] }),
  });

  const handleExport = async () => {
    const { rows } = await exp();
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pomah-training-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8 p-6 md:p-10">
      <header className="flex items-end justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Conversation logs
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">AI training data</h1>
        </div>
        <Button variant="outline" onClick={handleExport}>
          <Download className="mr-2 h-4 w-4" /> Export labelled
        </Button>
      </header>

      <div className="flex gap-2">
        {(["all", "unrated", "good", "bad"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-md border px-3 py-1 font-mono text-xs uppercase tracking-widest ${
              filter === f
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {(data?.logs ?? []).map((l) => (
          <LogRow
            key={l.id}
            id={l.id}
            user_message={l.user_message}
            ai_response={l.ai_response}
            rating={l.rating as "good" | "bad" | null}
            correction={l.correction}
            created_at={l.created_at}
            onRate={(rating, correction) => m.mutate({ id: l.id, rating, correction })}
          />
        ))}
        {(data?.logs ?? []).length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No conversations yet. Ask the AI for a draft in the WhatsApp inbox to populate this.
          </p>
        )}
      </div>
    </div>
  );
}

function LogRow({
  id,
  user_message,
  ai_response,
  rating,
  correction,
  created_at,
  onRate,
}: {
  id: string;
  user_message: string | null;
  ai_response: string;
  rating: "good" | "bad" | null;
  correction: string | null;
  created_at: string;
  onRate: (r: "good" | "bad" | null, correction?: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(correction ?? "");
  void id;
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {user_message && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Guest
              </p>
              <p className="mt-1 text-sm">{user_message}</p>
            </div>
          )}
          <div className="mt-3 border-l-2 border-accent pl-3">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              AI draft
            </p>
            <p className="mt-1 text-sm">{ai_response}</p>
          </div>
          {correction && (
            <div className="mt-3">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Correction
              </p>
              <p className="mt-1 text-sm text-foreground">{correction}</p>
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <p className="font-mono text-[10px] text-muted-foreground">
            {formatDateTimeID(created_at)}
          </p>
          {rating && (
            <Badge variant={rating === "good" ? "default" : "destructive"}>{rating}</Badge>
          )}
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={rating === "good" ? "default" : "outline"}
              onClick={() => onRate("good")}
            >
              <ThumbsUp className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant={rating === "bad" ? "destructive" : "outline"}
              onClick={() => {
                onRate("bad");
                setEditing(true);
              }}
            >
              <ThumbsDown className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
      {editing && (
        <div className="mt-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What should the AI have said?"
            rows={2}
          />
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                onRate("bad", text);
                setEditing(false);
              }}
            >
              Save correction
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
