import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { createSignal, createResource, For, Show } from "solid-js";
import { TextAttributes } from "@opentui/core";

const ZONES = [
  { id: "UTC", city: "UTC", code: "UTC" },
  { id: "America/New_York", city: "New York", code: "ET" },
  { id: "America/Chicago", city: "Chicago", code: "CT" },
  { id: "America/Denver", city: "Denver", code: "MT" },
  { id: "America/Los_Angeles", city: "Los Angeles", code: "PT" },
  { id: "Europe/London", city: "London", code: "GMT" },
  { id: "Europe/Paris", city: "Paris", code: "CET" },
  { id: "Europe/Berlin", city: "Berlin", code: "CET" },
  { id: "Asia/Kolkata", city: "Kolkata", code: "IST" },
  { id: "Asia/Tokyo", city: "Tokyo", code: "JST" },
  { id: "Asia/Shanghai", city: "Shanghai", code: "CST" },
  { id: "Australia/Sydney", city: "Sydney", code: "AEST" },
  { id: "Pacific/Auckland", city: "Auckland", code: "NZST" },
];

const SECTIONS = ["mcpCost", "clocks", "calendar", "plugins"] as const;
type SectionID = (typeof SECTIONS)[number];

const COLORS = ["base", "muted", "success", "warning", "error", "info"];

function zoneInfo(id: string) {
  return ZONES.find((z) => z.id === id) || { id, city: id, code: id };
}

function formatTime(tz: string, now: number) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(now);
  } catch {
    return "--:--:--";
  }
}

function tzCode(tz: string, now: number) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "short",
    }).formatToParts(now);
    return parts.find((p) => p.type === "timeZoneName")?.value || tz;
  } catch {
    return tz;
  }
}

function calendarData(now: number) {
  const d = new Date(now);
  const year = d.getFullYear();
  const month = d.getMonth();
  const date = d.getDate();
  const monthName = d.toLocaleString("en-US", { month: "long" });
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dow = d.toLocaleString("en-US", { weekday: "long" });
  const rows: (number | null)[][] = [];
  let row: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) row.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    row.push(day);
    if (row.length === 7) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) {
    while (row.length < 7) row.push(null);
    rows.push(row);
  }
  return { year, date, monthName, dow, rows };
}

export default Plugin.define({
  id: "sidebar.layout",
  async setup(context: any) {
    const currentTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const home = (globalThis as any)?.process?.env?.HOME || "/home/craig";
    const configPath = `${home}/.config/opencode/sidebar-layout.json`;
    const defaults = {
      zones: [currentTz],
      sections: {
        mcpCost: { order: 0, visible: true, color: "base" },
        clocks: { order: 1, visible: true, color: "base" },
        calendar: { order: 2, visible: true, color: "muted" },
        plugins: { order: 3, visible: true, color: "base" },
      },
    };
    let loaded: any = defaults;
    try {
      const fsMod: any = await import("node:fs");
      loaded = {
        ...defaults,
        ...JSON.parse(fsMod.readFileSync(configPath, "utf8")),
      };
      fsMod.writeFileSync(configPath, JSON.stringify(loaded, null, 2) + "\n");
    } catch {
      try {
        const fsMod: any = await import("node:fs");
        fsMod.writeFileSync(
          configPath,
          JSON.stringify(defaults, null, 2) + "\n",
        );
      } catch {}
    }
    const [config, setConfig] = createSignal<any>(loaded);
    const updateConfig = async (fn: (draft: any) => void) => {
      const draft = JSON.parse(JSON.stringify(config()));
      fn(draft);
      setConfig(draft);
      try {
        const fsMod: any = await import("node:fs");
        fsMod.writeFileSync(configPath, JSON.stringify(draft, null, 2) + "\n");
      } catch {}
    };

    const [now, setNow] = createSignal(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);

    const [snapshot] = createResource(async () => {
      try {
        const fsMod: any = await import("node:fs");
        const home = (globalThis as any)?.process?.env?.HOME || "/home/craig";
        return JSON.parse(
          fsMod.readFileSync(
            `${home}/.config/mcp-savings/snapshot.json`,
            "utf8",
          ),
        );
      } catch {
        return null;
      }
    });

    const [plugins] = createResource(async () => {
      const location = context.location ?? context.data.location.default();
      const list: any[] = [];
      try {
        const res = await context.client.plugin.list({ location });
        const rows = (res && (res.data ?? res)) || [];
        if (Array.isArray(rows)) list.push(...rows);
      } catch {}
      try {
        const fsMod: any = await import("node:fs");
        const home = (globalThis as any)?.process?.env?.HOME || "/home/craig";
        const parsed = JSON.parse(
          fsMod.readFileSync(`${home}/.config/opencode/cli.json`, "utf8"),
        );
        for (const entry of parsed?.plugins ?? []) {
          const spec = typeof entry === "string" ? entry : entry?.package;
          if (!spec) continue;
          list.push({
            id: String(spec).split("/").pop(),
            features: { tui: true },
            state: { status: "active" },
          });
        }
      } catch {}
      return list;
    });

    function color(name: string) {
      return (context.theme?.text as any)?.[name] ?? context.theme?.text?.base;
    }

    function sectionColor(id: SectionID) {
      return color(config()?.sections?.[id]?.color ?? "base");
    }

    // Configurable via cli.json/opencode.json plugin options; every section starts
    // collapsed unless explicitly expanded with { "collapsedByDefault": false }.
    const collapsedByDefault = context.options?.collapsedByDefault !== false;
    const [open, setOpen] = createSignal<Record<string, boolean>>(
      Object.fromEntries(SECTIONS.map((id) => [id, !collapsedByDefault])),
    );

    function header(id: SectionID, title: string) {
      const ctx = usePlugin();
      return (
        <box
          onMouseDown={(e: any) => {
            try {
              e?.stopPropagation?.();
            } catch {}
            setOpen({ ...open(), [id]: !open()[id] });
          }}
        >
          <text fg={sectionColor(id)} attributes={TextAttributes.BOLD}>
            {(open()[id] ? "▼ " : "▶ ") + title}
          </text>
        </box>
      );
    }

    async function configureZones() {
      for (;;) {
        const selected = new Set(config()?.zones ?? [currentTz]);
        const opts = ZONES.map((z) => ({
          title: `${selected.has(z.id) ? "✓ " : "  "}${z.city} (${z.code})`,
          value: z.id,
        }));
        const choice = await context.ui.dialog.select({
          title: "Toggle timezone (Esc to finish)",
          options: opts,
        });
        if (!choice) return;
        const next = new Set(selected);
        if (next.has(choice)) next.delete(choice);
        else next.add(choice);
        if (next.size === 0) next.add(currentTz);
        await updateConfig((d: any) => {
          d.zones = Array.from(next);
        });
      }
    }

    async function configure() {
      const sec = await context.ui.dialog.select({
        title: "Sidebar section",
        options: SECTIONS.map((id) => ({
          title: `${config()?.sections?.[id]?.visible === false ? "hidden" : "shown"} · ${id}`,
          value: id,
        })),
      });
      if (!sec) return;
      const actions = await context.ui.dialog.select({
        title: `Configure ${sec}`,
        options: [
          { title: "Toggle visibility", value: "visible" },
          { title: "Move up", value: "up" },
          { title: "Move down", value: "down" },
          { title: "Set colour", value: "color" },
          { title: "Select timezones", value: "zones" },
        ],
      });
      if (!actions) return;
      if (actions === "zones") return configureZones();
      if (actions === "color") {
        const c = await context.ui.dialog.select({
          title: "Colour",
          options: COLORS.map((x) => ({ title: x, value: x })),
        });
        if (!c) return;
        await updateConfig((d: any) => {
          d.sections[sec].color = c;
        });
        return;
      }
      await updateConfig((d: any) => {
        const current = d.sections[sec];
        if (actions === "visible") current.visible = !current.visible;
        if (actions === "up") current.order = current.order - 1;
        if (actions === "down") current.order = current.order + 1;
      });
    }

    context.ui.slot({
      prepend: "sidebar.content",
      render: () => {
        const ctx = usePlugin();
        const nowVal = now();
        const ordered = SECTIONS.filter(
          (id) => config()?.sections?.[id]?.visible !== false,
        ).sort(
          (a, b) =>
            (config()?.sections?.[a]?.order ?? 0) -
            (config()?.sections?.[b]?.order ?? 0),
        );
        return (
          <box flexDirection="column" marginTop={1}>
            <For each={ordered}>
              {(id: SectionID) => (
                <box flexDirection="column" marginTop={1}>
                  {header(
                    id,
                    id === "mcpCost"
                      ? "MCP cost/request"
                      : id === "clocks"
                        ? "Clocks"
                        : id === "calendar"
                          ? "Calendar"
                          : "Plugins",
                  )}
                  <Show when={open()[id]}>
                    <box flexDirection="column" paddingLeft={1}>
                      <Show when={id === "mcpCost"}>
                        <Show
                          when={!snapshot()}
                          fallback={
                            <box flexDirection="column">
                              <text
                                fg={ctx.theme.text.muted}
                              >{`Updated: ${new Date(snapshot()?.timestamp).toLocaleString()}`}</text>
                              <For each={snapshot()?.mcpMeasurement ?? []}>
                                {(m: any) => (
                                  <text
                                    fg={ctx.theme.text.base}
                                  >{`${m.server}: ${m.tokens != null ? m.tokens + " tok" : "n/a"}  (${m.bytes} B)`}</text>
                                )}
                              </For>
                              <text
                                fg={ctx.theme.text.muted}
                              >{`Total: ${snapshot()?.totalSchemaBytes ?? 0} B`}</text>
                            </box>
                          }
                        >
                          <text fg={ctx.theme.text.muted}>No snapshot</text>
                        </Show>
                      </Show>
                      <Show when={id === "clocks"}>
                        <For each={config()?.zones ?? [currentTz]}>
                          {(tz: string) => (
                            <text
                              fg={ctx.theme.text.base}
                            >{`${zoneInfo(tz).city} (${tzCode(tz, nowVal)}): ${formatTime(tz, nowVal)}`}</text>
                          )}
                        </For>
                      </Show>
                      <Show when={id === "calendar"}>
                        {(() => {
                          const cal = calendarData(nowVal);
                          return (
                            <box flexDirection="column">
                              <text
                                fg={sectionColor("calendar")}
                              >{`${cal.monthName} ${cal.year}`}</text>
                              <text fg={ctx.theme.text.muted}>
                                {"Su Mo Tu We Th Fr Sa"}
                              </text>
                              <For each={cal.rows}>
                                {(week: (number | null)[]) => (
                                  <box flexDirection="row">
                                    <For each={week}>
                                      {(day: number | null) => (
                                        <text
                                          width={3}
                                          fg={
                                            day === cal.date
                                              ? ctx.theme.text.success
                                              : ctx.theme.text.muted
                                          }
                                          attributes={
                                            day === cal.date
                                              ? TextAttributes.BOLD
                                              : 0
                                          }
                                        >
                                          {day
                                            ? String(day).padStart(2, " ") + " "
                                            : "   "}
                                        </text>
                                      )}
                                    </For>
                                  </box>
                                )}
                              </For>
                              <text
                                fg={ctx.theme.text.muted}
                              >{`${cal.dow}, ${cal.monthName} ${cal.date}, ${cal.year}`}</text>
                            </box>
                          );
                        })()}
                      </Show>
                      <Show when={id === "plugins"}>
                        <For each={plugins() ?? []}>
                          {(p: any) => (
                            <text
                              fg={ctx.theme.text.base}
                            >{`${p.id ?? p.source?.target ?? "plugin"}  ${p.state?.status ?? "unknown"}`}</text>
                          )}
                        </For>
                      </Show>
                    </box>
                  </Show>
                </box>
              )}
            </For>
          </box>
        );
      },
    });

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "sidebar.layout.configure",
          title: "Configure sidebar layout",
          group: "Sidebar",
          palette: true,
          slash: { name: "sidebar-layout", aliases: ["layout"] },
          run: async () => {
            await configure();
          },
        },
      ],
    }));

    return () => clearInterval(timer);
  },
});
