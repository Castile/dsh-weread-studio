/**
 * Dictionary lookup for a selected word or character.
 *
 * Selecting text in the reader should answer "what does this mean?" without
 * leaving the panel. Four public dictionaries are tried in order, because no
 * single one covers both Chinese and English well:
 *
 * 1. `weread.qq.com/web/dict/query` — the Web reader's own dictionary. Needs
 *    only the Web session cookie (no Agent Gateway key) and answers Chinese
 *    and English in one shape.
 * 2. `dict.youdao.com/jsonapi` — pinyin, parts of speech and exam tags.
 * 3. `zdic.net` — a Chinese-only fallback whose page carries a one-line gloss.
 * 4. `api.dictionaryapi.dev` — an English-only fallback with IPA and senses.
 *
 * Every step is allowed to fail: the cascade simply moves on and the caller
 * gets `source: 'none'` instead of an exception, so the panel can show
 * 「没有查到」 rather than an error box.
 *
 * Transport is injectable (`options.fetchText`) so the tests never touch the
 * network, and successful lookups are cached in memory (200 entries, 10 min)
 * so re-selecting the same character is instant.
 *
 * @module dsh-weread/lib/dict
 */

/** Endpoint of the Web reader's dictionary; GET only (POST answers 404). */
const WEREAD_DICT_URL = 'https://weread.qq.com/web/dict/query'

/** Youdao's JSON API, with only the dictionaries the panel can render. */
const YOUDAO_URL = 'https://dict.youdao.com/jsonapi'
const YOUDAO_DICTS = '{"count":99,"dicts":[["ec"],["ce"],["simple"]]}'

/** Chinese character page; https only, and it insists on a browser UA. */
const ZDIC_URL = 'https://www.zdic.net/hans/'

/** Free English dictionary used only when the first three miss. */
const DICTIONARY_API_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en/'

/** The desktop UA these origins expect; zdic rejects an empty one. */
export const DICT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'

/** Default per-lookup deadline, matching the reader's request budget. */
export const DEFAULT_TIMEOUT_MS = 15000

/** Longest selection worth looking up; longer strings are prose, not a word. */
export const MAX_WORD_LENGTH = 64

/** Upper bound on cached entries, oldest evicted first. */
export const CACHE_MAX_ENTRIES = 200

/** How long a cached entry stays fresh. */
export const CACHE_TTL_MS = 10 * 60 * 1000

/** The cascade, in order, before `options.sources` narrows or reorders it. */
export const DEFAULT_SOURCES = Object.freeze(['weread', 'youdao', 'zdic', 'dictionaryapi'])

/** Sources that only make sense for one script. */
const SOURCE_KINDS = Object.freeze({
  weread: ['cjk', 'en'],
  youdao: ['cjk', 'en'],
  zdic: ['cjk'],
  dictionaryapi: ['en'],
})

/**
 * Result of the last (or current) lookup, keyed by word + cascade.
 * `Map` preserves insertion order, which is enough for LRU-by-reinsert.
 */
const cache = new Map()

/** Characters a selection picks up from surrounding prose or quotes. */
const SURROUNDING_PUNCTUATION = new Set(
  Array.from('“”"‘’《》〈〉「」『』（）()[]【】{}<>，,。.；;：:！!？?、·…—–'),
)

/** True for a single Han character. */
const HAN_CHAR = /^\p{Script=Han}$/u

/** True when the text contains at least one Han character. */
const HAS_HAN = /\p{Script=Han}/u

/** True when the text contains at least one Latin letter. */
const HAS_LATIN = /\p{Script=Latin}/u

/** Characters an English lookup may contain (letters, digits, marks, spacing). */
const EN_CHAR = /^[\p{Script=Latin}\p{M}\p{N}\s'’.\-]$/u

/**
 * Strip quotes, brackets and sentence punctuation wrapped around a selection.
 * Only the ends are touched, so `well-known` and `don't` survive intact.
 */
function stripSurrounding(word) {
  let start = 0
  let end = Array.from(word).length
  const chars = Array.from(word)
  while (start < end && SURROUNDING_PUNCTUATION.has(chars[start])) start += 1
  while (end > start && SURROUNDING_PUNCTUATION.has(chars[end - 1])) end -= 1
  return chars.slice(start, end).join('')
}

/**
 * Normalize a raw selection into the word that gets looked up.
 *
 * Whitespace inside CJK text is removed (a selection across a line break is
 * still one word) but collapsed to single spaces elsewhere. Quotes and
 * sentence punctuation around the selection are dropped. Anything empty,
 * punctuation-only, or longer than {@link MAX_WORD_LENGTH} yields `''`.
 *
 * @param raw - the text the panel selected, of unknown type.
 * @returns the word to look up, or `''` when the selection is unusable.
 */
export function normalizeLookupWord(raw) {
  if (typeof raw !== 'string') return ''
  let word = raw.trim()
  if (word.length === 0) return ''
  if (Array.from(word).length > MAX_WORD_LENGTH) return ''

  word = stripSurrounding(word).replace(/\u3000/gu, ' ')
  word = HAS_HAN.test(word)
    ? word.replace(/\s+/gu, '')
    : word.replace(/\s+/gu, ' ').trim()
  word = stripSurrounding(word).trim()

  if (word.length === 0) return ''
  if (Array.from(word).length > MAX_WORD_LENGTH) return ''
  return word
}

/**
 * Classify a normalized word.
 *
 * @param word - an already normalized word.
 * @returns `'cjk'` for Han text, `'en'` for Latin text, else `'unknown'`.
 */
export function detectWordKind(word) {
  if (typeof word !== 'string' || word.length === 0) return 'unknown'
  const chars = Array.from(word)
  if (chars.every((char) => HAN_CHAR.test(char))) return 'cjk'
  if (HAS_LATIN.test(word) && chars.every((char) => EN_CHAR.test(char))) return 'en'
  return 'unknown'
}

/** Coerce a payload that arrived as text into JSON, or `undefined`. */
function asJson(payload) {
  if (typeof payload !== 'string') return payload
  try {
    return JSON.parse(payload)
  } catch {
    return undefined
  }
}

/** Wrap a value in an array; `undefined` and `null` become an empty array. */
function asArray(value) {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

/** Deep-flatten Youdao's `{"#text": "..."}` link nodes into one string. */
function flattenText(value) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map((item) => flattenText(item)).join('')
  if (typeof value !== 'object') return ''
  if (typeof value['#text'] === 'string') return value['#text']
  if (value.i !== undefined) return flattenText(value.i)
  if (value.l !== undefined) return flattenText(value.l)
  return ''
}

/** Collapse whitespace and trim, so displayed text never has ragged gaps. */
function cleanText(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim()
}

/** Drop empty and repeated strings, preserving order. */
function uniqueStrings(values) {
  const seen = new Set()
  const out = []
  for (const value of asArray(values)) {
    const text = cleanText(value)
    if (text.length === 0 || seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

/** Pinyin stays bare; IPA is displayed between slashes like a dictionary. */
function formatPhonetic(value, kind) {
  const text = cleanText(value).replace(/^\/+|\/+$/gu, '').trim()
  if (text.length === 0) return ''
  return kind === 'en' ? `/${text}/` : text
}

/**
 * Assemble the normalized entry every parser returns.
 *
 * An entry with no definitions is treated as a miss (a bare pinyin is not an
 * answer), which is what lets the cascade try the next source.
 */
function finalizeEntry({ word, kind, source, readings, definitions, raw }) {
  const normalizedReadings = asArray(readings)
    .map((reading) => {
      const definitionsForReading = uniqueStrings(reading?.definitions)
      const phonetic = formatPhonetic(reading?.phonetic, kind)
      return definitionsForReading.length === 0 && phonetic.length === 0
        ? undefined
        : { phonetic, definitions: definitionsForReading }
    })
    .filter((reading) => reading !== undefined)

  const explicitDefinitions = uniqueStrings(definitions)
  const allDefinitions =
    explicitDefinitions.length > 0
      ? explicitDefinitions
      : uniqueStrings(normalizedReadings.flatMap((reading) => reading.definitions))
  if (allDefinitions.length === 0) return undefined

  const phonetic =
    normalizedReadings.find((reading) => reading.phonetic.length > 0)?.phonetic ?? ''

  return {
    word,
    kind,
    phonetic,
    readings:
      normalizedReadings.length > 0
        ? normalizedReadings
        : [{ phonetic, definitions: allDefinitions }],
    definitions: allDefinitions,
    source,
    ...(raw === undefined ? {} : { raw }),
  }
}

/**
 * Parse the Web reader's dictionary payload.
 *
 * Chinese (`type: 1`) carries `result[].spell` (pinyin) and
 * `result[].means[].mean`; English (`type: 4`) carries `spell_en` and
 * `result[].part` + `result[].mean`. A `status` below 1 means "no entry".
 *
 * @param payload - the decoded body (or raw JSON text).
 * @param word - the word that was looked up, used for `word_name` fallback.
 * @returns a normalized entry, or `undefined` when the payload has no answer.
 */
export function parseWereadDict(payload, word) {
  const data = asJson(payload)
  if (data === null || typeof data !== 'object') return undefined
  const status = Number(data.status)
  if (Number.isFinite(status) && status < 1) return undefined

  const kind = detectWordKind(word)
  const message = data.message
  if (message === null || typeof message !== 'object') return undefined
  const wordName = cleanText(message.word_name) || word
  const results = asArray(message.result).filter((item) => item !== null && typeof item === 'object')
  if (results.length === 0) return undefined

  const readings = results.map((result) => {
    const definitions = []
    for (const mean of asArray(result.means)) {
      if (mean !== null && typeof mean === 'object') definitions.push(mean.mean)
      else definitions.push(mean)
    }
    if (typeof result.mean === 'string' && result.mean.length > 0) {
      const part = cleanText(result.part)
      definitions.push(part.length > 0 ? `${part}. ${cleanText(result.mean)}` : result.mean)
    }
    return { phonetic: result.spell, definitions }
  })

  // English results are one sense per entry (`part` names the part of
  // speech), so they collapse into a single reading with one phonetic.
  const mergedReadings =
    kind === 'en'
      ? [
          {
            phonetic: message.spell_en ?? message.spell_am ?? readings[0]?.phonetic,
            definitions: readings.flatMap((reading) => reading.definitions),
          },
        ]
      : readings

  return finalizeEntry({
    word: wordName,
    kind,
    source: 'weread',
    readings: mergedReadings,
    raw: data,
  })
}

/** Definitions from a Youdao `trs` tree, including `#tran` explanations. */
function youdaoDefinitions(entry) {
  const definitions = []
  for (const trs of asArray(entry?.trs)) {
    for (const tr of asArray(trs?.tr)) {
      const l = tr?.l
      if (l === null || typeof l !== 'object') continue
      definitions.push(flattenText(l.i ?? l))
      const translated = flattenText(l['#tran'])
      if (translated.length > 0) definitions.push(translated)
    }
  }
  return definitions
}

/**
 * Parse a Youdao `jsonapi` payload.
 *
 * Chinese lookups use `simple.word[0].phone` for pinyin and `ce.word[0]` for
 * the gloss; English lookups use `simple.word[0].usphone`/`ukphone` and
 * `ec.word[0]`. Text runs arrive as `{"#text": "..."}` link nodes and are
 * flattened before use. Exam tags (`ec.word[0].exam_type`) are kept on `raw`.
 *
 * @param payload - the decoded body (or raw JSON text).
 * @param word - the word that was looked up.
 * @returns a normalized entry, or `undefined` when nothing usable is present.
 */
export function parseYoudao(payload, word) {
  const data = asJson(payload)
  if (data === null || typeof data !== 'object') return undefined
  const kind = detectWordKind(word)
  const simple = asArray(data.simple?.word)[0] ?? {}
  const ce = asArray(data.ce?.word)[0] ?? {}
  const ec = asArray(data.ec?.word)[0] ?? {}

  if (kind === 'en') {
    const phonetic = ec.usphone ?? simple.usphone ?? ec.ukphone ?? simple.ukphone ?? ec.phone ?? simple.phone
    const definitions = [...youdaoDefinitions(ec), ...youdaoDefinitions(simple)]
    return finalizeEntry({
      word: cleanText(data.input) || word,
      kind,
      source: 'youdao',
      readings: [{ phonetic, definitions }],
      raw: { examType: uniqueStrings(data.ec?.exam_type), input: data.input },
    })
  }

  const phonetic = simple.phone ?? ce.phone ?? ec.phone
  const definitions = [...youdaoDefinitions(ce), ...youdaoDefinitions(simple)]
  return finalizeEntry({
    word: cleanText(data.input) || word,
    kind,
    source: 'youdao',
    readings: [{ phonetic, definitions }],
    raw: { input: data.input },
  })
}

/** Decode the handful of entities the dictionary pages actually use. */
function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
}

/** Strip tags from one HTML fragment and normalize its text. */
function htmlFragmentToText(fragment) {
  return cleanText(decodeEntities(fragment.replace(/<[^>]*>/gu, ' ')).replace(/\s+/gu, ' '))
}

/** Read a `<meta name="..." content="...">` value, order-agnostic. */
function metaContent(html, name) {
  const pattern = new RegExp(`<meta[^>]+name=["']${name}["'][^>]*content=["']([^"']*)["']`, 'iu')
  const reversed = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*name=["']${name}["']`, 'iu')
  return decodeEntities((pattern.exec(html) ?? reversed.exec(html) ?? [])[1] ?? '')
}

/**
 * Parse a zdic.net character page.
 *
 * The basic-explanation list (`li.jbjs-item`) is preferred; the page's
 * `<meta name="description" content="馈（kuì）：进献…">` supplies both the
 * pinyin and a single-line gloss when the list is absent (the page lazy-loads
 * some sections). The raw HTML is not kept on the entry — it is ~45 KB.
 *
 * @param html - the page body as text.
 * @param word - the character that was looked up.
 * @returns a normalized entry, or `undefined` when the page has no gloss.
 */
export function parseZdicHtml(html, word) {
  if (typeof html !== 'string' || html.length === 0) return undefined
  if (/访问验证|安全验证|请开启JavaScript/u.test(html)) return undefined

  const description = cleanText(metaContent(html, 'description'))
  const meta = /^(.+?)（([^）]+)）：(.+)$/u.exec(description)

  const pinyinMatch = /class="jbjs-reading__py"[^>]*>([^<]*)</iu.exec(html)
  const phonetic = cleanText(pinyinMatch?.[1] ?? meta?.[2] ?? '')

  const definitions = []
  for (const match of html.matchAll(/<li class="jbjs-item">([\s\S]*?)<\/li>/giu)) {
    const item = match[1]
    const def = /class="jbjs-item__def"[^>]*>([\s\S]*?)<\/span>/iu.exec(item)
    const example = /class="jbjs-item__eg"[^>]*>([\s\S]*?)<\/span>/iu.exec(item)
    const text = htmlFragmentToText(def?.[1] ?? '')
    if (text.length === 0) continue
    const sample = htmlFragmentToText(example?.[1] ?? '')
    definitions.push(sample.length > 0 ? `${text}（例：${sample}）` : text)
  }

  if (definitions.length === 0 && meta !== null) definitions.push(cleanText(meta[3]))

  return finalizeEntry({
    word,
    kind: 'cjk',
    source: 'zdic',
    readings: [{ phonetic, definitions }],
  })
}

/**
 * Parse a dictionaryapi.dev response.
 *
 * `phonetics[].text` already carries the slashes; `meanings[].definitions`
 * become one line each, prefixed with the part of speech.
 *
 * @param payload - the decoded array (or raw JSON text).
 * @param word - the word that was looked up.
 * @returns a normalized entry, or `undefined` when nothing usable is present.
 */
export function parseDictionaryApi(payload, word) {
  const data = asJson(payload)
  const entries = asArray(data).filter((item) => item !== null && typeof item === 'object')
  if (entries.length === 0) return undefined

  const first = entries[0]
  const phonetic =
    asArray(first.phonetics).map((item) => cleanText(item?.text ?? item?.phonetic)).find((text) => text.length > 0) ??
    cleanText(first.phonetic)

  const definitions = []
  for (const meaning of asArray(first.meanings)) {
    const part = cleanText(meaning?.partOfSpeech)
    for (const definition of asArray(meaning?.definitions)) {
      const text = cleanText(definition?.definition)
      if (text.length === 0) continue
      definitions.push(part.length > 0 ? `${part}. ${text}` : text)
    }
  }

  return finalizeEntry({
    word: cleanText(first.word) || word,
    kind: 'en',
    source: 'dictionaryapi',
    readings: [{ phonetic, definitions }],
    raw: first,
  })
}

/** Combine a caller signal with a request deadline. */
function withDeadline(signal, timeoutMs) {
  const deadline = AbortSignal.timeout(timeoutMs)
  return signal === undefined ? deadline : AbortSignal.any([signal, deadline])
}

/**
 * The default transport: global `fetch`, a desktop UA, and a 15 s deadline.
 *
 * It resolves to `{ ok, status, text }` and never rejects for an HTTP error,
 * so a 404 from one dictionary is just a miss. Network failures still reject
 * and the cascade catches them.
 *
 * @param url - absolute request URL.
 * @param init - `{ headers, signal }` supplied by the cascade.
 */
export async function defaultFetchText(url, { headers = {}, signal } = {}) {
  const response = await fetch(url, {
    headers: {
      'user-agent': DICT_USER_AGENT,
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      ...headers,
    },
    redirect: 'follow',
    signal: signal === undefined ? AbortSignal.timeout(DEFAULT_TIMEOUT_MS) : withDeadline(signal, DEFAULT_TIMEOUT_MS),
  })
  const text = await response.text()
  return { ok: response.ok, status: response.status, text }
}

/** Build the URL for one source, or `''` when the word has no URL form. */
function sourceUrl(source, word) {
  switch (source) {
    case 'weread':
      return `${WEREAD_DICT_URL}?word=${encodeURIComponent(word)}`
    case 'youdao':
      return `${YOUDAO_URL}?q=${encodeURIComponent(word)}&dicts=${encodeURIComponent(YOUDAO_DICTS)}`
    case 'zdic':
      return `${ZDIC_URL}${encodeURIComponent(word)}`
    case 'dictionaryapi':
      return `${DICTIONARY_API_URL}${encodeURIComponent(word)}`
    default:
      return ''
  }
}

/** Headers each origin expects; only weread receives the session cookie. */
function sourceHeaders(source, cookie) {
  const headers = {
    accept:
      source === 'zdic'
        ? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        : 'application/json, text/plain, */*',
  }
  if (source === 'weread') {
    headers.referer = 'https://weread.qq.com/'
    if (typeof cookie === 'string' && cookie.length > 0) headers.cookie = cookie
  }
  return headers
}

/** True when this source can answer for this script. */
function sourceSupports(source, kind) {
  return SOURCE_KINDS[source]?.includes(kind) === true
}

/**
 * Query one source and parse it. Returns `undefined` for a miss, a false
 * `ok`, unparsable JSON, or a failed request — the caller just moves on.
 */
async function fetchFromSource(source, word, context) {
  const { fetchText, cookie, signal, logger } = context
  const url = sourceUrl(source, word)
  if (url.length === 0) return undefined
  let response
  try {
    response = await fetchText(url, { headers: sourceHeaders(source, cookie), signal })
  } catch (error) {
    logger?.debug?.('[weread] 字典请求失败（%s）：%s', source, error?.message ?? String(error))
    return undefined
  }
  if (response === null || typeof response !== 'object' || response.ok !== true) {
    logger?.debug?.('[weread] 字典返回 HTTP %s（%s）', response?.status ?? '?', source)
    return undefined
  }
  const text = typeof response.text === 'string' ? response.text : ''
  if (text.length === 0) return undefined

  switch (source) {
    case 'weread':
      return parseWereadDict(text, word)
    case 'youdao':
      return parseYoudao(text, word)
    case 'zdic':
      return parseZdicHtml(text, word)
    case 'dictionaryapi':
      return parseDictionaryApi(text, word)
    default:
      return undefined
  }
}

/** The empty answer the panel renders as 「没有查到」. */
function emptyEntry(word, kind) {
  return { word, kind, phonetic: '', readings: [], definitions: [], source: 'none' }
}

/** Cache key: the answer also depends on which cascade produced it. */
function cacheKeyFor(word, kind, sources, cookie) {
  return `${kind}|${word}|${sources.join(',')}|${typeof cookie === 'string' && cookie.length > 0 ? 'session' : 'anon'}`
}

/** Read a live cache entry, refreshing its recency. */
function readCache(key) {
  const hit = cache.get(key)
  if (hit === undefined) return undefined
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key)
    return undefined
  }
  cache.delete(key)
  cache.set(key, hit)
  return hit.entry
}

/** Store an entry, evicting the oldest past the bound. */
function writeCache(key, entry) {
  cache.delete(key)
  cache.set(key, { entry, expiresAt: Date.now() + CACHE_TTL_MS })
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next()
    if (oldest.done === true) break
    cache.delete(oldest.value)
  }
}

/**
 * Forget every cached entry. Intended for tests and for a "刷新" action.
 */
export function clearDictCache() {
  cache.clear()
}

/** Resolve the cascade for one call: known names only, caller order kept. */
function resolveSources(sources) {
  if (!Array.isArray(sources)) return [...DEFAULT_SOURCES]
  return sources.filter((source) => Object.hasOwn(SOURCE_KINDS, source))
}

/**
 * Look a word up across the cascade.
 *
 * @param word - raw selection; normalized internally.
 * @param options - wiring.
 * @param options.fetchText - transport `(url, {headers, signal}) => {ok, status, text}`.
 * @param options.cookie - the weread.qq.com session cookie; may be empty, in
 *   which case the weread step is skipped instead of failing.
 * @param options.logger - host logger; only `debug` is used.
 * @param options.timeoutMs - overall deadline for the whole cascade.
 * @param options.sources - subset/reorder of
 *   `['weread','youdao','zdic','dictionaryapi']`.
 * @param options.signal - caller cancellation.
 * @returns the normalized entry; `source: 'none'` when everything missed.
 *   Never throws.
 */
export async function lookupWord(word, options = {}) {
  const normalized = normalizeLookupWord(word)
  const kind = detectWordKind(normalized)
  if (normalized.length === 0 || kind === 'unknown') return emptyEntry(normalized, kind)

  const sources = resolveSources(options?.sources)
  const cookie = typeof options?.cookie === 'string' ? options.cookie : ''
  const cacheKey = cacheKeyFor(normalized, kind, sources, cookie)
  const cached = readCache(cacheKey)
  if (cached !== undefined) return cached

  const timeoutMs =
    Number.isFinite(Number(options?.timeoutMs)) && Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : DEFAULT_TIMEOUT_MS
  const fetchText = typeof options?.fetchText === 'function' ? options.fetchText : defaultFetchText
  const signal = withDeadline(options?.signal, timeoutMs)
  const context = { fetchText, cookie, signal, logger: options?.logger }

  try {
    for (const source of sources) {
      if (signal.aborted) break
      if (!sourceSupports(source, kind)) continue
      // Without a session the weread endpoint only redirects to a login page.
      if (source === 'weread' && cookie.length === 0) {
        options?.logger?.debug?.('[weread] 未配置 Cookie，跳过微信读书字典。')
        continue
      }
      const entry = await fetchFromSource(source, normalized, context)
      if (entry !== undefined) {
        writeCache(cacheKey, entry)
        return entry
      }
    }
  } catch (error) {
    options?.logger?.warn?.('[weread] 字典查询异常：%s', error?.message ?? String(error))
  }

  // Misses are deliberately not cached: a transient outage should not make a
  // character unlookupable for the next ten minutes.
  return emptyEntry(normalized, kind)
}
