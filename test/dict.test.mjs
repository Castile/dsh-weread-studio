/**
 * Tests for the dictionary cascade behind the reader's word popover.
 *
 * Nothing here reaches the network: every request goes through an injected
 * `fetchText`, and each fixture is the real response shape captured from the
 * origin (weread's `type: 1` Chinese body, youdao's `#text` link nodes,
 * zdic's `jbjs-item` list, dictionaryapi's `phonetics`/`meanings` array).
 *
 * @module dsh-weread/test/dict
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CACHE_MAX_ENTRIES,
  clearDictCache,
  detectWordKind,
  lookupWord,
  normalizeLookupWord,
  parseDictionaryApi,
  parseWereadDict,
  parseYoudao,
  parseZdicHtml,
} from '../lib/dict.js'

/** A logger shaped like the host's, quiet enough for the test output. */
const SILENT_LOGGER = { info() {}, warn() {}, debug() {}, error() {} }

/** The weread Chinese body for 馈, verbatim from the live endpoint. */
const WEREAD_CJK = JSON.stringify({
  baike: '',
  baikeUrl: '',
  status: 1,
  source: 0,
  type: 1,
  message: {
    word_name: '馈',
    result: [{ spell: 'kuì', means: [{ mean: '（动）馈赠：～送｜～以鲜果。' }] }],
  },
})

/** The weread English body for hello, including the encyclopedia blurb. */
const WEREAD_EN = JSON.stringify({
  baike: '《Hello》是一首由Adele Adkins演唱的歌曲。',
  baikeUrl: 'https://baike.sogou.com/v147872965.htm',
  status: 1,
  source: 0,
  type: 4,
  message: {
    word_name: 'hello',
    spell_en: "hə'ləʊ",
    spell_am: 'hɛˈlo, hə-',
    result: [
      { part: 'g', mean: '哈喽，喂;你好，您好;表示问候;打招呼' },
      { part: 'n', mean: '“喂”的招呼声或问候声' },
    ],
  },
})

/** The weread "no entry" body: HTTP 200 with status -1. */
const WEREAD_MISS = JSON.stringify({ status: -1, type: 4, message: { word_name: '不认识', result: [{ mean: '' }] } })

/** A youdao Chinese body: pinyin in `simple`, gloss in `ce` as `#text` nodes. */
const YOUDAO_CJK = JSON.stringify({
  input: '馈',
  ce: {
    word: [
      {
        trs: [
          {
            tr: [
              {
                l: {
                  i: [
                    '',
                    { '#text': 'make', '@action': 'link' },
                    ' ',
                    { '#text': 'a', '@action': 'link' },
                    ' ',
                    { '#text': 'present', '@action': 'link' },
                    ' ',
                    { '#text': 'of', '@action': 'link' },
                  ],
                  '#tran': '赠送：指将礼物送给某人，作为一种表示或礼节。',
                },
              },
            ],
          },
        ],
        phone: 'kuì',
      },
    ],
  },
  simple: { query: '馈', word: [{ phone: 'kuì', 'return-phrase': '馈' }] },
  meta: { input: '馈', dicts: ['ce', 'meta', 'simple'] },
})

/** A youdao English body: IPA plus exam tags plus ordinary string `i` values. */
const YOUDAO_EN = JSON.stringify({
  input: 'hello',
  simple: { word: [{ usphone: 'həˈloʊ', ukphone: 'həˈləʊ', 'return-phrase': 'hello' }] },
  ec: {
    exam_type: ['初中', '高中', 'CET4', 'CET6', '考研'],
    word: [
      {
        usphone: 'həˈloʊ',
        ukphone: 'həˈləʊ',
        trs: [
          { tr: [{ l: { i: ['int. 喂，你好（用于问候或打招呼）。'] } }] },
          { tr: [{ l: { i: ['n. 招呼，问候。'] } }] },
        ],
      },
    ],
  },
})

/** A zdic page slice: the basic-explanation list with one example. */
const ZDIC_HTML = `<!doctype html><html><head>
<meta name="description" content="馈（kuì）：进献，进食于人：“凡王之～，食用六谷”。">
</head><body>
<section class="dict-section" id="jbjs" data-section="基本解释">
<div class="jbjs-reading"><header class="jbjs-reading__head">
<span class="jbjs-reading__char"><span class="sym">●</span>馈</span><span class="jbjs-reading__py">kuì</span>
</header></div>
<ol class="jbjs-list">
<li class="jbjs-item"><span class="jbjs-item__def">进献，进食于人。</span><span class="jbjs-item__eg-label">例如</span><span class="jbjs-item__eg">“凡王之～，食用六谷”。</span></li>
<li class="jbjs-item"><span class="jbjs-item__def">泛指赠送。</span><span class="jbjs-item__eg">～赠。～送。</span></li>
</ol></section></body></html>`

/** A zdic page whose list is lazy-loaded, leaving only the meta description. */
const ZDIC_META_ONLY = `<html><head><meta content="馈（kuì）：进献，进食于人。" name="description"></head><body></body></html>`

/** A dictionaryapi.dev English response for hello. */
const DICTIONARY_API = JSON.stringify([
  {
    word: 'hello',
    phonetics: [
      { audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/hello-au.mp3' },
      { text: '/həˈləʊ/' },
      { text: '/həˈloʊ/' },
    ],
    meanings: [
      { partOfSpeech: 'noun', definitions: [{ definition: '"Hello!" or an equivalent greeting.' }] },
      { partOfSpeech: 'interjection', definitions: [{ definition: 'A greeting (salutation) said when meeting someone.' }] },
    ],
  },
])

/**
 * Build an injected transport from a URL-substring table.
 * @param routes - `[{ match, status?, text? }]`, first match wins.
 * @returns the transport plus the list of URLs it saw.
 */
function fakeFetch(routes) {
  const calls = []
  const fetchText = async (url) => {
    calls.push(url)
    const route = routes.find((candidate) => url.includes(candidate.match))
    if (route === undefined) return { ok: false, status: 404, text: '' }
    if (route.reject === true) throw new Error(`blocked: ${route.match}`)
    return { ok: (route.status ?? 200) < 400, status: route.status ?? 200, text: route.text ?? '' }
  }
  return { fetchText, calls }
}

/** Every lookup in this file starts from a cold cache. */
test.beforeEach(() => {
  clearDictCache()
})

test('normalizeLookupWord trims, strips wrapping punctuation and drops unusable input', () => {
  assert.equal(normalizeLookupWord('  馈  '), '馈')
  assert.equal(normalizeLookupWord('“馈赠”'), '馈赠')
  assert.equal(normalizeLookupWord('（ hello ）'), 'hello')
  assert.equal(normalizeLookupWord('hello,'), 'hello')
  assert.equal(normalizeLookupWord('word\n'), 'word')
  // A selection across a line break inside CJK text is still one word.
  assert.equal(normalizeLookupWord('馈\n赠'), '馈赠')
  assert.equal(normalizeLookupWord('hello   world'), 'hello world')
  // Apostrophes and hyphens inside a word are meaningful and survive.
  assert.equal(normalizeLookupWord("don't"), "don't")
  assert.equal(normalizeLookupWord('well-known'), 'well-known')

  assert.equal(normalizeLookupWord(''), '')
  assert.equal(normalizeLookupWord('   '), '')
  assert.equal(normalizeLookupWord('\n\t'), '')
  assert.equal(normalizeLookupWord('…—…'), '')
  assert.equal(normalizeLookupWord(undefined), '')
  assert.equal(normalizeLookupWord(null), '')
  assert.equal(normalizeLookupWord(42), '')
  assert.equal(normalizeLookupWord('a'.repeat(65)), '')
  assert.equal(normalizeLookupWord('a'.repeat(64)), 'a'.repeat(64))
})

test('detectWordKind separates Han, Latin, and everything else', () => {
  assert.equal(detectWordKind('馈'), 'cjk')
  assert.equal(detectWordKind('馈赠'), 'cjk')
  assert.equal(detectWordKind('hello'), 'en')
  assert.equal(detectWordKind("don't"), 'en')
  assert.equal(detectWordKind('hello 馈'), 'unknown')
  assert.equal(detectWordKind('123'), 'unknown')
  assert.equal(detectWordKind(''), 'unknown')
})

test('parseWereadDict reads the Chinese shape', () => {
  const entry = parseWereadDict(WEREAD_CJK, '馈')
  assert.equal(entry.word, '馈')
  assert.equal(entry.kind, 'cjk')
  assert.equal(entry.phonetic, 'kuì')
  assert.equal(entry.source, 'weread')
  assert.deepEqual(entry.readings, [{ phonetic: 'kuì', definitions: ['（动）馈赠：～送｜～以鲜果。'] }])
  assert.deepEqual(entry.definitions, ['（动）馈赠：～送｜～以鲜果。'])
})

test('parseWereadDict reads the English shape and prefers spell_en', () => {
  const entry = parseWereadDict(WEREAD_EN, 'hello')
  assert.equal(entry.kind, 'en')
  assert.equal(entry.phonetic, "/hə'ləʊ/")
  assert.equal(entry.source, 'weread')
  assert.deepEqual(entry.definitions, [
    'g. 哈喽，喂;你好，您好;表示问候;打招呼',
    'n. “喂”的招呼声或问候声',
  ])
})

test('parseWereadDict rejects a status -1 body and non-JSON input', () => {
  assert.equal(parseWereadDict(WEREAD_MISS, '不认识'), undefined)
  assert.equal(parseWereadDict('<html>login</html>', '馈'), undefined)
  assert.equal(parseWereadDict({ status: 1 }, '馈'), undefined)
  assert.equal(parseWereadDict(null, '馈'), undefined)
})

test('parseYoudao flattens #text nodes and lifts the pinyin out of simple.word', () => {
  const entry = parseYoudao(YOUDAO_CJK, '馈')
  assert.equal(entry.source, 'youdao')
  assert.equal(entry.phonetic, 'kuì')
  assert.equal(entry.word, '馈')
  assert.deepEqual(entry.definitions, ['make a present of', '赠送：指将礼物送给某人，作为一种表示或礼节。'])
})

test('parseYoudao returns IPA for English and keeps exam tags on raw', () => {
  const entry = parseYoudao(YOUDAO_EN, 'hello')
  assert.equal(entry.kind, 'en')
  assert.equal(entry.phonetic, '/həˈloʊ/')
  assert.deepEqual(entry.definitions, ['int. 喂，你好（用于问候或打招呼）。', 'n. 招呼，问候。'])
  assert.deepEqual(entry.raw.examType, ['初中', '高中', 'CET4', 'CET6', '考研'])
})

test('parseYoudao gives up on a body with no definitions', () => {
  assert.equal(parseYoudao({ input: 'x', meta: {} }, 'x'), undefined)
  assert.equal(parseYoudao('not json', 'x'), undefined)
})

test('parseZdicHtml reads the basic-explanation list and its examples', () => {
  const entry = parseZdicHtml(ZDIC_HTML, '馈')
  assert.equal(entry.kind, 'cjk')
  assert.equal(entry.phonetic, 'kuì')
  assert.equal(entry.source, 'zdic')
  assert.deepEqual(entry.definitions, [
    '进献，进食于人。（例：“凡王之～，食用六谷”。）',
    '泛指赠送。（例：～赠。～送。）',
  ])
  assert.equal(entry.raw, undefined)
})

test('parseZdicHtml falls back to the meta description when the list is absent', () => {
  const entry = parseZdicHtml(ZDIC_META_ONLY, '馈')
  assert.equal(entry.phonetic, 'kuì')
  assert.deepEqual(entry.definitions, ['进献，进食于人。'])
  assert.equal(parseZdicHtml('<html><body>访问验证</body></html>', '馈'), undefined)
  assert.equal(parseZdicHtml('', '馈'), undefined)
})

test('parseDictionaryApi reads IPA and parts of speech', () => {
  const entry = parseDictionaryApi(DICTIONARY_API, 'hello')
  assert.equal(entry.kind, 'en')
  assert.equal(entry.source, 'dictionaryapi')
  assert.equal(entry.word, 'hello')
  assert.equal(entry.phonetic, '/həˈləʊ/')
  assert.deepEqual(entry.definitions, [
    'noun. "Hello!" or an equivalent greeting.',
    'interjection. A greeting (salutation) said when meeting someone.',
  ])
  assert.equal(parseDictionaryApi([], 'hello'), undefined)
})

test('lookupWord returns the weread entry first and never asks another source', async () => {
  const { fetchText, calls } = fakeFetch([{ match: '/web/dict/query', text: WEREAD_CJK }])
  const entry = await lookupWord('馈', { cookie: 'wr_vid=1; wr_skey=2', fetchText, logger: SILENT_LOGGER })

  assert.equal(entry.source, 'weread')
  assert.equal(entry.phonetic, 'kuì')
  assert.equal(calls.length, 1)
  assert.match(calls[0], /^https:\/\/weread\.qq\.com\/web\/dict\/query\?word=%E9%A6%88$/)
})

test('lookupWord falls through weread to youdao when weread fails', async () => {
  const { fetchText, calls } = fakeFetch([
    { match: '/web/dict/query', status: 500, text: '' },
    { match: 'dict.youdao.com', text: YOUDAO_CJK },
  ])
  const entry = await lookupWord('馈', { cookie: 'wr_vid=1; wr_skey=2', fetchText })

  assert.equal(entry.source, 'youdao')
  assert.equal(entry.phonetic, 'kuì')
  assert.equal(calls.length, 2)
})

test('lookupWord treats a weread status -1 body as a miss, not a result', async () => {
  const { fetchText } = fakeFetch([
    { match: '/web/dict/query', text: WEREAD_MISS },
    { match: 'dict.youdao.com', text: YOUDAO_CJK },
  ])
  const entry = await lookupWord('馈', { cookie: 'wr_vid=1; wr_skey=2', fetchText })
  assert.equal(entry.source, 'youdao')
})

test('lookupWord skips weread entirely when no cookie is configured', async () => {
  const { fetchText, calls } = fakeFetch([{ match: 'dict.youdao.com', text: YOUDAO_CJK }])
  const entry = await lookupWord('馈', { fetchText })

  assert.equal(entry.source, 'youdao')
  assert.equal(calls.length, 1)
  assert.ok(!calls[0].includes('weread.qq.com'))
})

test('lookupWord sends the cookie only to weread', async () => {
  const seen = []
  const fetchText = async (url, init) => {
    seen.push({ url, headers: init.headers })
    return { ok: false, status: 503, text: '' }
  }
  await lookupWord('馈', { cookie: 'wr_vid=1; wr_skey=2', fetchText })

  const wereadCall = seen.find((call) => call.url.includes('weread.qq.com'))
  assert.equal(wereadCall.headers.cookie, 'wr_vid=1; wr_skey=2')
  for (const call of seen.filter((entry) => !entry.url.includes('weread.qq.com'))) {
    assert.equal(call.headers.cookie, undefined)
  }
})

test('lookupWord keeps going when a source throws', async () => {
  const { fetchText } = fakeFetch([
    { match: '/web/dict/query', reject: true },
    { match: 'dict.youdao.com', text: YOUDAO_CJK },
  ])
  const entry = await lookupWord('馈', { cookie: 'wr_vid=1; wr_skey=2', fetchText })
  assert.equal(entry.source, 'youdao')
})

test('lookupWord uses zdic for a character the first two sources do not have', async () => {
  const { fetchText, calls } = fakeFetch([
    { match: '/web/dict/query', text: WEREAD_MISS },
    { match: 'dict.youdao.com', text: '{"input":"馈","meta":{}}' },
    { match: 'zdic.net/hans/', text: ZDIC_HTML },
  ])
  const entry = await lookupWord('馈', { cookie: 'wr_vid=1; wr_skey=2', fetchText })

  assert.equal(entry.source, 'zdic')
  assert.equal(entry.phonetic, 'kuì')
  assert.equal(calls.length, 3)
})

test('lookupWord uses dictionaryapi for English and never calls zdic', async () => {
  const { fetchText, calls } = fakeFetch([
    { match: '/web/dict/query', text: WEREAD_MISS },
    { match: 'dict.youdao.com', text: '{"input":"hello","meta":{}}' },
    { match: 'api.dictionaryapi.dev', text: DICTIONARY_API },
  ])
  const entry = await lookupWord('hello', { cookie: 'wr_vid=1; wr_skey=2', fetchText })

  assert.equal(entry.source, 'dictionaryapi')
  assert.equal(entry.phonetic, '/həˈləʊ/')
  assert.equal(entry.kind, 'en')
  assert.ok(!calls.some((url) => url.includes('zdic.net')))
})

test('lookupWord returns source none instead of throwing when everything fails', async () => {
  const { fetchText, calls } = fakeFetch([{ match: '.', status: 500, text: '' }])
  const entry = await lookupWord('馈', { cookie: 'wr_vid=1; wr_skey=2', fetchText })

  assert.deepEqual(entry, { word: '馈', kind: 'cjk', phonetic: '', readings: [], definitions: [], source: 'none' })
  assert.equal(calls.length, 3)
})

test('lookupWord returns source none for empty or unusable input without a request', async () => {
  const { fetchText, calls } = fakeFetch([{ match: '.', text: WEREAD_CJK }])
  for (const raw of ['', '   ', '……', 'a'.repeat(65), undefined]) {
    const entry = await lookupWord(raw, { fetchText })
    assert.equal(entry.source, 'none')
    assert.deepEqual(entry.definitions, [])
  }
  assert.equal(calls.length, 0)
})

test('lookupWord honours options.sources order', async () => {
  const { fetchText, calls } = fakeFetch([
    { match: 'dict.youdao.com', text: YOUDAO_CJK },
    { match: '/web/dict/query', text: WEREAD_CJK },
  ])
  const entry = await lookupWord('馈', { cookie: 'wr_vid=1; wr_skey=2', fetchText, sources: ['youdao', 'weread'] })

  assert.equal(entry.source, 'youdao')
  assert.equal(calls.length, 1)
  assert.match(calls[0], /youdao/)
})

test('lookupWord caches a hit so a second selection makes no request', async () => {
  const { fetchText, calls } = fakeFetch([{ match: '/web/dict/query', text: WEREAD_CJK }])
  const first = await lookupWord('馈', { cookie: 'wr_vid=1; wr_skey=2', fetchText })
  const second = await lookupWord('馈', { cookie: 'wr_vid=1; wr_skey=2', fetchText })

  assert.equal(calls.length, 1)
  assert.equal(second, first)
  assert.equal(second.phonetic, 'kuì')
})

test('lookupWord does not cache a miss, so a retry asks again', async () => {
  const { fetchText, calls } = fakeFetch([{ match: '.', status: 500, text: '' }])
  const miss = await lookupWord('馈', { cookie: 'wr_vid=1; wr_skey=2', fetchText })
  assert.equal(miss.source, 'none')
  const afterFirst = calls.length
  assert.ok(afterFirst > 0)

  await lookupWord('馈', { cookie: 'wr_vid=1; wr_skey=2', fetchText })
  assert.equal(calls.length, afterFirst * 2)
})

test('clearDictCache makes the next selection hit the network again', async () => {
  clearDictCache()
  const { fetchText: hitFetch, calls: hitCalls } = fakeFetch([{ match: '/web/dict/query', text: WEREAD_CJK }])
  await lookupWord('馈', { cookie: 'wr_vid=1; wr_skey=2', fetchText: hitFetch })
  await lookupWord('馈', { cookie: 'wr_vid=1; wr_skey=2', fetchText: hitFetch })
  assert.equal(hitCalls.length, 1)
})

test('the cache evicts the oldest entry once it is full', async () => {
  assert.equal(CACHE_MAX_ENTRIES, 200)

  // Every word resolves, so every word is cached; `calls` counts requests.
  let next = 0
  const fetchText = async () => {
    calls.push(1)
    const word = String.fromCodePoint(0x4e00 + next)
    next += 1
    return {
      ok: true,
      status: 200,
      text: JSON.stringify({ status: 1, type: 1, message: { word_name: word, result: [{ spell: 'x', means: [{ mean: '释义' }] }] } }),
    }
  }
  const calls = []

  for (let index = 0; index < CACHE_MAX_ENTRIES; index += 1) {
    const entry = await lookupWord(String.fromCodePoint(0x4e00 + index), { cookie: 'c=1', fetchText, sources: ['weread'] })
    assert.equal(entry.source, 'weread')
  }
  assert.equal(calls.length, CACHE_MAX_ENTRIES)

  // One more distinct word pushes the first one out of the cache.
  await lookupWord(String.fromCodePoint(0x4e00 + CACHE_MAX_ENTRIES), { cookie: 'c=1', fetchText, sources: ['weread'] })
  assert.equal(calls.length, CACHE_MAX_ENTRIES + 1)

  await lookupWord(String.fromCodePoint(0x4e00), { cookie: 'c=1', fetchText, sources: ['weread'] })
  assert.equal(calls.length, CACHE_MAX_ENTRIES + 2)

  // The newest entry is still cached.
  await lookupWord(String.fromCodePoint(0x4e00 + CACHE_MAX_ENTRIES), { cookie: 'c=1', fetchText, sources: ['weread'] })
  assert.equal(calls.length, CACHE_MAX_ENTRIES + 2)
})
