import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminThemeStore } from "@/stores/adminThemeStore";

/*
 * Chart ink — resolved from the theme's tokens so charts match the rest of
 * the admin, in both light and dark mode. Contrast verified with the
 * dataviz skill's validator:
 *   light (surface hsl(27 100% 97%)): ink 12.9:1, axis 5.1:1, delta-up 7.1:1, delta-down 4.5:1
 *   dark  (surface hsl(24 35% 9%)):   ink 15.1:1, axis 7.5:1, delta-up 5.3:1, delta-down 8.2:1
 * all clear of the 3:1 mark minimum. Single-series charts: identity comes
 * from the card title, so no legend and one hue per chart.
 */
const LIGHT_CHART_COLORS = {
  ink: "#332c28", // --foreground
  axis: "#746863", // --muted-foreground
  grid: "#e7e0da", // --border
  deltaUp: "#006300",
  deltaDown: "#d03b3b",
};
const DARK_CHART_COLORS = {
  ink: "#efebe7", // --foreground
  axis: "#b0a69b", // --muted-foreground
  grid: "#3d3129", // --border
  deltaUp: "#0ca30c",
  deltaDown: "#ff8f8f",
};

type RangeDays = 7 | 30;

interface OrderLite {
  subtotal: number;
  status: string;
  created_at: string;
  items: Array<{ title: string; quantity: number }>;
  customer_name: string;
  currency: string;
}

interface ViewLite {
  session_id: string;
  created_at: string;
}

interface DayPoint {
  day: string; // e.g. "Jul 8"
  sales: number;
  orders: number;
  visitors: number;
}

function startOfDay(d: Date) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function dayKey(d: Date) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function compact(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function pctDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

/** Minimal tooltip matching the admin's type scale. */
const ChartTip = ({
  active,
  payload,
  label,
  money,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
  money?: boolean;
}) => {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  return (
    <div className="bg-background border border-border rounded-md px-3 py-2 shadow-sm">
      <p className="font-body text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className="font-body text-[13px] font-medium">{money ? `$${v.toLocaleString()}` : v.toLocaleString()}</p>
    </div>
  );
};

const StatTile = ({
  label,
  value,
  delta,
  colors,
}: {
  label: string;
  value: string;
  delta: number | null;
  colors: typeof LIGHT_CHART_COLORS;
}) => (
  <div className="border border-border rounded-md p-4">
    <p className="font-body text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
    <p className="font-body text-xl sm:text-2xl font-semibold mt-1">{value}</p>
    {delta !== null && (
      <p
        className="font-body text-[11px] mt-0.5"
        style={{ color: delta >= 0 ? colors.deltaUp : colors.deltaDown }}
      >
        {delta >= 0 ? "↑" : "↓"} {Math.abs(delta).toFixed(0)}% vs previous {""}
        <span className="text-muted-foreground">period</span>
      </p>
    )}
  </div>
);

const OverviewTab = () => {
  const theme = useAdminThemeStore((s) => s.theme);
  const colors = theme === "dark" ? DARK_CHART_COLORS : LIGHT_CHART_COLORS;
  const [range, setRange] = useState<RangeDays>(7);
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<OrderLite[]>([]);
  const [views, setViews] = useState<ViewLite[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      // Fetch current + previous period in one query per table, split locally.
      const since = startOfDay(new Date(Date.now() - 2 * range * 86400000)).toISOString();
      const [o, v] = await Promise.all([
        supabase
          .from("orders")
          .select("subtotal,status,created_at,items,customer_name,currency")
          .gte("created_at", since)
          .order("created_at", { ascending: false }),
        supabase
          .from("page_views")
          .select("session_id,created_at")
          .gte("created_at", since),
      ]);
      setOrders(((o.data as unknown as OrderLite[]) || []).filter((x) => x.status !== "cancelled"));
      setViews((v.data as unknown as ViewLite[]) || []);
      setLoading(false);
    })();
  }, [range]);

  const { series, stats, topProducts, recentOrders } = useMemo(() => {
    const now = new Date();
    const currentStart = startOfDay(new Date(now.getTime() - (range - 1) * 86400000));
    const prevStart = new Date(currentStart.getTime() - range * 86400000);

    const inCurrent = (iso: string) => new Date(iso) >= currentStart;
    const inPrev = (iso: string) => {
      const d = new Date(iso);
      return d >= prevStart && d < currentStart;
    };

    // Day buckets for the charts.
    const days: DayPoint[] = [];
    const bucket = new Map<string, DayPoint>();
    for (let i = 0; i < range; i++) {
      const d = new Date(currentStart.getTime() + i * 86400000);
      const point = { day: dayKey(d), sales: 0, orders: 0, visitors: 0 };
      days.push(point);
      bucket.set(dayKey(d), point);
    }

    const curOrders = orders.filter((o) => inCurrent(o.created_at));
    const prevOrders = orders.filter((o) => inPrev(o.created_at));
    for (const o of curOrders) {
      const p = bucket.get(dayKey(new Date(o.created_at)));
      if (p) {
        p.sales += Number(o.subtotal) || 0;
        p.orders += 1;
      }
    }

    const curViews = views.filter((x) => inCurrent(x.created_at));
    const prevViews = views.filter((x) => inPrev(x.created_at));
    const sessionsPerDay = new Map<string, Set<string>>();
    for (const x of curViews) {
      const k = dayKey(new Date(x.created_at));
      if (!sessionsPerDay.has(k)) sessionsPerDay.set(k, new Set());
      sessionsPerDay.get(k)!.add(x.session_id);
    }
    for (const p of days) p.visitors = sessionsPerDay.get(p.day)?.size ?? 0;

    const uniq = (arr: ViewLite[]) => new Set(arr.map((x) => x.session_id)).size;
    const curSales = curOrders.reduce((s, o) => s + (Number(o.subtotal) || 0), 0);
    const prevSales = prevOrders.reduce((s, o) => s + (Number(o.subtotal) || 0), 0);
    const curVisitors = uniq(curViews);
    const prevVisitors = uniq(prevViews);
    const conversion = curVisitors > 0 ? (curOrders.length / curVisitors) * 100 : 0;
    const prevConversion = prevVisitors > 0 ? (prevOrders.length / prevVisitors) * 100 : 0;

    // Top products by units across the current period.
    const unitsByTitle = new Map<string, number>();
    for (const o of curOrders) {
      for (const it of o.items || []) {
        unitsByTitle.set(it.title, (unitsByTitle.get(it.title) ?? 0) + (it.quantity || 1));
      }
    }
    const topProducts = [...unitsByTitle.entries()]
      .map(([title, units]) => ({ title, units }))
      .sort((a, b) => b.units - a.units)
      .slice(0, 5);

    return {
      series: days,
      stats: {
        sales: curSales,
        salesDelta: pctDelta(curSales, prevSales),
        orders: curOrders.length,
        ordersDelta: pctDelta(curOrders.length, prevOrders.length),
        visitors: curVisitors,
        visitorsDelta: pctDelta(curVisitors, prevVisitors),
        conversion,
        conversionDelta: pctDelta(conversion, prevConversion),
      },
      topProducts,
      recentOrders: curOrders.slice(0, 5),
    };
  }, [orders, views, range]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const axisProps = {
    stroke: colors.axis,
    fontSize: 10,
    tickLine: false,
    axisLine: { stroke: colors.grid },
    fontFamily: "var(--font-body)",
  } as const;

  const maxUnits = Math.max(1, ...topProducts.map((p) => p.units));

  return (
    <div className="space-y-6">
      {/* Date range — one filter row above the charts */}
      <div className="flex gap-1.5">
        {([7, 30] as RangeDays[]).map((d) => (
          <button
            key={d}
            onClick={() => setRange(d)}
            className={`px-3 py-1.5 text-[11px] font-body border rounded-md transition-colors ${
              range === d
                ? "bg-foreground text-background border-foreground"
                : "bg-transparent text-foreground border-border hover:border-foreground"
            }`}
          >
            Last {d} days
          </button>
        ))}
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Sales" value={`$${compact(Math.round(stats.sales))}`} delta={stats.salesDelta} colors={colors} />
        <StatTile label="Orders" value={compact(stats.orders)} delta={stats.ordersDelta} colors={colors} />
        <StatTile label="Visitors" value={compact(stats.visitors)} delta={stats.visitorsDelta} colors={colors} />
        <StatTile label="Conversion" value={`${stats.conversion.toFixed(1)}%`} delta={stats.conversionDelta} colors={colors} />
      </div>

      {/* Time charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="border border-border rounded-md p-4">
          <p className="font-body text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-3">
            Sales over time
          </p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                <CartesianGrid stroke={colors.grid} strokeWidth={1} vertical={false} />
                <XAxis dataKey="day" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
                <YAxis {...axisProps} tickFormatter={(v: number) => `$${compact(v)}`} width={58} />
                <Tooltip content={<ChartTip money />} cursor={{ stroke: colors.axis, strokeWidth: 1 }} />
                <Area
                  type="monotone"
                  dataKey="sales"
                  stroke={colors.ink}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  fill={colors.ink}
                  fillOpacity={0.1}
                  activeDot={{ r: 4, fill: colors.ink, stroke: "hsl(var(--background))", strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="border border-border rounded-md p-4">
          <p className="font-body text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-3">
            Visitors over time
          </p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                <CartesianGrid stroke={colors.grid} strokeWidth={1} vertical={false} />
                <XAxis dataKey="day" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
                <YAxis {...axisProps} tickFormatter={(v: number) => compact(v)} width={58} allowDecimals={false} />
                <Tooltip content={<ChartTip />} cursor={{ stroke: colors.axis, strokeWidth: 1 }} />
                <Area
                  type="monotone"
                  dataKey="visitors"
                  stroke={colors.ink}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  fill={colors.ink}
                  fillOpacity={0.1}
                  activeDot={{ r: 4, fill: colors.ink, stroke: "hsl(var(--background))", strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Top products + recent orders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="border border-border rounded-md p-4">
          <p className="font-body text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-3">
            Top products
          </p>
          {topProducts.length === 0 ? (
            <p className="font-body text-[12px] text-muted-foreground py-6 text-center">
              No sales in this period yet.
            </p>
          ) : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topProducts}
                  layout="vertical"
                  margin={{ top: 0, right: 34, bottom: 0, left: 0 }}
                  barCategoryGap="28%"
                >
                  <XAxis type="number" hide domain={[0, maxUnits]} />
                  <YAxis
                    type="category"
                    dataKey="title"
                    {...axisProps}
                    axisLine={false}
                    width={110}
                    tick={{ fill: colors.ink, fontSize: 10 }}
                  />
                  <Tooltip content={<ChartTip />} cursor={{ fill: colors.grid, fillOpacity: 0.4 }} />
                  <Bar
                    dataKey="units"
                    fill={colors.ink}
                    maxBarSize={18}
                    radius={[0, 4, 4, 0]}
                    label={{ position: "right", fill: colors.axis, fontSize: 10 }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="border border-border rounded-md p-4">
          <p className="font-body text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-3">
            Recent orders
          </p>
          {recentOrders.length === 0 ? (
            <p className="font-body text-[12px] text-muted-foreground py-6 text-center">
              No orders in this period yet.
            </p>
          ) : (
            <div className="space-y-2">
              {recentOrders.map((o, i) => (
                <div key={i} className="flex items-center justify-between gap-2 border-b border-border last:border-0 pb-2 last:pb-0">
                  <div className="min-w-0">
                    <p className="font-body text-[12px] truncate">{o.customer_name}</p>
                    <p className="font-body text-[10px] text-muted-foreground">
                      {new Date(o.created_at).toLocaleDateString()} ·{" "}
                      {(o.items || []).reduce((s, it) => s + (it.quantity || 1), 0)} item(s)
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="font-body text-[12px] font-medium">
                      ${Number(o.subtotal).toFixed(0)}
                    </span>
                    <Badge variant="outline" className="text-[10px]">{o.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OverviewTab;
