import { NavLink } from "react-router-dom";
import { CalendarDays, Settings, Utensils } from "lucide-react";
import { cn } from "@/lib/utils";

const links: {
  to: string;
  label: string;
  icon: typeof Utensils;
  end?: boolean;
}[] = [
  { to: "/", label: "Today", icon: Utensils, end: true },
  { to: "/history", label: "History", icon: CalendarDays },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function BottomNav() {
  return (
    <nav className="bottom-nav bg-background/95 border-border z-40 shrink-0 border-t backdrop-blur">
      <div className="mx-auto flex max-w-lg items-stretch justify-around px-2 pt-2">
        {links.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "text-muted-foreground flex min-w-[4.5rem] flex-col items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                isActive && "text-primary bg-secondary",
              )
            }
          >
            <Icon className="size-5" />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}