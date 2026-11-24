import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { base44 } from "@/api/cloudflareClient";
import { RecordDetail } from "@/components/shopping/RecordDetail";

export const Route = createFileRoute("/_authed/record/$recordId")({
  head: () => ({ meta: [{ title: "Shopping Record · Shopping Hisab" }] }),
  component: RecordPage,
});

function RecordPage() {
  const { recordId } = Route.useParams();
  const navigate = useNavigate();
  const returnToHistory = () => window.location.replace("/history");
  const [record, setRecord] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    base44.entities.ShoppingRecord.get(recordId)
      .then((r) => !cancelled && setRecord(r))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [recordId]);

  if (error) {
    return (
      <div className="rounded-[24px] border border-border px-5 py-10 text-center">
        <p className="text-sm font-semibold">This shopping record was not found</p>
        <button
          type="button"
          onClick={() => navigate({ to: "/history" })}
          className="mt-4 rounded-full bg-primary px-5 py-2.5 text-[13px] font-bold text-primary-foreground"
        >
          Back to history
        </button>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-[190px] rounded-[28px] bg-muted" />
        <div className="h-64 rounded-[24px] bg-muted" />
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate({ to: "/history" })}
        className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> History
      </button>
      <RecordDetail record={record} onDeleted={returnToHistory} />
    </div>
  );
}