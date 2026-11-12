/**
 * Tests for the reader's interaction layer.
 *
 * The browser bundle only registers itself with the host loader; every helper
 * this file exercises is pure, so the bundle is loaded once with a stubbed
 * loader and a stubbed react, and the exported views are called directly.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

/* -------------------------------------------------------------------------- */
/* bundle loader                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Load client.js outside a browser.
 *
 * The file is not a module: it calls window.__ModuleLoader__.load and takes
 * react from the page's module table. Both are supplied here, and the factory
 * is invoked so __views becomes reachable.
 */
function loadViews() {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const registered = []
  const window = {
    __ModuleLoader__: {
      load: (definition) => {
        registered.push(definition)
      },
    },
  }
  // A minimal createElement: enough for paragraphChildren's output to be
  // inspected (type, props, children) without pulling in a renderer.
  const require = (id) => {
    assert.equal(id, 'react', 'the bundle may only require react')
    return {
      createElement: (type, props, ...children) => ({
        type,
        props: Object.assign({}, props, { children: children.length <= 1 ? children[0] : children }),
      }),
    }
  }
  // eslint-disable-next-line no-new-func
  const run = new Function('window', 'module', 'require', source)
  const module = { exports: {} }
  run(window, module, require)
  assert.equal(registered.length, 1, 'the bundle must register exactly once')
  assert.equal(registered[0].id, 'dsh-weread-studio')
  const exported = registered[0].factory(require)
  assert.deepEqual(exported.inject, ['slots'])
  assert.equal(typeof exported.apply, 'function')
  return exported.__views
}

const views = loadViews()

/* -------------------------------------------------------------------------- */
/* buildSelectionTarget                                                       */
/* -------------------------------------------------------------------------- */

test('a same-paragraph selection in a cloud book can be marked', () => {
  const target = views.buildSelectionTarget({
    text: '  天地玄黄  ',
    paragraphIndex: 3,
    startOffset: 10,
    endOffset: 14,
    local: false,
    cookieReady: true,
  })
  assert.equal(target.text, '天地玄黄')
  assert.equal(target.canHighlight, true)
  assert.equal(target.highlightTitle, '')
  assert.equal(target.sameParagraph, true)
  assert.equal(target.paragraphIndex, 3)
  assert.equal(target.startOffset, 10)
  assert.equal(target.endOffset, 14)
  assert.equal(target.empty, false)
})

test('a local book reports why marking is unavailable', () => {
  const target = views.buildSelectionTarget({
    text: '本地书的一段',
    paragraphIndex: 0,
    startOffset: 0,
    endOffset: 5,
    local: true,
    cookieReady: true,
  })
  assert.equal(target.canHighlight, false)
  assert.equal(target.highlightTitle, '本地书不支持云端划线')
})

test('a cloud book without a cookie reports the setting to fix', () => {
  const target = views.buildSelectionTarget({
    text: '没有 Cookie',
    paragraphIndex: 0,
    startOffset: 0,
    endOffset: 4,
    local: false,
    cookieReady: false,
  })
  assert.equal(target.canHighlight, false)
  assert.equal(target.highlightTitle, '先在设置里扫码或粘贴 Cookie')
})

test('a selection spanning two paragraphs cannot be marked', () => {
  const target = views.buildSelectionTarget({
    text: '第一段尾巴第二段开头',
    paragraphIndex: -1,
    startOffset: -1,
    endOffset: -1,
    local: false,
    cookieReady: true,
  })
  assert.equal(target.canHighlight, false)
  assert.equal(target.highlightTitle, '请在同一段落内选择文字')
  assert.equal(target.sameParagraph, false)
  assert.equal(target.startOffset, -1)
  assert.equal(target.endOffset, -1)
})

test('a reversed or empty range is not a paragraph range', () => {
  const reversed = views.buildSelectionTarget({
    text: '倒着选',
    paragraphIndex: 0,
    startOffset: 6,
    endOffset: 2,
    cookieReady: true,
  })
  assert.equal(reversed.sameParagraph, false)
  const collapsed = views.buildSelectionTarget({
    text: '   ',
    paragraphIndex: 0,
    startOffset: 2,
    endOffset: 2,
    cookieReady: true,
  })
  assert.equal(collapsed.canHighlight, false)
  assert.equal(collapsed.empty, true)
})

test('only a short single token becomes a dictionary word', () => {
  const word = views.buildSelectionTarget({ text: ' 縹緲 ', cookieReady: true })
  assert.equal(word.word, '縹緲')
  const phrase = views.buildSelectionTarget({ text: '天地 玄黄', cookieReady: true })
  assert.equal(phrase.word, '')
  const long = views.buildSelectionTarget({ text: '一二三四五六七八九', cookieReady: true })
  assert.equal(long.word, '')
  assert.equal(long.tooLong, false)
})

test('a very long selection is flagged instead of being handed to a menu', () => {
  const target = views.buildSelectionTarget({ text: '字'.repeat(views.SELECTION_MAX_LENGTH + 1), cookieReady: true })
  assert.equal(target.tooLong, true)
})

test('missing input describes an empty selection rather than throwing', () => {
  for (const input of [undefined, null, {}]) {
    const target = views.buildSelectionTarget(input)
    assert.equal(target.empty, true)
    assert.equal(target.canHighlight, false)
    assert.equal(target.word, '')
  }
})

/* -------------------------------------------------------------------------- */
/* clipAiText / buildAiPrompt                                                 */
/* -------------------------------------------------------------------------- */

test('clipAiText trims and leaves short text untouched', () => {
  assert.equal(views.clipAiText('  原文  '), '原文')
  assert.equal(views.clipAiText(undefined), '')
  assert.equal(views.clipAiText(null), '')
})

test('clipAiText truncates at the limit and says so', () => {
  const clipped = views.clipAiText('字'.repeat(views.AI_TEXT_LIMIT + 50))
  assert.equal(clipped.startsWith('字'.repeat(10)), true)
  assert.equal(clipped.endsWith('…（已截断）'), true)
  assert.equal(clipped.length, views.AI_TEXT_LIMIT + '…（已截断）'.length)
})

test('an explain prompt quotes the passage line by line with its source', () => {
  const prompt = views.buildAiPrompt('explain', { text: '第一行\n第二行', bookTitle: '论语' })
  assert.equal(prompt.startsWith('请解释这段文字：\n\n'), true)
  assert.equal(prompt.includes('> 第一行\n> 第二行'), true)
  assert.equal(prompt.includes('（来自《论语》）'), true)
  assert.equal(prompt.endsWith('最后说明它在全书论述中的作用。'), true)
})

test('a chat prompt skips the analysis brief', () => {
  const prompt = views.buildAiPrompt('chat', { text: '一句原文' })
  assert.equal(prompt.startsWith('我想聊聊这段文字：'), true)
  assert.equal(prompt.includes('> 一句原文'), true)
  assert.equal(prompt.includes('（来自微信读书）'), true)
  assert.equal(prompt.includes('要求：'), false)
})

/* -------------------------------------------------------------------------- */
/* dictLines                                                                  */
/* -------------------------------------------------------------------------- */

test('dictLines merges readings and top-level definitions without duplicates', () => {
  const view = views.dictLines({
    word: '縹緲',
    phonetic: 'piāo miǎo',
    readings: [
      { phonetic: 'piāo miǎo', definitions: ['隐隐约约，若有若无。', '高远隐约貌。'] },
      { definitions: ['高远隐约貌。'] },
    ],
    definitions: ['隐隐约约，若有若无。', '另有一说。'],
    source: 'weread',
  })
  assert.equal(view.word, '縹緲')
  assert.equal(view.phonetic, 'piāo miǎo')
  assert.deepEqual(view.lines, ['隐隐约约，若有若无。', '高远隐约貌。', '另有一说。'])
  assert.equal(view.sourceLabel, '微信读书辞典')
  assert.equal(view.empty, false)
})

test('dictLines joins distinct phonetics and keeps unknown sources', () => {
  const view = views.dictLines({
    word: 'x',
    readings: [{ phonetic: 'a' }, { phonetic: 'b' }, { phonetic: 'a' }],
    definitions: [],
    source: 'mystery',
  })
  assert.equal(view.phonetic, 'a / b')
  assert.equal(view.sourceLabel, 'mystery')
  assert.equal(view.empty, true)
})

test('a lookup that found nothing is empty, not an error', () => {
  const view = views.dictLines({ word: '生僻字', source: 'none' })
  assert.equal(view.empty, true)
  assert.deepEqual(view.lines, [])
  assert.equal(view.sourceLabel, '')
  assert.deepEqual(views.dictLines(undefined).lines, [])
})

/* -------------------------------------------------------------------------- */
/* clampToolbarPosition                                                       */
/* -------------------------------------------------------------------------- */

test('the toolbar prefers to sit above the selection, centred on it', () => {
  const position = views.clampToolbarPosition({
    rect: { left: 200, top: 300, width: 100, height: 20 },
    body: { width: 720, height: 900 },
    toolbar: { width: 200, height: 40 },
  })
  assert.equal(position.left, 150)
  assert.equal(position.top, 252)
  assert.equal(position.placement, 'above')
})

test('a selection near the top flips the toolbar below it', () => {
  const position = views.clampToolbarPosition({
    rect: { left: 10, top: 5, width: 40, height: 18 },
    body: { width: 720, height: 900 },
    toolbar: { width: 200, height: 40 },
  })
  assert.equal(position.placement, 'below')
  assert.equal(position.top, 31)
  assert.equal(position.left, 0)
})

test('the toolbar is kept inside the body on the right and bottom edges', () => {
  const right = views.clampToolbarPosition({
    rect: { left: 700, top: 200, width: 20, height: 20 },
    body: { width: 720, height: 900 },
    toolbar: { width: 200, height: 40 },
  })
  assert.equal(right.left, 520)
  // Flipped below a tall selection near the top, then clamped to the bottom.
  const bottom = views.clampToolbarPosition({
    rect: { left: 10, top: 5, width: 20, height: 890 },
    body: { width: 720, height: 900 },
    toolbar: { width: 200, height: 40 },
  })
  assert.equal(bottom.placement, 'below')
  assert.equal(bottom.top, 860)
})

test('clampToolbarPosition tolerates missing pieces', () => {
  const position = views.clampToolbarPosition({})
  assert.deepEqual(position, { left: 0, top: 0, placement: 'below' })
  const tall = views.clampToolbarPosition({
    rect: { left: 0, top: 100, width: 0, height: 0 },
    body: { width: 100, height: 50 },
    toolbar: { width: 200, height: 80 },
    gap: 4,
  })
  assert.equal(tall.left, 0)
  assert.equal(tall.top, 0)
})

/* -------------------------------------------------------------------------- */
/* constants the UI depends on                                                */
/* -------------------------------------------------------------------------- */

test('the five mark colours keep their documented order', () => {
  assert.deepEqual(views.MARK_COLOR_LABELS, ['黄', '红', '蓝', '绿', '紫'])
  for (let color = 0; color < 5; color += 1) {
    assert.equal(views.normalizeMarkColor(color), color)
  }
  assert.equal(views.normalizeMarkColor(undefined), 0)
  assert.equal(views.normalizeMarkColor(9), 0)
})

test('paragraphChildren never emits HTML, only text and marks', () => {
  const nodes = views.paragraphChildren(
    '前段后段',
    [
      { start: 0, end: 1, text: '前' },
      { start: 1, end: 3, text: '段后', highlightId: 'h1', colorStyle: 2, note: '想法' },
    ],
    {},
  )
  // A plain lead-in, the mark, its note dot, then the uncovered tail.
  assert.equal(nodes.length, 4)
  assert.equal(nodes[0], '前')
  assert.equal(nodes[1].type, 'mark')
  assert.equal(nodes[1].props.className, 'wr-mark')
  assert.equal(nodes[1].props['data-color'], '2')
  assert.equal(nodes[1].props['data-hid'], 'h1')
  assert.equal(nodes[1].props.dangerouslySetInnerHTML, undefined)
  assert.equal(nodes[1].props.children, '段后')
  assert.equal(nodes[2].type, 'button')
  assert.equal(nodes[2].props.className, 'wr-noteDot')
  assert.equal(nodes[3], '段')
})
