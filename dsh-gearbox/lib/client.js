window.__ModuleLoader__.load({
	id: "dsh-gearbox",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		/**
		 * dsh-gearbox client half.
		 *
		 * ## Why this file looks like this
		 *
		 * The client bundle is loaded as a **classic script** over `dsh-app://`, so
		 * an ESM `import`/`export` statement is a syntax error there — and because
		 * the plugin table is parsed as one concatenated script, one bad statement
		 * takes the whole renderer boot down and the app's crash-recovery resets the
		 * profile. Hence `window.__ModuleLoader__.load({ id, factory })`, the wrapper
		 * every shipped plugin uses, and hence `require` for React instead of JSX.
		 *
		 * ## The settings section renders NATIVELY, not in an iframe
		 *
		 * An iframe inside the settings dialog is its own scrolling container: the
		 * shell scrolls outside, the page scrolls inside, and the user gets two
		 * scrollbars no matter how the inner one is styled or auto-heighted.
		 * `dsh-better-sidebar`'s 「侧边卡片」 has one scrollbar because it renders
		 * React **into the shell document** — there is no nested scroller at all.
		 * This section does the same: the markup lives in the shell document, so the
		 * shell's scrollbar is the only one, and the shell's theme and fonts apply
		 * without any bridging.
		 *
		 * Data comes from the plugin's own `/gears/api/*` routes, so this panel and
		 * the standalone `/gears/ui` page share one backend and cannot disagree
		 * about state.
		 *
		 * Everything here is defensive on purpose: this half runs during the
		 * renderer's boot, so a throw in `apply` must never escape.
		 */

		const SETTINGS_SLOT = "settings.section";
		const SECTION_ID = "dsh-gearbox";
		const PAGE_PATH = "/gears/ui";
		const API = "/gears/api";

		/** Locale namespace the dictionaries land under. */
		const NS = "dsh-gearbox";

		const DICTIONARIES = {
			zh: {
				meta: {
					title: "模型变速箱",
					description: "第三方模型的思考档位与图像生成通道"
				},
				settingsNav: "模型变速箱",
				loading: "正在读取当前配置…",
				loadFailed: "读取失败",
				model: "模型",
				gears: "思考档位",
				protocol: "协议",
				advertised: "前端实际可用",
				noGears: "— 无思考档位",
				unset: "— 未设置",
				custom: "自定义档位…",
				addMode: "＋ 添加模式",
				saveCustom: "保存自定义",
				cancel: "取消",
				transportHint: "传输值留空：off 表示不发任何字段，其余档位默认发与模式同名的值。",
				recommended: "（推荐）",
				liveHint: "「前端实际可用」来自适配器本身，是 composer 渲染档位选择器的依据。改动保存后立即生效。",
				enhancer: "提示词增强角色（图像通道）",
				enhancerT2I: "文生图提示词扩写 PE-T2I",
				enhancerI2I: "编辑指令改写 PE-I2I",
				vendor: "供应商",
				modelField: "模型",
				saveEnhancers: "保存增强角色",
				saved: "已保存",
				openInTab: "独立页",
				lastWrite: "上次写入",
				noChange: "无变更",
				attempts: "尝试",
				times: "次",
				writeFailed: "上次写入失败"
			},
			en: {
				meta: {
					title: "Gearbox",
					description: "Reasoning-effort gears and an image-generation lane for third-party models"
				},
				settingsNav: "Gearbox",
				loading: "Reading the live configuration…",
				loadFailed: "Failed to load",
				model: "Model",
				gears: "Thinking gears",
				protocol: "Protocol",
				advertised: "Advertised",
				noGears: "— no thinking gears",
				unset: "— unset",
				custom: "Custom gears…",
				addMode: "＋ Add mode",
				saveCustom: "Save custom",
				cancel: "Cancel",
				transportHint: "Empty wire value: off sends no field, other gears send their own name.",
				recommended: " (recommended)",
				liveHint: "\"Advertised\" comes from the adapter — it is what the composer renders. Changes apply immediately.",
				enhancer: "Prompt-enhancer roles (image lane)",
				enhancerT2I: "Text-to-image prompt expansion PE-T2I",
				enhancerI2I: "Edit-instruction rewriting PE-I2I",
				vendor: "Provider",
				modelField: "Model",
				saveEnhancers: "Save enhancer roles",
				saved: "Saved",
				openInTab: "standalone",
				lastWrite: "Last write",
				noChange: "no change",
				attempts: "attempts",
				times: "",
				writeFailed: "Last write failed"
			}
		};

		/**
		 * Client-side services, by **service name**.
		 *
		 * This is the client half's own inject map, resolved inside the client plugin
		 * tree — the same shape `dsh-better-sidebar` (`"slots", "sessions", "locale",
		 * …`) and `dsh-client-ui-plugin-manager` (`"slots", "locale", "remote", …`)
		 * use.
		 *
		 * **Do not put package ids here.** Package ids belong in `package.json` →
		 * `dsh.client.inject`, which seeds the module table; naming a package here
		 * parks the entry forever with `pending (waiting for services: @deepseek-ai/…)`,
		 * and because the web app asserts that every entry activated, the whole app
		 * then refuses to boot.
		 */
		const inject = ["slots", "locale"];

		/** The standard gear ladder, in escalation order. */
		const LADDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

		const PROTOCOL_LABEL = {
			"openai-responses": "OpenAI Responses",
			"openai-completions": "OpenAI Chat Completions",
			"anthropic-messages": "Anthropic Messages"
		};

		const ROLE_LABEL = {
			promptEnhancer: "文生图提示词扩写 PE-T2I",
			editEnhancer: "编辑指令改写 PE-I2I"
		};

		/** The gears one preset offers: off always, the others when the preset sets them. */
		function presetGears(preset) {
			const levels = (preset && preset.levels) || {};
			const out = new Set(["off"]);
			for (const gear of LADDER) {
				if (gear !== "off" && levels[gear] !== null && levels[gear] !== undefined) out.add(gear);
			}
			return out;
		}

		function presetWire(preset) {
			const levels = (preset && preset.levels) || {};
			const out = {};
			for (const gear of presetGears(preset)) {
				out[gear] = gear === "off" && levels[gear] === undefined ? null : levels[gear];
			}
			return out;
		}

		/** Which entry in the config currently supplies this model's gears. */
		function gearSource(config, route, model) {
			const rule = ((config && config.rules) || []).find((entry) => entry && entry.route === route && entry.model === model);
			if (rule && rule.preset) return { kind: "preset", id: rule.preset };
			const custom = ((config && config.customEfforts) || []).find((entry) => entry && entry.route === route && entry.model === model);
			if (custom) {
				const gears = {};
				for (const [key, value] of Object.entries(custom)) {
					if (key !== "route" && key !== "model") gears[key] = value;
				}
				return { kind: "custom", gears: gears };
			}
			return null;
		}

		/** Wire values for a custom gear bag; empty means "off → nothing, else its own name". */
		function normalizedGears(gears) {
			const out = {};
			for (const [gear, value] of Object.entries(gears || {})) {
				out[gear] = (value === "" || value === undefined) ? (gear === "off" ? null : gear) : value;
			}
			return out;
		}

		const BORDER = "1px solid rgba(127,127,127,.30)";

		/**
		 * Inline styles. Deliberately sparse: colours are inherited from the shell so
		 * the panel blends into light and dark themes without any bridging.
		 */
		/**
		 * Inline styles built on the shell's own design tokens (`--dsw-*`), the same
		 * set `dsh-better-sidebar` consumes. Using the tokens instead of literal
		 * colours is what makes the panel look native in both themes: background,
		 * borders, text tiers, accent and the primary button all come from the
		 * shell, so nothing needs theme detection.
		 */
		const STYLE = {
			root: {
				display: "flex", flexDirection: "column", color: "var(--dsw-alias-label-primary)",
				fontFamily: "var(--dsw-font-family, inherit)", fontSize: "13px", lineHeight: 1.5
			},
			head: {
				display: "flex", alignItems: "baseline", gap: "10px",
				padding: "2px 0 10px", borderBottom: "1px solid var(--dsw-alias-hairline)", marginBottom: "4px"
			},
			title: { fontSize: "14px", fontWeight: 650, color: "var(--dsw-alias-label-primary)" },
			note: { fontSize: "12px", color: "var(--dsw-alias-label-secondary)" },
			muted: { fontSize: "11.5px", color: "var(--dsw-alias-label-tertiary)" },
			mono: { fontFamily: "ui-monospace, Consolas, monospace", fontSize: "12.5px" },
			card: {
				background: "var(--dsw-alias-bg-layer-1)", border: "1px solid var(--dsw-alias-border-l1)",
				borderRadius: "12px", padding: "2px 16px", marginBottom: "12px"
			},
			row: {
				display: "grid", gridTemplateColumns: "minmax(150px, 230px) 1fr", gap: "14px",
				padding: "12px 0", borderBottom: "1px solid var(--dsw-alias-hairline)", alignItems: "start"
			},
			rowLast: { borderBottom: "none" },
			rowLabel: { display: "flex", flexDirection: "column", gap: "2px", paddingTop: "4px" },
			rowControl: { display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 },
			controlLine: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" },
			controlLabel: { fontSize: "11.5px", color: "var(--dsw-alias-label-secondary)", marginBottom: "3px" },
			select: {
				font: "inherit", fontSize: "12.5px", color: "var(--dsw-alias-label-primary)",
				background: "var(--dsw-alias-bg-layer-2)", border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: "8px", padding: "6px 10px", maxWidth: "100%"
			},
			input: {
				font: "inherit", fontSize: "12.5px", color: "var(--dsw-alias-label-primary)",
				background: "var(--dsw-alias-bg-layer-2)", border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: "8px", padding: "6px 10px", width: "150px"
			},
			good: { fontFamily: "ui-monospace, Consolas, monospace", fontSize: "11.5px", color: "var(--dsw-alias-state-success-primary)" },
			dim: { fontFamily: "ui-monospace, Consolas, monospace", fontSize: "11.5px", color: "var(--dsw-alias-label-tertiary)" },
			flash: {
				padding: "7px 12px", borderRadius: "8px", fontSize: "12.5px",
				background: "var(--dsw-alias-accent-soft, rgba(37,99,235,.12))", color: "var(--dsw-alias-label-primary)"
			},
			h3: { fontSize: "13px", margin: "14px 0 4px", fontWeight: 650 },
			roleRow: {
				display: "grid", gridTemplateColumns: "minmax(150px, 230px) 1fr", gap: "14px",
				padding: "10px 0", borderBottom: "1px solid var(--dsw-alias-hairline)", alignItems: "center"
			},
			roleLabel: { fontSize: "12.5px", color: "var(--dsw-alias-label-primary)" },
			fields: { display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" },
			field: { display: "flex", flexDirection: "column", gap: "3px", fontSize: "11.5px", color: "var(--dsw-alias-label-secondary)" },
			modeBox: {
				marginTop: "2px", padding: "10px", background: "var(--dsw-alias-bg-layer-2)",
				border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "10px",
				display: "flex", flexDirection: "column", gap: "8px"
			},
			modeRow: { display: "flex", gap: "6px", alignItems: "center" },
			modeInput: { width: "140px" },
			rowActions: { display: "flex", gap: "8px", alignItems: "center" },
			primaryButton: {
				padding: "6px 14px", borderRadius: "8px", border: "1px solid transparent",
				background: "var(--dsw-alias-button-primary-fill, var(--dsw-alias-accent))",
				color: "var(--dsw-alias-button-primary-ink, #fff)", cursor: "pointer", fontSize: "12.5px"
			},
			smallButton: {
				padding: "5px 11px", borderRadius: "8px", border: "1px solid var(--dsw-alias-border-l2)",
				background: "transparent", color: "var(--dsw-alias-label-primary)", cursor: "pointer", fontSize: "12.5px"
			}
		};

		/**
		 * The settings section. All state is local; data arrives from `/gears/api/*`.
		 *
		 * @param {object} React  the shell's React
		 * @param {(key: string) => string} t  localized label lookup
		 */
		function makeSection(React, t) {
			const createElement = React.createElement.bind(React);
			// 变长 children：写成 (tag, props, ...children)，漏了 children 会让整棵渲染树静默变空。
			const h = (tag, props, ...children) => createElement(tag, props, ...children);

			function GearboxSection() {
				const dataState = React.useState(null);
				const data = dataState[0];
				const setData = dataState[1];
				const errorState = React.useState(null);
				const loadError = errorState[0];
				const setError = errorState[1];
				const flashState = React.useState(null);
				const flash = flashState[0];
				const setFlash = flashState[1];
				// 自定义档位草稿，按 `route|model` 存；点「自定义档位…」时才建。
				const draftState = React.useState({});
				const drafts = draftState[0];
				const setDrafts = draftState[1];

				React.useEffect(() => {
					let cancelled = false;
					const read = async () => {
						try {
							const results = await Promise.all([
								fetch(API + "/info").then((r) => r.json()),
								fetch(API + "/inventory").then((r) => r.json()),
								fetch(API + "/presets").then((r) => r.json()),
								fetch(API + "/own-config").then((r) => r.json())
							]);
							if (cancelled) return;
							const failed = results.find((entry) => !entry.ok);
							if (failed) throw new Error(failed.error || "HTTP error");
							setData({
								info: results[0],
								inventory: results[1],
								presets: results[2],
								config: results[3].config
							});
							setError(null);
						} catch (error) {
							if (!cancelled) setError(String((error && error.message) || error));
						}
					};
					read();
					return () => { cancelled = true; };
				}, []);

				const refresh = async () => {
					try {
						const results = await Promise.all([
							fetch(API + "/info").then((r) => r.json()),
							fetch(API + "/inventory").then((r) => r.json()),
							fetch(API + "/own-config").then((r) => r.json())
						]);
						if (results.every((entry) => entry.ok)) {
							setData({
								info: results[0],
								inventory: results[1],
								presets: (data && data.presets) || { vendors: [] },
								config: results[2].config
							});
						}
					} catch (error) {
						setFlash(String((error && error.message) || error));
					}
				};

				/** Persist this plugin's config section, pushing Effort Studio in the same request. */
				const saveOwn = async (patch) => {
					const out = await fetch(API + "/own-config", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(patch)
					}).then((r) => r.json());
					if (!out.ok) throw new Error(out.error || "save failed");
					return out;
				};

				const saveGears = async (route, model, next) => {
					const config = data.config;
					const rules = (config.rules || []).filter((entry) => !(entry.route === route && entry.model === model));
					const customEfforts = (config.customEfforts || []).filter((entry) => !(entry.route === route && entry.model === model));
					if (next.kind === "preset") rules.push({ route: route, model: model, preset: next.id });
					else if (next.kind === "custom" && Object.keys(next.gears || {}).length) {
						customEfforts.push(Object.assign({ route: route, model: model }, normalizedGears(next.gears)));
					}
					try {
						const out = await saveOwn({ rules: rules, customEfforts: customEfforts });
						const wrote = ((out.efforts && out.efforts.applied) || []).length;
						setFlash(t("saved") + " · " + model + " (" + wrote + ")");
						setDrafts((prev) => { const copy = Object.assign({}, prev); delete copy[route + "|" + model]; return copy; });
						await refresh();
					} catch (error) {
						setFlash(String((error && error.message) || error));
					}
				};

				const switchProtocol = async (model, api) => {
					const plan = {};
					plan[model] = api;
					try {
						const out = await fetch(API + "/protocol", {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({ plan: plan })
						}).then((r) => r.json());
						if (!out.ok) throw new Error(out.error || "switch failed");
						setFlash(t("saved") + " · " + model);
						await refresh();
					} catch (error) {
						setFlash(String((error && error.message) || error));
					}
				};

				const saveEnhancers = async () => {
					const image = JSON.parse(JSON.stringify((data.config && data.config.image) || {}));
					const grids = document.querySelectorAll("[data-gearbox-role]");
					for (const grid of grids) {
						const id = grid.getAttribute("data-gearbox-role");
						const provider = grid.querySelector('[data-field="provider"]').value;
						const model = grid.querySelector('[data-field="model"]').value.trim();
						if (!model) continue;
						image.roles = image.roles || {};
						image.roles[id] = Object.assign({}, image.roles[id] || {}, { provider: provider, model: model });
					}
					try {
						await saveOwn({ image: image });
						setFlash(t("saved"));
						await refresh();
					} catch (error) {
						setFlash(String((error && error.message) || error));
					}
				};

				// ---- render ----
				if (loadError) {
					return h("div", { style: STYLE.note },
						t("loadFailed") + ": " + loadError + "  ",
						h("a", { href: PAGE_PATH, target: "_blank", rel: "noreferrer" }, PAGE_PATH));
				}
				if (!data) {
					return h("div", { style: STYLE.note }, t("loading"));
				}

				const info = data.info || {};
				const config = data.config || {};
				const models = ((data.inventory || {}).models) || [];
				const vendors = ((data.presets || {}).vendors) || [];
				const protocols = ((data.presets || {}).protocols) || [];
				const presets = ((data.presets || {}).presets) || [];
				const providers = Object.keys(((info.lane || {}).providers) || {});
				const capables = info.thinkingCapable || {};
				const lastApply = info.lastApply;

				const statusLine = lastApply
					? (lastApply.error
						? t("writeFailed") + ": " + lastApply.error
						: [t("lastWrite"), String(lastApply.at || "").replace("T", " ").slice(0, 19), lastApply.changed ? "" : t("noChange"), t("attempts") + " " + String(lastApply.attempts ?? 1) + t("times")].filter((part) => part !== "").join(" · "))
					: "";

				// 每个模型一行：左标签 + 右控件，行间细分割线 —— 设置页的通用排布。
				const rows = models.map((row, index) => {
					const k = row.route + "|" + row.model;
					const capable = capables[row.model] !== false;
					const source = gearSource(config, row.route, row.model);
					const selected = source ? (source.kind === "preset" ? "preset:" + source.id : "custom") : "";
					const efforts = (row.capabilities && row.capabilities.efforts) || null;
					const advertised = Object.keys(efforts || {}).filter((gear) => efforts[gear] !== null && efforts[gear] !== undefined);
					const suggested = (row.suggestedFit && row.suggestedFit.length ? row.suggestedFit : row.suggested) || [];
					const draft = drafts[k];
					const last = index === models.length - 1;
					const rowStyle = last ? Object.assign({}, STYLE.row, STYLE.rowLast) : STYLE.row;

					// ---- 档位下拉：厂家 → 模型 两级分组，末尾「自定义档位…」 ----
					let gearControl;
					if (!capable) {
						gearControl = h("div", { style: STYLE.dim }, t("noGears"));
					} else {
						const options = [createElement("option", { key: "unset", value: "" },
							t("unset") + (suggested.length ? " · " + suggested[0] + t("recommended") : ""))];
						for (const vendor of vendors) {
							const children = (vendor.models || []).map((model) =>
								createElement("option", {
									key: vendor.id + "/" + model.id, value: "preset:" + model.id
								}, (model.label || model.id) + " · " + (model.gears || []).join("/")));
							options.push(createElement("optgroup", { key: vendor.id, label: vendor.label }, children));
						}
						options.push(createElement("option", { key: "custom", value: "custom" }, t("custom")));
						const gearSelect = h("select", {
							style: Object.assign({}, STYLE.select, { minWidth: "300px" }),
							value: selected,
							onChange: (event) => {
								const value = event.target.value;
								if (value === "") { saveGears(row.route, row.model, { kind: "custom", gears: {} }); return; }
								if (value === "custom") {
									const preset = presets.find((entry) => entry.id === (suggested[0] || ""));
									const seed = preset ? presetWire(preset) : { high: "high" };
									const entries = Object.keys(seed).length ? Object.entries(seed) : [["high", "high"]];
									setDrafts((prev) => {
										const copy = Object.assign({}, prev);
										copy[k] = entries.map((entry) => ({ gear: entry[0], wire: entry[1] === null ? "" : String(entry[1]) }));
										return copy;
									});
									return; // 等用户在编辑器里点「保存自定义」
								}
								saveGears(row.route, row.model, { kind: "preset", id: value.slice("preset:".length) });
							}
						}, options);

						const modeRows = (draft || []).map((entry, index2) =>
							h("div", { key: "row" + index2, style: STYLE.modeRow },
								h("select", {
									style: STYLE.select,
									value: entry.gear,
									onChange: (event) => setDrafts((prev) => {
										const copy = Object.assign({}, prev);
										copy[k] = prev[k].map((item, i) => (i === index2 ? { gear: event.target.value, wire: item.wire } : item));
										return copy;
									})
								}, LADDER.map((gear) => createElement("option", { key: gear, value: gear }, gear))),
								h("input", {
									type: "text", style: STYLE.modeInput, value: entry.wire, placeholder: "high",
									onChange: (event) => setDrafts((prev) => {
										const copy = Object.assign({}, prev);
										copy[k] = prev[k].map((item, i) => (i === index2 ? { gear: item.gear, wire: event.target.value } : item));
										return copy;
									})
								}),
								h("button", {
									type: "button", style: STYLE.smallButton, title: "remove",
									onClick: () => setDrafts((prev) => {
										const copy = Object.assign({}, prev);
										copy[k] = prev[k].filter((item, i) => i !== index2);
										return copy;
									})
								}, "×")));

						gearControl = h("div", null,
							gearSelect,
							draft ? h("div", { style: STYLE.modeBox },
								modeRows,
								h("div", { style: STYLE.modeRow },
									h("button", {
										type: "button", style: STYLE.smallButton,
										onClick: () => setDrafts((prev) => {
											const copy = Object.assign({}, prev);
											copy[k] = prev[k].concat([{ gear: "low", wire: "low" }]);
											return copy;
										})
									}, t("addMode")),
									h("button", {
										type: "button", style: STYLE.primaryButton,
										onClick: () => {
											const gears = {};
											for (const entry of drafts[k]) {
												if (!entry.gear) continue;
												gears[entry.gear] = entry.wire === "" ? (entry.gear === "off" ? null : entry.gear) : entry.wire;
											}
											saveGears(row.route, row.model, { kind: "custom", gears: gears });
										}
									}, t("saveCustom")),
									h("button", {
										type: "button", style: STYLE.smallButton,
										onClick: () => setDrafts((prev) => { const copy = Object.assign({}, prev); delete copy[k]; return copy; })
									}, t("cancel"))),
								h("div", { style: STYLE.note }, t("transportHint")))
								: null);
					}

					// ---- 协议 + 前端实际可用 ----
					const protocolSelect = h("select", {
						style: Object.assign({}, STYLE.select, { minWidth: "200px" }),
						value: row.api,
						onChange: (event) => switchProtocol(row.model, event.target.value)
					}, protocols.map((api) => createElement("option", { key: api, value: api }, PROTOCOL_LABEL[api] || api)));

					return createElement("div", { key: k, style: rowStyle },
						createElement("div", { style: STYLE.rowLabel },
							createElement("span", { style: STYLE.mono }, row.model),
							createElement("span", { style: STYLE.muted }, row.route)),
						createElement("div", { style: STYLE.rowControl },
							gearControl,
							createElement("div", { style: STYLE.controlLine },
								createElement("div", null,
									createElement("div", { style: STYLE.controlLabel }, t("protocol")),
									protocolSelect),
								createElement("div", null,
									createElement("div", { style: STYLE.controlLabel }, t("advertised")),
									createElement("span", { style: advertised.length ? STYLE.good : STYLE.dim },
										advertised.length ? advertised.join("  ") : "—")))));
				});

				// 图像通道的两个增强角色：只有"哪个供应商的哪个模型"是这里要配的，
				// 生成/编辑模型与协议统一在上面的模型列表里改。
				const roleGrids = ["promptEnhancer", "editEnhancer"].map((id) => {
					const role = ((config.image || {}).roles || {})[id] || {};
					const resolved = (((info.lane || {}).roles) || {})[id] || {};
					return createElement("div", { key: id, "data-gearbox-role": id, style: STYLE.roleRow },
						createElement("span", { style: STYLE.roleLabel }, ROLE_LABEL[id] || id),
						createElement("span", { style: STYLE.fields },
							createElement("label", { style: STYLE.field }, t("vendor"),
								createElement("select", {
									style: STYLE.select, "data-field": "provider",
									defaultValue: role.provider || resolved.provider || (providers[0] ?? "")
								}, providers.map((name) => createElement("option", { key: name, value: name }, name)))),
							createElement("label", { style: STYLE.field }, t("modelField"),
								createElement("input", {
									type: "text", "data-field": "model", style: STYLE.modeInput,
									defaultValue: role.model || resolved.model || "", placeholder: "model id"
								}))));
				});

				return h("div", { style: STYLE.root },
					flash ? h("div", { style: STYLE.flash }, flash) : null,
					h("div", { style: STYLE.head },
						h("span", { style: STYLE.title }, t("settingsNav")),
						h("span", { style: STYLE.note }, statusLine),
						h("span", { style: { flex: "1 1 auto" } }),
						h("a", { href: PAGE_PATH, target: "_blank", rel: "noreferrer", style: STYLE.note }, t("openInTab"))),
					h("div", { style: STYLE.card },
						h("div", { style: { padding: "8px 0 4px" } }, h("span", { style: STYLE.controlLabel }, t("liveHint"))),
						rows),
					h("h3", { style: STYLE.h3 }, t("enhancer")),
					h("div", { style: STYLE.card },
						h("div", { style: { padding: "6px 0 2px" } }, roleGrids),
						h("div", { style: Object.assign({}, STYLE.rowActions, { padding: "10px 0 6px" }) },
							h("button", { type: "button", style: STYLE.primaryButton, onClick: saveEnhancers }, t("saveEnhancers")))));

							}
			return GearboxSection;
		}

		/** Resolve the active language for the nav label. */
		function activeLanguage(ctx) {
			try {
				const fromService = ctx.locale?.current?.() ?? ctx.locale?.language?.();
				if (typeof fromService === "string" && fromService.length > 0) return fromService.startsWith("zh") ? "zh" : "en";
			} catch {
				/* fall through to the document */
			}
			return String(document.documentElement.lang ?? navigator.language ?? "en").startsWith("zh") ? "zh" : "en";
		}

		function apply(ctx) {
			// Locale first, and separately contained: a missing service must not cost
			// the settings section.
			let language = "en";
			try {
				for (const code of Object.keys(DICTIONARIES)) {
					ctx.locale?.register?.(NS, code, DICTIONARIES[code]);
				}
				language = activeLanguage(ctx);
			} catch (error) {
				ctx.logger?.warn?.("dsh-gearbox: locale registration skipped", error);
			}
			const t = (key) => DICTIONARIES[language]?.[key] ?? DICTIONARIES.en[key] ?? key;

			try {
				const React = require("react");
				if (React === undefined || React === null) throw new Error("react is not in the client module table");
				const Section = makeSection(React, t);
				ctx.effect(
					() => ctx.slots.inject(SETTINGS_SLOT, () => ctx.slots.register({
						name: SETTINGS_SLOT,
						id: SECTION_ID,
						// After the built-ins; the shell sorts by this.
						order: 120,
						label: () => t("settingsNav")
					}, Section)),
					"dsh-gearbox: settings section"
				);
				ctx.logger?.info?.("dsh-gearbox: settings section registered");
			} catch (error) {
				// Never rethrow during the renderer's boot: a failed section is a
				// missing row, a thrown apply is a broken app.
				ctx.logger?.warn?.("dsh-gearbox: settings section not registered", error);
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
