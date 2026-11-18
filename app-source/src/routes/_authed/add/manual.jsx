import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/cloudflareClient";
import { RecordForm } from "@/components/shopping/RecordForm";
import { buildPayload } from "@/lib/shopping";
import { clearDraft } from "@/lib/draft";

export const Route = createFileRoute("/_authed/add/manual")({
  head: () => ({ meta: [{ title: "Manual Entry · Shopping Hisab" }] }),
  component: AddManualPage,
});

function AddManualPage() {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);

  const save = async (values) => {
    setSaving(true);
    try {
      const payload = buildPayload({ ...values, source: "manual" });
      const created = await base44.entities.ShoppingRecord.create(payload);
      clearDraft();
      toast.success("Shopping saved");
      navigate({ to: "/record/$recordId", params: { recordId: created.id } });
    } catch {
      toast.error("Could not save this shopping. Please try again.");
      setSaving(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate({ to: "/add" })}
        className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Add shopping
      </button>

      <h1 className="text-[24px] font-extrabold leading-tight tracking-tight">Manual entry</h1>
      <p className="mb-4 mt-1 text-[13.5px] text-muted-foreground">
        Quantity × price is calculated for you, and the grand total updates as you type.
      </p>

      <RecordForm submitLabel="Save shopping" saving={saving} onSave={save} footerNote="Added manually" />
    </div>
  );
}