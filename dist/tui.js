import { memo as _$memo } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { createSignal, createResource, For, Show } from "solid-js";
import { TextAttributes } from "@opentui/core";
const ZONES = [{
  id: "UTC",
  city: "UTC",
  code: "UTC"
}, {
  id: "America/New_York",
  city: "New York",
  code: "ET"
}, {
  id: "America/Chicago",
  city: "Chicago",
  code: "CT"
}, {
  id: "America/Denver",
  city: "Denver",
  code: "MT"
}, {
  id: "America/Los_Angeles",
  city: "Los Angeles",
  code: "PT"
}, {
  id: "Europe/London",
  city: "London",
  code: "GMT"
}, {
  id: "Europe/Paris",
  city: "Paris",
  code: "CET"
}, {
  id: "Europe/Berlin",
  city: "Berlin",
  code: "CET"
}, {
  id: "Asia/Kolkata",
  city: "Kolkata",
  code: "IST"
}, {
  id: "Asia/Tokyo",
  city: "Tokyo",
  code: "JST"
}, {
  id: "Asia/Shanghai",
  city: "Shanghai",
  code: "CST"
}, {
  id: "Australia/Sydney",
  city: "Sydney",
  code: "AEST"
}, {
  id: "Pacific/Auckland",
  city: "Auckland",
  code: "NZST"
}];
const SECTIONS = ["mcpCost", "clocks", "calendar", "plugins"];
const COLORS = ["base", "muted", "success", "warning", "error", "info"];
function zoneInfo(id) {
  return ZONES.find(z => z.id === id) || {
    id,
    city: id,
    code: id
  };
}
function formatTime(tz, now) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(now);
  } catch {
    return "--:--:--";
  }
}
function tzCode(tz, now) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "short"
    }).formatToParts(now);
    return parts.find(p => p.type === "timeZoneName")?.value || tz;
  } catch {
    return tz;
  }
}
function calendarData(now) {
  const d = new Date(now);
  const year = d.getFullYear();
  const month = d.getMonth();
  const date = d.getDate();
  const monthName = d.toLocaleString("en-US", {
    month: "long"
  });
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dow = d.toLocaleString("en-US", {
    weekday: "long"
  });
  const rows = [];
  let row = [];
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
  return {
    year,
    date,
    monthName,
    dow,
    rows
  };
}
export default Plugin.define({
  id: "sidebar.layout",
  async setup(context) {
    const currentTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const home = globalThis?.process?.env?.HOME || "/home/craig";
    const configPath = `${home}/.config/opencode/sidebar-layout.json`;
    const defaults = {
      zones: [currentTz],
      sections: {
        mcpCost: {
          order: 0,
          visible: true,
          color: "base"
        },
        clocks: {
          order: 1,
          visible: true,
          color: "base"
        },
        calendar: {
          order: 2,
          visible: true,
          color: "muted"
        },
        plugins: {
          order: 3,
          visible: true,
          color: "base"
        }
      }
    };
    let loaded = defaults;
    try {
      const fsMod = await import("node:fs");
      loaded = {
        ...defaults,
        ...JSON.parse(fsMod.readFileSync(configPath, "utf8"))
      };
      fsMod.writeFileSync(configPath, JSON.stringify(loaded, null, 2) + "\n");
    } catch {
      try {
        const fsMod = await import("node:fs");
        fsMod.writeFileSync(configPath, JSON.stringify(defaults, null, 2) + "\n");
      } catch {}
    }
    const [config, setConfig] = createSignal(loaded);
    const updateConfig = async fn => {
      const draft = JSON.parse(JSON.stringify(config()));
      fn(draft);
      setConfig(draft);
      try {
        const fsMod = await import("node:fs");
        fsMod.writeFileSync(configPath, JSON.stringify(draft, null, 2) + "\n");
      } catch {}
    };
    const [now, setNow] = createSignal(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const [snapshot] = createResource(async () => {
      try {
        const fsMod = await import("node:fs");
        const home = globalThis?.process?.env?.HOME || "/home/craig";
        return JSON.parse(fsMod.readFileSync(`${home}/.config/mcp-savings/snapshot.json`, "utf8"));
      } catch {
        return null;
      }
    });
    const [plugins] = createResource(async () => {
      const location = context.location ?? context.data.location.default();
      const list = [];
      try {
        const res = await context.client.plugin.list({
          location
        });
        const rows = res && (res.data ?? res) || [];
        if (Array.isArray(rows)) list.push(...rows);
      } catch {}
      try {
        const fsMod = await import("node:fs");
        const home = globalThis?.process?.env?.HOME || "/home/craig";
        const parsed = JSON.parse(fsMod.readFileSync(`${home}/.config/opencode/cli.json`, "utf8"));
        for (const entry of parsed?.plugins ?? []) {
          const spec = typeof entry === "string" ? entry : entry?.package;
          if (!spec) continue;
          list.push({
            id: String(spec).split("/").pop(),
            features: {
              tui: true
            },
            state: {
              status: "active"
            }
          });
        }
      } catch {}
      return list;
    });
    function color(name) {
      return context.theme?.text?.[name] ?? context.theme?.text?.base;
    }
    function sectionColor(id) {
      return color(config()?.sections?.[id]?.color ?? "base");
    }
    const [open, setOpen] = createSignal({
      mcpCost: true,
      clocks: true,
      calendar: true,
      plugins: false
    });
    function header(id, title) {
      const ctx = usePlugin();
      return (() => {
        var _el$ = _$createElement("box"),
          _el$2 = _$createElement("text");
        _$insertNode(_el$, _el$2);
        _$setProp(_el$, "onMouseDown", e => {
          try {
            e?.stopPropagation?.();
          } catch {}
          setOpen({
            ...open(),
            [id]: !open()[id]
          });
        });
        _$insert(_el$2, () => (open()[id] ? "▼ " : "▶ ") + title);
        _$effect(_p$ => {
          var _v$ = sectionColor(id),
            _v$2 = TextAttributes.BOLD;
          _v$ !== _p$.e && (_p$.e = _$setProp(_el$2, "fg", _v$, _p$.e));
          _v$2 !== _p$.t && (_p$.t = _$setProp(_el$2, "attributes", _v$2, _p$.t));
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$;
      })();
    }
    async function configureZones() {
      for (;;) {
        const selected = new Set(config()?.zones ?? [currentTz]);
        const opts = ZONES.map(z => ({
          title: `${selected.has(z.id) ? "✓ " : "  "}${z.city} (${z.code})`,
          value: z.id
        }));
        const choice = await context.ui.dialog.select({
          title: "Toggle timezone (Esc to finish)",
          options: opts
        });
        if (!choice) return;
        const next = new Set(selected);
        if (next.has(choice)) next.delete(choice);else next.add(choice);
        if (next.size === 0) next.add(currentTz);
        await updateConfig(d => {
          d.zones = Array.from(next);
        });
      }
    }
    async function configure() {
      const sec = await context.ui.dialog.select({
        title: "Sidebar section",
        options: SECTIONS.map(id => ({
          title: `${config()?.sections?.[id]?.visible === false ? "hidden" : "shown"} · ${id}`,
          value: id
        }))
      });
      if (!sec) return;
      const actions = await context.ui.dialog.select({
        title: `Configure ${sec}`,
        options: [{
          title: "Toggle visibility",
          value: "visible"
        }, {
          title: "Move up",
          value: "up"
        }, {
          title: "Move down",
          value: "down"
        }, {
          title: "Set colour",
          value: "color"
        }, {
          title: "Select timezones",
          value: "zones"
        }]
      });
      if (!actions) return;
      if (actions === "zones") return configureZones();
      if (actions === "color") {
        const c = await context.ui.dialog.select({
          title: "Colour",
          options: COLORS.map(x => ({
            title: x,
            value: x
          }))
        });
        if (!c) return;
        await updateConfig(d => {
          d.sections[sec].color = c;
        });
        return;
      }
      await updateConfig(d => {
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
        const ordered = SECTIONS.filter(id => config()?.sections?.[id]?.visible !== false).sort((a, b) => (config()?.sections?.[a]?.order ?? 0) - (config()?.sections?.[b]?.order ?? 0));
        return (() => {
          var _el$3 = _$createElement("box");
          _$setProp(_el$3, "flexDirection", "column");
          _$setProp(_el$3, "marginTop", 1);
          _$insert(_el$3, _$createComponent(For, {
            each: ordered,
            children: id => (() => {
              var _el$4 = _$createElement("box");
              _$setProp(_el$4, "flexDirection", "column");
              _$setProp(_el$4, "marginTop", 1);
              _$insert(_el$4, () => header(id, id === "mcpCost" ? "MCP cost/request" : id === "clocks" ? "Clocks" : id === "calendar" ? "Calendar" : "Plugins"), null);
              _$insert(_el$4, _$createComponent(Show, {
                get when() {
                  return open()[id];
                },
                get children() {
                  var _el$5 = _$createElement("box");
                  _$setProp(_el$5, "flexDirection", "column");
                  _$setProp(_el$5, "paddingLeft", 1);
                  _$insert(_el$5, _$createComponent(Show, {
                    when: id === "mcpCost",
                    get children() {
                      return _$createComponent(Show, {
                        get when() {
                          return !snapshot();
                        },
                        get fallback() {
                          return (() => {
                            var _el$8 = _$createElement("box"),
                              _el$9 = _$createElement("text"),
                              _el$0 = _$createElement("text");
                            _$insertNode(_el$8, _el$9);
                            _$insertNode(_el$8, _el$0);
                            _$setProp(_el$8, "flexDirection", "column");
                            _$insert(_el$9, () => `Updated: ${new Date(snapshot()?.timestamp).toLocaleString()}`);
                            _$insert(_el$8, _$createComponent(For, {
                              get each() {
                                return snapshot()?.mcpMeasurement ?? [];
                              },
                              children: m => (() => {
                                var _el$1 = _$createElement("text");
                                _$insert(_el$1, () => `${m.server}: ${m.tokens != null ? m.tokens + " tok" : "n/a"}  (${m.bytes} B)`);
                                _$effect(_$p => _$setProp(_el$1, "fg", ctx.theme.text.base, _$p));
                                return _el$1;
                              })()
                            }), _el$0);
                            _$insert(_el$0, () => `Total: ${snapshot()?.totalSchemaBytes ?? 0} B`);
                            _$effect(_p$ => {
                              var _v$3 = ctx.theme.text.muted,
                                _v$4 = ctx.theme.text.muted;
                              _v$3 !== _p$.e && (_p$.e = _$setProp(_el$9, "fg", _v$3, _p$.e));
                              _v$4 !== _p$.t && (_p$.t = _$setProp(_el$0, "fg", _v$4, _p$.t));
                              return _p$;
                            }, {
                              e: undefined,
                              t: undefined
                            });
                            return _el$8;
                          })();
                        },
                        get children() {
                          var _el$6 = _$createElement("text");
                          _$insertNode(_el$6, _$createTextNode(`No snapshot`));
                          _$effect(_$p => _$setProp(_el$6, "fg", ctx.theme.text.muted, _$p));
                          return _el$6;
                        }
                      });
                    }
                  }), null);
                  _$insert(_el$5, _$createComponent(Show, {
                    when: id === "clocks",
                    get children() {
                      return _$createComponent(For, {
                        get each() {
                          return config()?.zones ?? [currentTz];
                        },
                        children: tz => (() => {
                          var _el$10 = _$createElement("text");
                          _$insert(_el$10, () => `${zoneInfo(tz).city} (${tzCode(tz, nowVal)}): ${formatTime(tz, nowVal)}`);
                          _$effect(_$p => _$setProp(_el$10, "fg", ctx.theme.text.base, _$p));
                          return _el$10;
                        })()
                      });
                    }
                  }), null);
                  _$insert(_el$5, _$createComponent(Show, {
                    when: id === "calendar",
                    get children() {
                      return (() => {
                        const cal = calendarData(nowVal);
                        return (() => {
                          var _el$11 = _$createElement("box"),
                            _el$12 = _$createElement("text"),
                            _el$13 = _$createElement("text"),
                            _el$15 = _$createElement("text");
                          _$insertNode(_el$11, _el$12);
                          _$insertNode(_el$11, _el$13);
                          _$insertNode(_el$11, _el$15);
                          _$setProp(_el$11, "flexDirection", "column");
                          _$insert(_el$12, () => `${cal.monthName} ${cal.year}`);
                          _$insertNode(_el$13, _$createTextNode(`Su Mo Tu We Th Fr Sa`));
                          _$insert(_el$11, _$createComponent(For, {
                            get each() {
                              return cal.rows;
                            },
                            children: week => (() => {
                              var _el$16 = _$createElement("box");
                              _$setProp(_el$16, "flexDirection", "row");
                              _$insert(_el$16, _$createComponent(For, {
                                each: week,
                                children: day => (() => {
                                  var _el$17 = _$createElement("text");
                                  _$setProp(_el$17, "width", 3);
                                  _$insert(_el$17, () => day ? String(day).padStart(2, " ") + " " : "   ");
                                  _$effect(_p$ => {
                                    var _v$8 = day === cal.date ? ctx.theme.text.success : ctx.theme.text.muted,
                                      _v$9 = day === cal.date ? TextAttributes.BOLD : 0;
                                    _v$8 !== _p$.e && (_p$.e = _$setProp(_el$17, "fg", _v$8, _p$.e));
                                    _v$9 !== _p$.t && (_p$.t = _$setProp(_el$17, "attributes", _v$9, _p$.t));
                                    return _p$;
                                  }, {
                                    e: undefined,
                                    t: undefined
                                  });
                                  return _el$17;
                                })()
                              }));
                              return _el$16;
                            })()
                          }), _el$15);
                          _$insert(_el$15, () => `${cal.dow}, ${cal.monthName} ${cal.date}, ${cal.year}`);
                          _$effect(_p$ => {
                            var _v$5 = sectionColor("calendar"),
                              _v$6 = ctx.theme.text.muted,
                              _v$7 = ctx.theme.text.muted;
                            _v$5 !== _p$.e && (_p$.e = _$setProp(_el$12, "fg", _v$5, _p$.e));
                            _v$6 !== _p$.t && (_p$.t = _$setProp(_el$13, "fg", _v$6, _p$.t));
                            _v$7 !== _p$.a && (_p$.a = _$setProp(_el$15, "fg", _v$7, _p$.a));
                            return _p$;
                          }, {
                            e: undefined,
                            t: undefined,
                            a: undefined
                          });
                          return _el$11;
                        })();
                      })();
                    }
                  }), null);
                  _$insert(_el$5, _$createComponent(Show, {
                    when: id === "plugins",
                    get children() {
                      return _$createComponent(For, {
                        get each() {
                          return plugins() ?? [];
                        },
                        children: p => (() => {
                          var _el$18 = _$createElement("text");
                          _$insert(_el$18, () => `${p.id ?? p.source?.target ?? "plugin"}  ${p.state?.status ?? "unknown"}`);
                          _$effect(_$p => _$setProp(_el$18, "fg", ctx.theme.text.base, _$p));
                          return _el$18;
                        })()
                      });
                    }
                  }), null);
                  return _el$5;
                }
              }), null);
              return _el$4;
            })()
          }));
          return _el$3;
        })();
      }
    });
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "sidebar.layout.configure",
        title: "Configure sidebar layout",
        group: "Sidebar",
        palette: true,
        slash: {
          name: "sidebar-layout",
          aliases: ["layout"]
        },
        run: async () => {
          await configure();
        }
      }]
    }));
    return () => clearInterval(timer);
  }
});
