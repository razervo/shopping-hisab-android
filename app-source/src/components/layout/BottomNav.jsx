import { Link } from "@tanstack/react-router";
import { BarChart3, History, Home, Plus } from "lucide-react";

const items = [
  { to: "/", label: "Home", icon: Home },
  { to: "/history", label: "My shopping", icon: History },
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
  return (<>
    <Link to="/sessions" aria-label="Start a shopping trip" title="Start a shopping trip" className="fixed bottom-[88px] right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#0F766E] text-white shadow-[0_8px_22px_rgba(15,118,110,0.32)] transition-transform active:scale-95"><Plus className="h-7 w-7" strokeWidth={2.6} /></Link>
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[#3B0A0A] bg-white/95 shadow-[0_-6px_24px_-18px_rgba(15,23,42,0.2)] backdrop-blur-md">
      <div className="mx-auto flex max-w-2xl items-stretch px-2 pb-[max(env(safe-area-inset-bottom),4px)]">{items.map(item => <NavItem key={item.to} {...item} />)}</div>
    </nav>
  </>);
}
