import { Link } from "@tanstack/react-router";
import { BarChart3, History, Home, Plus } from "lucide-react";

const left = [
  { to: "/", label: "Home", icon: Home },
  { to: "/history", label: "My shopping", icon: History },
];

const right = [{ to: "/reports", label: "Summary", icon: BarChart3 }];

function NavItem({ to, label, icon: Icon }) {
  return (
    <Link
      to={to}
      className="group flex flex-1 flex-col items-center justify-center gap-1 py-2 text-muted-foreground transition-colors duration-200"
      activeProps={{ className: "text-primary" }}
      activeOptions={{ exact: to === "/" }}
    >
      {({ isActive }) => (
        <>
          <Icon
            className="h-[22px] w-[22px] transition-transform duration-200 group-active:scale-90"
            strokeWidth={isActive ? 2.4 : 1.9}
          />
          <span className="text-[10.5px] font-semibold tracking-wide">{label}</span>
        </>
      )}
    </Link>
  );
}

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-2xl items-stretch px-2 pb-[env(safe-area-inset-bottom)]">
        {left.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}

        <div className="flex w-[74px] items-start justify-center">
          <Link
            to="/sessions"
            aria-label="Start a shopping trip"
            title="Start a shopping trip"
            className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_10px_24px_-8px_rgba(16,88,58,0.65)] transition-transform duration-200 active:scale-95"
            activeProps={{ className: "ring-4 ring-accent" }}
          >
            <Plus className="h-7 w-7" strokeWidth={2.6} />
          </Link>
        </div>

        {right.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </div>
    </nav>
  );
}
