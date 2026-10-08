import {
  ChevronRight,
  Download,
  ExternalLink,
  LogOut,
  Moon,
  MoreHorizontal,
  Sun,
} from "lucide-react";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { useInstallApp } from "@/hooks/useInstallApp";
import { cn } from "@/lib/utils";
import { ADMIN_TABS, BAR_TABS, type AdminTab } from "./adminTabs";

const itemClass =
  "flex flex-1 flex-col items-center justify-center gap-1 min-h-[52px] pt-1.5 font-body text-[10px] tracking-[0.04em] select-none active:opacity-60 transition-colors";

/** Phone-only tab bar fixed to the bottom of the screen, like a native app's. */
export const BottomTabBar = ({
  tab,
  onSelect,
  onMore,
  badges,
}: {
  tab: AdminTab;
  onSelect: (tab: AdminTab) => void;
  onMore: () => void;
  badges: Partial<Record<AdminTab, number>>;
}) => {
  const moreActive = !BAR_TABS.includes(tab);
  return (
    <nav
      aria-label="Dashboard sections"
      className="sm:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 pb-[env(safe-area-inset-bottom)]"
    >
      <div className="flex px-[env(safe-area-inset-left)]">
        {ADMIN_TABS.filter((t) => BAR_TABS.includes(t.value)).map(({ value, label, icon: Icon }) => {
          const active = tab === value;
          const badge = badges[value] ?? 0;
          return (
            <button
              key={value}
              type="button"
              onClick={() => onSelect(value)}
              aria-current={active ? "page" : undefined}
              aria-label={badge > 0 ? `${label} (${badge})` : undefined}
              className={cn(itemClass, active ? "text-foreground" : "text-muted-foreground")}
            >
              <span className="relative">
                <Icon className="w-[22px] h-[22px]" strokeWidth={active ? 2.2 : 1.6} />
                {badge > 0 && (
                  <span aria-hidden className="absolute -top-1.5 -right-2.5 min-w-[17px] h-[17px] px-1 rounded-full bg-foreground text-background text-[10px] leading-[17px] text-center font-medium">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </span>
              {label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onMore}
          aria-current={moreActive ? "page" : undefined}
          className={cn(itemClass, moreActive ? "text-foreground" : "text-muted-foreground")}
        >
          <MoreHorizontal className="w-[22px] h-[22px]" strokeWidth={moreActive ? 2.2 : 1.6} />
          More
        </button>
      </div>
    </nav>
  );
};

const rowClass =
  "w-full flex items-center gap-3 px-4 min-h-[52px] font-body text-[14px] text-left active:bg-muted transition-colors";

/** Phone-only sheet behind "More": the remaining sections plus account actions. */
export const MoreDrawer = ({
  open,
  onOpenChange,
  tab,
  onSelect,
  theme,
  onToggleTheme,
  onSignOut,
  badges,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: AdminTab;
  onSelect: (tab: AdminTab) => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onSignOut: () => void;
  badges: Partial<Record<AdminTab, number>>;
}) => {
  const install = useInstallApp();
  const pick = (t: AdminTab) => {
    onSelect(t);
    onOpenChange(false);
  };
  return (
    <Drawer open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
      <DrawerContent className="pb-[calc(env(safe-area-inset-bottom)+8px)]">
        <DrawerTitle className="sr-only">More</DrawerTitle>
        <div className="mt-3 divide-y divide-border border-y border-border">
          {ADMIN_TABS.filter((t) => !BAR_TABS.includes(t.value)).map(({ value, label, icon: Icon }) => (
            <button key={value} type="button" className={rowClass} onClick={() => pick(value)}>
              <Icon className="w-5 h-5 text-muted-foreground" strokeWidth={1.6} />
              <span className={cn("flex-1", tab === value && "font-medium")}>{label}</span>
              {(badges[value] ?? 0) > 0 && (
                <span className="font-body text-[12px] text-muted-foreground">{badges[value]}</span>
              )}
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          ))}
        </div>
        <div className="mt-3 divide-y divide-border border-y border-border">
          <a href={import.meta.env.BASE_URL} target="_blank" rel="noopener noreferrer" className={rowClass}>
            <ExternalLink className="w-5 h-5 text-muted-foreground" strokeWidth={1.6} />
            <span className="flex-1">View live site</span>
          </a>
          <button type="button" className={rowClass} onClick={onToggleTheme}>
            {theme === "dark" ? (
              <Sun className="w-5 h-5 text-muted-foreground" strokeWidth={1.6} />
            ) : (
              <Moon className="w-5 h-5 text-muted-foreground" strokeWidth={1.6} />
            )}
            <span className="flex-1">{theme === "dark" ? "Light mode" : "Dark mode"}</span>
          </button>
          {install.canInstall && (
            <button type="button" className={rowClass} onClick={install.install}>
              <Download className="w-5 h-5 text-muted-foreground" strokeWidth={1.6} />
              <span className="flex-1">Install as an app</span>
            </button>
          )}
          <button type="button" className={rowClass} onClick={onSignOut}>
            <LogOut className="w-5 h-5 text-muted-foreground" strokeWidth={1.6} />
            <span className="flex-1">Sign out</span>
          </button>
        </div>
        {install.ios && (
          <p className="px-4 pt-3 font-body text-[12px] text-muted-foreground leading-relaxed">
            Use this like an app: tap Share, then “Add to Home Screen”. It opens straight to your dashboard, full screen.
          </p>
        )}
      </DrawerContent>
    </Drawer>
  );
};
