/**
 * Tests for the highlight positioning module.
 *
 * The fixtures mirror real WeRead bookmark payloads: a chapter-local
 * `range` string plus `markText` that may not match the rendered text
 * character for character.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  COLOR_STYLES,
  buildHighlightIndex,
  buildSpans,
  highlightCounts,
  parseRange,
} from '../lib/highlights.js'

/** Build a bookmark with WeRead's field names. */
function bookmark(overrides) {
  return {
    bookmarkId: '23601441_1_366-476',
    chapterUid: 1,
    chapterIdx: 1,
    range: '0-0',
    markText: '',
    colorStyle: 0,
    createTime: 1778693740,
    ...overrides,
  }
}

test('parseRange accepts every separator WeRead has used', () => {
  assert.deepEqual(parseRange('366-476'), { start: 366, end: 476 })
  assert.deepEqual(parseRange('366,476'), { start: 366, end: 476 })
  assert.deepEqual(parseRange('366~476'), { start: 366, end: 476 })
  assert.deepEqual(parseRange('366，476'), { start: 366, end: 476 })
  assert.deepEqual(parseRange('366～476'), { start: 366, end: 476 })
  assert.deepEqual(parseRange(' 366 - 476 '), { start: 366, end: 476 })
  assert.deepEqual(parseRange('３６６－４７６'), { start: 366, end: 476 })
  assert.deepEqual(parseRange('0-0'), { start: 0, end: 0 })
})

test('parseRange swaps a reversed pair instead of failing', () => {
  assert.deepEqual(parseRange('476-366'), { start: 366, end: 476 })
})

test('parseRange rejects input it cannot trust', () => {
  assert.equal(parseRange(''), null)
  assert.equal(parseRange('   '), null)
  assert.equal(parseRange('366'), null)
  assert.equal(parseRange('366-'), null)
  assert.equal(parseRange('-476'), null)
  assert.equal(parseRange('366-476-500'), null)
  assert.equal(parseRange('a-b'), null)
  assert.equal(parseRange('3.6-4.7'), null)
  assert.equal(parseRange(null), null)
  assert.equal(parseRange(undefined), null)
  assert.equal(parseRange(366), null)
  assert.equal(parseRange({ start: 366, end: 476 }), null)
})

test('COLOR_STYLES exposes at least five selectable swatches', () => {
  assert.ok(Array.isArray(COLOR_STYLES))
  assert.ok(COLOR_STYLES.length >= 5)
  assert.deepEqual(COLOR_STYLES[0], { id: 0, label: '黄' })
  for (const [index, style] of COLOR_STYLES.entries()) {
    assert.equal(style.id, index)
    assert.equal(typeof style.label, 'string')
    assert.ok(style.label.length > 0)
  }
})

test('strategy a: a unique markText wins over the recorded range', () => {
  const paragraphs = ['第一段没有划线', '目标句子在这里', '第三段']
  const highlight = bookmark({ range: '0-4', markText: '目标句子在这里' })

  const { segments, unmatched } = buildHighlightIndex(paragraphs, [highlight])

  assert.equal(unmatched.length, 0)
  assert.equal(segments.length, paragraphs.length)
  assert.deepEqual(segments[0], [{ text: '第一段没有划线' }])
  assert.deepEqual(segments[2], [{ text: '第三段' }])
  assert.deepEqual(segments[1], [
    { text: '目标句子在这里', highlightId: '23601441_1_366-476', colorStyle: 0 },
  ])
})

test('strategy a: a markText repeated in the chapter is ambiguous and falls through to the range', () => {
  const paragraphs = ['重复的句子', '中间', '重复的句子']
  // The range points at the first paragraph, so the ambiguity must resolve there.
  const highlight = bookmark({ range: '0-5', markText: '重复的句子' })

  const { segments, unmatched } = buildHighlightIndex(paragraphs, [highlight])

  assert.equal(unmatched.length, 0)
  assert.deepEqual(segments[0], [{ text: '重复的句子', highlightId: '23601441_1_366-476', colorStyle: 0 }])
  assert.deepEqual(segments[2], [{ text: '重复的句子' }])
})

test('strategy b: an ellipsized markText is located through the range', () => {
  const paragraphs = ['第一段', '开头这是一段被划线的原文结尾']
  // No verbatim match exists, so only the range can place this bookmark.
  const highlight = bookmark({ range: '6-16', markText: '这是一段……原文' })

  const { segments, unmatched } = buildHighlightIndex(paragraphs, [highlight])

  assert.equal(unmatched.length, 0)
  assert.deepEqual(segments[0], [{ text: '第一段' }])
  assert.deepEqual(segments[1], [
    { text: '开头' },
    { text: '这是一段被划线的原文', highlightId: '23601441_1_366-476', colorStyle: 0 },
    { text: '结尾' },
  ])
  assert.equal(segments[1].map((segment) => segment.text).join(''), paragraphs[1])
})

test('strategy b: whitespace differences in markText also fall back to the range', () => {
  const paragraphs = ['甲 乙 丙 丁 戊']
  const highlight = bookmark({ range: '0-9', markText: '甲乙丙' })

  const { segments, unmatched } = buildHighlightIndex(paragraphs, [highlight])

  assert.equal(unmatched.length, 0)
  assert.equal(segments[0][0].highlightId, '23601441_1_366-476')
  assert.equal(segments[0][0].text, '甲 乙 丙 丁 戊')
})

test('strategy b: a range crossing paragraphs is split per paragraph', () => {
  const paragraphs = ['ABCDE', 'FGHIJ', 'KLMNO']
  const highlight = bookmark({ range: '3-14', markText: 'DEFGHIJK' })

  const { segments, unmatched } = buildHighlightIndex(paragraphs, [highlight])

  assert.equal(unmatched.length, 0)
  assert.deepEqual(segments[0], [{ text: 'ABC' }, { text: 'DE', highlightId: '23601441_1_366-476', colorStyle: 0 }])
  assert.deepEqual(segments[1], [{ text: 'FGHIJ', highlightId: '23601441_1_366-476', colorStyle: 0 }])
  assert.deepEqual(segments[2], [{ text: 'KL', highlightId: '23601441_1_366-476', colorStyle: 0 }, { text: 'MNO' }])
})

test('a cross-paragraph range clipped past the end never invents text', () => {
  const paragraphs = ['ABCDE', 'FGHIJ']
  const highlight = bookmark({ range: '3-999', markText: 'no match' })

  const { segments, unmatched } = buildHighlightIndex(paragraphs, [highlight])

  assert.equal(unmatched.length, 0)
  assert.deepEqual(segments[0], [{ text: 'ABC' }, { text: 'DE', highlightId: '23601441_1_366-476', colorStyle: 0 }])
  assert.deepEqual(segments[1], [{ text: 'FGHIJ', highlightId: '23601441_1_366-476', colorStyle: 0 }])
})

test('overlapping highlights are truncated so segments never nest', () => {
  const paragraphs = ['0123456789']
  const first = bookmark({ bookmarkId: 'first', range: '2-6', markText: 'none-a' })
  const second = bookmark({ bookmarkId: 'second', range: '4-8', markText: 'none-b' })

  const { segments, unmatched } = buildHighlightIndex(paragraphs, [first, second])

  assert.equal(unmatched.length, 0)
  assert.deepEqual(segments[0], [
    { text: '01' },
    { text: '2345', highlightId: 'first', colorStyle: 0 },
    { text: '67', highlightId: 'second', colorStyle: 0 },
    { text: '89' },
  ])
  assert.equal(segments[0].map((segment) => segment.text).join(''), paragraphs[0])
})

test('a highlight fully covered by an earlier one is absorbed, not reported as unmatched', () => {
  const paragraphs = ['abcdefgh']
  const first = bookmark({ bookmarkId: 'outer', range: '0-8', markText: 'none-a' })
  const second = bookmark({ bookmarkId: 'inner', range: '3-5', markText: 'none-b' })

  const { segments, unmatched } = buildHighlightIndex(paragraphs, [first, second])

  assert.equal(unmatched.length, 0)
  assert.deepEqual(segments[0], [{ text: 'abcdefgh', highlightId: 'outer', colorStyle: 0 }])
})

test('an unmatched highlight is returned untouched for the UI', () => {
  const paragraphs = ['short']
  const highlight = bookmark({ range: '500-600', markText: '不存在的句子' })

  const { segments, unmatched } = buildHighlightIndex(paragraphs, [highlight])

  assert.deepEqual(segments, [[{ text: 'short' }]])
  assert.equal(unmatched.length, 1)
  assert.equal(unmatched[0], highlight)
})

test('a highlight with neither a usable range nor markText is unmatched', () => {
  const paragraphs = ['some text']
  const broken = bookmark({ range: 'not-a-range', markText: '' })
  const noFields = { bookmarkId: 'x' }

  const { unmatched } = buildHighlightIndex(paragraphs, [broken, noFields])

  assert.equal(unmatched.length, 2)
})

test('empty paragraphs produce as many segment lists as paragraphs', () => {
  const empty = buildHighlightIndex([], [bookmark({ range: '0-5', markText: '文字' })])
  assert.deepEqual(empty.segments, [])
  assert.equal(empty.unmatched.length, 1)

  const withEmptyParagraph = buildHighlightIndex(['', '正文'], [bookmark({ range: '0-2', markText: '正文' })])
  assert.deepEqual(withEmptyParagraph.segments[0], [{ text: '' }])
  assert.deepEqual(withEmptyParagraph.segments[1], [
    { text: '正文', highlightId: '23601441_1_366-476', colorStyle: 0 },
  ])
})

test('non-array input is tolerated', () => {
  assert.deepEqual(buildHighlightIndex(undefined, undefined), { segments: [], unmatched: [] })
  assert.deepEqual(buildSpans(null, null), [])
})

test('note and colorStyle are passed through from the bookmark', () => {
  const paragraphs = ['这本书讲的是耐心']
  const highlight = bookmark({
    bookmarkId: 'with-note',
    range: '0-7',
    markText: '这本书讲的是耐心',
    colorStyle: 2,
    content: '想到去年的事',
  })

  const { segments } = buildHighlightIndex(paragraphs, [highlight])

  assert.deepEqual(segments[0], [
    {
      text: '这本书讲的是耐心',
      highlightId: 'with-note',
      colorStyle: 2,
      note: '想到去年的事',
    },
  ])
})

test('a bookmark without a note leaves note undefined', () => {
  const paragraphs = ['没有想法']
  const highlight = bookmark({ range: '0-4', markText: '没有想法' })

  const { segments } = buildHighlightIndex(paragraphs, [highlight])

  assert.equal('note' in segments[0][0], false)
  assert.equal(segments[0][0].note, undefined)
})

test('a missing colorStyle is omitted rather than invented', () => {
  const paragraphs = ['颜色']
  const highlight = bookmark({ range: '0-2', markText: '颜色', colorStyle: undefined })

  const { segments } = buildHighlightIndex(paragraphs, [highlight])

  assert.equal('colorStyle' in segments[0][0], false)
})

test('buildSpans reports paragraph-relative offsets', () => {
  const paragraphs = ['开头这是一段被划线的原文结尾', '第二段']
  const highlight = bookmark({ range: '2-12', markText: '这是一段……原文' })

  const spans = buildSpans(paragraphs, [highlight])

  assert.equal(spans.length, paragraphs.length)
  assert.deepEqual(spans[0], [
    { start: 0, end: 2, text: '开头' },
    { start: 2, end: 12, text: '这是一段被划线的原文', highlightId: '23601441_1_366-476', colorStyle: 0 },
    { start: 12, end: 14, text: '结尾' },
  ])
  assert.deepEqual(spans[1], [{ start: 0, end: 3, text: '第二段' }])
})

test('buildSpans keeps offsets local to each paragraph when a range crosses paragraphs', () => {
  const paragraphs = ['ABCDE', 'FGHIJ', 'KLMNO']
  const highlight = bookmark({ range: '3-14', markText: 'DEFGHIJK' })

  const spans = buildSpans(paragraphs, [highlight])

  assert.deepEqual(spans[0], [
    { start: 0, end: 3, text: 'ABC' },
    { start: 3, end: 5, text: 'DE', highlightId: '23601441_1_366-476', colorStyle: 0 },
  ])
  assert.deepEqual(spans[1], [
    { start: 0, end: 5, text: 'FGHIJ', highlightId: '23601441_1_366-476', colorStyle: 0 },
  ])
  assert.deepEqual(spans[2], [
    { start: 0, end: 2, text: 'KL', highlightId: '23601441_1_366-476', colorStyle: 0 },
    { start: 2, end: 5, text: 'MNO' },
  ])

  // Every offset must address the paragraph it belongs to.
  for (const [index, paragraphSpans] of spans.entries()) {
    for (const span of paragraphSpans) {
      assert.equal(span.text, paragraphs[index].slice(span.start, span.end))
    }
    assert.equal(paragraphSpans.map((span) => span.text).join(''), paragraphs[index])
    assert.equal(paragraphSpans.at(0).start, 0)
    assert.equal(paragraphSpans.at(-1).end, paragraphs[index].length)
  }
})

test('buildSpans and buildHighlightIndex agree on the same input', () => {
  const paragraphs = ['上一段', 'ABCDE', 'FGHIJ', 'KLMNO', '下一段']
  const highlights = [
    bookmark({ bookmarkId: 'cross', range: '6-17', markText: 'not present' }),
    bookmark({ bookmarkId: 'text', range: '0-2', markText: '下一段' }),
    bookmark({ bookmarkId: 'lost', range: '900-999', markText: 'gone' }),
  ]

  const spans = buildSpans(paragraphs, highlights)
  const { segments, unmatched } = buildHighlightIndex(paragraphs, highlights)

  assert.equal(segments.length, spans.length)
  assert.equal(unmatched.length, 1)
  assert.equal(unmatched[0].bookmarkId, 'lost')

  for (const [index, paragraphSpans] of spans.entries()) {
    assert.deepEqual(
      paragraphSpans.map((span) => span.text),
      segments[index].map((segment) => segment.text),
    )
    for (const [offset, span] of paragraphSpans.entries()) {
      assert.equal(span.text, paragraphs[index].slice(span.start, span.end))
      if (span.highlightId !== undefined) assert.equal(segments[index][offset].highlightId, span.highlightId)
    }
  }
})

test('highlightCounts groups by chapterUid and stringifies the key', () => {
  const highlights = [
    bookmark({ bookmarkId: 'a', chapterUid: 1 }),
    bookmark({ bookmarkId: 'b', chapterUid: '1' }),
    bookmark({ bookmarkId: 'c', chapterUid: 2 }),
    bookmark({ bookmarkId: 'd', chapterUid: undefined }),
  ]

  assert.deepEqual(highlightCounts(highlights), {
    total: 4,
    byChapter: { 1: 2, 2: 1 },
  })
})

test('highlightCounts handles empty and missing input', () => {
  assert.deepEqual(highlightCounts([]), { total: 0, byChapter: {} })
  assert.deepEqual(highlightCounts(undefined), { total: 0, byChapter: {} })
})
