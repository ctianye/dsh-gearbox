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
				transportHint: "传输值（wire value）留空：off 表示不发任何字段，其余档位默认发与模式同名的值。",
				recommended: "（推荐）",
				liveHint: "「前端实际可用」来自适配器本身（adapter），是 composer 渲染档位选择器的依据。改动保存后立即生效。",
				enhancer: "提示词增强角色（图像通道）",
				enhancerT2I: "文生图提示词扩写 PE-T2I",
				enhancerI2I: "编辑指令改写 PE-I2I",
				vendor: "供应商",
				modelField: "模型",
				saveEnhancers: "保存增强角色",
				saved: "已保存",
				textProtocols: "文本协议（写进 llm-pi-ai 路由）",
				imageProtocols: "图像协议（本插件 Image Lane）",
				imageMode: "图像模式",
				imageModeHint: "开启后输入区出现提示词优化按钮（生图请用 /image 或 agent 模式）",
				optimize: "优化提示词",
				optimizing: "优化中…",
				optimizeHint: "调用设置里绑定的提示词优化模型改写输入框内容",
				draftUnavailable: "读不到输入框内容，无法写回（外壳结构变了？）",
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
				textProtocols: "Text protocols (llm-pi-ai route)",
				imageProtocols: "Image protocols (this plugin's lane)",
				imageMode: "Image",
				imageModeHint: "Shows the prompt-optimize button (generate images with /image or agent mode)",
				optimize: "Optimize",
				optimizing: "Optimizing…",
				optimizeHint: "Rewrite the composer text with the configured enhancer model",
				draftUnavailable: "Could not read the composer text back",
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
			"openai-responses": "OpenAI Responses（响应式）",
			"openai-completions": "OpenAI Chat Completions（对话补全）",
			"anthropic-messages": "Anthropic Messages（消息）"
		};

		const IMAGE_PROTOCOL_LABEL = {
			'images-generations': '图像 · /v1/images/generations（文生图）',
			'images-edits': '图像 · /v1/images/edits（图编辑/图生图）',
			'images-variations': '图像 · /v1/images/variations（图像变体）'
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
				fontFamily: "var(--dsw-font-family, inherit)", fontSize: "12.5px", lineHeight: 1.55
			},
			head: {
				display: "flex", alignItems: "baseline", gap: "10px",
				padding: "2px 0 10px", borderBottom: "1px solid var(--dsw-alias-hairline)", marginBottom: "4px"
			},
			title: { fontSize: "13px", fontWeight: 650, color: "var(--dsw-alias-label-primary)" },
			note: { fontSize: "11.5px", color: "var(--dsw-alias-label-secondary)" },
			muted: { fontSize: "11.5px", color: "var(--dsw-alias-label-tertiary)" },
			mono: { fontFamily: "ui-monospace, Consolas, monospace", fontSize: "12px" },
			card: {
				background: "var(--dsw-alias-bg-layer-1)", border: "1px solid var(--dsw-alias-border-l1)",
				borderRadius: "10px", padding: "2px 14px", marginBottom: "10px", minWidth: 0
			},
			row: {
				display: "grid", gridTemplateColumns: "minmax(96px, 180px) minmax(0, 1fr)", gap: "12px",
				padding: "10px 0", borderBottom: "1px solid var(--dsw-alias-hairline)", alignItems: "start",
				minWidth: 0
			},
			rowLast: { borderBottom: "none" },
			rowLabel: { display: "flex", flexDirection: "column", gap: "2px", paddingTop: "4px" },
			rowControl: { display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 },
			controlLine: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", minWidth: 0 },
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
			h3: { fontSize: "12.5px", margin: "12px 0 2px", fontWeight: 650, color: "var(--dsw-alias-label-primary)" },
			roleRow: {
				display: "grid", gridTemplateColumns: "minmax(96px, 180px) minmax(0, 1fr)", gap: "12px",
				padding: "8px 0", borderBottom: "1px solid var(--dsw-alias-hairline)", alignItems: "center",
				minWidth: 0
			},
			roleLabel: { fontSize: "12.5px", color: "var(--dsw-alias-label-primary)" },
			fields: { display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", minWidth: 0 },
			field: { display: "flex", flexDirection: "column", gap: "3px", fontSize: "11.5px", color: "var(--dsw-alias-label-secondary)" },
			modeBox: {
				marginTop: "2px", padding: "10px", background: "var(--dsw-alias-bg-layer-2)",
				border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "10px",
				display: "flex", flexDirection: "column", gap: "8px"
			},
			modeRow: { display: "flex", gap: "6px", alignItems: "center" },
			modeInput: { width: "140px" },
			rowActions: { display: "flex", gap: "8px", alignItems: "center" },
			// 一级标题：供应商（DSH 路由）。比正文（12.5px）明显大一档，并用主文字色。
			groupHead: {
				display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap",
				fontSize: "15px", fontWeight: 700, color: "var(--dsw-alias-label-primary)",
				padding: "16px 0 4px", letterSpacing: "0.01em",
				borderBottom: "1px solid var(--dsw-alias-hairline)", marginBottom: "2px"
			},
			groupHeadMeta: { fontSize: "11.5px", fontWeight: 400, color: "var(--dsw-alias-label-tertiary)" },
			composerRow: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0 },
			chip: {
				font: "inherit", fontSize: "11.5px", lineHeight: 1.2, padding: "4px 9px",
				borderRadius: "999px", border: "1px solid var(--dsw-alias-border-l2)",
				background: "transparent", color: "var(--dsw-alias-label-secondary)", cursor: "pointer",
				whiteSpace: "nowrap"
			},
			chipOn: {
				borderColor: "var(--dsw-alias-brand-primary)",
				background: "var(--dsw-alias-accent-soft, rgba(37,99,235,.14))",
				color: "var(--dsw-alias-label-primary)"
			},
			chipDisabled: { opacity: 0.55, cursor: "default" },
			composerNote: { fontSize: "11.5px", color: "var(--dsw-alias-state-warn-label, var(--dsw-alias-label-tertiary))" },
			ddWrap: { position: "relative", display: "inline-flex", minWidth: 0, maxWidth: "100%" },
			ddButton: {
				font: "inherit", fontSize: "12.5px", color: "var(--dsw-alias-label-primary)",
				background: "var(--dsw-alias-bg-layer-2)", border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: "8px", padding: "6px 10px", cursor: "pointer",
				display: "flex", alignItems: "center", gap: "8px", minWidth: 0, maxWidth: "100%",
				overflow: "hidden"
			},
			ddButtonOpen: { borderColor: "var(--dsw-alias-brand-primary)" },
			ddLabel: { flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
			ddCaret: { marginLeft: "auto", color: "var(--dsw-alias-label-tertiary)", fontSize: "10px" },
			ddMenu: {
				position: "absolute", top: "calc(100% + 4px)", right: 0, left: "auto", zIndex: 40,
				minWidth: "100%", width: "max-content", maxWidth: "min(64vw, 340px)", maxHeight: "300px",
				overflowY: "auto", overflowX: "hidden",
				background: "var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2))",
				border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "10px",
				boxShadow: "0 8px 24px rgba(0,0,0,.18)", padding: "4px"
			},
			ddGroup: {
				fontSize: "11px", fontWeight: 650, color: "var(--dsw-alias-label-tertiary)",
				padding: "7px 8px 3px"
			},
			ddItem: {
				display: "block", width: "100%", textAlign: "left", font: "inherit", fontSize: "12px",
				color: "var(--dsw-alias-label-primary)", background: "transparent", border: "none",
				borderRadius: "6px", padding: "6px 8px", cursor: "pointer", whiteSpace: "normal", lineHeight: 1.4
			},
			ddItemActive: { background: "var(--dsw-alias-interactive-bg-active, var(--dsw-alias-accent-soft))" },
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
		/** 把选中的档位值还原成下拉按钮上显示的文案。 */
		function makeGearLabel(presets) {
			return (selected) => {
				if (selected === '') return '';
				if (selected === 'custom') return '';
				const id = selected.slice('preset:'.length);
				const preset = presets.find((entry) => entry.id === id);
				if (preset === undefined) return id;
				const gears = Object.keys(preset.levels || {}).filter((gear) => preset.levels[gear] !== null && preset.levels[gear] !== undefined);
				return (preset.label || id) + ' · ' + gears.join('/');
			};
		}

	/**
	 * The composer's gearbox controls: an image-mode toggle, plus a prompt-optimize
	 * button that only appears while image mode is on.
	 *
	 * Rendered through `conversation.input.dock`, whose spec passes `sessionId`. A
	 * shipped first-party plugin (the input queue) uses the same seam, so the slot is
	 * the supported way in.
	 *
	 * ## Reading and writing the draft
	 *
	 * The conversation service is reachable from here
	 * (`ctx.sessions.scope(sessionId).get('conversation')`), but its draft API has not
	 * been verified, so the draft is read and written through the composer's own
	 * `<textarea>` instead: set `value` via the native setter and dispatch `input`,
	 * which is what React listens to. That is the fragile part of this component —
	 * if the shell ever renames its composer markup, the optimize button stops
	 * writing back (it will not corrupt anything, it just won't take effect), and the
	 * fix is to switch to the conversation service's API once its shape is confirmed.
	 *
	 * Everything else is server-derived: the toggle reads and writes `ui.imageMode`
	 * through `/gears/api/own-config`, and optimization calls `/gears/api/enhance`.
	 */
	function makeComposerActions(React, t) {
		return function ComposerActions() {
			const onState = React.useState(false);
			const on = onState[0];
			const setOn = onState[1];
			const busyState = React.useState(false);
			const busy = busyState[0];
			const setBusy = busyState[1];
			const noteState = React.useState(null);
			const note = noteState[0];
			const setNote = noteState[1];

			React.useEffect(() => {
				let cancelled = false;
				fetch(API + '/own-config')
					.then((response) => response.json())
					.then((payload) => {
						if (cancelled || !payload.ok) return;
						setOn((((payload.config || {}).ui || {}).imageMode) === true);
					})
					.catch(() => { /* 读不到就维持默认关，不影响输入 */ });
				return () => { cancelled = true; };
			}, []);

			/** The composer's textarea — see the note above about why this is DOM-level. */
			const draftElement = () => {
				const seat = document.querySelector('[data-composer-seat]');
				return (seat === null ? null : seat.querySelector('textarea')) || document.querySelector('textarea');
			};
			const readDraft = () => {
				const element = draftElement();
				return element === null ? '' : element.value;
			};
			const writeDraft = (text) => {
				const element = draftElement();
				if (element === null) return false;
				const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
				descriptor.set.call(element, text);
				element.dispatchEvent(new Event('input', { bubbles: true }));
				element.focus();
				return true;
			};

			const toggle = async () => {
				const next = !on;
				setOn(next);
				setNote(null);
				try {
					const payload = await fetch(API + '/own-config', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ ui: { imageMode: next } })
					}).then((response) => response.json());
					if (!payload.ok) throw new Error(payload.error || 'save failed');
				} catch (error) {
					setOn(!next);
					setNote(String((error && error.message) || error));
				}
			};

			const optimize = async () => {
				const prompt = readDraft().trim();
				if (prompt === '' || busy) return;
				setBusy(true);
				setNote(null);
				try {
					const payload = await fetch(API + '/enhance', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ prompt: prompt })
					}).then((response) => response.json());
					if (!payload.ok) throw new Error(payload.error || 'enhance failed');
					if (!writeDraft(payload.prompt)) throw new Error(t('draftUnavailable'));
				} catch (error) {
					setNote(String((error && error.message) || error));
				} finally {
					setBusy(false);
				}
			};

			const chip = (label, active, handler, disabled, title) => React.createElement('button', {
				type: 'button',
				title: title || label,
				disabled: disabled === true,
				style: Object.assign({}, STYLE.chip, active ? STYLE.chipOn : null, disabled === true ? STYLE.chipDisabled : null),
				onClick: handler
			}, label);

			return React.createElement('div', { style: STYLE.composerRow },
				chip(t('imageMode'), on, toggle, false, t('imageModeHint')),
				on ? chip(busy ? t('optimizing') : t('optimize'), false, optimize, busy, t('optimizeHint')) : null,
				note === null ? null : React.createElement('span', { style: STYLE.composerNote }, note));
		};
	}
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
				// 哪一个自绘下拉是展开的（原生 select 的弹层样式由系统决定，改不动，所以自绘）。
				const openState = React.useState(null);
				const openKey = openState[0];
				const setOpenKey = openState[1];

				/**
				 * A settings-page dropdown: a button plus our own popup list.
				 *
				 * Native `<select>` popups are drawn by the OS — their font, row height
				 * and blue highlight cannot be themed, which is exactly what makes them
				 * look out of place next to the shell's own controls. This draws the
				 * list with the shell's tokens instead.
				 *
				 * @param k  unique key for open/close state
				 * @param currentValue  the raw value, for the selected mark
				 * @param currentLabel  what the button shows
				 * @param options  `{ value, label, group? }` — `group` renders a heading
				 */
				const dropdown = (k, currentValue, currentLabel, options, onPick, maxWidth) => {
					const open = openKey === k;
					return createElement("div", { style: STYLE.ddWrap },
						createElement("button", {
							type: "button",
							style: Object.assign({}, STYLE.ddButton, maxWidth ? { maxWidth: maxWidth } : null, open ? STYLE.ddButtonOpen : null),
							onClick: () => setOpenKey(open ? null : k)
						},
							createElement("span", { style: STYLE.ddLabel }, currentLabel),
							createElement("span", { style: STYLE.ddCaret }, "▾")),
						open ? createElement("div", { style: STYLE.ddMenu },
							options.map((option, i) => option.group
								? createElement("div", { key: "g" + i, style: STYLE.ddGroup }, option.group)
								: createElement("button", {
									key: "o" + i,
									type: "button",
									style: Object.assign({}, STYLE.ddItem, option.value === currentValue ? STYLE.ddItemActive : null),
									onClick: () => { setOpenKey(null); onPick(option.value); }
								}, option.label))) : null);
				};

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
				const imageProtocols = info.imageProtocols || [];
				const presets = ((data.presets || {}).presets) || [];
				const gearLabel = makeGearLabel(presets);
				const providers = Object.keys(((info.lane || {}).providers) || {});
				const capables = info.thinkingCapable || {};
				const lastApply = info.lastApply;

				const statusLine = lastApply
					? (lastApply.error
						? t("writeFailed") + ": " + lastApply.error
						: [t("lastWrite"), String(lastApply.at || "").replace("T", " ").slice(0, 19), lastApply.changed ? "" : t("noChange"), t("attempts") + " " + String(lastApply.attempts ?? 1) + t("times")].filter((part) => part !== "").join(" · "))
					: "";

				// 按供应商分组：路由名作大标题，其下是该供应商的模型。
				const rows = [];
				let lastRoute = null;
				for (const [index, row] of models.entries()) {
					if (row.route !== lastRoute) {
						rows.push(createElement("div", { key: "head-" + row.route, style: STYLE.groupHead },
							createElement("span", null, row.route),
							createElement("span", { style: STYLE.groupHeadMeta }, PROTOCOL_LABEL[row.api] || row.api)));
						lastRoute = row.route;
					}
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
						const gearOptions = [{ value: "", label: t("unset") + (suggested.length ? " · " + suggested[0] + t("recommended") : "") }];
						for (const vendor of vendors) {
							gearOptions.push({ group: vendor.label });
							for (const model of vendor.models || []) {
								gearOptions.push({
									value: "preset:" + model.id,
									label: (model.label || model.id) + " · " + (model.gears || []).join("/")
								});
							}
						}
						gearOptions.push({ value: "custom", label: t("custom") });
						const gearSelect = dropdown(
							"gear:" + k,
							selected,
							selected === "custom" ? t("custom") : (selected === "" ? t("unset") + (suggested.length ? " · " + suggested[0] : "") : gearLabel(selected)),
							gearOptions,
							(value) => {
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
							},
							"100%");

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

					// ---- 协议：文本协议写进 llm-pi-ai，图像协议写进本插件的 Image Lane ----
					const protocolOptions = [
						{ group: t("textProtocols") },
						...protocols.map((api) => ({ value: api, label: PROTOCOL_LABEL[api] || api })),
						{ group: t("imageProtocols") },
						...imageProtocols.map((api) => ({ value: api, label: IMAGE_PROTOCOL_LABEL[api] || api })),
					];
					const protocolSelect = dropdown(
						"proto:" + k,
						row.api,
						PROTOCOL_LABEL[row.api] || row.api,
						protocolOptions,
						(value) => switchProtocol(row.model, value),
						"100%");

					const element = createElement("div", { key: k, style: rowStyle },
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
					rows.push(element);
				}

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

		/**
		 * Resolve the active language.
		 *
		 * Order matters and was wrong once: the shell sets
		 * `document.documentElement.lang = "en"` even when the app runs in Chinese, so
		 * consulting the document first pinned the whole panel to English. The
		 * browser/Electron locale (`navigator.language`, which follows the OS and
		 * matched `locale: zh-CN` in the app log) is the reliable signal, so it wins;
		 * the document and the locale service are only fallbacks.
		 */
		function activeLanguage(ctx) {
			const looksChinese = (value) => typeof value === "string" && /^zh/i.test(value);
			try {
				if (looksChinese(navigator?.language)) return "zh";
				if (Array.isArray(navigator?.languages) && navigator.languages.some(looksChinese)) return "zh";
				if (looksChinese(document.documentElement?.lang)) return "zh";
				const fromService = ctx.locale?.current?.() ?? ctx.locale?.language?.();
				if (looksChinese(fromService)) return "zh";
			} catch {
				/* any of these can be unavailable; fall through to English */
			}
			return "en";
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
				// 输入条内的开关与优化按钮。该插槽的 spec 会传 sessionId；
				// 组件目前不依赖它（草稿走 DOM），保留是为了将来切到会话服务 API。
				const ComposerActions = makeComposerActions(React, t);
				/**
				 * 控件要落在输入条底部那一行，所以首选 `conversation.input.left`（左侧控件区，
				 * 紧邻「+」与「工作区内修改」）。`conversation.input.dock` 会被渲染在输入条
				 * **上方**，另起一行，位置不对。
				 *
				 * 两个插槽是否都对第三方开放并不能从代码确定，因此按顺序试：第一个注册成功
				 * 即止，全部失败则本轮没有控件（不会抛错影响渲染层）。
				 */
				ctx.effect(() => {
					for (const slot of ["conversation.input.left", "conversation.input.dock"]) {
						try {
							return ctx.slots.inject(slot, () => ctx.slots.register({
								name: slot,
								id: "gearbox-image-mode",
								order: 30,
								label: () => t("imageMode")
							}, ComposerActions));
						} catch (error) {
							ctx.logger?.warn?.(`dsh-gearbox: ${slot} 不可注册，换下一个`, error);
						}
					}
					return undefined;
				}, "dsh-gearbox: composer controls");
				ctx.logger?.info?.("dsh-gearbox: composer controls registered");
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
