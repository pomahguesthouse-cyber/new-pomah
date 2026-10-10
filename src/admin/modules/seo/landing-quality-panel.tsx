import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, X } from "lucide-react";
import { getLandingQuality } from "@/admin/modules/seo/landing-briefs.functions";
import { FIXTURE_LP_ID, FIXTURE_QUALITY } from "@/admin/modules/seo/builder-fixture";
import { isPbFixtureRequest } from "@/admin/modules/seo/builder-layout";
import type { QualityReport } from "@/public/lib/lp-quality";

export function LandingQualityPanel({
  pageId,
  onState,
}: {
  pageId: string;
  onState: (state: { pass: boolean; loading: boolean }) => void;
}) {
  const fixture = isPbFixtureRequest() && pageId === FIXTURE_LP_ID;
  const reportFn = useServerFn(getLandingQuality);
  const query = useQuery({
    queryKey: ["lp-quality", pageId],
    queryFn: () => reportFn({ data: { pageId } }) as Promise<QualityReport>,
    refetchOnWindowFocus: false,
    enabled: !fixture,
  });

  useEffect(() => {
    if (fixture) {
      onState({ pass: FIXTURE_QUALITY.pass, loading: false });
      return;
    }
    onState({ pass: query.data?.pass === true, loading: query.isLoading });
  }, [fixture, onState, query.data?.pass, query.isLoading]);

  if (fixture) return <QualityChecklist report={FIXTURE_QUALITY} />;

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
  return <QualityChecklist report={report} />;
}

function QualityChecklist({ report }: { report: QualityReport }) {
  return (
    <div className="space-y-2 rounded-lg border border-border px-3 py-2.5">
      <p className="text-xs font-medium">Checklist sebelum publikasi</p>
      <ul className="space-y-1.5">
        {report.checks.map((check) => (
          <li key={check.id} className="flex items-start gap-2 text-xs leading-snug">
            {check.pass ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            ) : (
              <X className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            )}
            <span className="min-w-0 break-words">
              <span className="font-medium">{check.label}.</span> {check.detail}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
