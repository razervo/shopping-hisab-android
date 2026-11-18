import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Keyboard, ScanLine } from "lucide-react";

export const Route = createFileRoute("/_authed/add/")({
  head: () => ({ meta: [{ title: "Add Shopping · Shopping Hisab" }] }),
  component: AddChoice,
});

function AddChoice() {
  return (
    <div className="pb-2">
      <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">Add shopping</h1>
      <p className="mt-1 text-[13.5px] text-muted-foreground">
        Upload your list before shopping, estimate the cost, then add the actual prices before saving.
      </p>

      <div className="mt-5 space-y-3.5">
        <Link
          to="/add/bill"
          className="group flex items-center gap-4 rounded-[26px] bg-primary p-5 text-primary-foreground shadow-[0_18px_36px_-24px_rgba(11,60,40,0.9)] transition-transform duration-200 active:scale-[0.99]"
        >
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15">
            <ScanLine className="h-7 w-7" strokeWidth={2.2} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16.5px] font-extrabold">Upload shopping list</span>
            <span className="mt-0.5 block text-[12.5px] leading-snug text-white/70">
              Import item names first, estimate prices, then update actual shop rates
            </span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-white/60" />
        </Link>

        <Link
          to="/add/manual"
          className="group flex items-center gap-4 rounded-[26px] border border-border bg-white p-5 transition-colors hover:bg-secondary/50"
        >
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
            <Keyboard className="h-7 w-7" strokeWidth={2} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16.5px] font-extrabold">Enter manually</span>
            <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">
              Add items, quantity and price one by one
            </span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
        </Link>
      </div>

      <div className="mt-6 rounded-[22px] bg-secondary/50 px-5 py-4">
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          <span className="font-bold text-foreground">Tip:</span> fill the bill in good light and keep the
          whole receipt inside the frame for the best read.
        </p>
      </div>
    </div>
  );
}