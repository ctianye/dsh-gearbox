/**
 * dsh-gearbox Image Lane: direct image work through configured OpenAI-compatible
 * endpoints, bypassing the chat adapter's image-output restriction
 * (dsh-llm-pi-ai refuses assistant image blocks outright, so image generation
 * has no first-class support in DSH and needs its own lane).
 *
 * ## The binding model: provider / model / protocol are three separate things
 *
 *   provider   connection facts only — base URL, credential ref, extra headers
 *   model      an id, sent verbatim as the request body's `model`
 *   protocol   WHICH ENDPOINT a call goes to, bound to the model, not the provider
 *
 * That separation is the point. One provider can serve a text→image model on
 * `/v1/images/generations`, an edit model on `/v1/images/edits` and a prompt
 * enhancer on `/v1/chat/completions` at the same time, and two providers may
 * both use the same protocol. Providers are connection profiles; the protocol
 * is a per-model choice.
 *
 * ## Protocols
 *
 *   images-generations  POST /v1/images/generations — JSON, text→image.
 *                       Returns `data[0].b64_json` (PNG, decode and save) or a URL.
 *                       `bodyStyle: siliconflow` switches the body to
 *                       `{ image_size, batch_size }` instead of `{ size, n }`.
 *   images-edits        POST /v1/images/edits — multipart form, image→image,
 *                       up to `maxInputImages` (default 4) input images.
 *   chat                POST /v1/chat/completions — JSON, returns text. Used for
 *                       the two enhancer roles (PE-T2I / PE-I2I) and optionally
 *                       as a generator that accepts image parts.
 *
 * ## Roles
 *
 * A role is a slot in the pipeline with its own provider+model+protocol binding
 * and its own gear set:
 *
 *   generator        text→image.                     protocols: images-generations | chat
 *   editor           image→image.                    protocols: images-edits | chat
 *   promptEnhancer   expands a description (PE-T2I). protocol:  chat
 *   editEnhancer     rewrites an edit instruction.   protocol:  chat
 *
 * Only `generator` is needed for text→image. A reference image selects the
 * `editor` role when one is configured, otherwise it falls back to `generator`
 * if that protocol can carry images at all.
 *
 * ## Gears
 *
 * A gear is a named bag of request-body fields: "call this model at this gear,
 * and these parameters go on the wire". The plugin never invents field names —
 * `gears.standard: { size: "1024x1024", n: 1 }` merges exactly those keys.
 * `gear` selects which one applies, and the tool/command can override it per
 * call. This is also how a chat-role model receives a reasoning parameter, for
 * example `gears.deep: { reasoning_effort: "high" }`.
 *
 * ## Shape notes (verified against the live runtime, not assumed)
 *
 * `defineTool` takes a ParameterSchemaSpec for `parameters` and `execute(args,
 * exec)` returns the canonical OUTPUT VALUE (checked against `output.schema`,
 * while the model reads `output.render`'s text); the calling session's workspace
 * is `exec.agent?.session.header.cwd`. No `timeoutMs` is declared by default:
 * dsh-tool-call-timeout-policy only enforces a timeout a tool asks for, and
 * image work is slow by nature — the enhancers alone measured 13–18 s against a
 * real endpoint. A per-role `timeoutMs` is available in the config for anyone
 * who wants a cap.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, join, resolve as resolvePath, extname } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';

/** Endpoint families the lane can speak. */
export const IMAGE_PROTOCOLS = ['images-generations', 'images-edits', 'images-variations', 'chat'];

/** Request-body dialects for `images-generations`. */
export const IMAGE_BODY_STYLES = ['openai', 'siliconflow'];

/**
 * Pipeline slots. `protocols` documents what each slot accepts; the settings
 * panel reads this list so the roles are described in one place.
 */
export const IMAGE_ROLES = [
  { id: 'generator', label: '文生图生成器', protocols: ['images-generations', 'chat'] },
  { id: 'editor', label: '图生图编辑器', protocols: ['images-edits', 'chat'] },
  { id: 'variator', label: '图像变体', protocols: ['images-variations'] },
  { id: 'promptEnhancer', label: '文生图提示词增强 PE-T2I', protocols: ['chat'] },
  { id: 'editEnhancer', label: '编辑指令改写 PE-I2I', protocols: ['chat'] },
];

/** Default images/edits multipart field name. */
const DEFAULT_IMAGE_FIELD = 'image';

/** Default cap on images/edits inputs. */
const DEFAULT_MAX_INPUT_IMAGES = 4;

/** Mime type for a reference file, by extension. */
function mimeOf(path) {
  switch (extname(path).toLowerCase()) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    default: return 'image/png';
  }
}

/** The legacy flat `style` mapped onto a protocol + body style. */
function protocolFromStyle(style) {
  if (style === 'siliconflow') return { protocol: 'images-generations', bodyStyle: 'siliconflow' };
  if (style === 'images') return { protocol: 'images-generations', bodyStyle: 'openai' };
  return { protocol: 'chat', bodyStyle: 'openai' };
}

/**
 * Resolve the configured image settings into `{ providers, roles, … }`.
 *
 * Supports both shapes:
 *  - the per-model binding form (`image.roles`), where each role names its own
 *    provider/model/protocol;
 *  - the original provider-flat form (`providers.<name>.style/generator/…`),
 *    synthesised into roles so an existing config keeps working untouched.
 * When both are present `roles` wins, per role.
 */
export function normalizeImage(image) {
  const providers = image?.providers ?? {};
  const defaultProvider = image?.defaultProvider ?? Object.keys(providers)[0] ?? null;
  const explicit = image?.roles ?? {};
  const roles = {};

  for (const spec of IMAGE_ROLES) {
    const configured = explicit[spec.id];
    if (configured !== undefined && configured.model) {
      roles[spec.id] = {
        id: spec.id,
        provider: configured.provider || defaultProvider,
        model: configured.model,
        protocol: configured.protocol ?? spec.protocols[0],
        bodyStyle: configured.bodyStyle ?? 'openai',
        size: configured.size,
        gears: configured.gears ?? {},
        gear: configured.gear,
        imageField: configured.imageField ?? DEFAULT_IMAGE_FIELD,
        maxInputImages: configured.maxInputImages ?? DEFAULT_MAX_INPUT_IMAGES,
        timeoutMs: configured.timeoutMs,
        source: 'roles',
      };
      continue;
    }
    // Legacy: whichever provider declares this role's flat field.
    for (const [name, provider] of Object.entries(providers)) {
      const legacyModel = provider?.[spec.id];
      if (typeof legacyModel !== 'string' || legacyModel.length === 0) continue;
      const mapped = protocolFromStyle(provider.style);
      roles[spec.id] = {
        id: spec.id,
        provider: name,
        model: legacyModel,
        // The enhancer roles are chat by definition, whatever the provider style.
        protocol: spec.id === 'generator' ? mapped.protocol : 'chat',
        bodyStyle: spec.id === 'generator' ? mapped.bodyStyle : 'openai',
        size: provider.size,
        gears: {},
        gear: undefined,
        imageField: DEFAULT_IMAGE_FIELD,
        maxInputImages: DEFAULT_MAX_INPUT_IMAGES,
        timeoutMs: undefined,
        source: 'provider-flat',
      };
      break;
    }
  }

  return {
    providers,
    defaultProvider,
    roles,
    saveDir: image?.saveDir ?? '.dsh-gearbox',
    autoEnhance: image?.autoEnhance ?? true,
  };
}

/** The request-body fields a role's selected gear contributes. */
function gearParams(role, override) {
  const name = override ?? role?.gear;
  if (name === undefined || role?.gears?.[name] === undefined) return {};
  return { ...role.gears[name] };
}

/** Auth + extra headers for a provider. */
function headersFor(provider, apiKey) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
    ...(provider.headers ?? {}),
  };
}

/** `fetch` with an optional per-role timeout. No timeout means no cap. */
function request(url, init, timeoutMs) {
  const bounded = typeof timeoutMs === 'number' && timeoutMs > 0
    ? { ...init, signal: AbortSignal.timeout(timeoutMs) }
    : init;
  return fetch(url, bounded);
}

/**
 * Turn references into OpenAI `image_url` content parts.
 *
 * Accepts data URLs, http(s) URLs, or paths — the last resolved against the
 * session workspace, which is the only place an agent can have put a file.
 */
export async function referenceParts(references, cwd) {
  const parts = [];
  for (const reference of references) {
    if (/^data:image\//.test(reference) || /^https?:\/\//.test(reference)) {
      parts.push({ type: 'image_url', image_url: { url: reference } });
      continue;
    }
    const path = resolvePath(cwd ?? process.cwd(), reference);
    const bytes = await readFile(path);
    parts.push({ type: 'image_url', image_url: { url: `data:${mimeOf(path)};base64,${bytes.toString('base64')}` } });
  }
  return parts;
}

/** The bytes + filename of each reference, for a multipart upload. */
export async function referenceFiles(references, cwd) {
  const files = [];
  for (const reference of references) {
    if (/^data:image\//.test(reference)) {
      const match = /^data:([^;]+);base64,(.+)$/s.exec(reference);
      files.push({ bytes: Buffer.from(match[2], 'base64'), mime: match[1], name: 'reference.png' });
      continue;
    }
    if (/^https?:\/\//.test(reference)) {
      const res = await fetch(reference);
      if (!res.ok) throw new Error(`reference download HTTP ${res.status}`);
      files.push({
        bytes: Buffer.from(await res.arrayBuffer()),
        mime: res.headers.get('content-type')?.split(';')[0] ?? 'image/png',
        name: basename(new URL(reference).pathname) || 'reference.png',
      });
      continue;
    }
    const path = resolvePath(cwd ?? process.cwd(), reference);
    files.push({ bytes: await readFile(path), mime: mimeOf(path), name: basename(path) });
  }
  return files;
}

/** Extract the first image (base64 or URL) from any known response shape. */
export function extractImage(body) {
  const dataUri = /^data:([^;]+);base64,(.+)$/s;
  /** One candidate URL/data-URL, normalised to `{mime, b64}` or `{mime, url}`. */
  const fromUrl = (url) => {
    if (typeof url !== 'string' || url.length === 0) return undefined;
    const match = url.match(dataUri);
    if (match) return { mime: match[1], b64: match[2] };
    if (/^https?:\/\//.test(url)) return { mime: 'image/png', url };
    return undefined;
  };
  // 1) OpenAI Images API: data[0].b64_json / url  (images/generations + images/edits)
  const first = body?.data?.[0];
  if (first?.b64_json) return { mime: 'image/png', b64: first.b64_json };
  const dataUrl = fromUrl(first?.url);
  if (dataUrl) return dataUrl;
  // 2) Responses API: output[].content[].image_url / output[].result
  for (const item of body?.output ?? []) {
    if (typeof item?.result === 'string') return { mime: 'image/png', b64: item.result };
    for (const part of item?.content ?? []) {
      const hit = fromUrl(part?.image_url?.url ?? part?.image_url ?? part?.url ?? (typeof part?.image === 'string' ? part.image : undefined));
      if (hit) return hit;
    }
  }
  // 3) chat.completions: choices[0].message.images[]
  const message = body?.choices?.[0]?.message;
  if (Array.isArray(message?.images)) {
    for (const lead of message.images) {
      const hit = fromUrl(typeof lead === 'string' ? lead : (lead?.image_url?.url ?? lead?.url));
      if (hit) return hit;
    }
  }
  // 4) message.content[] image parts
  if (Array.isArray(message?.content)) {
    for (const part of message.content) {
      const hit = fromUrl(part?.image_url?.url ?? part?.url);
      if (hit) return hit;
    }
  }
  // 5) siliconflow-style top-level images[]
  if (Array.isArray(body?.images)) {
    for (const entry of body.images) {
      const hit = fromUrl(typeof entry === 'string' ? entry : entry?.url);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** The text of a chat-completions reply. */
export function extractText(body) {
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('').trim();
  }
  return '';
}

async function fetchToB64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image download HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get('content-type')?.split(';')[0] ?? 'image/png';
  return { mime, b64: buffer.toString('base64') };
}

// ------------------------------------------------------------------ protocol callers

/** POST /v1/chat/completions — JSON in, text (or an image block) out. */
async function callChat({ provider, apiKey, role, prompt, references, system, params }) {
  const content = references === undefined || references.length === 0
    ? prompt
    : [{ type: 'text', text: prompt }, ...references];
  const messages = system === undefined
    ? [{ role: 'user', content }]
    : [{ role: 'system', content: system }, { role: 'user', content }];
  const res = await request(`${String(provider.baseURL).replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: headersFor(provider, apiKey),
    body: JSON.stringify({ model: role.model, stream: false, messages, ...params }),
  }, role.timeoutMs);
  if (!res.ok) throw new Error(`${role.id} ${role.model} HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

/** POST /v1/images/generations — JSON in, `data[0].b64_json` or URL out. */
async function callGenerations({ provider, apiKey, role, prompt, params }) {
  const body = { model: role.model, prompt, ...params };
  if (role.bodyStyle === 'siliconflow') {
    const size = params.image_size ?? params.size ?? role.size;
    if (size !== undefined) body.image_size = String(size);
    body.batch_size = params.batch_size ?? params.n ?? 1;
    delete body.size;
    delete body.n;
  } else {
    if (body.n === undefined) body.n = 1;
    if (role.size !== undefined && params.size === undefined) body.size = role.size;
  }
  const res = await request(`${String(provider.baseURL).replace(/\/+$/, '')}/images/generations`, {
    method: 'POST',
    headers: headersFor(provider, apiKey),
    body: JSON.stringify(body),
  }, role.timeoutMs);
  if (!res.ok) throw new Error(`${role.id} ${role.model} HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

/**
 * POST /v1/images/edits — multipart in, `data[0].b64_json` or URL out.
 *
 * Content-Type is deliberately left unset: `fetch` writes the multipart boundary
 * itself, and setting the header by hand produces a body the server cannot parse.
 */
async function callEdits({ provider, apiKey, role, prompt, files, params }) {
  const { authorization, 'content-type': _dropped, ...extra } = headersFor(provider, apiKey);
  const form = new FormData();
  const field = role.imageField || DEFAULT_IMAGE_FIELD;
  const limit = role.maxInputImages ?? DEFAULT_MAX_INPUT_IMAGES;
  for (const file of files.slice(0, limit)) {
    form.append(field, new Blob([file.bytes], { type: file.mime }), file.name);
  }
  form.append('model', role.model);
  form.append('prompt', prompt);
  form.append('n', String(params.n ?? 1));
  const size = params.size ?? role.size;
  if (size !== undefined) form.append('size', String(size));
  // Gear fields travel as form fields; multipart carries strings only.
  for (const [key, value] of Object.entries(params)) {
    if (key === 'n' || key === 'size') continue;
    form.append(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  const res = await request(`${String(provider.baseURL).replace(/\/+$/, '')}/images/edits`, {
    method: 'POST',
    headers: { authorization, ...extra },
    body: form,
  }, role.timeoutMs);
  if (!res.ok) throw new Error(`${role.id} ${role.model} HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

/**
 * POST /v1/images/variations — multipart with only the source image, no prompt.
 *
 * Same shape as {@link callEdits} minus the instruction: the endpoint returns
 * variants of the image it is given. `n` is how many variants to ask for.
 */
async function callVariations({ provider, apiKey, role, files, params }) {
  const { authorization, 'content-type': _dropped, ...extra } = headersFor(provider, apiKey);
  const form = new FormData();
  const field = role.imageField || DEFAULT_IMAGE_FIELD;
  for (const file of files.slice(0, role.maxInputImages ?? DEFAULT_MAX_INPUT_IMAGES)) {
    form.append(field, new Blob([file.bytes], { type: file.mime }), file.name);
  }
  form.append('model', role.model);
  form.append('n', String(params.n ?? 1));
  const size = params.size ?? role.size;
  if (size !== undefined) form.append('size', String(size));
  for (const [key, value] of Object.entries(params)) {
    if (key === 'n' || key === 'size') continue;
    form.append(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  const res = await request(String(provider.baseURL).replace(/\/+$/, '') + '/images/variations', {
    method: 'POST',
    headers: { authorization, ...extra },
    body: form,
  }, role.timeoutMs);
  if (!res.ok) throw new Error(role.id + ' ' + role.model + ' HTTP ' + res.status + ': ' + await res.text().catch(() => ''));
  return res.json();
}

// ------------------------------------------------------------------ registration

/**
 * Register the image lane: the `image_generate` tool, the `/gears/api/image`
 * route, and the `/image` command.
 * @returns `{ dispose, laneInfo, run, commands }`
 */
export function registerImageLane(ctx, { image }) {
  const lane = normalizeImage(image);
  const { providers, roles } = lane;

  const resolveProvider = (name) => {
    const key = name ?? lane.defaultProvider;
    const provider = key === null ? undefined : providers[key];
    if (provider === undefined) {
      throw new Error(`dsh-gearbox: image provider "${String(key)}" is not configured (plugin settings → Image Lane → providers)`);
    }
    return [key, provider];
  };

  const resolveKey = async (provider) => {
    const ref = provider.apiKeyEnv;
    const credentials = ctx.get('credentials');
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref).catch(() => undefined);
      if (hit?.value) return hit.value;
    }
    const env = process.env[ref];
    if (env) return env;
    throw new Error(`dsh-gearbox: credential "${ref}" resolves to nothing (store it in the credentials service or export the env var)`);
  };

  /**
   * One run of the pipeline.
   *
   * Role choice is driven by the input, not by configuration order: references
   * mean "edit", no references mean "generate". A reference with no `editor`
   * role falls back to the generator only when its protocol can carry an image.
   */
  const run = async ({
    prompt,
    references: rawReferences,
    provider: providerOverride,
    gear,
    size,
    enhance: doEnhance,
    cwd,
    exec,
  }) => {
    const references = rawReferences ?? [];
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new Error('dsh-gearbox: a non-empty prompt is required');
    }

    const wantsEdit = references.length > 0;
    let role = wantsEdit ? roles.editor : roles.generator;
    const laneKind = wantsEdit ? 'edit' : 't2i';
    if (role === undefined && wantsEdit) {
      const generator = roles.generator;
      if (generator === undefined) {
        throw new Error('dsh-gearbox: a reference image was given but neither an `editor` nor a `generator` role is configured');
      }
      if (generator.protocol !== 'chat') {
        throw new Error(`dsh-gearbox: a reference image needs an \`editor\` role on protocol images-edits, or a \`generator\` on protocol chat; the configured generator uses "${generator.protocol}"`);
      }
      role = generator;
    }
    if (role === undefined) {
      throw new Error('dsh-gearbox: no `generator` role is configured (plugin settings → Image Lane → roles)');
    }
    if (providerOverride !== undefined) role = { ...role, provider: providerOverride };

    const [providerName, provider] = resolveProvider(role.provider);
    const apiKey = await resolveKey(provider);
    const params = { ...gearParams(role, gear) };
    if (size !== undefined) params.size = size;
    const wantEnhance = doEnhance ?? lane.autoEnhance;

    // -- stage 1: rewrite the prompt, if an enhancer for this lane exists --
    const enhancerRole = laneKind === 'edit' ? roles.editEnhancer : roles.promptEnhancer;
    let finalPrompt = prompt;
    let enhanced = false;
    if (wantEnhance && enhancerRole !== undefined) {
      const [enhancerProviderName, enhancerProvider] = resolveProvider(enhancerRole.provider);
      const enhancerKey = enhancerProviderName === providerName ? apiKey : await resolveKey(enhancerProvider);
      const body = await callChat({
        provider: enhancerProvider,
        apiKey: enhancerKey,
        role: enhancerRole,
        prompt,
        references: laneKind === 'edit' ? await referenceParts(references, cwd) : undefined,
        system: laneKind === 'edit'
          ? 'You rewrite a short edit instruction into a precise, structured English image-editing instruction, using the reference image to name what to change. Output the instruction only.'
          : 'You expand a short description into a structured, high-quality English image-generation prompt. Output the prompt only.',
        params: gearParams(enhancerRole, undefined),
      });
      const rewritten = extractText(body);
      if (rewritten.length > 0) {
        finalPrompt = rewritten;
        enhanced = true;
      }
    }

    // -- stage 2: the generation/edit call, on the role's own protocol --
    let body;
    if (role.protocol === 'images-generations') {
      body = await callGenerations({ provider, apiKey, role, prompt: finalPrompt, params });
    } else if (role.protocol === 'images-variations') {
      if (references.length === 0) {
        throw new Error('dsh-gearbox: protocol images-variations needs one source image');
      }
      body = await callVariations({
        provider, apiKey, role,
        files: await referenceFiles(references, cwd),
        params,
      });
    } else if (role.protocol === 'images-edits') {
      if (references.length === 0) {
        throw new Error('dsh-gearbox: protocol images-edits needs at least one reference image');
      }
      body = await callEdits({
        provider, apiKey, role, prompt: finalPrompt,
        files: await referenceFiles(references, cwd),
        params,
      });
    } else {
      body = await callChat({
        provider, apiKey, role, prompt: finalPrompt,
        references: references.length > 0 ? await referenceParts(references, cwd) : undefined,
        params,
      });
    }

    let img = extractImage(body);
    if (img === undefined) {
      const text = extractText(body);
      throw new Error(`dsh-gearbox: ${role.model} returned no recognizable image (checked data[0].b64_json/url, output[] parts, message.images, content parts, images[])${text.length > 0 ? ` — it answered with text instead: ${text.slice(0, 160)}` : ''}`);
    }
    if (img.url !== undefined && img.b64 === undefined) img = await fetchToB64(img.url);

    const root = exec?.agent?.session?.header?.cwd ?? cwd ?? process.cwd();
    const dir = resolvePath(join(root, lane.saveDir));
    await mkdir(dir, { recursive: true });
    const ext = img.mime === 'image/jpeg' ? 'jpg' : img.mime === 'image/webp' ? 'webp' : 'png';
    const file = join(dir, `gearbox-${Date.now()}.${ext}`);
    await writeFile(file, Buffer.from(img.b64, 'base64'));

    return {
      file,
      provider: providerName,
      model: role.model,
      protocol: role.protocol,
      role: role.id,
      lane: laneKind,
      enhanced,
      gear: gear ?? role.gear ?? null,
      references: references.length,
      finalPrompt,
    };
  };

  // ---------------------------------------------------------------- tool
  const offTool = ctx.tools.register(defineTool({
    name: 'image_generate',
    description: 'Generate or edit an image through the gearbox Image Lane. Pass `images` (workspace paths, URLs or data URLs, up to 4) to edit reference pictures; the edit-instruction enhancer then rewrites the prompt against them. Without references the prompt enhancer expands the description. Returns the saved image path.',
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: '图像描述 / 编辑指令（中英文皆可；增强模型会改写为英文提示词或编辑指令）',
      },
      images: {
        type: 'array',
        items: { type: 'string' },
        description: '参考图（最多 4 张）：工作区相对路径、绝对路径、http(s) URL 或 data URL。提供时走 image→image 通道',
      },
      image: {
        type: 'string',
        description: '单张参考图（images 的简写，二选一）',
      },
      provider: {
        type: 'string',
        description: `覆盖该角色配置的供应商。可用：${Object.keys(providers).join(', ') || '(未配置)'}`,
      },
      gear: {
        type: 'string',
        description: '选用该模型的一个已配置档位名（覆盖配置里的默认档位）',
      },
      enhance: {
        type: 'boolean',
        description: '是否先走提示词增强（文生图 PE-T2I / 图生图 PE-I2I）；缺省跟随 autoEnhance 设置',
      },
      size: {
        type: 'string',
        description: '尺寸，如 1024x1024（覆盖角色配置的 size）',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          file: { type: 'string', required: true },
          provider: { type: 'string', required: true },
          model: { type: 'string', required: true },
          protocol: { type: 'string', required: true },
          lane: { type: 'string', required: true },
          finalPrompt: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.lane === 'edit' ? '已编辑图片' : '已生成图片'}（${value.provider} / ${value.model} / ${value.protocol}）\n\n![${value.lane === 'edit' ? '编辑结果' : '生成图片'}](${value.file.replaceAll('\\', '/')})\n\n保存路径：${value.file}\n\n最终提示词：\n\n> ${value.finalPrompt}`,
      }],
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `${args?.images !== undefined || args?.image !== undefined ? 'Edit' : 'Generate'} image: ${String(args?.prompt ?? '').slice(0, 56)}`,
      kind: 'other',
      rawInput: args?.prompt ?? '',
    }),
    async execute(args, exec) {
      const images = [
        ...(Array.isArray(args?.images) ? args.images : []),
        ...(typeof args?.image === 'string' ? [args.image] : []),
      ];
      return run({
        prompt: args?.prompt,
        references: images,
        provider: args?.provider,
        gear: args?.gear,
        size: args?.size,
        enhance: args?.enhance,
        cwd: exec?.agent?.session?.header?.cwd,
        exec,
      });
    },
  }));

  // ---------------------------------------------------------------- panel route
  const offRoute = ctx.webServer.register({
    kind: 'exact',
    path: '/gears/api/image',
    handler: async (req, res) => {
      const send = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      };
      try {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const input = JSON.parse(raw || '{}');
        const references = [
          ...(Array.isArray(input.images) ? input.images : []),
          ...(typeof input.image === 'string' ? [input.image] : []),
        ];
        const result = await run({
          prompt: input.prompt,
          references,
          provider: input.provider,
          gear: input.gear,
          size: input.size,
          enhance: input.enhance,
          cwd: process.cwd(),
        });
        send(200, { ok: true, ...result });
      } catch (error) {
        send(502, { ok: false, error: String(error?.message ?? error) });
      }
    },
  });

  // ---------------------------------------------------------------- /image
  const offCommand = ctx.commands?.register({
    name: 'image',
    description: 'Generate or edit an image through the gearbox Image Lane',
    input: { hint: ' [--ref <path|url>]… [--provider <name>] [--gear <name>] [--size WxH] [--no-enhance]' },
    handler: async (invocation) => {
      const parsed = parseArgs(String(invocation?.rawInput ?? ''));
      if (typeof parsed.error === 'string') return { kind: 'error', text: parsed.error };
      if (parsed.prompt.length === 0) {
        return { kind: 'error', text: '用法 / Usage: /image <prompt> [--ref <path|url>]… [--provider <name>] [--gear <name>] [--size WxH] [--no-enhance]' };
      }
      try {
        const result = await run({
          prompt: parsed.prompt,
          references: parsed.flags.refs,
          provider: parsed.flags.provider,
          gear: parsed.flags.gear,
          size: parsed.flags.size,
          enhance: parsed.flags.enhance,
          cwd: invocation?.agent?.session?.header?.cwd,
        });
        const heading = result.lane === 'edit' ? '已编辑图片' : '已生成图片';
        return {
          kind: 'success',
          text: `${heading}（${result.provider} / ${result.model} / ${result.protocol}）\n\n![${heading}](${result.file.replaceAll('\\', '/')})\n\n保存路径：${result.file}\n\n最终提示词：${result.finalPrompt}`,
        };
      } catch (error) {
        if (invocation?.signal?.aborted) return { kind: 'error', text: 'Image request cancelled.' };
        return { kind: 'error', text: `图像请求失败 / Image request failed: ${String(error?.message ?? error)}` };
      }
    },
  });

  /** Panel-facing description of the resolved lane, without revealing keys. */
  const laneInfo = () => ({
    defaultProvider: lane.defaultProvider,
    saveDir: lane.saveDir,
    autoEnhance: lane.autoEnhance,
    protocols: IMAGE_PROTOCOLS,
    providers: Object.fromEntries(Object.entries(providers).map(([name, provider]) => [name, {
      baseURL: provider.baseURL,
      credentialRef: provider.apiKeyEnv,
      displayName: provider.displayName ?? null,
    }])),
    roles: Object.fromEntries(Object.entries(roles).map(([id, role]) => [id, {
      provider: role.provider,
      model: role.model,
      protocol: role.protocol,
      bodyStyle: role.bodyStyle,
      size: role.size ?? null,
      gear: role.gear ?? null,
      gears: Object.keys(role.gears ?? {}),
      maxInputImages: role.maxInputImages,
      source: role.source,
    }])),
  });

  return {
    dispose: () => {
      offTool?.();
      offRoute?.();
      offCommand?.();
    },
    laneInfo,
    run,
    /** Names this lane put into the command registry, for diagnostics. */
    commands: offCommand === undefined ? [] : ['image'],
  };
}

/**
 * Split `/image` raw input into a prompt plus flags.
 *
 * Hand-rolled rather than delegated to a general parser because the prompt is
 * free text and may itself contain dashes; only the known flags are consumed,
 * and everything else stays in the prompt with its original spacing.
 * `--ref` is repeatable, which is how the multi-image edit lane is reached.
 *
 * @returns `{ prompt, flags: {refs, provider, gear, size, enhance} }` or `{ error }`.
 */
function parseArgs(raw) {
  const flags = { refs: [], provider: undefined, gear: undefined, size: undefined, enhance: undefined };
  const kept = [];
  const tokens = raw.split(/\s+/).filter((token) => token.length > 0);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--no-enhance') {
      flags.enhance = false;
      continue;
    }
    if (token === '--enhance') {
      flags.enhance = true;
      continue;
    }
    if (token === '--ref' || token === '--provider' || token === '--gear' || token === '--size') {
      const value = tokens[index + 1];
      if (value === undefined) return { error: `${token} needs a value` };
      if (token === '--ref') flags.refs.push(value);
      else flags[token === '--provider' ? 'provider' : token === '--gear' ? 'gear' : 'size'] = value;
      index += 1;
      continue;
    }
    kept.push(token);
  }
  return { prompt: kept.join(' '), flags };
}
