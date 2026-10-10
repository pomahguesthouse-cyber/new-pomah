import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, X } from "lucide-react";
import { getLandingQuality } from "@/admin/modules/seo/landing-briefs.functions";
import type { QualityReport } from "@/public/lib/lp-quality";

export function LandingQualityPanel({
  pageId,
  onState,
}: {
  pageId: string;
  onState: (state: { pass: boolean; loading: boolean }) => void;
}) {
  const reportFn = useServerFn(getLandingQuality);
  const query = useQuery({
    queryKey: ["lp-quality", pageId],
    queryFn: () => reportFn({ data: { pageId } }) as Promise<QualityReport>,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    onState({ pass: query.data?.pass === true, loading: query.isLoading });
  }, [onState, query.data?.pass, query.isLoading]);

  if (query.isLoading) {
    return <p className="text-[11px] text-muted-foreground">Memeriksa quality gate…</p>;
  }
  if (query.isError) {
    return (
      <p className="text-[11px] text-amber-800">
        Quality gate belum bisa dihitung. {(query.error as Error).message}
      </p>
    );
  }
  const report = query.data;
  if (!report) return null;
  return (
    <div className="space-y-2 rounded-lg border border-border px-3 py-2.5">
      <p className="text-xs font-medium">Checklist sebelum publikasi</p>
      <ul className="space-y-1.5">
        {report.checks.map((check) => (
          <li key={check.id} className="flex items-start gap-2 text-[11px] leading-snug">
            {check.pass ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
            ) : (
              <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
            )}
            <span>
              <span className="font-medium">{check.label}.</span> {check.detail}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
