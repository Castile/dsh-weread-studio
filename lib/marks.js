/**
 * Bookmark ↔ rendered-paragraph coordinates for one chapter.
 *
 * WeRead bookmarks carry a `range` such as "18333-18400" whose coordinates are
 * offsets into the *raw decoded chapter XHTML*, not into the flattened text the
 * panel renders. For a non-stale bookmark the identity
 *
 *     html.slice(start, end) === bookmark.markText
 *
 * holds (verified against real chapter payloads). The panel, however, paints
 * htmlToParagraphs(html), so a cloud bookmark can only be underlined once its
 * html interval is expressed as (paragraphIndex, offsetInParagraph) pairs —
 * and a new selection has to travel the other way.
 *
 * Both directions come from walking the html once and emitting the flattened
 * characters together with the html span each one came from. Stripping tags and
 * searching the text afterwards cannot recover this: tags, CRLF and footnote
 * <img class="qqreader-footnote"> nodes all count toward html offsets, and a
 * single output character may come from a multi-character entity (&#x4e2d;).
 *
 * The walk mirrors htmlToParagraphs from lib/reader.js rule for rule: <br> and
 * closing block tags become newlines, script/style are dropped entirely,
 * remaining tags vanish, character references are decoded, lines are split,
 * trimmed and empty ones dropped — so the paragraph list built here is
 * identical to the one the panel renders. test/marks.test.mjs asserts it.
 *
 * Offsets are half-open [start, end) intervals in UTF-16 code units, i.e.
 * ordinary JavaScript string indices, matching bookmark range values.
 *
 * @module dsh-weread/lib/marks
 */

import { parseRange } from './highlights.js'
import { htmlToParagraphs } from './reader.js'

/**
 * The per-character html map of one chapter.
 *
 * Kept off the public shape on purpose: only { paragraphs, text } is the
 * documented, serializable result, while the map is an implementation detail
 * that would otherwise leak into JSON payloads sent to the panel. It is a
 * non-enumerable symbol property, so it lives as long as the index object
 * itself does and is ignored by JSON.stringify and deepEqual.
 */
const INTERNAL = Symbol('weread.marks.map')

/** <br> and <br/> become one newline. */
const BR_TAG = /<br\s*\/?>/iy

/** Closing block-level tags become one newline. */
const BLOCK_CLOSE_TAG = /<\/(?:p|div|h[1-6]|li|blockquote|section|article|tr|td)>/iy

/** A whole <script>/<style> element contributes no text at all. */
const SCRIPT_STYLE_TAG = /<(script|style)[^>]*>[\s\S]*?<\/\1>/iy

/** Any remaining tag is dropped, exactly as htmlToParagraphs drops it. */
const ANY_TAG = /<[^>]*>/y

/**
 * Character-reference passes, in exactly the order htmlToParagraphs applies
 * them. Order matters: "&amp;lt;" must decode to "&lt;", never to "<", so each
 * pass only sees the output of the previous one.
 */
const ENTITY_PASSES = [
  [/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16))],
  [/&#(\d+);/g, (_match, dec) => String.fromCodePoint(Number.parseInt(dec, 10))],
  [/&nbsp;/gi, () => ' '],
  [/&lt;/gi, () => '<'],
  [/&gt;/gi, () => '>'],
  [/&quot;/gi, () => '"'],
  [/&#39;|&apos;/gi, () => "'"],
  [/&amp;/gi, () => '&'],
]

/** Characters htmlToParagraphs trims from both ends of a line. */
const TRIMMED = /[\s\u3000]/u

/**
 * Walk the html once, emitting flattened characters with their html spans.
 *
 * The replacement order is the one htmlToParagraphs uses: script/style, then
 * <br>, then closing block tags, then every other tag. Newlines are emitted as
 * characters whose span is the offset of the break itself, so the assembly step
 * can both split lines and remember where each separator sat in the html.
 *
 * Character references are deliberately left undecoded here: decodePasses()
 * replays them over the emitted stream, where re-walking is impossible because
 * htmlToParagraphs decodes after stripping tags (so a reference can be split by
 * a tag and still decode).
 *
 * @param html - decoded chapter XHTML.
 * @returns chars, starts and ends as three parallel arrays.
 */
function walk(html) {
  const chars = []
  const starts = []
  const ends = []
  const length = html.length
  let i = 0

  // Emit one output character occupying [start, end) in the html.
  //
  // A decoded reference may be a surrogate pair (&#x20000;), which is two
  // UTF-16 units but a single un-splittable character: both units are recorded
  // with the reference's whole span so every offset stays code-unit aligned
  // with the paragraph text.
  const emit = (char, start, end) => {
    for (let unit = 0; unit < char.length; unit += 1) {
      chars.push(char[unit])
      starts.push(start)
      ends.push(end)
    }
  }

  while (i < length) {
    if (html[i] !== '<') {
      emit(html[i], i, i + 1)
      i += 1
      continue
    }

    SCRIPT_STYLE_TAG.lastIndex = i
    const script = SCRIPT_STYLE_TAG.exec(html)
    if (script !== null) {
      i = SCRIPT_STYLE_TAG.lastIndex
      continue
    }

    BR_TAG.lastIndex = i
    const br = BR_TAG.exec(html)
    if (br !== null) {
      emit('\n', i, i)
      i = BR_TAG.lastIndex
      continue
    }

    BLOCK_CLOSE_TAG.lastIndex = i
    const block = BLOCK_CLOSE_TAG.exec(html)
    if (block !== null) {
      emit('\n', i, i)
      i = BLOCK_CLOSE_TAG.lastIndex
      continue
    }

    ANY_TAG.lastIndex = i
    const tag = ANY_TAG.exec(html)
    if (tag !== null) {
      i = ANY_TAG.lastIndex
      continue
    }

    // A lone '<' with no closing '>' stays literal text, as it does upstream.
    emit('<', i, i + 1)
    i += 1
  }

  return { chars, starts, ends }
}

/**
 * Replay htmlToParagraphs' character-reference passes over the emitted stream.
 *
 * Doing this after tag stripping (rather than inside the walk) is what makes
 * the map exact: upstream decodes the already-stripped string, so a reference
 * may be split by a tag ("&#x4e"<b></b>"2d;") or cascade through a previous pass
 * ("&#38;lt;" -> "&lt;" -> "<"). Each surviving unit inherits the html span of
 * the match it came from, so a decoded character still points at its source.
 *
 * @param walked - { chars, starts, ends } from walk().
 * @returns a new { chars, starts, ends } with references decoded, same shape.
 */
function decodePasses({ chars, starts, ends }) {
  let current = { chars, starts, ends }

  for (const [pattern, replace] of ENTITY_PASSES) {
    // Every reference starts with '&', so a stream without one cannot match any
    // pass and the chapter is returned untouched.
    const joined = current.chars.join('')
    if (!joined.includes('&')) return current

    const nextChars = []
    const nextStarts = []
    const nextEnds = []
    let copied = 0
    let matched = false
    let match

    pattern.lastIndex = 0
    while ((match = pattern.exec(joined)) !== null) {
      matched = true
      for (let k = copied; k < match.index; k += 1) {
        nextChars.push(current.chars[k])
        nextStarts.push(current.starts[k])
        nextEnds.push(current.ends[k])
      }
      const start = current.starts[match.index]
      const end = current.ends[match.index + match[0].length - 1]
      const replacement = replace(...match)
      for (let unit = 0; unit < replacement.length; unit += 1) {
        nextChars.push(replacement[unit])
        nextStarts.push(start)
        nextEnds.push(end)
      }
      copied = match.index + match[0].length
    }

    // A pass that matched nothing leaves the stream as it was, so chapters that
    // use only a couple of reference forms pay for only those passes.
    if (!matched) continue

    for (let k = copied; k < current.chars.length; k += 1) {
      nextChars.push(current.chars[k])
      nextStarts.push(current.starts[k])
      nextEnds.push(current.ends[k])
    }

    current = { chars: nextChars, starts: nextStarts, ends: nextEnds }
  }

  return current
}

/**
 * Split emitted characters into the paragraphs htmlToParagraphs would return.
 *
 * Each line is trimmed from both ends (the same characters htmlToParagraphs
 * trims) and dropped when empty; the surviving characters keep their html
 * spans, which is how paragraphs[i].start and .end are derived.
 *
 * @param walked - the result of walk().
 * @returns the public paragraphs plus the per-character map behind them.
 */
function assemble({ chars, starts, ends }, htmlLength) {
  const paragraphs = []
  const charStarts = []
  const charEnds = []
  const lineBreaks = []
  const total = chars.length
  let lineStart = 0

  for (let k = 0; k <= total; k += 1) {
    const isBreak = k === total || chars[k] === '\n'
    if (!isBreak) continue
    let from = lineStart
    let to = k
    while (from < to && TRIMMED.test(chars[from])) from += 1
    while (to > from && TRIMMED.test(chars[to - 1])) to -= 1
    if (to > from) {
      paragraphs.push({
        text: chars.slice(from, to).join(''),
        start: starts[from],
        end: ends[to - 1],
      })
      charStarts.push(starts.slice(from, to))
      charEnds.push(ends.slice(from, to))
      lineBreaks.push(k < total ? starts[k] : htmlLength)
    }
    lineStart = k + 1
  }

  const textStarts = []
  let cursor = 0
  for (const paragraph of paragraphs) {
    textStarts.push(cursor)
    cursor += paragraph.text.length + 1
  }

  return {
    paragraphs,
    text: paragraphs.map((paragraph) => paragraph.text).join('\n'),
    charStarts,
    charEnds,
    textStarts,
    lineBreaks,
  }
}

/** The hidden per-character map of an index built by buildChapterIndex. */
function mapOf(index) {
  if (index === null || typeof index !== 'object') return undefined
  if (!Array.isArray(index.paragraphs)) return undefined
  return index[INTERNAL]
}

/** First index k in [from, to) with values[k] > target; to when none. */
function firstGreater(values, target, from, to) {
  let lo = from
  let hi = to
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (values[mid] > target) hi = mid
    else lo = mid + 1
  }
  return lo
}

/** Last index k in [from, to) with values[k] < target; from - 1 when none. */
function lastLess(values, target, from, to) {
  let lo = from
  let hi = to
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (values[mid] < target) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

/** Normalize a range argument into a clipped { start, end }, or null. */
function normalizeRange(range, htmlLength) {
  let start
  let end
  if (typeof range === 'string') {
    const parsed = parseRange(range)
    if (parsed === null) return null
    start = parsed.start
    end = parsed.end
  } else if (Array.isArray(range)) {
    start = Number(range[0])
    end = Number(range[1])
  } else if (range !== null && typeof range === 'object') {
    start = Number(range.start)
    end = Number(range.end)
  } else {
    return null
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  start = Math.trunc(start)
  end = Math.trunc(end)
  if (start > end) [start, end] = [end, start]
  return {
    start: Math.min(Math.max(start, 0), htmlLength),
    end: Math.min(Math.max(end, 0), htmlLength),
  }
}

/** The paragraph at paragraphIndex, or undefined when out of bounds. */
function paragraphOf(index, paragraphIndex) {
  if (!Array.isArray(index?.paragraphs)) return undefined
  if (!Number.isInteger(paragraphIndex)) return undefined
  return index.paragraphs[paragraphIndex]
}

/**
 * Build the html ↔ paragraph coordinate map for one chapter.
 *
 * The returned paragraphs are exactly htmlToParagraphs(html) — same text, same
 * order, same trimming — with the html span of each one added.
 * html.slice(start, end) === text holds whenever nothing was stripped between
 * the characters, and still bounds the paragraph exactly when tags were dropped
 * inside it.
 *
 * text is paragraphs.map(p => p.text).join('\n'): the flattened chapter with
 * one separator newline between paragraphs and none at the end.
 *
 * @param html - decoded chapter XHTML (the same string bookmarks index into).
 * @returns { paragraphs: [{ text, start, end }], text }.
 */
export function buildChapterIndex(html) {
  const source = typeof html === 'string' ? html : ''
  const built = assemble(decodePasses(walk(source)), source.length)
  const index = { paragraphs: built.paragraphs, text: built.text }
  Object.defineProperty(index, INTERNAL, {
    value: {
      htmlLength: source.length,
      charStarts: built.charStarts,
      charEnds: built.charEnds,
      textStarts: built.textStarts,
      lineBreaks: built.lineBreaks,
    },
    enumerable: false,
    writable: false,
    configurable: false,
  })
  return index
}

/**
 * Map a selection inside one rendered paragraph to an html range.
 *
 * startOffset/endOffset are paragraph-relative UTF-16 offsets, the same numbers
 * the panel's <p> text selection produces. The result can be stored as a
 * bookmark: markText is exactly the selected substring.
 *
 * Returns null (never throws) when the index did not come from
 * buildChapterIndex, when the paragraph is out of range, when an offset is not
 * an integer, or when the offsets do not satisfy
 * 0 <= startOffset <= endOffset <= paragraph.text.length. A zero-width
 * selection (startOffset === endOffset) is valid and yields markText === ''.
 *
 * @param index - a map from buildChapterIndex().
 * @param paragraphIndex - paragraph to select inside.
 * @param startOffset - selection start, paragraph-relative.
 * @param endOffset - selection end, paragraph-relative (exclusive).
 * @returns { start, end, markText }, or null.
 */
export function selectionRange(index, paragraphIndex, startOffset, endOffset) {
  const map = mapOf(index)
  if (map === undefined) return null
  const paragraph = paragraphOf(index, paragraphIndex)
  if (paragraph === undefined) return null
  if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset)) return null
  const length = paragraph.text.length
  if (length === 0) return null
  if (startOffset < 0 || endOffset < startOffset || endOffset > length) return null

  const starts = map.charStarts[paragraphIndex]
  const ends = map.charEnds[paragraphIndex]
  const start = startOffset >= length ? ends[length - 1] : starts[startOffset]
  const end = endOffset <= 0 ? starts[0] : ends[endOffset - 1]
  return { start, end, markText: paragraph.text.slice(startOffset, endOffset) }
}

/**
 * Project an html range onto paragraph-relative spans.
 *
 * This is the direction cloud bookmarks need: a stored "18333-18400" becomes
 * one span per paragraph it touches, clipped to each paragraph's bounds. A
 * range that has drifted (points into tags, past the chapter, or onto text that
 * is no longer there) degrades instead of failing: out-of-bounds parts are
 * clipped and uncovered paragraphs are simply absent, so a stale bookmark still
 * underlines whatever overlaps.
 *
 * @param index - a map from buildChapterIndex().
 * @param range - { start, end }, [start, end], or a WeRead "a-b" string.
 * @returns [{ paragraphIndex, start, end }], possibly empty, never null.
 */
export function htmlRangeToParagraphSpans(index, range) {
  const map = mapOf(index)
  if (map === undefined) return []
  const clipped = normalizeRange(range, map.htmlLength)
  if (clipped === null || clipped.start >= clipped.end) return []

  const spans = []
  for (let p = 0; p < index.paragraphs.length; p += 1) {
    const starts = map.charStarts[p]
    const ends = map.charEnds[p]
    const count = starts.length
    if (count === 0) continue
    if (clipped.start >= ends[count - 1] || clipped.end <= starts[0]) continue
    const from = Math.min(count, Math.max(0, firstGreater(ends, clipped.start, 0, count)))
    const to = Math.min(count, Math.max(0, lastLess(starts, clipped.end, 0, count) + 1))
    if (to > from) spans.push({ paragraphIndex: p, start: from, end: to })
  }
  return spans
}

/**
 * Convert an html offset to an offset in the flattened index.text.
 *
 * Offsets inside stripped markup (a tag, a CRLF, a footnote <img>) snap to the
 * next emitted character; offsets past the last paragraph snap to the end of
 * the text. Handy when a bookmark's raw range has to be shown in the panel's
 * own coordinate space.
 *
 * @param index - a map from buildChapterIndex().
 * @param htmlOffset - source offset into the chapter html.
 * @returns a text offset, or null when the index did not come from
 *   buildChapterIndex or the offset is not finite.
 */
export function htmlToTextOffset(index, htmlOffset) {
  const map = mapOf(index)
  if (map === undefined) return null
  const offset = Number(htmlOffset)
  if (!Number.isFinite(offset)) return null
  const target = Math.min(Math.max(Math.trunc(offset), 0), map.htmlLength)
  if (target >= map.htmlLength) return index.text.length

  for (let p = 0; p < index.paragraphs.length; p += 1) {
    const starts = map.charStarts[p]
    const ends = map.charEnds[p]
    const count = starts.length
    if (target < starts[0]) return map.textStarts[p]
    if (target <= ends[count - 1]) {
      return map.textStarts[p] + firstGreater(ends, target, 0, count)
    }
  }
  return index.text.length
}

/**
 * Convert an offset in the flattened index.text to an html offset.
 *
 * A paragraph separator newline maps to the html offset of the tag (or literal
 * newline) that produced the break; text.length maps to the end of the html.
 * The inverse of htmlToTextOffset for every offset that names an emitted
 * character.
 *
 * @param index - a map from buildChapterIndex().
 * @param textOffset - offset into index.text.
 * @returns an html offset, or null when the index did not come from
 *   buildChapterIndex or the offset is not finite.
 */
export function textOffsetToHtml(index, textOffset) {
  const map = mapOf(index)
  if (map === undefined) return null
  const offset = Number(textOffset)
  if (!Number.isFinite(offset)) return null
  const target = Math.min(Math.max(Math.trunc(offset), 0), index.text.length)
  if (target >= index.text.length) return map.htmlLength

  let p = 0
  while (p + 1 < index.paragraphs.length && map.textStarts[p + 1] <= target) p += 1
  const local = target - map.textStarts[p]
  if (local < index.paragraphs[p].text.length) return map.charStarts[p][local]
  return map.lineBreaks[p]
}

export { htmlToParagraphs }
