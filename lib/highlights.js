/**
 * Highlight (bookmark) positioning for rendered chapter paragraphs.
 *
 * WeRead returns bookmarks with a chapter-local `range` plus the underlined
 * `markText`. Neither is authoritative on its own: `markText` may carry
 * ellipses, collapsed whitespace or footnote markers, and the `range`
 * coordinate system is not guaranteed to match `paragraphs.join('\n')`
 * (it may be plain text, or count newlines differently).
 *
 * Resolution is therefore ordered: exact unique text match first, then the
 * recorded range, and finally `unmatched` so the UI can flag the bookmark.
 *
 * All offsets are half-open character intervals `[start, end)` measured in
 * UTF-16 code units, i.e. ordinary JS string indices.
 */

/** `"366-476"` style: two non-negative integers and one separator. */
const RANGE_PATTERN = /^(\d+)\s*[-~,，、～－﹣—–]\s*(\d+)$/u

/** Full-width digits, so a copied `range` still parses. */
const FULLWIDTH_DIGITS = /[０-９]/g

/**
 * Parse a WeRead `range` into a half-open interval.
 *
 * Accepts `-`, `~` and `,` (and their full-width relatives) as separators.
 * Anything else — `null`, `undefined`, numbers, empty strings, single
 * offsets, extra tokens — yields `null` so callers never see NaN offsets.
 *
 * @param range - e.g. `"366-476"`.
 * @returns `{ start, end }` with `start <= end`, or `null`.
 */
export function parseRange(range) {
  if (typeof range !== 'string') return null
  const text = range
    .trim()
    .replace(FULLWIDTH_DIGITS, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
  const match = RANGE_PATTERN.exec(text)
  if (match === null) return null
  const first = Number.parseInt(match[1], 10)
  const second = Number.parseInt(match[2], 10)
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(second)) return null
  // Drafts occasionally record the pair backwards; the interval is the same.
  return first <= second ? { start: first, end: second } : { start: second, end: first }
}

/** Colour swatches WeRead uses for bookmarks, in its own id order. */
export const COLOR_STYLES = [
  { id: 0, label: '黄' },
  { id: 1, label: '红' },
  { id: 2, label: '蓝' },
  { id: 3, label: '绿' },
  { id: 4, label: '紫' },
]

/**
 * Split every paragraph into plain and highlighted spans.
 *
 * Strategy, first hit wins:
 * a. `markText` occurs exactly once across the chapter → that occurrence.
 * b. the recorded `range`, interpreted over `paragraphs.join('\n')`, clipped
 *    to each paragraph; a range crossing paragraphs yields one span per
 *    covered paragraph (fully covered paragraphs are entirely highlighted).
 * c. otherwise the bookmark is dropped (see `buildHighlightIndex.unmatched`).
 *
 * Spans are claimed first-come-first-served: a later bookmark may only take
 * the characters an earlier bookmark has not already claimed, so spans never
 * nest and a fully covered bookmark disappears without failing.
 *
 * @param paragraphs - rendered chapter text, one string per paragraph.
 * @param highlights - bookmark records as returned by WeRead.
 * @returns one array per paragraph; each span carries `start`/`end` relative
 *   to its own paragraph plus the bookmark metadata.
 */
export function buildSpans(paragraphs, highlights) {
  return resolve(paragraphs, highlights).spans
}

/**
 * Split every paragraph into plain and highlighted segments for rendering.
 *
 * Same positioning and overlap rules as {@link buildSpans}; the only
 * difference is the shape: segments carry just `text` and the optional
 * bookmark metadata, and bookmarks that could not be placed are returned so
 * the UI can flag them instead of silently losing them.
 *
 * @param paragraphs - rendered chapter text, one string per paragraph.
 * @param highlights - bookmark records as returned by WeRead.
 * @returns `{ segments, unmatched }`; `segments.length === paragraphs.length`.
 */
export function buildHighlightIndex(paragraphs, highlights) {
  const { spans, unmatched } = resolve(paragraphs, highlights)
  const segments = spans.map((paragraphSpans) =>
    paragraphSpans.map((span) => {
      const segment = { text: span.text }
      if (span.highlightId !== undefined) segment.highlightId = span.highlightId
      if (span.colorStyle !== undefined) segment.colorStyle = span.colorStyle
      if (span.note !== undefined) segment.note = span.note
      return segment
    }),
  )
  return { segments, unmatched }
}

/** Count bookmarks overall and per chapter (`chapterUid` stringified). */
export function highlightCounts(highlights) {
  const bookmarks = Array.isArray(highlights) ? highlights : []
  const byChapter = {}
  let total = 0

  for (const bookmark of bookmarks) {
    if (bookmark === null || typeof bookmark !== 'object') continue
    total += 1
    const uid = bookmark.chapterUid
    if (uid === undefined || uid === null || uid === '') continue
    const key = String(uid)
    byChapter[key] = (byChapter[key] ?? 0) + 1
  }

  return { total, byChapter }
}

/** Shared resolution pass behind both public shapes. */
function resolve(paragraphs, highlights) {
  const texts = Array.isArray(paragraphs)
    ? paragraphs.map((paragraph) => (typeof paragraph === 'string' ? paragraph : paragraph == null ? '' : String(paragraph)))
    : []
  const bookmarks = Array.isArray(highlights) ? highlights : []

  const paragraphStarts = []
  let offset = 0
  for (const text of texts) {
    paragraphStarts.push(offset)
    offset += text.length + 1 // the joining newline
  }
  const globalLength = texts.length === 0 ? 0 : Math.max(0, offset - 1)

  /** Claimed `[start, end)` intervals per paragraph, kept sorted. */
  const claimed = texts.map(() => [])
  /** Accepted spans per paragraph: `{ start, end, meta }`. */
  const placed = texts.map(() => [])
  const unmatched = []

  for (const bookmark of bookmarks) {
    if (bookmark === null || typeof bookmark !== 'object') {
      unmatched.push(bookmark)
      continue
    }

    const markText = typeof bookmark.markText === 'string' ? bookmark.markText : ''
    const range = parseRange(bookmark.range)
    const located =
      (markText.trim().length > 0 ? locateByText(texts, markText) : null) ??
      (range === null ? null : locateByRange(texts, paragraphStarts, globalLength, range))
    if (located === null) {
      unmatched.push(bookmark)
      continue
    }

    const meta = {
      highlightId: bookmark.bookmarkId === undefined || bookmark.bookmarkId === null ? undefined : bookmark.bookmarkId,
      colorStyle: Number.isFinite(Number(bookmark.colorStyle)) ? Number(bookmark.colorStyle) : undefined,
      note: typeof bookmark.content === 'string' && bookmark.content.length > 0 ? bookmark.content : undefined,
    }

    for (const span of located) {
      for (const [start, end] of subtractClaims(span.start, span.end, claimed[span.index])) {
        claimed[span.index].push([start, end])
        claimed[span.index].sort((left, right) => left[0] - right[0])
        placed[span.index].push({ start, end, meta })
      }
    }
  }

  return { spans: texts.map((text, index) => composeSpans(text, placed[index])), unmatched }
}

/**
 * Locate `markText` when it appears exactly once in the whole chapter.
 * A repeated phrase is ambiguous, so the caller falls back to the range.
 */
function locateByText(paragraphs, markText) {
  let found = null
  let count = 0

  for (let index = 0; index < paragraphs.length; index += 1) {
    const text = paragraphs[index]
    let from = text.indexOf(markText)
    while (from !== -1) {
      count += 1
      if (count > 1) return null
      found = { index, start: from, end: from + markText.length }
      from = text.indexOf(markText, from + markText.length)
    }
  }

  return found === null ? null : [found]
}

/**
 * Map a global `[start, end)` range onto paragraph-relative spans.
 *
 * The range is clipped to the chapter's real length, and any paragraph whose
 * characters are covered contributes a span. Ranges outside the text, or
 * empty after clipping, are rejected rather than guessed at.
 */
function locateByRange(paragraphs, paragraphStarts, globalLength, range) {
  const start = Math.min(Math.max(range.start, 0), globalLength)
  const end = Math.min(Math.max(range.end, 0), globalLength)
  if (end <= start) return null

  const spans = []
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraphStart = paragraphStarts[index]
    const paragraphEnd = paragraphStart + paragraphs[index].length
    const from = Math.max(start, paragraphStart)
    const to = Math.min(end, paragraphEnd)
    if (to > from) spans.push({ index, start: from - paragraphStart, end: to - paragraphStart })
  }

  return spans.length === 0 ? null : spans
}

/** Remove already claimed characters from `[start, end)`, keeping the rest. */
function subtractClaims(start, end, claimed) {
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

  return pieces.filter(([pieceStart, pieceEnd]) => pieceEnd > pieceStart)
}

/** Turn accepted spans into ordered, gap-free spans over the paragraph. */
function composeSpans(text, items) {
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
