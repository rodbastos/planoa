import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  Briefcase,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Scale,
  Sun,
  Target,
  TrendingUp,
  Upload,
  X,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useAuth } from "../../hooks/useAuth";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/carteira", label: "Carteira Atual", icon: Briefcase },
  { to: "/carteira-ideal", label: "Alocação Alvo", icon: Target },
  { to: "/rebalanceamento", label: "Rebalanceamento", icon: Scale },
  { to: "/simulacao", label: "Simulação", icon: TrendingUp },
  { to: "/importar", label: "Importar", icon: Upload },
  { to: "/historico", label: "Histórico", icon: History },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

function useTheme() {
  const [dark, setDark] = useState(
    () => localStorage.getItem("planoa-theme") === "dark",
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("planoa-theme", dark ? "dark" : "light");
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

function SidebarContent({
  onNavigate,
  collapsed = false,
  onToggleCollapse,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div
        className={cn(
          "flex items-center gap-3 px-5 py-5",
          collapsed && "justify-center px-0",
        )}
      >
        <img src="/logo-mark.png" alt="Plano A" className="h-9 w-9 object-contain" />
        {!collapsed && (
          <div>
            <p className="text-base font-bold text-white leading-tight">Plano A</p>
            <p className="text-[11px] text-sidebar-foreground/70">
              Gestão de investimentos
            </p>
          </div>
        )}
      </div>

      <nav className="mt-2 flex-1 space-y-1 px-3">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                collapsed && "justify-center px-0",
                isActive
                  ? "bg-white/10 text-white"
                  : "text-sidebar-foreground hover:bg-white/5 hover:text-white",
              )
            }
          >
            <Icon className="h-4.5 w-4.5 shrink-0" />
            {!collapsed && label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-white/10 p-3">
        <button
          onClick={toggle}
          title={collapsed ? (dark ? "Modo claro" : "Modo escuro") : undefined}
          className={cn(
            "mb-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground hover:bg-white/5 hover:text-white cursor-pointer",
            collapsed && "justify-center px-0",
          )}
        >
          {dark ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
          {!collapsed && (dark ? "Modo claro" : "Modo escuro")}
        </button>
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
            className={cn(
              "mb-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground hover:bg-white/5 hover:text-white cursor-pointer",
              collapsed && "justify-center px-0",
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4.5 w-4.5" />
            ) : (
              <PanelLeftClose className="h-4.5 w-4.5" />
            )}
            {!collapsed && "Recolher menu"}
          </button>
        )}
        <div
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2",
            collapsed && "flex-col px-0",
          )}
        >
          {user?.photoURL ? (
            <img src={user.photoURL} alt="" className="h-8 w-8 rounded-full" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
              {user?.displayName?.[0] ?? "?"}
            </div>
          )}
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">
                {user?.displayName ?? "Usuário"}
              </p>
              <p className="truncate text-[11px] text-sidebar-foreground/70">
                {user?.email}
              </p>
            </div>
          )}
          <button
            onClick={logout}
            title="Sair"
            className="rounded-md p-1.5 text-sidebar-foreground hover:bg-white/10 hover:text-white cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppLayout({ children }: { children?: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("planoa-sidebar-collapsed") === "1",
  );

  useEffect(() => {
    localStorage.setItem("planoa-sidebar-collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* sidebar desktop */}
      <aside
        className={cn(
          "hidden shrink-0 transition-all duration-300 lg:block",
          collapsed ? "w-20" : "w-64",
        )}
      >
        <SidebarContent
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
        />
      </aside>

      {/* drawer mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-64">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute -right-10 top-4 rounded-md p-2 text-white"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* topbar mobile */}
        <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 lg:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-2 hover:bg-muted cursor-pointer"
          >
            <Menu className="h-5 w-5" />
          </button>
          <img src="/logo-mark.png" alt="" className="h-7 w-7 object-contain" />
          <span className="font-bold">Plano A</span>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          {children ?? <Outlet />}
        </main>
      </div>
    </div>
  );
}
