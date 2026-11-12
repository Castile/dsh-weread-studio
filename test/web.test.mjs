/**
 * Tests for the interaction layer: writing marks back to WeRead, placing marks
 * against the decoded chapter source, and the cache invalidation that keeps the
 * panel from redrawing a stale notebook.
 *
 * Nothing here touches the network. The service is built exactly as the host
 * builds it, then its three clients (reader, web, gateway) are replaced with
 * recorders, so every assertion is about our own contract rather than about
 * weread.qq.com. The one module-level stub is `globalThis.fetch`, used only to
 * observe what lib/web.js puts on the wire.
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildChapterIndex, selectionRange } from '../lib/marks.js'
import { WereadService } from '../lib/service.js'
import { invalidate, invalidatePrefix } from '../lib/store.js'
import { WereadWebApi } from '../lib/web.js'

/** A logger shaped like the host's, quiet enough for the test output. */
const SILENT_LOGGER = { info() {}, warn() {}, debug() {}, error() {} }

/** A signed-in cookie: the reader APIs only need wr_vid and wr_skey. */
const COOKIE = 'wr_vid=123456; wr_skey=abcdef'

/** Three paragraphs, unmarked, with tags that carry no text between them. */
const CHAPTER_HTML = '<p>第一章开始</p><p>内容A内容B</p><p>内容C</p>'
const CHAPTER_PARAGRAPHS = ['第一章开始', '内容A内容B', '内容C']

/** The catalog the fake reader reports. */
const CATALOG = [
  { chapterUid: 11, chapterIdx: 1, title: '第一章开始', level: 1, wordCount: 5 },
  { chapterUid: 12, chapterIdx: 2, title: '内容C', level: 1, wordCount: 3 },
]

/** Build the service the way the host does, over a throwaway data directory. */
function makeService(dataDir) {
  return new WereadService({ ctx: { logger: SILENT_LOGGER }, config: { dataDir, syncProgress: false } })
}

/** Run a test body against a fresh temp data directory, always cleaned up. */
async function withTempDir(body) {
  const dir = await mkdtemp(join(tmpdir(), 'weread-web-'))
  try {
    return await body(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * A service whose reader/web/gateway are recorders.
 *
 * @returns the service plus the recorders, so tests can assert on both the
 * result and the calls that produced it.
 */
function fakeService(service) {
  const reader = {
    calls: { fetchChapter: 0, webCatalog: 0 },
    session: true,
    hasSession() {
      return this.session
    },
    async webCatalog() {
      this.calls.webCatalog += 1
      return CATALOG
    },
    async fetchChapter({ chapterUid, title }) {
      this.calls.fetchChapter += 1
      return {
        bookId: 'bk-1',
        chapterUid,
        title: title ?? '第一章开始',
        format: 'epub',
        html: CHAPTER_HTML,
        paragraphs: CHAPTER_PARAGRAPHS,
        readerState: {},
      }
    },
  }
  const web = {
    calls: [],
    session: true,
    hasSession() {
      return this.session
    },
    async bookInfo(bookId) {
      this.calls.push(['bookInfo', bookId])
      return { bookId, version: 77 }
    },
    async addBookmark(input) {
      this.calls.push(['addBookmark', input])
      return { bookmarkId: 'bm-new' }
    },
    async updateBookmark(input) {
      this.calls.push(['updateBookmark', input])
      return { succ: 1 }
    },
    async removeBookmark(input) {
      this.calls.push(['removeBookmark', input])
      return { succ: 1 }
    },
  }
  const gateway = {
    calls: 0,
    async bookmarks() {
      this.calls += 1
      return { updated: [], chapters: [] }
    },
    async myReviews() {
      return { reviews: [] }
    },
  }

  service.reader = reader
  service.web = web
  service.gateway = gateway
  return { service, reader, web, gateway }
}

/** A notebook with marks on the chapter under test. */
function bookmarkNotebook(updated) {
  return {
    updated,
    chapters: [
      { chapterUid: 11, title: '第一章开始' },
      { chapterUid: 12, title: '内容C' },
    ],
  }
}

/** Replace globalThis.fetch for one test body. */
async function withFetch(handler, body) {
  const original = globalThis.fetch
  const seen = []
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), init })
    return handler(String(url), init)
  }
  try {
    return await body(seen)
  } finally {
    globalThis.fetch = original
  }
}

/** A response shaped like the ones lib/web.js consumes. */
function jsonResponse(payload, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { getSetCookie: () => [] },
    async json() {
      return payload
    },
    async text() {
      return JSON.stringify(payload)
    },
  }
}

test('chapter keeps the decoded source so marks can be placed later', async () => {
  await withTempDir(async (dataDir) => {
    const service = makeService(dataDir)
    await service.ready
    const { reader } = fakeService(service)

    const chapter = await service.chapter('bk-1', 11)
    assert.equal(chapter.html, CHAPTER_HTML)
    assert.deepEqual(chapter.paragraphs, CHAPTER_PARAGRAPHS)
    assert.equal(reader.calls.fetchChapter, 1)

    // Cached, html included: a second read costs no fetch.
    const again = await service.chapter('bk-1', 11)
    assert.equal(again.html, CHAPTER_HTML)
    assert.equal(reader.calls.fetchChapter, 1)
  })
})

test('a chapter cached before html existed is refetched once', async () => {
  await withTempDir(async (dataDir) => {
    const service = makeService(dataDir)
    await service.ready
    const { reader } = fakeService(service)

    // Exactly what the old version of chapter() wrote: no html field.
    await service.store.writeCache('chapter/bk-1/11', {
      chapterUid: 11,
      title: '第一章开始',
      format: 'epub',
      paragraphs: CHAPTER_PARAGRAPHS,
      fetchedAt: Date.now(),
    })

    const chapter = await service.chapter('bk-1', 11)
    assert.equal(reader.calls.fetchChapter, 1)
    assert.equal(chapter.html, CHAPTER_HTML)
    assert.deepEqual(chapter.paragraphs, CHAPTER_PARAGRAPHS)
  })
})

test('chapterMarks places ranges against the html index, not the joined text', async () => {
  await withTempDir(async (dataDir) => {
    const service = makeService(dataDir)
    await service.ready
    const { service: wired } = fakeService(service)

    // 15-22 is the whole second paragraph in CHAPTER_HTML.
    wired.gateway = {
      async bookmarks() {
        return bookmarkNotebook([
          { markText: '内容A内容B', range: '15-21', chapterUid: 11, bookmarkId: 'bm-1', colorStyle: 2 },
        ])
      },
      async myReviews() {
        return { reviews: [] }
      },
    }

    const marks = await wired.chapterMarks({ bookId: 'bk-1', chapterUid: 11 })
    assert.equal(marks.configured, true)
    assert.equal(marks.highlightCount, 1)
    assert.deepEqual(marks.unmatched, [])
    assert.equal(typeof marks.syncedAt, 'number')
    assert.equal(marks.spans.length, CHAPTER_PARAGRAPHS.length)

    assert.deepEqual(marks.spans[1], [
      { start: 0, end: 6, text: '内容A内容B', highlightId: 'bm-1', colorStyle: 2 },
    ])
    // Untouched paragraphs stay a single plain span.
    assert.deepEqual(marks.spans[0], [{ start: 0, end: 5, text: '第一章开始' }])
    assert.deepEqual(marks.spans[2], [{ start: 0, end: 3, text: '内容C' }])
  })
})

test('a range crossing paragraphs is split, keeping paragraph-local offsets', async () => {
  await withTempDir(async (dataDir) => {
    const service = makeService(dataDir)
    await service.ready
    const { service: wired } = fakeService(service)

    wired.gateway = {
      // From the last character of paragraph 1 through '内容A' of paragraph 2.
      async bookmarks() {
        return bookmarkNotebook([
          { markText: '始内容A', range: '7-18', chapterUid: 11, bookmarkId: 'bm-1', colorStyle: 0 },
        ])
      },
      async myReviews() {
        return { reviews: [] }
      },
    }

    const marks = await wired.chapterMarks({ bookId: 'bk-1', chapterUid: 11 })
    assert.deepEqual(marks.unmatched, [])
    assert.deepEqual(marks.spans[0], [
      { start: 0, end: 4, text: '第一章开' },
      { start: 4, end: 5, text: '始', highlightId: 'bm-1', colorStyle: 0 },
    ])
    assert.deepEqual(marks.spans[1], [
      { start: 0, end: 3, text: '内容A', highlightId: 'bm-1', colorStyle: 0 },
      { start: 3, end: 6, text: '内容B' },
    ])
    assert.deepEqual(marks.spans[2], [{ start: 0, end: 3, text: '内容C' }])
  })
})

test('overlapping marks keep the first claim and truncate the second', async () => {
  await withTempDir(async (dataDir) => {
    const service = makeService(dataDir)
    await service.ready
    const { service: wired } = fakeService(service)

    wired.gateway = {
      async bookmarks() {
        return bookmarkNotebook([
          { markText: '内容A内', range: '15-19', chapterUid: 11, bookmarkId: 'bm-1', colorStyle: 1 },
          { markText: 'A内容B', range: '17-21', chapterUid: 11, bookmarkId: 'bm-2', colorStyle: 3 },
        ])
      },
      async myReviews() {
        return { reviews: [] }
      },
    }

    const marks = await wired.chapterMarks({ bookId: 'bk-1', chapterUid: 11 })
    assert.deepEqual(marks.unmatched, [])
    // 15-19 belongs to bm-1; bm-2 only keeps the characters it still can (19-21).
    assert.deepEqual(marks.spans[1], [
      { start: 0, end: 4, text: '内容A内', highlightId: 'bm-1', colorStyle: 1 },
      { start: 4, end: 6, text: '容B', highlightId: 'bm-2', colorStyle: 3 },
    ])
    // Spans still tile the paragraph with no gaps and no nesting.
    assert.equal(marks.spans[1].map((span) => span.text).join(''), '内容A内容B')
  })
})

test('a mark whose range cannot be placed is reported as unmatched', async () => {
  await withTempDir(async (dataDir) => {
    const service = makeService(dataDir)
    await service.ready
    const { service: wired } = fakeService(service)

    wired.gateway = {
      async bookmarks() {
        return bookmarkNotebook([
          { markText: '不存在的原文', range: '9000-9100', chapterUid: 11, bookmarkId: 'bm-lost' },
          { range: 'not-a-range', chapterUid: 11, bookmarkId: 'bm-bad' },
        ])
      },
      async myReviews() {
        return { reviews: [] }
      },
    }

    const marks = await wired.chapterMarks({ bookId: 'bk-1', chapterUid: 11 })
    assert.equal(marks.unmatched.length, 2)
    assert.deepEqual(
      marks.unmatched.map((item) => item.bookmarkId),
      ['bm-lost', 'bm-bad'],
    )
    assert.deepEqual(marks.spans, CHAPTER_PARAGRAPHS.map((text) => [{ start: 0, end: text.length, text }]))
  })
})

test('a thought rides along on the marked span as note', async () => {
  await withTempDir(async (dataDir) => {
    const service = makeService(dataDir)
    await service.ready
    const { service: wired } = fakeService(service)

    wired.gateway = {
      async bookmarks() {
        return bookmarkNotebook([
          { markText: '内容C', range: '28-31', chapterUid: 11, bookmarkId: 'bm-3', colorStyle: 4, content: '短评' },
        ])
      },
      async myReviews() {
        return { reviews: [] }
      },
    }

    const marks = await wired.chapterMarks({ bookId: 'bk-1', chapterUid: 11 })
    assert.deepEqual(marks.spans[2], [
      { start: 0, end: 3, text: '内容C', highlightId: 'bm-3', colorStyle: 4, note: '短评' },
    ])
    assert.equal(marks.highlights[0].note, '短评')
  })
})

test('chapterMarks without a cookie or key is empty, not an error', async () => {
  await withTempDir(async (dataDir) => {
    const service = makeService(dataDir)
    await service.ready
    const { reader, web } = fakeService(service)
    // Signed out: no cookie for the text, no API key for the notebook.
    reader.session = false
    web.session = false

    const marks = await service.chapterMarks({ bookId: 'bk-1', chapterUid: 11 })
    assert.equal(marks.configured, false)
    assert.deepEqual(marks.spans, [])
    assert.equal(marks.highlightCount, 0)
  })
})

test('addHighlight converts a paragraph selection into an absolute range', async () => {
  await withTempDir(async (dataDir) => {
    const service = makeService(dataDir)
    await service.ready
    await service.store.save({ cookie: COOKIE })
    const { web } = fakeService(service)
    // A stale notebook entry the write must clear.
    await service.store.writeCache('notes/bk-1', { at: Date.now(), value: { stale: true } })

    const result = await service.addHighlight({
      bookId: 'bk-1',
      chapterUid: 11,
      paragraphIndex: 1,
      startOffset: 2,
      endOffset: 6,
      colorStyle: 3,
    })

    assert.deepEqual(result, {
      ok: true,
      bookmarkId: 'bm-new',
      bookId: 'bk-1',
      chapterUid: 11,
      range: '17-21',
      markText: 'A内容B',
      colorStyle: 3,
    })
    // The range must round-trip through the same index the reader draws with.
    const expected = selectionRange(buildChapterIndex(CHAPTER_HTML), 1, 2, 6)
    assert.equal(result.range, `${expected.start}-${expected.end}`)
    assert.equal(result.markText, expected.markText)

    const written = web.calls.find(([name]) => name === 'addBookmark')
    assert.equal(written[1].bookId, 'bk-1')
    assert.equal(written[1].chapterUid, 11)
    assert.equal(written[1].chapterIdx, 0)
    assert.equal(written[1].bookVersion, 77)
    assert.equal(written[1].range, '17-21')
    assert.equal(written[1].markText, 'A内容B')
    assert.equal(written[1].colorStyle, 3)

    // The five-minute notebook cache is dropped so a refetch shows the new mark.
    assert.equal(await service.store.readCache('notes/bk-1'), undefined)
  })
})

test('addHighlight honours an explicit range when the paragraph offsets do not resolve', async () => {
  await withTempDir(async (dataDir) => {
    const service = makeService(dataDir)
    await service.ready
    await service.store.save({ cookie: COOKIE })
    const { web } = fakeService(service)

    const result = await service.addHighlight({
      bookId: 'bk-1',
      chapterUid: 11,
      paragraphIndex: 99,
      startOffset: 0,
      endOffset: 2,
      colorStyle: 0,
      range: '15-21',
    })

    assert.equal(result.range, '15-21')
    assert.equal(result.markText, '内容A内容B')
    assert.equal(web.calls.find(([name]) => name === 'addBookmark')[1].range, '15-21')
  })
})

test('addHighlight refuses local books, missing cookies and empty selections', async () => {
  await withTempDir(async (dataDir) => {
    const service = makeService(dataDir)
    await service.ready
    const { web } = fakeService(service)

    // A local book never reaches the network at all.
    await assert.rejects(
      service.addHighlight({ bookId: 'local-0123456789ab', chapterUid: 1 }),
      (error) => error.code === 'weread/local-no-marks',
    )

    // Signed out: the message names the Cookie, which is what writing needs.
    web.session = false
    await assert.rejects(
      service.addHighlight({ bookId: 'bk-1', chapterUid: 11, paragraphIndex: 0, startOffset: 0, endOffset: 1 }),
      (error) => error.code === 'weread/needs-cookie',
    )

    web.session = true
    await service.store.save({ cookie: COOKIE })
    await assert.rejects(
      service.addHighlight({ bookId: 'bk-1', chapterUid: 11, paragraphIndex: 0, startOffset: 1, endOffset: 1 }),
      (error) => error.code === 'weread/bad-selection',
    )
  })
})

test('updateHighlight and removeHighlight call WeRead and invalidate the notebook', async () => {
  await withTempDir(async (dataDir) => {
    const service = makeService(dataDir)
    await service.ready
    await service.store.save({ cookie: COOKIE })
    const { web } = fakeService(service)

    for (const key of ['notes/bk-1', 'chapterMarks/bk-1']) {
      await service.store.writeCache(key, { at: Date.now(), value: { stale: true } })
    }

    const recolored = await service.updateHighlight({ bookId: 'bk-1', bookmarkId: 'bm-9', colorStyle: 4 })
    assert.deepEqual(recolored, { ok: true, bookmarkId: 'bm-9', colorStyle: 4 })
    assert.deepEqual(web.calls.find(([name]) => name === 'updateBookmark')[1], {
      bookmarkId: 'bm-9',
      colorStyle: 4,
    })
    assert.equal(await service.store.readCache('notes/bk-1'), undefined)
    assert.equal(await service.store.readCache('chapterMarks/bk-1'), undefined)

    await service.store.writeCache('notes/bk-1', { at: Date.now(), value: { stale: true } })
    const removed = await service.removeHighlight({ bookId: 'bk-1', bookmarkId: 'bm-9' })
    assert.deepEqual(removed, { ok: true, bookmarkId: 'bm-9' })
    assert.deepEqual(web.calls.find(([name]) => name === 'removeBookmark')[1], { bookmarkId: 'bm-9' })
    assert.equal(await service.store.readCache('notes/bk-1'), undefined)

    await assert.rejects(
      service.updateHighlight({ bookId: 'bk-1', bookmarkId: '' }),
      (error) => error.code === 'weread/bad-request',
    )
  })
})

test('lookupDict degrades to an empty entry instead of failing the panel', async () => {
  await withTempDir(async (dataDir) => {
    const service = makeService(dataDir)
    await service.ready
    await service.store.save({ cookie: COOKIE })

    // No word: answered locally, so no dictionary source is ever contacted.
    assert.deepEqual(await service.lookupDict({ word: '   ' }), {
      word: '',
      kind: 'unknown',
      phonetic: '',
      readings: [],
      definitions: [],
      source: 'none',
    })
  })
})

test('the new endpoints are reachable through dispatch', async () => {
  await withTempDir(async (dataDir) => {
    const service = makeService(dataDir)
    await service.ready
    await service.store.save({ cookie: COOKIE })
    const { web } = fakeService(service)

    const added = await service.dispatch('addHighlight', {
      bookId: 'bk-1',
      chapterUid: 11,
      paragraphIndex: 2,
      startOffset: 0,
      endOffset: 3,
      colorStyle: 1,
    })
    assert.equal(added.ok, true)
    assert.equal(added.bookmarkId, 'bm-new')

    const recolored = await service.dispatch('updateHighlight', {
      bookId: 'bk-1',
      bookmarkId: 'bm-9',
      colorStyle: 2,
    })
    assert.deepEqual(recolored, { ok: true, bookmarkId: 'bm-9', colorStyle: 2 })

    assert.deepEqual(await service.dispatch('removeHighlight', { bookId: 'bk-1', bookmarkId: 'bm-9' }), {
      ok: true,
      bookmarkId: 'bm-9',
    })

    const looked = await service.dispatch('lookupDict', { word: '' })
    assert.equal(looked.source, 'none')
    assert.equal(web.calls.filter(([name]) => name === 'addBookmark').length, 1)
  })
})

test('invalidate drops one cache entry and leaves its neighbours alone', async () => {
  await withTempDir(async (dataDir) => {
    const store = makeService(dataDir).store
    await store.writeCache('notes/bk-1', { marker: 1 })
    await store.writeCache('notes/bk-2', { marker: 2 })

    assert.equal(await invalidate(store, 'notes/bk-1'), true)
    assert.equal(await store.readCache('notes/bk-1'), undefined)
    assert.deepEqual((await store.readCache('notes/bk-2')).value, { marker: 2 })
    // A miss is not an error: the caller only wanted it gone.
    assert.equal(await invalidate(store, 'notes/bk-1'), false)
  })
})

test('invalidatePrefix clears a whole family of cached responses', async () => {
  await withTempDir(async (dataDir) => {
    const service = makeService(dataDir)
    const store = service.store
    await store.writeCache('chapterMarks/bk-1', { marker: 1 })
    await store.writeCache('chapterMarks/bk-2', { marker: 2 })
    await store.writeCache('notes/bk-1', { marker: 3 })

    assert.equal(await invalidatePrefix(store, 'chapterMarks/'), 2)
    assert.equal(await store.readCache('chapterMarks/bk-1'), undefined)
    assert.equal(await store.readCache('chapterMarks/bk-2'), undefined)
    assert.deepEqual((await store.readCache('notes/bk-1')).value, { marker: 3 })
    assert.equal(await invalidatePrefix(store, 'chapterMarks/'), 0)
  })
})

test('addBookmark base64-encodes non-ASCII markText and posts the documented body', async () => {
  await withFetch(
    () => jsonResponse({ bookmarkId: '920786_14_2400-2418' }),
    async (seen) => {
      const api = new WereadWebApi({ getCookie: () => COOKIE, getTimeoutMs: () => 5000, logger: SILENT_LOGGER })

      const payload = await api.addBookmark({
        bookId: '920786',
        chapterUid: 14,
        chapterIdx: 3,
        bookVersion: 55,
        range: '2400-2418',
        markText: '这是一段被划线的原文',
        colorStyle: 2,
      })
      assert.deepEqual(payload, { bookmarkId: '920786_14_2400-2418' })

      const post = seen.find((call) => call.url.includes('/web/book/addBookmark'))
      assert.ok(post !== undefined)
      assert.equal(post.init.method, 'POST')
      const body = JSON.parse(post.init.body)
      assert.deepEqual(body, {
        bookId: '920786',
        chapterUid: 14,
        chapterIdx: 3,
        bookVersion: 55,
        type: 1,
        style: 1,
        colorStyle: 2,
        range: '2400-2418',
        // Chinese text is rejected in the clear; the wire form is base64 UTF-8.
        markText: Buffer.from('这是一段被划线的原文', 'utf8').toString('base64'),
      })

      // ASCII text is sent verbatim: base64 is a workaround, not the format.
      await api.addBookmark({ bookId: '1', chapterUid: 2, range: '0-3', markText: 'hello' })
      const ascii = seen.filter((call) => call.url.includes('/web/book/addBookmark')).at(-1)
      assert.equal(JSON.parse(ascii.init.body).markText, 'hello')
    },
  )
})

test('updateBookmark, removeBookmark and dict hit the documented endpoints', async () => {
  await withFetch(
    () => jsonResponse({ succ: 1 }),
    async (seen) => {
      const api = new WereadWebApi({ getCookie: () => COOKIE, getTimeoutMs: () => 5000, logger: SILENT_LOGGER })

      await api.updateBookmark({ bookmarkId: 'bm-1', colorStyle: 3 })
      const updated = seen.find((call) => call.url.includes('/web/book/updateBookmark'))
      assert.deepEqual(JSON.parse(updated.init.body), { bookmarkId: 'bm-1', style: 1, colorStyle: 3 })

      await api.removeBookmark({ bookmarkId: 'bm-1' })
      const removed = seen.find((call) => call.url.includes('/web/book/removeBookmark'))
      assert.deepEqual(JSON.parse(removed.init.body), { bookmarkId: 'bm-1' })

      await api.dict('苹果')
      const lookup = seen.find((call) => call.url.includes('/web/dict/query'))
      // Dictionary lookup is a GET with the word in the query string.
      assert.equal(lookup.init.method, 'GET')
      assert.equal(lookup.init.body, undefined)
      assert.ok(lookup.url.endsWith(`word=${encodeURIComponent('苹果')}`))
    },
  )
})
