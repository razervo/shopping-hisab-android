import { Link } from "@tanstack/react-router";
import { BarChart3, History, Home, ShoppingBag } from "lucide-react";

const items = [
  { to: "/", label: "Home", icon: Home },
  { to: "/sessions", label: "Plan Trip", icon: ShoppingBag },
  { to: "/history", label: "Past Purchase", icon: History },
  { to: "/reports", label: "Summary", icon: BarChart3 },
];

function NavItem({ to, label, icon: Icon }) {
  return (
    <Link to={to} className="group flex min-h-[58px] flex-1 flex-col items-center justify-center gap-1 py-2 text-muted-foreground transition-colors duration-200"
      activeProps={{ className: "text-primary" }} activeOptions={{ exact: to === "/" }}>
      {({ isActive }) => (<><Icon className="h-[22px] w-[22px] transition-transform duration-200 group-active:scale-90" strokeWidth={isActive ? 2.4 : 1.9} /><span className="text-[10.5px] font-semibold tracking-wide">{label}</span></>)}
    </Link>
  );
}

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t-[1.5px] border-[#450A0A] bg-white/95 shadow-[0_-6px_24px_-18px_rgba(15,23,42,0.2)] backdrop-blur-md">
      <div className="mx-auto flex max-w-2xl items-stretch px-2 pb-[max(env(safe-area-inset-bottom),4px)]">
        {items.map(item => <NavItem key={item.to} {...item} />)}
      </div>
    </nav>
  );
}
