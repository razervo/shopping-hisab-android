import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { LogOut, ShoppingBasket, UserRound } from "lucide-react";
import { BottomNav } from "@/components/layout/BottomNav";
import { useAuth } from "@/lib/AuthContext";

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const firstName = (user?.display_name || user?.full_name || "").trim().split(" ")[0];

  const handleLogout = async () => {
    await logout();
    navigate({ to: "/login" });
  };

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-5">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ShoppingBasket className="h-[18px] w-[18px]" strokeWidth={2.2} />
            </span>
            <span className="leading-tight">
              <span className="block text-[15px] font-extrabold tracking-tight">Shopping Hisab</span>
              <span className="block text-[11px] font-medium text-muted-foreground">
                Your Daily Shopping Account
              </span>
            </span>
          </Link>
          <div className="flex items-center gap-1">
            {firstName ? (
              <span className="hidden text-xs font-semibold text-muted-foreground sm:block">
                {firstName}
              </span>
            ) : null}
            <Link
              to="/profile"
              aria-label="Open your profile"
              title="Profile"
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <UserRound className="h-4 w-4" />
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Sign out"
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pb-32 pt-5 sm:px-5">
        <Outlet />
      </main>

      <BottomNav />
    </div>
  );
}