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
		 * ## What it contributes
		 *
		 * One **settings section** — the 「模型变速箱」 row in the settings
		 * navigation, the same mechanism `dsh-better-sidebar` uses for 「侧边卡片」:
		 *
		 *   ctx.slots.inject("settings.section", () => ctx.slots.register({
		 *     name: "settings.section", id, order, label
		 *   }, Component))
		 *
		 * DSH 0.1.x projects only `id`, `order` and `label` from that registration.
		 *
		 * The section's body is an **iframe onto `/gears/ui`**, the plugin's own
		 * settings page. That is deliberate: the page is a separate document, so
		 * even a runtime error inside it cannot touch the settings shell or the
		 * renderer — the failure mode that once reset this profile. It also means
		 * the two surfaces cannot drift, because there is only one implementation.
		 *
		 * Everything here is defensive on purpose: this half is loaded during the
		 * renderer's boot, so a throw in `apply` must never escape.
		 */

		const SETTINGS_SLOT = "settings.section";
		const SECTION_ID = "dsh-gearbox";
		const PAGE_PATH = "/gears/ui";

		/** Locale namespace the dictionaries land under. */
		const NS = "dsh-gearbox";

		const DICTIONARIES = {
			zh: {
				meta: {
					title: "模型变速箱",
					description: "第三方模型的思考档位与图像生成通道"
				},
				settingsNav: "模型变速箱",
				sectionTitle: "模型变速箱 · 档位与图像通道",
				sectionHint: "下方是插件自带的设置页，内容来自运行中的真实状态。",
				openInTab: "在新标签打开"
			},
			en: {
				meta: {
					title: "Gearbox",
					description: "Reasoning-effort gears and an image-generation lane for third-party models"
				},
				settingsNav: "Gearbox",
				sectionTitle: "Gearbox · gears and image lane",
				sectionHint: "The plugin's own settings page, showing live state.",
				openInTab: "Open in a new tab"
			}
		};

		/** The shell's current theme, so the embedded page does not clash. */
		function shellTheme() {
			try {
				const root = document.documentElement;
				const marker = `${root.getAttribute("data-dsh-theme") ?? ""} ${root.getAttribute("data-theme") ?? ""} ${root.className ?? ""}`;
				if (/dark/i.test(marker)) return "dark";
				if (/light/i.test(marker)) return "light";
				return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
			} catch {
				return "light";
			}
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

		/**
		 * The section body: a header row plus the plugin's page in a frame.
		 *
		 * Written with `createElement` rather than JSX because this bundle is served
		 * as a plain script with no transform step.
		 */
		function makeSection(React, t) {
			return function GearboxSection() {
				const theme = shellTheme();
				const src = `${PAGE_PATH}?theme=${theme}`;
				return React.createElement(
					"div",
					{ style: { display: "flex", flexDirection: "column", gap: "10px", minHeight: "560px" } },
					React.createElement(
						"div",
						{ style: { display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" } },
						React.createElement("strong", { style: { fontSize: "14px" } }, t("sectionTitle")),
						React.createElement("a", { href: src, target: "_blank", rel: "noreferrer", style: { fontSize: "12px" } }, t("openInTab")),
						React.createElement("span", { style: { fontSize: "12px", opacity: 0.65 } }, t("sectionHint"))
					),
					React.createElement("iframe", {
						src,
						title: t("sectionTitle"),
						style: {
							flex: "1 1 auto",
							width: "100%",
							minHeight: "520px",
							border: "1px solid rgba(127,127,127,.35)",
							borderRadius: "8px",
							background: theme === "dark" ? "#17181a" : "#ffffff"
						}
					})
				);
			};
		}

		/**
		 * Client-side services, by **service name**.
		 *
		 * This is the client half's own inject map, and it is resolved inside the
		 * client plugin tree — so it names services (`slots`, `locale`), the same
		 * shape `dsh-better-sidebar` (`"slots", "sessions", "locale", …`) and
		 * `dsh-client-ui-plugin-manager` (`"slots", "locale", "remote", …`) use.
		 *
		 * **Do not put package ids here.** The package ids belong in
		 * `package.json` → `dsh.client.inject`, which seeds the module table; naming
		 * a package here leaves the entry parked forever with
		 * `pending (waiting for services: @deepseek-ai/…)`, and because the web app
		 * asserts that every entry activated, the whole app then refuses to boot.
		 */
		const inject = ["slots", "locale"];

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
