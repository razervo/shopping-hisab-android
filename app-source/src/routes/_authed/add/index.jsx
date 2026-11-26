import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Keyboard, ScanLine, ShoppingBag } from "lucide-react";

export const Route = createFileRoute("/_authed/add/")({
  head: () => ({ meta: [{ title: "Add Shopping · Shopping Hisab" }] }),
  component: AddChoice,
});

function AddChoice() {
  return (
    <div className="pb-5">
      <p className="micro inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-primary">SHOPPING HISAB</p>
      <h1 className="mt-2 text-[24px] font-extrabold leading-tight tracking-tight">Add shopping</h1>
      <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">
        Planning a new trip? Keep your list, cost estimate and shop bills together in one place.
      </p>
      <Link
        to="/sessions"
        className="mt-5 flex items-center gap-4 rounded-[26px] bg-primary p-5 text-primary-foreground shadow-[0_18px_36px_-24px_rgba(11,60,40,0.9)]"
      >
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15">
          <ShoppingBag className="h-7 w-7" strokeWidth={2.2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16.5px] font-extrabold">Plan a shopping trip</span>
          <span className="mt-0.5 block text-[12.5px] leading-snug text-white/75">
            Make a list → estimate cost → shop → check your bills
          </span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-white/60" />
      </Link>

      <p className="mt-6 text-[11.5px] font-bold text-muted-foreground">ALREADY FINISHED SHOPPING?</p>
      <div className="mt-3 space-y-3.5">
        <Link
          to="/add/bill"
          className="group flex items-center gap-4 rounded-[24px] border border-border/80 bg-card p-4 shadow-[0_8px_24px_-18px_hsl(var(--foreground)/0.24)] transition-all hover:border-primary/20 hover:bg-secondary/40"
        >
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
            <ScanLine className="h-7 w-7" strokeWidth={2.2} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16.5px] font-extrabold">Import a shopping list</span>
            <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">
              Read item names from a photo and add prices
            </span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
        </Link>

        <Link
          to="/add/manual"
          className="group flex items-center gap-4 rounded-[24px] border border-border/80 bg-card p-4 shadow-[0_8px_24px_-18px_hsl(var(--foreground)/0.24)] transition-all hover:border-primary/20 hover:bg-secondary/40"
        >
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
            <Keyboard className="h-7 w-7" strokeWidth={2} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16.5px] font-extrabold">Record a past purchase</span>
            <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">
              Enter the items and amount yourself
            </span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
        </Link>
      </div>

      <div className="mt-6 rounded-[22px] border border-border/70 bg-secondary/45 px-4 py-3.5">
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          <span className="font-bold text-foreground">Tip:</span> For clearer list scanning, use good light and keep the whole page inside the frame.
        </p>
      </div>
    </div>
  );
}
