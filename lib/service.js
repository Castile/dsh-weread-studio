/**
 * The WeRead service: one owner of credentials, gateway calls, caching, and
 * the client-callable operations.
 *
 * Every operation is implemented exactly once here. The agent tools and the
 * sidebar panel both call these methods, so the two surfaces can never drift.
 * Errors carry a stable `code` so the panel can tell "not configured" from
 * "the gateway is unhappy".
 */

import { createWebInstallId, devicePair } from './crypto.js'
import { DEMO_BOOK, DEMO_BOOK_ID, DEMO_CHAPTERS, demoChapter, isDemoBook } from './demo.js'
import { WereadGateway, WereadGatewayError, looksLikeApiKey, maskSecret } from './gateway.js'
import { lookupWord } from './dict.js'
import { buildHighlightIndex, buildSpans, parseRange } from './highlights.js'
import { LocalLibrary } from './library.js'
import { buildChapterIndex, htmlRangeToParagraphSpans, selectionRange } from './marks.js'
import { mergeProgressByRecency } from './progress.js'
import { WereadReaderError, WereadWebReader } from './reader.js'
import { completeQrLogin, startQrLogin } from '../qr-login.js'
import {
  cached,
  invalidate,
  normalizeDevice,
  normalizePositions,
  parseCookieHeader,
  resolveDataDir,
  WereadStore,
} from './store.js'
import { WereadWebApi } from './web.js'

/** Shelf responses change slowly; progress is polled more often. */
const SHELF_TTL_MS = 5 * 60 * 1000
const NOTEBOOK_TTL_MS = 5 * 60 * 1000
const PROGRESS_TTL_MS = 30 * 1000
/** A decoded chapter never changes; keep it for a month. */
const CHAPTER_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Reading-appearance defaults.
 *
 * `follow` inherits the Harness theme; the other three are the reader's own
 * palettes, which is the one place a literal colour is right: the reading
 * surface is content, not chrome.
 */
export const READER_DEFAULTS = {
  theme: 'follow',
  fontSize: 17,
  lineHeight: 1.9,
  fontFamily: 'system',
}

const READER_THEMES = ['follow', 'light', 'dark', 'sepia']
const READER_FAMILIES = ['system', 'serif', 'sans']

/**
 * Estimate a book's percentage from a reading position.
 *
 * Fitted against 44 real books: the chapter-ordinal model this replaces had a
 * mean absolute error of 12.2 points against WeRead's own number and landed
 * within 2 points only 20% of the time; weighting chapters by their word count
 * and adding the position inside the current chapter drops that to 4.6 points
 * and 75% respectively.
 *
 * It is still an estimate: WeRead's own model is not reproducible from
 * outside, and its percentage is partly recomputed server-side. The ordinal
 * model remains the fallback when a catalog carries no word counts.
 *
 * @param chapters - the catalog, in reading order.
 * @param index - the position of the current chapter, or -1 when unknown.
 * @param chapterOffset - position inside the chapter, in the catalog's units.
 */
export function estimateProgress(chapters, index, chapterOffset = 0) {
  if (!Array.isArray(chapters) || chapters.length === 0 || index < 0) return 0
  const total = chapters.reduce((sum, chapter) => sum + (chapter.wordCount || 0), 0)
  if (total <= 0) return Math.round(((index + 1) / chapters.length) * 100)
  let before = 0
  for (let i = 0; i < index; i += 1) before += chapters[i].wordCount || 0
  const here = chapters[index].wordCount || 0
  const share = here > 0 && chapterOffset > 0 ? Math.min(1, chapterOffset / here) : 0
  return Math.round(((before + here * share) / total) * 100)
}

/**
 * Coerce a stored or incoming appearance patch onto the accepted values.
 *
 * Normalizing on read as well as on write means a hand-edited or older
 * settings file can never put the reader into a state it cannot render.
 */
export function normalizeReaderSettings(patch, current = READER_DEFAULTS) {
  const next = { ...current }
  if (READER_THEMES.includes(patch?.theme)) next.theme = patch.theme
  if (READER_FAMILIES.includes(patch?.fontFamily)) next.fontFamily = patch.fontFamily
  const size = Number(patch?.fontSize)
  if (Number.isFinite(size)) next.fontSize = Math.min(30, Math.max(12, Math.round(size)))
  const line = Number(patch?.lineHeight)
  if (Number.isFinite(line)) next.lineHeight = Math.min(2.6, Math.max(1.4, Math.round(line * 10) / 10))
  return next
}

/** A failure the panel and tools both understand. */
class WereadServiceError extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'WereadServiceError'
    this.code = code
    this.details = details ?? {}
  }
}

/** Coerce a gateway number field, tolerating strings. */
function numberOr(value, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Unix seconds → ISO date text, or undefined when absent. */
function toDate(unixSeconds) {
  const seconds = numberOr(unixSeconds, 0)
  if (seconds <= 0) return undefined
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

/** One book entry, normalized across shelf books and albums. */
function normalizeShelfBook(raw) {
  return {
    bookId: String(raw?.bookId ?? ''),
    title: String(raw?.title ?? '未命名'),
    author: String(raw?.author ?? ''),
    cover: String(raw?.cover ?? ''),
    category: String(raw?.category ?? ''),
    readUpdateTime: numberOr(raw?.readUpdateTime, 0),
    readUpdateDate: toDate(raw?.readUpdateTime),
    finishReading: numberOr(raw?.finishReading, 0) === 1,
    secret: numberOr(raw?.secret, 0) === 1,
    kind: 'book',
  }
}

/** One audiobook/album entry from the shelf. */
function normalizeAlbum(raw) {
  const info = raw?.albumInfo ?? {}
  return {
    bookId: String(info.albumId ?? ''),
    title: String(info.name ?? '未命名专辑'),
    author: String(info.authorName ?? ''),
    cover: String(info.cover ?? ''),
    category: '',
    trackCount: numberOr(info.trackCount, 0),
    readUpdateTime: 0,
    finishReading: false,
    secret: numberOr(raw?.albumInfoExtra?.secret, 0) === 1,
    kind: 'album',
  }
}

/** Normalize the whole shelf payload. */
function normalizeShelf(payload) {
  const books = Array.isArray(payload?.books) ? payload.books.map(normalizeShelfBook) : []
  const albums = Array.isArray(payload?.albums) ? payload.albums.map(normalizeAlbum) : []
  const hasMp = payload?.mp !== undefined && payload.mp !== null
  return {
    books,
    albums,
    hasMp,
    bookCount: numberOr(payload?.bookCount, books.length),
    // The documented counting rule: albums and a non-empty mp entry are shelf
    // entries too, so a plain books.length under-reports the shelf.
    totalCount: books.length + albums.length + (hasMp ? 1 : 0),
    fetchedAt: Date.now(),
  }
}

/** Normalize one reading-progress payload. */
function normalizeProgress(payload) {
  const book = payload?.book ?? payload ?? {}
  return {
    bookId: String(payload?.bookId ?? book?.bookId ?? ''),
    chapterUid: numberOr(book?.chapterUid, 0),
    chapterOffset: numberOr(book?.chapterOffset, 0),
    progress: numberOr(book?.progress, 0),
    updateTime: numberOr(book?.updateTime, 0),
    updateDate: toDate(book?.updateTime),
    recordReadingTime: numberOr(book?.recordReadingTime, 0),
    finishTime: numberOr(book?.finishTime, 0),
    isStartReading: numberOr(book?.isStartReading, 0) === 1,
  }
}

/** Local imported-book ids, which only the library knows about. */
const LOCAL_BOOK_ID_PATTERN = /^local-[0-9a-f]{12}$/

/** Whether an id belongs to an imported local book rather than a WeRead book. */
function isLocalBookId(bookId) {
  return typeof bookId === 'string' && LOCAL_BOOK_ID_PATTERN.test(bookId)
}

/**
 * Whether a string is already a WeRead bookId rather than a title.
 *
 * Books whose text is sold as EPUB come back from the shelf with a CB_ id, and
 * a 公众号 comes back as MP_WXS_; both are opaque handles the gateway accepts
 * verbatim. Sending one to store search returns nothing, so treating an id as a
 * title silently loses the notebook of exactly the books the user opened.
 */
const BOOK_ID_PATTERN = /^(?:\d+|CB_[A-Za-z0-9]+|MP_WXS_[A-Za-z0-9_]+)$/

function isBookIdLike(value) {
  return typeof value === 'string' && BOOK_ID_PATTERN.test(value)
}

/** Metadata every placed span carries, in the shape the reader paints. */
function markMeta(highlight) {
  const bookmarkId = highlight?.bookmarkId
  const colorStyle = Number(highlight?.colorStyle)
  const note = highlight?.note
  return {
    highlightId:
      bookmarkId === undefined || bookmarkId === null || bookmarkId === ''
        ? undefined
        : String(bookmarkId),
    // The notebook reports -1 for "no colour style recorded"; only 0..4 is real.
    colorStyle: Number.isFinite(colorStyle) && colorStyle >= 0 ? colorStyle : undefined,
    note: typeof note === 'string' && note.length > 0 ? note : undefined,
  }
}

/** Drop the characters an earlier mark already claimed, keeping the rest. */
function subtractClaim(start, end, claimed) {
  let pieces = [[start, end]]

  for (const [claimedStart, claimedEnd] of claimed) {
    const remaining = []
    for (const [pieceStart, pieceEnd] of pieces) {
      if (claimedEnd <= pieceStart || claimedStart >= pieceEnd) {
        remaining.push([pieceStart, pieceEnd])
        continue
      }
      if (claimedStart > pieceStart) remaining.push([pieceStart, Math.min(claimedStart, pieceEnd)])
      if (claimedEnd < pieceEnd) remaining.push([Math.max(claimedEnd, pieceStart), pieceEnd])
    }
    pieces = remaining
  }

  return pieces.filter(([from, to]) => to > from)
}

/** One paragraph as ordered, gap-free spans (plain text where nothing is marked). */
function paragraphSpans(text, items) {
  if (items.length === 0) return [{ start: 0, end: text.length, text }]

  const ordered = items.slice().sort((left, right) => left.start - right.start || left.end - right.end)
  const spans = []
  let cursor = 0

  for (const item of ordered) {
    if (item.start > cursor) spans.push({ start: cursor, end: item.start, text: text.slice(cursor, item.start) })
    const span = { start: item.start, end: item.end, text: text.slice(item.start, item.end) }
    if (item.meta.highlightId !== undefined) span.highlightId = item.meta.highlightId
    if (item.meta.colorStyle !== undefined) span.colorStyle = item.meta.colorStyle
    if (item.meta.note !== undefined) span.note = item.meta.note
    spans.push(span)
    cursor = item.end
  }

  if (cursor < text.length) spans.push({ start: cursor, end: text.length, text: text.slice(cursor) })
  return spans
}

/**
 * Adapt a service highlight to the bookmark shape `highlights.js` reads.
 *
 * The notebook maps WeRead's `markText`/`content` onto `text`/`note`, so the
 * plain-text fallback has to put those names back before asking for positioning.
 */
function asBookmark(highlight) {
  const markText =
    typeof highlight?.markText === 'string'
      ? highlight.markText
      : typeof highlight?.text === 'string'
        ? highlight.text
        : ''
  const content =
    typeof highlight?.content === 'string'
      ? highlight.content
      : typeof highlight?.note === 'string'
        ? highlight.note
        : undefined
  return { ...highlight, markText, ...(content === undefined ? {} : { content }) }
}

/** A highlight's recorded position as `{start, end}`, or null when unusable. */
function highlightRange(highlight) {
  const range = highlight?.range
  if (typeof range === 'string') return parseRange(range)
  if (Array.isArray(range) && range.length >= 2) return parseRange(`${range[0]}-${range[1]}`)
  if (range !== null && typeof range === 'object') {
    return parseRange(`${numberOr(range.start, -1)}-${numberOr(range.end, -1)}`)
  }
  return null
}

/**
 * Place marks against the decoded chapter source.
 *
 * WeRead records a bookmark's `range` as a UTF-16 offset into the text the
 * reader renders from — the decoded chapter `html`, not
 * `paragraphs.join('\n')`. `buildChapterIndex` maps that coordinate space onto
 * paragraphs, so a range spanning paragraphs yields one paragraph-local span
 * per covered paragraph and a fully covered paragraph is highlighted whole.
 *
 * Overlaps are first-come-first-claimed: a later mark only keeps the
 * characters an earlier one has not taken, so spans never nest.
 */
function placeOnHtmlIndex(index, highlights) {
  const claims = index.paragraphs.map(() => [])
  const placed = index.paragraphs.map(() => [])
  const unmatched = []

  for (const highlight of highlights) {
    const range = highlightRange(highlight)
    const mapped = range === null ? [] : htmlRangeToParagraphSpans(index, range)
    if (mapped.length === 0) {
      unmatched.push(highlight)
      continue
    }

    const meta = markMeta(highlight)
    for (const part of mapped) {
      for (const [start, end] of subtractClaim(part.start, part.end, claims[part.paragraphIndex])) {
        claims[part.paragraphIndex].push([start, end])
        claims[part.paragraphIndex].sort((left, right) => left[0] - right[0])
        placed[part.paragraphIndex].push({ start, end, meta })
      }
    }
  }

  return {
    spans: index.paragraphs.map((paragraph, at) => paragraphSpans(paragraph.text, placed[at])),
    unmatched,
  }
}

/** Build a chapterUid → title lookup from a bookmark or catalog payload. */
function chapterTitles(chapters) {
  const titles = new Map()
  if (!Array.isArray(chapters)) return titles
  for (const chapter of chapters) {
    const uid = numberOr(chapter?.chapterUid, 0)
    if (uid > 0) titles.set(uid, String(chapter?.title ?? ''))
  }
  return titles
}

export class WereadService {
  /**
   * @param options - host wiring.
   * @param options.ctx - host plugin context, used for logging.
   * @param options.config - the row's config values.
   */
  constructor({ ctx, config = {} }) {
    this.ctx = ctx
    this.config = {
      skillVersion: typeof config.skillVersion === 'string' ? config.skillVersion : '1.0.5',
      syncProgress: config.syncProgress === true,
      requestTimeoutMs: Number.isFinite(config.requestTimeoutMs) ? config.requestTimeoutMs : 20000,
      dataDir: resolveDataDir(config),
    }
    this.store = new WereadStore(this.config.dataDir)
    /** Books imported from the user's own files; owns its own on-disk shape. */
    this.library = new LocalLibrary(this.config.dataDir)
    this.gateway = new WereadGateway({
      getApiKey: () => this.store.credentials?.apiKey ?? '',
      getSkillVersion: () => this.config.skillVersion,
      getTimeoutMs: () => this.config.requestTimeoutMs,
      logger: ctx.logger,
    })
    /** In-flight credential load, so the first call sees the saved key. */
    this.ready = this.bootstrap(config)
    const onCookieRefresh = (setCookies) => {
      this.store.mergeSetCookies(setCookies).catch((error) => {
        ctx.logger?.warn('[weread] 刷新 Cookie 失败：%s', error?.message ?? String(error))
      })
    }
    /** The Web reader, used only for chapter text and progress reports. */
    this.reader = new WereadWebReader({
      getCookie: () => this.store.credentials?.cookie ?? '',
      getTimeoutMs: () => this.config.requestTimeoutMs,
      onCookieRefresh,
      logger: ctx.logger,
    })
    /** Cookie-authenticated metadata (shelf / search / book). */
    this.web = new WereadWebApi({
      getCookie: () => this.store.credentials?.cookie ?? '',
      getTimeoutMs: () => this.config.requestTimeoutMs,
      onCookieRefresh,
      logger: ctx.logger,
    })
    /** Active QR login uid, if a scan is in flight. */
    this.qrUid = undefined
  }

  /**
   * Load stored credentials, then seed a Cookie from the composition row
   * when the store is still empty.
   */
  async bootstrap(config) {
    const credentials = await this.store.load()
    const fromRow = typeof config.cookie === 'string' ? config.cookie.trim() : ''
    if (credentials.cookie.length === 0 && fromRow.length > 0) {
      await this.store.save({ cookie: fromRow })
    }
    return this.store.credentials
  }

  /**
   * Whether reading progress may be written back to WeRead.
   *
   * The row's config is only the initial default; a choice made in the panel
   * is stored and wins, so the switch never requires editing a file.
   */
  async syncProgressEnabled() {
    const settings = await this.store.loadSettings()
    return typeof settings.syncProgress === 'boolean' ? settings.syncProgress : this.config.syncProgress === true
  }

  /**
   * Whether a Cookie failure has to abort the call.
   *
   * An expired Cookie only means the Cookie path is unusable: when an API key
   * is configured the gateway can still answer, so the caller falls through to
   * it instead of failing a request the other credential could serve. With no
   * API key there is nothing left to try and the user has to be told to log in.
   */
  sessionExpiredIsFatal() {
    return (this.store.credentials?.apiKey ?? '').length === 0
  }

  /** The reading appearance in force, always fully populated and valid. */
  async readerSettings() {
    const settings = await this.store.loadSettings()
    return normalizeReaderSettings(settings.reader ?? {}, READER_DEFAULTS)
  }

  /** Wrap an unknown failure into the service's own code space. */
  static toServiceError(error) {
    if (error instanceof WereadServiceError) return error
    if (error instanceof WereadReaderError) return new WereadServiceError(error.code, error.message, error.details)
    if (error instanceof WereadGatewayError) {
      const code = error.code === 'weread/no-api-key' ? 'weread/needs-config' : error.code
      return new WereadServiceError(code, error.message, error.details)
    }
    return new WereadServiceError('weread/internal', error?.message ?? String(error))
  }

  // --- operations (shared by the panel and the agent tools) -----------------

  /** Credential and capability state, never echoing a secret. */
  async status() {
    await this.ready
    // Read the live record: a save made after the initial load replaces it.
    const credentials = this.store.credentials
    const cookieConfigured = this.reader.hasSession()
    return {
      apiKeyConfigured: credentials.apiKey.length > 0,
      apiKeyHint: maskSecret(credentials.apiKey),
      apiKeyLooksValid: looksLikeApiKey(credentials.apiKey),
      cookieConfigured,
      cookieNames: Object.keys(parseCookieHeader(credentials.cookie)),
      cookieUpdatedAt: credentials.updatedAt > 0 ? new Date(credentials.updatedAt).toISOString() : undefined,
      demoMode: !cookieConfigured,
      skillVersion: this.config.skillVersion,
      syncProgress: await this.syncProgressEnabled(),
      syncProgressDefault: this.config.syncProgress === true,
      reader: await this.readerSettings(),
      // Where each book was last read here, so the panel can resume a book
      // instead of restarting it at the first chapter.
      positions: await this.positions(),
      dataDir: this.config.dataDir,
      upgradeInfo: this.gateway.upgradeInfo,
    }
  }

  /** Where each book was last read from the panel, keyed by book id. */
  async positions() {
    await this.ready
    const settings = await this.store.loadSettings()
    return normalizePositions(settings.positions)
  }

  /**
   * Remember the chapter a book is open at.
   * @param input - `{ bookId, chapterUid }`.
   */
  async rememberPosition({ bookId, chapterUid, chapterIdx, chapterOffset, progress, readingTime } = {}) {
    await this.ready
    if (bookId === undefined || bookId === null || String(bookId).length === 0) {
      throw new WereadServiceError('weread/bad-request', '缺少 bookId。')
    }
    const entry = await this.store.rememberPosition(String(bookId), chapterUid, {
      chapterIdx,
      chapterOffset,
      progress,
      readingTime,
    })
    if (entry === undefined) {
      throw new WereadServiceError('weread/bad-request', '缺少有效的 chapterUid。')
    }
    return entry
  }

  /** Sticky web install id and device pair, created once and reused. */
  async deviceIdentity() {
    const settings = await this.store.loadSettings()
    const existing = normalizeDevice(settings.device)
    if (existing !== undefined) return existing
    const appId = createWebInstallId()
    const pair = devicePair(appId)
    const device = { appId, ...pair }
    await this.store.saveSettings({ device })
    return device
  }

  /**
   * Persist credentials supplied from the panel.
   * @param patch - `{ apiKey?, cookie? }`; an empty string clears the value.
   */
  async configure(patch = {}) {
    const next = {}
    if (typeof patch.apiKey === 'string') next.apiKey = patch.apiKey.trim()
    if (typeof patch.cookie === 'string') next.cookie = patch.cookie.trim()
    const wantsSync = typeof patch.syncProgress === 'boolean'
    const wantsReader = patch.reader !== null && typeof patch.reader === 'object'
    if (Object.keys(next).length === 0 && !wantsSync && !wantsReader) {
      throw new WereadServiceError('weread/nothing-to-save', '没有需要保存的内容。')
    }
    if (wantsSync) await this.store.saveSettings({ syncProgress: patch.syncProgress })
    if (wantsReader) {
      // Merged onto the current values, so a one-field change from the panel
      // never resets the rest of the appearance.
      const merged = normalizeReaderSettings(patch.reader, await this.readerSettings())
      await this.store.saveSettings({ reader: merged })
    }
    if (Object.keys(next).length === 0) return this.status()
    if (typeof next.apiKey === 'string' && next.apiKey.length > 0 && !looksLikeApiKey(next.apiKey)) {
      throw new WereadServiceError(
        'weread/bad-key',
        'API Key 格式看起来不对：应以 `wrk-` 开头。请到 https://weread.qq.com/r/weread-skills 领取。',
      )
    }
    if (typeof next.cookie === 'string' && next.cookie.length > 0) {
      const jar = parseCookieHeader(next.cookie)
      if (jar.wr_vid === undefined || jar.wr_skey === undefined) {
        throw new WereadServiceError(
          'weread/bad-cookie',
          'Cookie 需要同时包含 `wr_vid` 与 `wr_skey`（从已登录 weread.qq.com 的浏览器里复制完整 Cookie 头）。',
        )
      }
    }
    await this.ready
    await this.store.save(next)
    return this.status()
  }

  /** Verify the session by exercising the cheapest identity-bound endpoint. */
  async verify(signal) {
    await this.ready
    const shelf = await this.shelf({ refresh: true, signal })
    return { ok: true, shelfCount: shelf.totalCount, bookCount: shelf.books.length, demo: shelf.demo === true }
  }

  /** Demo shelf used when nobody is signed in. */
  demoShelf() {
    return {
      books: [{ ...DEMO_BOOK }],
      albums: [],
      hasMp: false,
      bookCount: 1,
      totalCount: 1,
      demo: true,
      fetchedAt: Date.now(),
    }
  }

  /** The whole shelf, cached briefly. Cookie first, then optional API key, then demo. */
  async shelf({ refresh = false, signal } = {}) {
    await this.ready
    if (this.web.hasSession()) {
      try {
        return await cached(this.store, 'shelf-web', refresh ? 0 : SHELF_TTL_MS, async () => {
          const payload = await this.web.shelf(signal)
          const progressById = WereadWebApi.progressIndex(payload)
          const positions = await this.positions()
          const books = (Array.isArray(payload?.books) ? payload.books : []).map((item) => {
            const book = WereadWebApi.normalizeBook(item)
            const cloud = progressById.get(book.bookId)
            const merged = mergeProgressByRecency(positions[book.bookId], {
              bookId: book.bookId,
              chapterUid: cloud?.chapterUid || book.chapterUid || 0,
              chapterOffset: cloud?.chapterOffset || 0,
              progress: cloud?.progress ?? book.progress ?? 0,
              updateTime: cloud?.updateTime || 0,
              recordReadingTime: cloud?.readingTime || book.readingTime || 0,
            })
            return {
              ...book,
              progress: merged?.progress ?? book.progress,
              chapterUid: merged?.chapterUid || book.chapterUid,
              readingTime: merged?.recordReadingTime || book.readingTime,
              progressSource: merged?.source,
            }
          })
          const albums = Array.isArray(payload?.albums) ? payload.albums.map(normalizeAlbum) : []
          return {
            books,
            albums,
            hasMp: payload?.mp !== undefined && payload.mp !== null,
            bookCount: books.length,
            totalCount: books.length + albums.length,
            demo: false,
            fetchedAt: Date.now(),
          }
        })
      } catch (error) {
        this.ctx.logger?.warn('[weread] 网页书架失败：%s', error?.message ?? String(error))
        if (error?.code === 'weread/session-expired' && this.sessionExpiredIsFatal()) throw error
      }
    }
    if ((this.store.credentials?.apiKey ?? '').length > 0) {
      try {
        return await cached(this.store, 'shelf', refresh ? 0 : SHELF_TTL_MS, async () => {
          const shelf = normalizeShelf(await this.gateway.shelf(signal))
          return { ...shelf, demo: false }
        })
      } catch (error) {
        this.ctx.logger?.warn('[weread] 网关书架失败：%s', error?.message ?? String(error))
      }
    }
    return this.demoShelf()
  }

  /** Reading progress for one book. */
  async progress(bookId, { signal } = {}) {
    await this.ready
    if (isDemoBook(bookId)) {
      return { bookId: DEMO_BOOK_ID, chapterUid: 1, chapterOffset: 0, progress: 0 }
    }
    const key = `progress/${bookId}`
    const cloud = await cached(this.store, key, PROGRESS_TTL_MS, async () => {
      if (this.web.hasSession()) {
        try {
          return normalizeProgress(await this.web.progress(bookId, signal))
        } catch (error) {
          this.ctx.logger?.warn('[weread] 网页进度失败：%s', error?.message ?? String(error))
          if (error?.code === 'weread/session-expired' && this.sessionExpiredIsFatal()) throw error
        }
      }
      return normalizeProgress(await this.gateway.progress(bookId, signal))
    })
    const local = (await this.positions())[String(bookId)]
    return mergeProgressByRecency(local ? { ...local, bookId } : undefined, cloud) ?? cloud
  }

  /** The book the user most recently read, with its progress. */
  async current({ signal } = {}) {
    const shelf = await this.shelf({ signal })
    const candidates = shelf.books.filter((book) => book.readUpdateTime > 0 && !book.finishReading)
    const pool = candidates.length > 0 ? candidates : shelf.books
    if (pool.length === 0) return { book: undefined, progress: undefined }
    const book = pool.reduce((best, item) => (item.readUpdateTime > best.readUpdateTime ? item : best))
    const progress = await this.progress(book.bookId, { signal })
    return { book, progress }
  }

  /** Book detail: metadata plus progress plus the public chapter catalog. */
  async book(bookId, { signal } = {}) {
    if (typeof bookId !== 'string' || bookId.length === 0) {
      throw new WereadServiceError('weread/bad-request', '缺少 bookId。')
    }
    await this.ready
    if (isDemoBook(bookId)) {
      return {
        bookId: DEMO_BOOK_ID,
        title: DEMO_BOOK.title,
        author: DEMO_BOOK.author,
        cover: '',
        intro: DEMO_BOOK.intro,
        category: DEMO_BOOK.category,
        publisher: '',
        wordCount: DEMO_CHAPTERS.reduce((sum, chapter) => sum + chapter.wordCount, 0),
        rating: undefined,
        readerLink: undefined,
        deepLink: undefined,
        demo: true,
        progress: { bookId: DEMO_BOOK_ID, chapterUid: 1, chapterOffset: 0, progress: 0 },
        chapters: DEMO_CHAPTERS.map((chapter) => ({
          chapterUid: chapter.chapterUid,
          chapterIdx: chapter.chapterIdx,
          title: chapter.title,
          level: chapter.level,
          wordCount: chapter.wordCount,
          paid: false,
        })),
      }
    }
    const loadInfo = async () => {
      if (this.web.hasSession()) {
        try {
          return await this.web.bookInfo(bookId, signal)
        } catch (error) {
          this.ctx.logger?.warn('[weread] 网页书籍详情失败：%s', error?.message ?? String(error))
          if (error?.code === 'weread/session-expired' && this.sessionExpiredIsFatal()) throw error
        }
      }
      return this.gateway.bookInfo(bookId, signal)
    }
    const loadCatalog = async () => {
      if (this.reader.hasSession()) {
        try {
          const chapters = await this.reader.webCatalog(bookId, signal)
          return { chapters }
        } catch (error) {
          this.ctx.logger?.warn('[weread] 网页目录失败：%s', error?.message ?? String(error))
          if (error?.code === 'weread/session-expired' && this.sessionExpiredIsFatal()) throw error
        }
      }
      return this.gateway.chapterInfo(bookId, signal)
    }
    const [info, progress, catalog] = await Promise.all([
      cached(this.store, `info/${bookId}`, 24 * 60 * 60 * 1000, loadInfo),
      this.progress(bookId, { signal }).catch(() => undefined),
      cached(this.store, `catalog/${bookId}`, 24 * 60 * 60 * 1000, loadCatalog),
    ])
    const chapters = Array.isArray(catalog?.chapters) ? catalog.chapters : []
    return {
      bookId,
      title: String(info?.title ?? ''),
      author: String(info?.author ?? ''),
      cover: String(info?.cover ?? ''),
      intro: String(info?.intro ?? ''),
      category: String(info?.category ?? ''),
      publisher: String(info?.publisher ?? ''),
      wordCount: numberOr(info?.wordCount, 0),
      rating: info?.newRating,
      readerLink: info?.readerLink,
      deepLink: info?.deepLink,
      progress,
      chapters: chapters.map((chapter) => ({
        chapterUid: numberOr(chapter?.chapterUid, 0),
        chapterIdx: numberOr(chapter?.chapterIdx, 0),
        title: String(chapter?.title ?? ''),
        level: numberOr(chapter?.level, 0),
        wordCount: numberOr(chapter?.wordCount, 0),
        paid: numberOr(chapter?.paid, 0) === 1,
      })),
    }
  }

  /** Notebook overview across every book that has notes. */
  async notebooks({ signal } = {}) {
    await this.ready
    return cached(this.store, 'notebooks', NOTEBOOK_TTL_MS, async () => {
      const books = []
      let lastSort
      // Cursor pagination; the documented cap is small, but guard anyway.
      for (let page = 0; page < 30; page += 1) {
        const payload = await this.gateway.notebooks(100, lastSort, signal)
        const batch = Array.isArray(payload?.books) ? payload.books : []
        for (const entry of batch) {
          books.push({
            bookId: String(entry?.bookId ?? ''),
            title: String(entry?.book?.title ?? ''),
            author: String(entry?.book?.author ?? ''),
            cover: String(entry?.book?.cover ?? ''),
            reviewCount: numberOr(entry?.reviewCount, 0),
            noteCount: numberOr(entry?.noteCount, 0),
            bookmarkCount: numberOr(entry?.bookmarkCount, 0),
            readingProgress: numberOr(entry?.readingProgress, 0),
            markedStatus: numberOr(entry?.markedStatus, 0),
            sort: numberOr(entry?.sort, 0),
            noteTotal:
              numberOr(entry?.reviewCount, 0) + numberOr(entry?.noteCount, 0) + numberOr(entry?.bookmarkCount, 0),
          })
        }
        if (numberOr(payload?.hasMore, 0) !== 1 || batch.length === 0) break
        lastSort = numberOr(batch[batch.length - 1]?.sort, 0)
        if (lastSort === 0) break
      }
      books.sort((left, right) => right.noteTotal - left.noteTotal)
      return {
        books,
        totalBookCount: books.length,
        totalNoteCount: books.reduce((sum, book) => sum + book.noteTotal, 0),
        fetchedAt: Date.now(),
      }
    })
  }

  /**
   * One book's highlights and personal thoughts, grouped by chapter.
   *
   * Cached per book: the notebook is what the panel and the reader's marks
   * both read, and a chapter turn must not re-fetch it.
   */
  async notes(bookId, { signal, refresh = false } = {}) {
    if (typeof bookId !== 'string' || bookId.length === 0) {
      throw new WereadServiceError('weread/bad-request', '缺少 bookId。')
    }
    await this.ready
    return cached(this.store, `notes/${bookId}`, refresh ? 0 : NOTEBOOK_TTL_MS, async () => {
      const [markPayload, reviewPayload] = await Promise.all([
        this.gateway.bookmarks(bookId, signal),
        this.gateway.myReviews(bookId, 100, undefined, signal).catch(() => ({ reviews: [] })),
      ])
      const titles = chapterTitles(markPayload?.chapters)
      const highlights = (Array.isArray(markPayload?.updated) ? markPayload.updated : []).map((entry) => ({
        range: String(entry?.range ?? ''),
        chapterUid: numberOr(entry?.chapterUid, 0),
        chapterTitle: titles.get(numberOr(entry?.chapterUid, 0)) ?? '',
        text: String(entry?.markText ?? ''),
        createTime: numberOr(entry?.createTime, 0),
        createDate: toDate(entry?.createTime),
        // Carried for the reader's marks: the raw bookmark handle, its colour
        // and kind, plus the note attached to the same bookmark.
        bookmarkId: String(entry?.bookmarkId ?? ''),
        colorStyle: numberOr(entry?.colorStyle, -1),
        type: numberOr(entry?.type, 1),
        ...(typeof entry?.content === 'string' && entry.content.length > 0 ? { note: entry.content } : {}),
      }))
      const thoughts = (Array.isArray(reviewPayload?.reviews) ? reviewPayload.reviews : []).map((entry) => {
        const review = entry?.review ?? entry ?? {}
        return {
          reviewId: String(review?.reviewId ?? ''),
          chapterUid: numberOr(review?.chapterUid, 0),
          chapterTitle: String(review?.chapterName ?? ''),
          abstract: typeof review?.abstract === 'string' ? review.abstract : '',
          content: String(review?.content ?? ''),
          star: numberOr(review?.star, -1),
          createTime: numberOr(review?.createTime, 0),
          createDate: toDate(review?.createTime),
        }
      })
      // Group by chapter so the panel can render one section per chapter.
      const groups = new Map()
      const groupFor = (uid, title) => {
        const key = uid > 0 ? String(uid) : 'unknown'
        if (!groups.has(key)) {
          groups.set(key, { chapterUid: uid, chapterTitle: title || titles.get(uid) || '', highlights: [], thoughts: [] })
        }
        return groups.get(key)
      }
      for (const highlight of highlights) groupFor(highlight.chapterUid, highlight.chapterTitle).highlights.push(highlight)
      for (const thought of thoughts) groupFor(thought.chapterUid, thought.chapterTitle).thoughts.push(thought)
      // The raw `book` record carries cover blurhashes, palettes and sales flags
      // — about half the payload — and neither the panel nor the tool reads any
      // of it, so only the display fields cross the wire.
      const rawBook = markPayload?.book ?? {}
      return {
        bookId,
        book: {
          bookId: String(rawBook.bookId ?? bookId),
          title: String(rawBook.title ?? ''),
          author: String(rawBook.author ?? ''),
          cover: String(rawBook.cover ?? ''),
        },
        highlightCount: highlights.length,
        thoughtCount: thoughts.length,
        chapters: [...groups.values()],
      }
    })
  }

  /** Reading-time statistics for one natural period. */
  async stats(mode = 'monthly', { baseTime, signal } = {}) {
    await this.ready
    if (!['weekly', 'monthly', 'annually', 'overall'].includes(mode)) {
      throw new WereadServiceError('weread/bad-request', `不支持的统计周期：${mode}`)
    }
    const normalized = mode === 'overall' ? 'overall' : mode
    return this.gateway.readData(normalized, mode === 'overall' ? 0 : baseTime, signal)
  }

  /** Normalize one search hit from either the Web or gateway payload. */
  static searchHit(item) {
    const info = item?.bookInfo ?? item?.book ?? item ?? {}
    return {
      bookId: String(info?.bookId ?? item?.bookId ?? ''),
      title: String(info?.title ?? ''),
      author: String(info?.author ?? ''),
      cover: String(info?.cover ?? ''),
      intro: String(info?.intro ?? ''),
      category: String(info?.category ?? ''),
      rating: info?.newRating,
      readingCount: numberOr(info?.readingCount ?? item?.readingCount, 0),
      readerLink: info?.readerLink ?? item?.readerLink,
      deepLink: info?.deepLink ?? item?.deepLink,
    }
  }

  /** Store search, used both by the panel and to resolve a title to a bookId. */
  async search(keyword, { scope = 10, count = 20, signal } = {}) {
    if (typeof keyword !== 'string' || keyword.trim().length === 0) {
      throw new WereadServiceError('weread/bad-request', '请提供搜索关键词。')
    }
    await this.ready
    const trimmed = keyword.trim()
    const fromWeb = async () => {
      const payload = await this.web.search(trimmed, count, signal)
      const list = Array.isArray(payload?.books)
        ? payload.books
        : Array.isArray(payload?.results)
          ? payload.results.flatMap((group) => (Array.isArray(group?.books) ? group.books : [group]))
          : []
      return list.map((item) => WereadService.searchHit(item)).filter((item) => item.bookId.length > 0)
    }
    let results = []
    try {
      results = await fromWeb()
    } catch (error) {
      this.ctx.logger?.warn('[weread] 网页书城搜索失败：%s', error?.message ?? String(error))
      if (error?.code === 'weread/session-expired' && this.sessionExpiredIsFatal()) throw error
    }
    if (results.length === 0 && (this.store.credentials?.apiKey ?? '').length > 0) {
      const payload = await this.gateway.search(trimmed, scope, count, signal)
      for (const group of Array.isArray(payload?.results) ? payload.results : []) {
        for (const item of Array.isArray(group?.books) ? group.books : []) {
          results.push(WereadService.searchHit(item))
        }
      }
    }
    return { keyword: trimmed, count: results.length, results }
  }

  /** Resolve a user-supplied bookId-or-title into a bookId. */
  async resolveBookId(query, { signal } = {}) {
    const text = typeof query === 'string' ? query.trim() : ''
    if (text.length === 0) throw new WereadServiceError('weread/bad-request', '请提供书名或 bookId。')
    if (isDemoBook(text) || DEMO_BOOK.title.includes(text) || text.includes('演示')) return DEMO_BOOK_ID
    // A bookId is already a bookId: numeric ids, the CB_ ids the shelf hands out
    // for EPUB/secret books, and 公众号 ids. Everything else is a title and has
    // to be searched — running a CB_ id through store search finds nothing,
    // which is exactly the book the reader just tapped in the notebook list.
    if (isBookIdLike(text)) return text
    const found = await this.search(text, { count: 5, signal })
    if (found.results.length === 0) {
      throw new WereadServiceError('weread/not-found', `书城搜索「${text}」没有结果。`)
    }
    return found.results[0].bookId
  }

  // --- 原生阅读器（Web 会话） -------------------------------------------------

  /** Whether the native reader can run: it needs a Web session, not the API key. */
  async readerStatus() {
    await this.ready
    return {
      cookieConfigured: this.reader.hasSession(),
      knownFormats: [...this.reader.formats.entries()].map(([bookId, format]) => ({ bookId, format })),
    }
  }

  /**
   * The chapter catalog the reader pages through.
   *
   * Reading needs the Web session, so the Web catalog is the primary source;
   * the gateway catalog is only a fallback for when that endpoint fails but an
   * API key happens to be configured. When neither credential exists, the
   * error names the one reading actually requires — a Cookie — instead of
   * sending the user after an API key this feature does not use.
   */
  async chapterCatalog(bookId, { signal } = {}) {
    if (isDemoBook(bookId)) return DEMO_CHAPTERS
    if (this.reader.hasSession()) {
      try {
        return await cached(this.store, `webcatalog/${bookId}`, 24 * 60 * 60 * 1000, () =>
          this.reader.webCatalog(bookId, signal),
        )
      } catch (error) {
        this.ctx.logger?.warn('[weread] 网页目录获取失败，尝试官方目录：%s', error?.message ?? String(error))
        if (error?.code === 'weread/session-expired' && this.sessionExpiredIsFatal()) throw error
      }
    }
    const credentials = await this.ready
    if (credentials.apiKey.length === 0) {
      throw new WereadServiceError(
        'weread/needs-cookie',
        '要读这本书的正文，请在「设置」里粘贴已登录 weread.qq.com 的 Cookie（须含 wr_vid 与 wr_skey）。',
      )
    }
    const detail = await this.book(bookId, { signal })
    return detail.chapters
  }

  /**
   * One chapter's readable text, cached per book and chapter.
   * @param bookId - the book.
   * @param chapterUid - the chapter.
   * @param options - `refresh` bypasses the cache; `signal` cancels.
   */
  async chapter(bookId, chapterUid, { refresh = false, signal } = {}) {
    if (typeof bookId !== 'string' || bookId.length === 0) {
      throw new WereadServiceError('weread/bad-request', '缺少 bookId。')
    }
    const uid = Number(chapterUid)
    if (!Number.isFinite(uid) || uid <= 0) {
      throw new WereadServiceError('weread/bad-request', '缺少 chapterUid。')
    }
    await this.ready
    if (isDemoBook(bookId)) {
      const catalog = DEMO_CHAPTERS
      const index = catalog.findIndex((chapter) => chapter.chapterUid === uid)
      const target = demoChapter(uid) ?? catalog[0]
      return {
        bookId: DEMO_BOOK_ID,
        chapterUid: target.chapterUid,
        title: target.title,
        format: 'txt',
        paragraphs: target.paragraphs,
        fetchedAt: Date.now(),
        chapterIdx: index < 0 ? 0 : index,
        chapterCount: catalog.length,
        previous: index > 0 ? catalog[index - 1] : undefined,
        next: index >= 0 && index < catalog.length - 1 ? catalog[index + 1] : undefined,
        chapters: catalog,
        demo: true,
      }
    }
    const catalog = await this.chapterCatalog(bookId, { signal })
    const index = catalog.findIndex((chapter) => chapter.chapterUid === uid)
    const target = index >= 0 ? catalog[index] : undefined
    const cacheKey = `chapter/${bookId}/${uid}`
    const produce = async () => {
      const fetched = await this.reader.fetchChapter({
        bookId,
        chapterUid: uid,
        title: target?.title,
        signal,
      })
      return {
        chapterUid: uid,
        title: fetched.title,
        format: fetched.format,
        // The decoded source text behind `paragraphs`. Marks are sent to WeRead
        // as offsets into this string, so it has to survive the cache.
        html: typeof fetched.html === 'string' ? fetched.html : '',
        paragraphs: fetched.paragraphs,
        fetchedAt: Date.now(),
      }
    }
    let decoded = await cached(this.store, cacheKey, refresh ? 0 : CHAPTER_TTL_MS, produce)
    if (typeof decoded?.html !== 'string') {
      // Entry written before `html` existed (up to 30 days old): refetch once
      // rather than serve a chapter whose marks could never be placed.
      decoded = await cached(this.store, cacheKey, 0, produce)
    }
    return {
      ...decoded,
      bookId,
      chapterIdx: index,
      chapterCount: catalog.length,
      previous: index > 0 ? catalog[index - 1] : undefined,
      next: index >= 0 && index < catalog.length - 1 ? catalog[index + 1] : undefined,
      chapters: catalog,
    }
  }

  // --- local imported books -------------------------------------------------

  /**
   * Every book imported from a local file, newest first.
   *
   * The library owns the on-disk shape; this only passes the list through so
   * the panel has one RPC surface, local books included.
   */
  async localList() {
    return this.library.list()
  }

  /**
   * Import one local file.
   *
   * The panel sends the bytes base64-encoded because the RPC payload is JSON.
   * Parsing happens in lib/import.js; a parser failure is reported as an
   * import failure rather than an internal error, so the panel can show the
   * reason the file was rejected.
   */
  async localImport({ filename, base64 } = {}) {
    if (typeof filename !== 'string' || filename.trim().length === 0) {
      throw new WereadServiceError('weread/bad-request', '缺少文件名。')
    }
    if (typeof base64 !== 'string' || base64.trim().length === 0) {
      throw new WereadServiceError('weread/bad-request', '缺少文件内容。')
    }
    // Buffer.from never rejects a bad string, so an empty result is the only
    // signal that the payload was not base64 at all.
    const buffer = Buffer.from(base64, 'base64')
    if (buffer.length === 0) {
      throw new WereadServiceError('weread/bad-request', '文件内容不是有效的 base64。')
    }
    try {
      return await this.library.import({ buffer, filename: filename.trim() })
    } catch (error) {
      if (error instanceof WereadServiceError) throw error
      throw new WereadServiceError('weread/import-failed', error?.message ?? String(error))
    }
  }

  /** Delete one imported book; false when it was not in the library. */
  async localRemove({ bookId } = {}) {
    const removed = await this.library.remove(typeof bookId === 'string' ? bookId : '')
    return { removed }
  }

  /** One imported book's catalog, never its text. */
  async localBook({ bookId } = {}) {
    const book = await this.library.book(typeof bookId === 'string' ? bookId : '')
    if (book === undefined) {
      throw new WereadServiceError('weread/not-found', '本地书库里没有这本书。')
    }
    return book
  }

  /**
   * One imported chapter, in the same shape the WeRead chapter endpoint
   * returns, so the reader renders both without a branch.
   */
  async localChapter({ bookId, chapterUid } = {}) {
    const chapter = await this.library.chapter(typeof bookId === 'string' ? bookId : '', chapterUid)
    if (chapter === undefined) {
      throw new WereadServiceError('weread/not-found', '本地书库里没有这一章。')
    }
    return {
      bookId: chapter.bookId,
      chapterUid: chapter.chapterUid,
      title: chapter.title,
      format: chapter.book.format,
      paragraphs: chapter.paragraphs,
      fetchedAt: Date.now(),
      chapterIdx: chapter.chapterIdx,
      chapterCount: chapter.chapterCount,
      previous: chapter.previous,
      next: chapter.next,
      chapters: chapter.chapters,
    }
  }

  // --- marks overlaid on rendered chapter text ------------------------------

  /**
   * A reader-shaped view of one chapter: the text plus where its marks sit.
   *
   * Local books have no WeRead notebook, so this resolves the chapter through
   * whichever source owns the id.
   */
  async chapterMarks({ bookId, chapterUid } = {}, { signal } = {}) {
    if (typeof bookId !== 'string' || bookId.length === 0) {
      throw new WereadServiceError('weread/bad-request', '缺少 bookId。')
    }
    await this.ready
    // Marks need either credential: the notebook itself needs the API key, but
    // a Cookie alone still reads text, and drawing nothing beats an error the
    // reader cannot act on.
    const apiKey = this.store.credentials?.apiKey ?? ''
    if (!this.reader.hasSession() && apiKey.length === 0) {
      return {
        bookId,
        chapterUid: numberOr(chapterUid, 0),
        configured: false,
        spans: [],
        unmatched: [],
        highlights: [],
        thoughts: [],
        highlightCount: 0,
        thoughtCount: 0,
        syncedAt: Date.now(),
      }
    }
    const local = isLocalBookId(bookId)
    const chapter = local
      ? await this.localChapter({ bookId, chapterUid })
      : await this.chapter(bookId, chapterUid, { signal })
    const uid = numberOr(chapter?.chapterUid, 0)
    const paragraphs = Array.isArray(chapter?.paragraphs) ? chapter.paragraphs : []
    // A local book has no WeRead notebook; a gateway failure there must not
    // stop the reader from showing the text.
    const notebook = await this.notes(bookId, { signal }).catch((error) => {
      if (local) return undefined
      throw error
    })
    const groups = Array.isArray(notebook?.chapters) ? notebook.chapters : []
    const group = uid > 0 ? groups.find((item) => numberOr(item?.chapterUid, 0) === uid) : undefined
    const highlights = Array.isArray(group?.highlights) ? group.highlights : []
    const thoughts = Array.isArray(group?.thoughts) ? group.thoughts : []
    // Placing marks is the expensive half; an unmarked chapter short-circuits
    // to one plain span per paragraph.
    let spans
    let unmatched
    if (highlights.length === 0) {
      spans = paragraphs.map((text) => [{ start: 0, end: text.length, text }])
      unmatched = []
    } else {
      // WeRead's `range` is an offset into the decoded chapter source, so the
      // html index is the only faithful coordinate space. The paragraph counts
      // have to agree, otherwise the two sources drifted apart and the index
      // is unusable.
      const index =
        typeof chapter?.html === 'string' && chapter.html.length > 0
          ? buildChapterIndex(chapter.html)
          : undefined
      if (index !== undefined && index.paragraphs.length === paragraphs.length) {
        const placed = placeOnHtmlIndex(index, highlights)
        spans = placed.spans
        unmatched = placed.unmatched
      } else {
        // No source text (local books, demo chapters): fall back to the plain
        // text heuristic, which needs the bookmark spelling of `markText`.
        const bookmarks = highlights.map(asBookmark)
        spans = buildSpans(paragraphs, bookmarks)
        const stray = new Set(buildHighlightIndex(paragraphs, bookmarks).unmatched)
        unmatched = highlights.filter((_highlight, at) => stray.has(bookmarks[at]))
      }
    }
    return {
      bookId,
      chapterUid: uid,
      configured: true,
      spans,
      unmatched,
      highlights,
      thoughts,
      highlightCount: highlights.length,
      thoughtCount: thoughts.length,
      syncedAt: Date.now(),
    }
  }

  // --- writing marks back to WeRead -----------------------------------------

  /** Cookie text for the reader APIs, or '' when nobody is signed in. */
  currentCookie() {
    return this.store.credentials?.cookie ?? ''
  }

  /**
   * Forget the caches a mark write invalidates.
   *
   * The notebook is cached for five minutes, so a panel refetch straight after
   * a write would otherwise redraw the old marks and look like the write was
   * dropped.
   */
  async invalidateMarkCaches(bookId) {
    await invalidate(this.store, `notes/${bookId}`)
    await invalidate(this.store, `chapterMarks/${bookId}`)
  }

  /**
   * Create a highlight on the currently open chapter.
   *
   * The panel proposes a paragraph-relative selection; WeRead wants absolute
   * UTF-16 offsets into the decoded chapter source, so this converts through
   * the same index the reader draws with.
   */
  async addHighlight(
    { bookId, chapterUid, paragraphIndex, startOffset, endOffset, colorStyle = 0, range } = {},
    { signal } = {},
  ) {
    const id = typeof bookId === 'string' ? bookId : ''
    if (id.length === 0) throw new WereadServiceError('weread/bad-request', '缺少 bookId。')
    if (isLocalBookId(id)) {
      throw new WereadServiceError('weread/local-no-marks', '本地书不支持云端划线。')
    }
    await this.ready
    if (!this.web.hasSession()) {
      throw new WereadServiceError(
        'weread/needs-cookie',
        '要写划线，请在「设置」里粘贴已登录 weread.qq.com 的 Cookie（须含 wr_vid 与 wr_skey）。',
      )
    }
    const uid = Number(chapterUid)
    if (!Number.isFinite(uid) || uid <= 0) {
      throw new WereadServiceError('weread/bad-request', '缺少 chapterUid。')
    }
    const style = Number.isFinite(Number(colorStyle)) ? Math.max(0, Math.min(4, Number(colorStyle))) : 0

    const catalog = await this.chapterCatalog(id, { signal })
    const chapterIdx = catalog.findIndex((chapter) => chapter.chapterUid === uid)
    const chapter = await this.chapter(id, uid, { signal })
    const html = typeof chapter?.html === 'string' ? chapter.html : ''
    if (html.length === 0) {
      throw new WereadServiceError('weread/no-chapter-text', '这一章还没有正文，无法划线。')
    }

    let selection
    if (
      Number.isInteger(paragraphIndex) &&
      Number.isInteger(startOffset) &&
      Number.isInteger(endOffset)
    ) {
      selection = selectionRange(buildChapterIndex(html), paragraphIndex, startOffset, endOffset)
    }
    if (selection === null || selection === undefined) {
      // The panel may have measured against a copy of the text the index does
      // not reproduce exactly; its absolute range is still trustworthy.
      const explicit = highlightRange({ range })
      if (explicit === null) {
        throw new WereadServiceError('weread/bad-selection', '没有选中可以划线的文字。')
      }
      selection = { ...explicit, markText: html.slice(explicit.start, explicit.end) }
    }
    if (selection.end <= selection.start || selection.markText.length === 0) {
      throw new WereadServiceError('weread/bad-selection', '没有选中可以划线的文字。')
    }

    const detail = await this.web.bookInfo(id, signal)
    const version = numberOr(detail?.version, 0)

    const payload = await this.web.addBookmark(
      {
        bookId: id,
        chapterUid: uid,
        chapterIdx: chapterIdx < 0 ? 0 : chapterIdx,
        bookVersion: version,
        range: `${selection.start}-${selection.end}`,
        markText: selection.markText,
        colorStyle: style,
      },
      signal,
    )

    await this.invalidateMarkCaches(id)
    return {
      ok: true,
      bookmarkId: String(payload?.bookmarkId ?? ''),
      bookId: id,
      chapterUid: uid,
      range: `${selection.start}-${selection.end}`,
      markText: selection.markText,
      colorStyle: style,
    }
  }

  /** Recolor an existing highlight. */
  async updateHighlight({ bookId, bookmarkId, colorStyle } = {}, { signal } = {}) {
    const id = typeof bookId === 'string' ? bookId : ''
    const markId = typeof bookmarkId === 'string' ? bookmarkId : String(bookmarkId ?? '')
    if (markId.length === 0) throw new WereadServiceError('weread/bad-request', '缺少 bookmarkId。')
    await this.ready
    if (!this.web.hasSession()) {
      throw new WereadServiceError(
        'weread/needs-cookie',
        '要写划线，请在「设置」里粘贴已登录 weread.qq.com 的 Cookie（须含 wr_vid 与 wr_skey）。',
      )
    }
    const style = Number.isFinite(Number(colorStyle)) ? Math.max(0, Math.min(4, Number(colorStyle))) : 0
    await this.web.updateBookmark({ bookmarkId: markId, colorStyle: style }, signal)
    await this.invalidateMarkCaches(id)
    return { ok: true, bookmarkId: markId, colorStyle: style }
  }

  /** Delete a highlight. */
  async removeHighlight({ bookId, bookmarkId } = {}, { signal } = {}) {
    const id = typeof bookId === 'string' ? bookId : ''
    const markId = typeof bookmarkId === 'string' ? bookmarkId : String(bookmarkId ?? '')
    if (markId.length === 0) throw new WereadServiceError('weread/bad-request', '缺少 bookmarkId。')
    await this.ready
    if (!this.web.hasSession()) {
      throw new WereadServiceError(
        'weread/needs-cookie',
        '要写划线，请在「设置」里粘贴已登录 weread.qq.com 的 Cookie（须含 wr_vid 与 wr_skey）。',
      )
    }
    await this.web.removeBookmark({ bookmarkId: markId }, signal)
    await this.invalidateMarkCaches(id)
    return { ok: true, bookmarkId: markId }
  }

  /**
   * Look a word up in the reader's dictionary.
   *
   * A miss is normal (rare words, no network), so it returns an empty entry
   * rather than failing the RPC the panel fires while the user reads.
   */
  async lookupDict({ word } = {}, { signal } = {}) {
    const text = typeof word === 'string' ? word.trim().slice(0, 64) : ''
    const empty = { word: text, kind: 'unknown', phonetic: '', readings: [], definitions: [], source: 'none' }
    if (text.length === 0) return empty
    await this.ready
    try {
      return await lookupWord(text, {
        cookie: this.currentCookie(),
        logger: this.ctx.logger,
        signal,
      })
    } catch (error) {
      this.ctx.logger?.debug('[weread] 查词失败：%s', error?.message ?? String(error))
      return empty
    }
  }

  /**
   * One book's whole notebook, tagged with whether marks are available at all.
   *
   * The panel asks once per book, so this stays a thin wrapper: either the
   * notebook, or an explicit "not configured" empty answer.
   */
  async bookMarks({ bookId } = {}, { signal } = {}) {
    const id = typeof bookId === 'string' ? bookId : ''
    await this.ready
    const empty = { bookId: id, book: {}, highlightCount: 0, thoughtCount: 0, chapters: [] }
    if ((this.store.credentials?.apiKey ?? '').length === 0) return { configured: false, ...empty }
    // An imported book has no WeRead notebook behind it.
    if (isLocalBookId(id)) return { configured: true, ...empty }
    return { configured: true, ...(await this.notes(id, { signal })) }
  }

  /**
   * Report the current position back to WeRead.
   *
   * An account mutation, so it stays behind the row's `syncProgress` flag and
   * is only ever reached from an explicit user action.
   */
  async reportProgress(
    { bookId, chapterUid, chapterOffset = 0, positionRatio, progress, summary, elapsedSeconds = 0 },
    { signal } = {},
  ) {
    if (!(await this.syncProgressEnabled())) {
      throw new WereadServiceError(
        'weread/sync-disabled',
        '进度回写当前是关闭的。请在「微信读书 → 设置 → 进度回写」里打开后再试。',
      )
    }
    await this.ready
    const catalog = await this.chapterCatalog(bookId, { signal })
    const index = catalog.findIndex((chapter) => chapter.chapterUid === Number(chapterUid))
    const chapter = index >= 0 ? catalog[index] : undefined
    const ratio = Number.isFinite(positionRatio) ? Math.max(0, Math.min(1, positionRatio)) : undefined
    const offset =
      Number.isFinite(ratio) ? Math.max(0, Math.floor(ratio * 1000)) : chapterOffset
    const wordOffset =
      Number.isFinite(ratio) && chapter?.wordCount
        ? Math.max(0, Math.min(chapter.wordCount, Math.round(ratio * chapter.wordCount)))
        : offset
    const derived = estimateProgress(catalog, index, wordOffset)
    const reportedProgress = Number.isFinite(progress) ? progress : derived
    const device = await this.deviceIdentity()
    const payload = await this.reader.reportRead({
      bookId,
      chapterUid: Number(chapterUid),
      chapterIdx: chapter?.chapterIdx || (index >= 0 ? index + 1 : 1),
      chapterOffset: offset,
      progress: reportedProgress,
      summary,
      elapsedSeconds,
      appId: device.appId,
      ps: device.ps,
      pc: device.pc,
      signal,
    })
    await this.store.rememberPosition(bookId, chapterUid, {
      chapterIdx: chapter?.chapterIdx,
      chapterOffset: offset,
      progress: reportedProgress,
      readingTime: elapsedSeconds,
    })
    return { reported: true, progress: reportedProgress, response: payload }
  }

  // --- QR login -------------------------------------------------------------

  /** Begin a WeRead web QR login. */
  async qrStart(signal) {
    const started = await startQrLogin(signal)
    this.qrUid = started.uid
    return started
  }

  /** Finish a QR login and persist the Cookie. */
  async qrComplete(uid, signal) {
    const target = typeof uid === 'string' && uid.length > 0 ? uid : this.qrUid
    const finished = await completeQrLogin(target, signal)
    await this.ready
    await this.store.save({ cookie: finished.cookie })
    this.qrUid = undefined
    return this.status()
  }

  // --- client transport -----------------------------------------------------

  /**
   * Dispatch one panel call. Never throws: the client transport carries a
   * result envelope, and a business failure is part of the result.
   * @param endpoint - operation name.
   * @param payload - operation arguments.
   * @param signal - caller cancellation.
   */
  async handleRpc(endpoint, payload, signal) {
    try {
      return { ok: true, value: await this.dispatch(endpoint, payload ?? {}, signal) }
    } catch (error) {
      const serviceError = WereadService.toServiceError(error)
      this.ctx.logger?.debug('[weread] rpc %s failed: %s', endpoint, serviceError.message)
      return {
        ok: false,
        error: { code: serviceError.code, message: serviceError.message, details: serviceError.details ?? {} },
      }
    }
  }

  /** Route one operation name onto the method above. */
  async dispatch(endpoint, payload, signal) {
    switch (endpoint) {
      case 'status':
        return this.status()
      case 'configure':
        return this.configure({
          ...(typeof payload.apiKey === 'string' ? { apiKey: payload.apiKey } : {}),
          ...(typeof payload.cookie === 'string' ? { cookie: payload.cookie } : {}),
          ...(typeof payload.syncProgress === 'boolean' ? { syncProgress: payload.syncProgress } : {}),
          ...(payload.reader !== null && typeof payload.reader === 'object' ? { reader: payload.reader } : {}),
        })
      case 'verify':
        return this.verify(signal)
      case 'readerStatus':
        return this.readerStatus()
      case 'shelf':
        return this.shelf({ refresh: payload.refresh === true, signal })
      case 'current':
        return this.current({ signal })
      case 'progress':
        return this.progress(String(payload.bookId ?? ''), { signal })
      case 'book':
        return this.book(String(payload.bookId ?? ''), { signal })
      case 'notes':
        return this.notes(await this.resolveBookId(payload.bookId ?? payload.title, { signal }), {
          refresh: payload.refresh === true,
          signal,
        })
      case 'chapter':
        return this.chapter(String(payload.bookId ?? ''), payload.chapterUid, {
          refresh: payload.refresh === true,
          signal,
        })
      case 'chapterMarks':
        return this.chapterMarks(
          { bookId: String(payload.bookId ?? ''), chapterUid: payload.chapterUid },
          { signal },
        )
      case 'bookMarks':
        return this.bookMarks({ bookId: String(payload.bookId ?? '') }, { signal })
      case 'addHighlight':
        return this.addHighlight(
          {
            bookId: String(payload.bookId ?? ''),
            chapterUid: payload.chapterUid,
            paragraphIndex: Number.isInteger(payload.paragraphIndex) ? payload.paragraphIndex : undefined,
            startOffset: Number.isInteger(payload.startOffset) ? payload.startOffset : undefined,
            endOffset: Number.isInteger(payload.endOffset) ? payload.endOffset : undefined,
            colorStyle: Number.isFinite(payload.colorStyle) ? payload.colorStyle : 0,
            range: payload.range,
          },
          { signal },
        )
      case 'updateHighlight':
        return this.updateHighlight(
          {
            bookId: String(payload.bookId ?? ''),
            bookmarkId: payload.bookmarkId,
            colorStyle: payload.colorStyle,
          },
          { signal },
        )
      case 'removeHighlight':
        return this.removeHighlight(
          { bookId: String(payload.bookId ?? ''), bookmarkId: payload.bookmarkId },
          { signal },
        )
      case 'lookupDict':
        return this.lookupDict({ word: payload.word }, { signal })
      case 'localList':
        return this.localList()
      case 'localImport':
        return this.localImport({ filename: payload.filename, base64: payload.base64 })
      case 'localRemove':
        return this.localRemove({ bookId: payload.bookId })
      case 'localBook':
        return this.localBook({ bookId: payload.bookId })
      case 'localChapter':
        return this.localChapter({ bookId: payload.bookId, chapterUid: payload.chapterUid })
      case 'reportProgress':
        return this.reportProgress(
          {
            bookId: String(payload.bookId ?? ''),
            chapterUid: payload.chapterUid,
            chapterOffset: Number.isFinite(payload.chapterOffset) ? payload.chapterOffset : 0,
            positionRatio: Number.isFinite(payload.positionRatio) ? payload.positionRatio : undefined,
            progress: Number.isFinite(payload.progress) ? payload.progress : undefined,
            summary: typeof payload.summary === 'string' ? payload.summary : '',
            elapsedSeconds: Number.isFinite(payload.elapsedSeconds) ? payload.elapsedSeconds : 0,
          },
          { signal },
        )
      case 'rememberPosition':
        return this.rememberPosition({
          bookId: payload.bookId,
          chapterUid: payload.chapterUid,
          chapterIdx: Number.isFinite(payload.chapterIdx) ? payload.chapterIdx : undefined,
          chapterOffset: Number.isFinite(payload.chapterOffset) ? payload.chapterOffset : undefined,
          progress: Number.isFinite(payload.progress) ? payload.progress : undefined,
          readingTime: Number.isFinite(payload.readingTime) ? payload.readingTime : undefined,
        })
      case 'notebooks':
        return this.notebooks({ signal })
      case 'stats':
        return this.stats(typeof payload.mode === 'string' ? payload.mode : 'monthly', {
          baseTime: Number.isFinite(payload.baseTime) ? payload.baseTime : undefined,
          signal,
        })
      case 'search':
        return this.search(payload.keyword, {
          scope: Number.isFinite(payload.scope) ? payload.scope : 10,
          count: Number.isFinite(payload.count) ? payload.count : 20,
          signal,
        })
      case 'qrStart':
        return this.qrStart(signal)
      case 'qrComplete':
        return this.qrComplete(payload.uid, signal)
      case 'logout':
        await this.store.save({ cookie: '', apiKey: this.store.credentials?.apiKey ?? '' })
        this.qrUid = undefined
        return this.status()
      case 'endpoints':
        return this.gateway.listEndpoints(signal)
      default:
        throw new WereadServiceError('weread/unknown-endpoint', `未知操作：${endpoint}`)
    }
  }
}
