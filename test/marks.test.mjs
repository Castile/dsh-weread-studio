/**
 * Tests for the chapter html ↔ rendered-paragraph coordinate map.
 *
 * Everything here is offline: the fixtures are hand-written chapter XHTML that
 * reproduces the shapes WeRead actually returns (CRLF, wrapper tags, entity
 * references, footnote <img> nodes, script/style blocks). The central promise
 * under test is that lib/marks.js agrees with lib/reader.js htmlToParagraphs
 * character for character, and that html offsets survive a round trip through
 * paragraph-relative spans.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildChapterIndex,
  htmlRangeToParagraphSpans,
  htmlToParagraphs,
  htmlToTextOffset,
  selectionRange,
  textOffsetToHtml,
} from '../lib/marks.js'

/** A wrapped chapter, CRLF separated the way the decoder returns it. */
const SIMPLE = [
  '<html>',
  '<head><meta charset="utf-8"/></head>',
  '<body>',
  '<p>第一段文字</p>',
  '<p>第二段文字</p>',
  '</body>',
  '</html>',
].join('\r\n')

/** Escapes, named references and a multi-character entity. */
const ENTITIES = '<p>&#x4e2d;&#25991; &nbsp;&amp;&nbsp; &#39;q&#39;&nbsp;&lt;x&gt;&nbsp;&quot;y&quot;</p>'

/** Breaks and block-level closing tags, the two newline sources. */
const BLOCKS = [
  '<div>甲<br/>乙</div>',
  '<h2>标题</h2>',
  '<ul><li>项一</li><li>项二</li></ul>',
  '<blockquote>引用</blockquote>',
  '<table><tr><td>格一</td><td>格二</td></tr></table>',
].join('')

/** A mixed chapter: markup inside paragraphs, footnotes, indentation, scripts. */
const MIXED = [
  '<?xml version="1.0"?>\r\n',
  '<html>\r\n<head><style>p{color:red}</style><script>var a=1<2;</script></head>\r\n',
  '<body>\r\n',
  '  <p>\u3000开头有全角空格\u3000</p>\r\n',
  '  <p>甲<b>加粗</b>丙<img class="qqreader-footnote" src="note.png"/></p>\r\n',
  '  <p>  单独一行  </p>\r\n',
  '  <p></p>\r\n',
  '  <p>尾段 &amp; 结束</p>\r\n',
  '</body>\r\n</html>',
].join('')

/** Assert the paragraph list matches lib/reader.js exactly, one by one. */
function assertParity(html) {
  const index = buildChapterIndex(html)
  const expected = htmlToParagraphs(html)
  assert.equal(index.paragraphs.length, expected.length)
  for (let p = 0; p < expected.length; p += 1) {
    assert.equal(index.paragraphs[p].text, expected[p])
  }
  assert.equal(index.text, index.paragraphs.map((paragraph) => paragraph.text).join('\n'))
  return index
}

test('paragraph text matches htmlToParagraphs on a wrapped CRLF chapter', () => {
  const index = assertParity(SIMPLE)
  assert.deepEqual(index.paragraphs.map((paragraph) => paragraph.text), ['第一段文字', '第二段文字'])
  assert.equal(index.text, '第一段文字\n第二段文字')
})

test('paragraph spans index the html: slice(start, end) is the paragraph', () => {
  const index = assertParity(SIMPLE)
  for (const paragraph of index.paragraphs) {
    assert.equal(SIMPLE.slice(paragraph.start, paragraph.end), paragraph.text)
  }
  // The first paragraph starts after its opening tag, not at the tag itself.
  assert.equal(SIMPLE[index.paragraphs[0].start - 1], '>')
})

test('entities decode and keep their full html span', () => {
  const index = assertParity(ENTITIES)
  assert.equal(index.paragraphs.length, 1)
  const paragraph = index.paragraphs[0]
  assert.equal(paragraph.text, '中文  &  \'q\' <x> "y"')

  const built = selectionRange(index, 0, 0, 2)
  assert.equal(built.markText, '中文')
  assert.equal(ENTITIES.slice(built.start, built.end), '&#x4e2d;&#25991;')

  // The ampersand came from &amp;, so the html slice is longer than the text.
  const amp = selectionRange(index, 0, paragraph.text.indexOf('&'), paragraph.text.indexOf('&') + 1)
  assert.equal(amp.markText, '&')
  assert.equal(ENTITIES.slice(amp.start, amp.end), '&amp;')

  const nbsp = selectionRange(index, 0, 3, 4)
  assert.equal(nbsp.markText, ' ')
  assert.equal(ENTITIES.slice(nbsp.start, nbsp.end), '&nbsp;')
})

test('<br> and closing block tags both break paragraphs', () => {
  const index = assertParity(BLOCKS)
  assert.deepEqual(index.paragraphs.map((paragraph) => paragraph.text), [
    '甲',
    '乙',
    '标题',
    '项一',
    '项二',
    '引用',
    '格一',
    '格二',
  ])
  // Each <br> contributes no characters, only a break, so the html between
  // consecutive paragraphs is the markup that separated them.
  const br = index.paragraphs[1].start
  assert.equal(BLOCKS.slice(br - 5, br), '<br/>')
})

test('a paragraph with inline markup spans the stored text exactly', () => {
  const index = assertParity(MIXED)
  assert.deepEqual(index.paragraphs.map((paragraph) => paragraph.text), [
    '开头有全角空格',
    '甲加粗丙',
    '单独一行',
    '尾段 & 结束',
  ])

  const paragraph = index.paragraphs[1]
  assert.equal(paragraph.text, '甲加粗丙')
  const bold = selectionRange(index, 1, 1, 3)
  assert.equal(bold.markText, '加粗')
  // The <b> tags sit between the two characters' spans, so the html interval
  // is wider than markText — start and end stay on the characters themselves.
  assert.equal(MIXED.slice(bold.start, bold.end), '加粗')
  assert.equal(MIXED.slice(bold.start - 3, bold.start), '<b>')
  assert.equal(MIXED.slice(bold.end, bold.end + 4), '</b>')

  // The footnote <img> is stripped and contributes nothing.
  const last = selectionRange(index, 1, 3, 4)
  assert.equal(last.markText, '丙')
  assert.equal(MIXED.slice(last.start, last.end), '丙')
  assert.ok(MIXED.slice(last.end).startsWith('<img class="qqreader-footnote"'))

  // Leading/trailing whitespace and the empty <p> are trimmed away.
  const indented = index.paragraphs[2]
  assert.equal(MIXED.slice(indented.start, indented.end), '单独一行')
})

test('script and style content never reaches the text', () => {
  const index = assertParity(MIXED)
  assert.equal(index.text.includes('color:red'), false)
  assert.equal(index.text.includes('var a=1'), false)
})

test('selections round-trip through paragraph spans', () => {
  const index = assertParity(MIXED)
  for (let p = 0; p < index.paragraphs.length; p += 1) {
    const length = index.paragraphs[p].text.length
    const whole = selectionRange(index, p, 0, length)
    assert.deepEqual(htmlRangeToParagraphSpans(index, whole), [
      { paragraphIndex: p, start: 0, end: length },
    ])
    assert.equal(MIXED.slice(whole.start, whole.end).includes('\n'), false)

    for (let start = 0; start < length; start += 1) {
      for (let end = start + 1; end <= length; end += 1) {
        const built = selectionRange(index, p, start, end)
        const spans = htmlRangeToParagraphSpans(index, built)
        assert.equal(spans.length, 1)
        assert.equal(spans[0].paragraphIndex, p)
        assert.equal(spans[0].start, start)
        assert.equal(spans[0].end, end)
        // markText is exactly what the panel would underline.
        assert.equal(built.markText, index.paragraphs[p].text.slice(start, end))
      }
    }
  }
})

test('a range crossing paragraphs yields one clipped span per paragraph', () => {
  const index = assertParity(SIMPLE)
  const first = index.paragraphs[0]
  const second = index.paragraphs[1]
  const spans = htmlRangeToParagraphSpans(index, {
    start: first.start + 1,
    end: second.start + 2,
  })
  assert.deepEqual(spans, [
    { paragraphIndex: 0, start: 1, end: first.text.length },
    { paragraphIndex: 1, start: 0, end: 2 },
  ])
})

test('a range covering the whole chapter covers every paragraph', () => {
  const index = assertParity(MIXED)
  const spans = htmlRangeToParagraphSpans(index, { start: 0, end: MIXED.length })
  assert.deepEqual(
    spans,
    index.paragraphs.map((paragraph, p) => ({
      paragraphIndex: p,
      start: 0,
      end: paragraph.text.length,
    })),
  )
})

test('stale and out-of-range ranges degrade to empty or clipped spans', () => {
  const index = assertParity(SIMPLE)
  // Past the chapter: clipped to nothing.
  assert.deepEqual(htmlRangeToParagraphSpans(index, { start: 100000, end: 100010 }), [])
  // Negative and inverted inputs are normalized, not thrown on.
  assert.deepEqual(htmlRangeToParagraphSpans(index, { start: -50, end: -10 }), [])
  const inverted = htmlRangeToParagraphSpans(index, {
    start: index.paragraphs[0].start + 2,
    end: index.paragraphs[0].start,
  })
  assert.deepEqual(inverted, [{ paragraphIndex: 0, start: 0, end: 2 }])
  // A range that starts inside the opening tag snaps forward to the text.
  const first = index.paragraphs[0]
  const inTag = htmlRangeToParagraphSpans(index, { start: first.start - 3, end: first.start + 1 })
  assert.deepEqual(inTag, [{ paragraphIndex: 0, start: 0, end: 1 }])
  // Junk never throws.
  assert.deepEqual(htmlRangeToParagraphSpans(index, null), [])
  assert.deepEqual(htmlRangeToParagraphSpans(index, 'not-a-range'), [])
  assert.deepEqual(htmlRangeToParagraphSpans(index, { start: 'x', end: 'y' }), [])
  assert.deepEqual(htmlRangeToParagraphSpans({ paragraphs: [] }, { start: 0, end: 5 }), [])
  // WeRead's own "a-b" spelling is accepted, in either order.
  const byString = htmlRangeToParagraphSpans(
    index,
    String(first.start) + '-' + String(first.start + 2),
  )
  assert.deepEqual(byString, [{ paragraphIndex: 0, start: 0, end: 2 }])
})

test('selectionRange rejects out-of-range and non-integer input with null', () => {
  const index = assertParity(SIMPLE)
  const length = index.paragraphs[0].text.length
  assert.equal(selectionRange(index, 0, -1, 2), null)
  assert.equal(selectionRange(index, 0, 2, 1), null)
  assert.equal(selectionRange(index, 0, 0, length + 1), null)
  assert.equal(selectionRange(index, 0, 0.5, 1), null)
  assert.equal(selectionRange(index, 0, 0, Number.NaN), null)
  assert.equal(selectionRange(index, 9, 0, 1), null)
  assert.equal(selectionRange(index, -1, 0, 1), null)
  assert.equal(selectionRange(null, 0, 0, 1), null)
  assert.equal(selectionRange({ paragraphs: [] }, 0, 0, 1), null)
  // A caret is a valid, empty selection.
  assert.deepEqual(selectionRange(index, 0, 0, 0), {
    start: index.paragraphs[0].start,
    end: index.paragraphs[0].start,
    markText: '',
  })
  assert.equal(selectionRange(index, 0, length, length).end, index.paragraphs[0].end)
})

test('html and flattened-text offsets agree in both directions', () => {
  const index = assertParity(MIXED)
  let cursor = 0
  for (let p = 0; p < index.paragraphs.length; p += 1) {
    const paragraph = index.paragraphs[p]
    assert.equal(htmlToTextOffset(index, paragraph.start), cursor)
    assert.equal(textOffsetToHtml(index, cursor), paragraph.start)
    for (let k = 0; k < paragraph.text.length; k += 1) {
      const htmlOffset = textOffsetToHtml(index, cursor + k)
      assert.equal(htmlToTextOffset(index, htmlOffset), cursor + k)
      assert.equal(selectionRange(index, p, k, k + 1).start, htmlOffset)
    }
    cursor += paragraph.text.length + 1
  }
  assert.equal(htmlToTextOffset(index, MIXED.length), index.text.length)
  assert.equal(textOffsetToHtml(index, index.text.length), MIXED.length)
  // Each paragraph separator maps to the html break that produced it, between
  // the two paragraphs' own spans.
  let textCursor = 0
  for (let p = 0; p + 1 < index.paragraphs.length; p += 1) {
    textCursor += index.paragraphs[p].text.length
    assert.equal(index.text[textCursor], '\n')
    const at = textOffsetToHtml(index, textCursor)
    // The separator maps to the closing tag (or <br>) that produced it, which
    // is at or after the previous paragraph's last character.
    assert.ok(at >= index.paragraphs[p].end)
    assert.ok(at < index.paragraphs[p + 1].start)
    assert.equal(htmlToTextOffset(index, at), textCursor + 1)
    textCursor += 1
  }
  assert.equal(htmlToTextOffset(index, -5), 0)
  // Clamped text offsets start at the first emitted character, not at html 0.
  assert.equal(textOffsetToHtml(index, -5), index.paragraphs[0].start)
  assert.equal(htmlToTextOffset(index, Number.NaN), null)
  assert.equal(textOffsetToHtml({ paragraphs: [] }, 0), null)
})

test('an empty or non-string chapter yields an empty index', () => {
  for (const input of ['', null, undefined, 42, {}]) {
    const index = buildChapterIndex(input)
    assert.deepEqual(index.paragraphs, [])
    assert.equal(index.text, '')
    assert.deepEqual(index, { paragraphs: [], text: '' })
    assert.deepEqual(htmlRangeToParagraphSpans(index, { start: 0, end: 10 }), [])
  }
})

test('the paragraph list is exactly htmlToParagraphs on synthetic chapters', () => {
  const chunks = ['&#x4e2d;', '文', '\r\n', '<p>', '一', '<img src="a"/>', '二', '</p>\n', '\u3000', '<br>', '三']
  for (let size = 1; size <= chunks.length; size += 1) {
    const html = chunks.slice(0, size).join('')
    const index = buildChapterIndex(html)
    assert.deepEqual(
      index.paragraphs.map((paragraph) => paragraph.text),
      htmlToParagraphs(html),
    )
  }
  // And the index is a plain, serializable object.
  const index = buildChapterIndex(MIXED)
  assert.deepEqual(Object.keys(index), ['paragraphs', 'text'])
  assert.deepEqual(JSON.parse(JSON.stringify(index)), {
    paragraphs: index.paragraphs.map((paragraph) => ({
      text: paragraph.text,
      start: paragraph.start,
      end: paragraph.end,
    })),
    text: index.text,
  })
})

test('character references decode exactly as htmlToParagraphs decodes them', () => {
  // The awkward ones: a reference split by a tag (htmlToParagraphs decodes after
  // stripping tags, so it still resolves), a reference that only appears after an
  // earlier pass ("&#38;" becomes "&", and only then can it look like "&lt;"),
  // and text that merely looks like a reference without being one.
  const cases = [
    ['<p>&#x4e<b></b>2d;&#25991;</p>', ['中文']],
    ['<p>&#38;lt;tag&#38;gt;</p>', ['<tag>']],
    ['<p>&amp;#x4e2d;</p>', ['&#x4e2d;']],
    ['<p>a & b &amp; c</p>', ['a & b & c']],
    ['<p>&#xzz; &unknown; &#;</p>', ['&#xzz; &unknown; &#;']],
    ['<p>&#x20000;x</p>', ['\u{20000}x']],
    ['<P>A</P><BR>B', ['A', 'B']],
  ]
  for (const [html, expected] of cases) {
    assert.deepEqual(htmlToParagraphs(html), expected)
    assert.deepEqual(
      buildChapterIndex(html).paragraphs.map((paragraph) => paragraph.text),
      expected,
      html,
    )
  }

  // One decoded character can cover a long html span, tags included, so a
  // selection is still paintable: here "中" is "&#x4e" + "<b></b>" + "2d;".
  const split = buildChapterIndex('<p>x&#x4e<b></b>2d;y</p>')
  assert.equal(split.paragraphs[0].text, 'x中y')
  assert.deepEqual(selectionRange(split, 0, 1, 2), { start: 4, end: 19, markText: '中' })
})

test('paragraph text agrees with htmlToParagraphs on generated chapters', () => {
  const parts = [
    '甲', '乙', ' ', '\u3000', '\n', '\r\n', '<p>', '</p>', '<br>', '<br/>',
    '<b>', '</b>', '<div>', '</div>', '<h2>', '</h2>', '<li>', '</li>', '<td>', '</td>',
    '&nbsp;', '&amp;', '&lt;', '&quot;', '&#x4e2d;', '&#25991;', '&#38;', '&apos;',
    '<img class="qqreader-footnote" src="x"/>', '<script>var a=1</script>', '<style>.a{}</style>',
  ]
  // A fixed linear-congruential seed keeps the corpus reproducible and keeps
  // Math.random (and so flaky failures) out of the suite.
  let seed = 20261111
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let round = 0; round < 400; round += 1) {
    let html = ''
    const count = 1 + Math.floor(next() * 12)
    for (let k = 0; k < count; k += 1) html += parts[Math.floor(next() * parts.length)]
    assert.deepEqual(
      buildChapterIndex(html).paragraphs.map((paragraph) => paragraph.text),
      htmlToParagraphs(html),
      html,
    )
  }
})
