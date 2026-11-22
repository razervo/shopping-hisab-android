import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Camera, ClipboardList, Plus, ReceiptText, ShoppingBag, Sparkles } from "lucide-react";
import { RecentRecords } from "@/components/dashboard/RecentRecords";
import { useOverview } from "@/components/dashboard/useOverview";
import { inr } from "@/lib/format";

export const Route = createFileRoute("/_authed/")({
  head: () => ({ meta: [{ title: "Home · Shopping Hisab" }] }),
  component: HomePage,
});

function HomePage() {
  const { loading, overview } = useOverview();

  return (
    <div className="pb-4">
      <section className="mb-5">
        <p className="micro text-primary">YOUR SHOPPING COMPANION</p>
        <h1 className="mt-2 max-w-[19ch] text-[29px] font-extrabold leading-[1.12] tracking-tight">
          What are we shopping for today?
        </h1>
        <p className="mt-2 max-w-[34ch] text-[13.5px] leading-relaxed text-muted-foreground">
          Make a list, get an idea of the cost, and keep everything together while you shop.
        </p>
      </section>

      <section className="animate-fade-up overflow-hidden rounded-[30px] bg-primary px-5 py-6 text-primary-foreground shadow-[0_18px_40px_-28px_rgba(11,60,40,0.9)]">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15">
          <Sparkles className="h-5 w-5" />
        </div>
        <p className="micro mt-5 text-white/65">LET'S GET READY</p>
        <h2 className="mt-2 text-[21px] font-extrabold leading-tight">
          Your next shopping trip starts here
        </h2>
        <p className="mt-2 max-w-[34ch] text-[12.5px] leading-relaxed text-white/75">
          Add everything you need. Your assistant will help organise the list and estimate the cost before you go.
        </p>
        <Link
          to="/sessions"
          className="mt-5 flex min-h-12 items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-[14px] font-extrabold text-primary transition-transform active:scale-[0.99]"
        >
          <ShoppingBag className="h-[18px] w-[18px]" />
          Start a shopping trip
          <ArrowRight className="h-4 w-4" />
        </Link>
      </section>

      <section className="mt-5">
        <div className="mb-2 px-1">
          <h2 className="text-[14px] font-extrabold">Need to add something else?</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">Quick actions for shopping you've already done.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Link
            to="/add/bill"
            className="flex min-h-[116px] flex-col items-start justify-between rounded-[22px] border border-border bg-white p-4 transition-colors hover:bg-secondary/40 active:scale-[0.99]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <Camera className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-[13px] font-extrabold">Add a bill</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">Save a receipt from a purchase</span>
            </span>
          </Link>
          <Link
            to="/add/manual"
            className="flex min-h-[116px] flex-col items-start justify-between rounded-[22px] border border-border bg-white p-4 transition-colors hover:bg-secondary/40 active:scale-[0.99]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <ClipboardList className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-[13px] font-extrabold">Enter a purchase</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">Add details yourself</span>
            </span>
          </Link>
        </div>
      </section>

      {loading ? (
        <div className="mt-5 h-[88px] animate-pulse rounded-[22px] bg-muted" />
      ) : overview ? (
        <section className="mt-5 flex items-center gap-3 rounded-[22px] border border-border bg-white px-4 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
            <ReceiptText className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-muted-foreground">Your shopping this month</p>
            <p className="tnum mt-0.5 text-[20px] font-extrabold">{inr(overview.monthTotal)}</p>
          </div>
          <Link to="/history" className="inline-flex shrink-0 items-center gap-1 text-[12px] font-bold text-primary">
            My shopping <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </section>
      ) : null}

      {overview ? (
        <RecentRecords records={overview.recent} />
      ) : null}
    </div>
  );
}
