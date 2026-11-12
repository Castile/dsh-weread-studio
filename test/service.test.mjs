/**
 * Tests for the service surface added for local books and reader marks.
 *
 * The service is constructed exactly as the host constructs it (a data
 * directory under a temp folder, a silent logger), and the gateway is replaced
 * with a stub so marks can be exercised without a live WeRead session. The
 * local book used throughout is a tiny two-chapter TXT parsed by the real
 * lib/import.js, which keeps the import path honest.
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { localBookId } from '../lib/library.js'
import { WereadService } from '../lib/service.js'

/** Two chapters, so previous/next both have something to point at. */
const BOOK_NAME = '两章.txt'
const BOOK_TEXT = '第一章 开始\n内容A\n内容B\n第二章 继续\n内容C'

/** A logger shaped like the host's, quiet enough for the test output. */
const SILENT_LOGGER = { info() {}, warn() {}, debug() {}, error() {} }

/** Build the service the way the host does, over a throwaway data directory. */
function makeService(dataDir) {
  return new WereadService({ ctx: { logger: SILENT_LOGGER }, config: { dataDir, syncProgress: false } })
}

/** Run a test body against a fresh temp data directory, always cleaned up. */
async function withTempDir(body) {
  const dir = await mkdtemp(join(tmpdir(), 'weread-service-'))
  try {
    return await body(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** The base64 payload the panel sends for a local file. */
function toBase64(text) {
  return Buffer.from(text, 'utf8').toString('base64')
}

/** A gateway stub whose bookmarks the caller controls. */
function stubGateway({ bookmarks, reviews = [] }) {
  return {
    bookmarks: async () => bookmarks,
    myReviews: async () => ({ reviews }),
  }
}

test('localImport stores a two-chapter TXT and the whole chain reads it back', async () => {
  await withTempDir(async (dataDir) => {
    const service = makeService(dataDir)
    const record = await service.localImport({ filename: BOOK_NAME, base64: toBase64(BOOK_TEXT) })

    assert.match(record.bookId, /^local-[0-9a-f]{12}$/)
    assert.equal(record.bookId, localBookId(BOOK_NAME, record.title, record.charCount))
    assert.equal(record.source, 'local')
    assert.equal(record.format, 'txt')
    assert.equal(record.chapterCount, 2)
    assert.ok(record.charCount > 0)
    assert.ok(record.title.length > 0)
    assert.ok(Number.isFinite(record.importedAt) && record.importedAt > 0)

    const listed = await service.localList()
    assert.equal(listed.books.length, 1)
    assert.deepEqual(listed.books[0], record)

    // The catalog describes the book, it never carries the text.
    const book = await service.localBook({ bookId: record.bookId })
    assert.equal(book.bookId, record.bookId)
    assert.equal(book.chapterCount, 2)
    assert.equal(book.chapters.length, 2)
    assert.equal(book.charCount, record.charCount)
    assert.equal(
      book.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
      record.charCount,
    )
    for (const chapter of book.chapters) {
      assert.equal(chapter.paragraphs, undefined)
      assert.ok(Number.isInteger(chapter.chapterUid) && chapter.chapterUid > 0)
      assert.ok(Number.isInteger(chapter.chapterIdx))
    }

    const first = await service.localChapter({ bookId: record.bookId, chapterUid: book.chapters[0].chapterUid })
    assert.equal(first.bookId, record.bookId)
    assert.equal(first.format, 'txt')
    assert.ok(Array.isArray(first.paragraphs) && first.paragraphs.length > 0)
    assert.equal(first.chapterIdx, 0)
    assert.equal(first.chapterCount, 2)
    assert.equal(first.previous, undefined)
    assert.deepEqual(first.next, book.chapters[1])
    assert.equal(first.chapters.length, 2)
    assert.ok(Number.isFinite(first.fetchedAt))
    assert.equal(first.book, undefined)
    assert.ok(first.paragraphs.some((paragraph) => paragraph.includes('内容A')))

    const second = await service.localChapter({ bookId: record.bookId, chapterUid: book.chapters[1].chapterUid })
    assert.equal(second.chapterIdx, 1)
    assert.equal(second.next, undefined)
    assert.deepEqual(second.previous, book.chapters[0])

    // The RPC surface reaches the same methods.
    const viaRpc = await service.handleRpc('localList', {})
    assert.equal(viaRpc.ok, true)
    assert.equal(viaRpc.value.books.length, 1)
    const unknown = await service.handleRpc('noSuchEndpoint', {})
    assert.equal(unknown.ok, false)
    assert.equal(unknown.error.code, 'weread/unknown-endpoint')

    // Removal empties the library and the book stops resolving.
    assert.deepEqual(await service.localRemove({ bookId: record.bookId }), { removed: true })
    assert.deepEqual(await service.localList(), { books: [] })
    await assert.rejects(service.localBook({ bookId: record.bookId }), (error) => error.code === 'weread/not-found')
    await assert.rejects(
      service.localChapter({ bookId: record.bookId, chapterUid: 1 }),
      (error) => error.code === 'weread/not-found',
    )
    // Removing a book that is already gone is not an error.
    assert.deepEqual(await service.localRemove({ bookId: record.bookId }), { removed: false })
  })
})

test('localImport rejects a payload with no file name or no bytes', async () => {
  await withTempDir(async (dataDir) => {
    const service = makeService(dataDir)
    await assert.rejects(service.localImport({ base64: toBase64('x') }), (error) => error.code === 'weread/bad-request')
    await assert.rejects(
      service.localImport({ filename: '   ', base64: toBase64('x') }),
      (error) => error.code === 'weread/bad-request',
    )
    await assert.rejects(
      service.localImport({ filename: 'a.txt', base64: '' }),
      (error) => error.code === 'weread/bad-request',
    )
    await assert.rejects(
      service.localImport({ filename: 'a.txt', base64: '!!!!' }),
      (error) => error.code === 'weread/bad-request',
    )
    assert.deepEqual(await service.localList(), { books: [] })
  })
})

test('a parser failure is reported as an import failure and stores nothing', async () => {
  await withTempDir(async (dataDir) => {
    const service = makeService(dataDir)
    service.library.parse = async () => {
      throw new Error('这个文件读不出章节。')
    }
    await assert.rejects(
      service.localImport({ filename: 'broken.txt', base64: toBase64('whatever') }),
      (error) => error.code === 'weread/import-failed' && error.message.includes('这个文件读不出章节。'),
    )
    assert.deepEqual(await service.localList(), { books: [] })
  })
})

test('localBook and localChapter report a missing local book as not found', async () => {
  await withTempDir(async (dataDir) => {
    const service = makeService(dataDir)
    await assert.rejects(
      service.localBook({ bookId: 'local-000000000000' }),
      (error) => error.code === 'weread/not-found',
    )
    await assert.rejects(
      service.localChapter({ bookId: 'local-000000000000', chapterUid: 1 }),
      (error) => error.code === 'weread/not-found',
    )
    // A WeRead id is not a library id, so it resolves to nothing here too.
    await assert.rejects(service.localBook({ bookId: 'not-a-local-id' }), (error) => error.code === 'weread/not-found')
  })
})

test('chapterMarks on an unconfigured account is empty, not an error', async () => {
  await withTempDir(async (dataDir) => {
    const service = makeService(dataDir)
    await service.ready
    assert.equal(service.store.credentials.apiKey, '')

    const marks = await service.chapterMarks({ bookId: 'local-0123456789ab', chapterUid: 3 })
    assert.equal(marks.bookId, 'local-0123456789ab')
    assert.equal(marks.chapterUid, 3)
    assert.equal(marks.configured, false)
    assert.deepEqual(marks.spans, [])
    assert.deepEqual(marks.unmatched, [])
    assert.deepEqual(marks.highlights, [])
    assert.deepEqual(marks.thoughts, [])
    assert.equal(marks.highlightCount, 0)
    assert.equal(marks.thoughtCount, 0)

    const whole = await service.bookMarks({ bookId: 'local-0123456789ab' })
    assert.equal(whole.configured, false)
    assert.deepEqual(whole.book, {})
    assert.deepEqual(whole.chapters, [])
    assert.equal(whole.highlightCount, 0)
    assert.equal(whole.thoughtCount, 0)
  })
})

test('chapterMarks places a bookmark on the chapter it belongs to', async () => {
  await withTempDir(async (dataDir) => {
    const service = makeService(dataDir)
    const record = await service.localImport({ filename: BOOK_NAME, base64: toBase64(BOOK_TEXT) })
    await service.ready
    await service.store.save({ apiKey: 'wrk-test-key' })

    let calls = 0
    service.gateway = {
      bookmarks: async () => {
        calls += 1
        return {
          updated: [
            { markText: '内容A', range: '0-3', chapterUid: 1, bookmarkId: 'bm-1', colorStyle: 2, content: '一句想法' },
            { markText: '内容C', range: '4-7', chapterUid: 2, bookmarkId: 'bm-2', colorStyle: 0 },
          ],
          chapters: [
            { chapterUid: 1, title: '第一章 开始' },
            { chapterUid: 2, title: '第二章 继续' },
          ],
        }
      },
      myReviews: async () => ({ reviews: [] }),
    }

    const marks = await service.chapterMarks({ bookId: record.bookId, chapterUid: 1 })
    const chapter = await service.localChapter({ bookId: record.bookId, chapterUid: 1 })

    assert.equal(marks.configured, true)
    assert.equal(marks.chapterUid, 1)
    assert.equal(marks.spans.length, chapter.paragraphs.length)
    assert.equal(marks.highlights.length, 1)
    assert.equal(marks.highlightCount, 1)
    assert.equal(marks.thoughtCount, 0)
    assert.deepEqual(marks.unmatched, [])
    assert.ok(marks.highlights[0].bookmarkId === 'bm-1')
    assert.equal(marks.highlights[0].colorStyle, 2)
    assert.equal(marks.highlights[0].note, '一句想法')

    // Each paragraph is a list of spans that tiles it without gaps.
    const marked = marks.spans.flat().filter((span) => span.highlightId !== undefined)
    assert.equal(marked.length, 1)
    assert.equal(marked[0].highlightId, 'bm-1')
    assert.equal(marked[0].text, '内容A')
    assert.equal(marked[0].colorStyle, 2)
    for (let index = 0; index < marks.spans.length; index += 1) {
      const spans = marks.spans[index]
      assert.ok(Array.isArray(spans) && spans.length > 0)
      assert.equal(spans.map((span) => span.text).join(''), chapter.paragraphs[index])
      assert.equal(spans[0].start, 0)
      assert.equal(spans[spans.length - 1].end, chapter.paragraphs[index].length)
    }

    // Chapter 2's bookmark never leaks into chapter 1, and its own turn sees it.
    const other = await service.chapterMarks({ bookId: record.bookId, chapterUid: 2 })
    assert.equal(other.highlightCount, 1)
    assert.equal(other.highlights[0].bookmarkId, 'bm-2')
    // The notebook is cached, so both turns cost one gateway round trip.
    assert.equal(calls, 1)
    await service.notes(record.bookId, { refresh: true })
    assert.equal(calls, 2)
  })
})

test('chapterMarks returns plain spans for a chapter with no bookmarks', async () => {
  await withTempDir(async (dataDir) => {
    const service = makeService(dataDir)
    const record = await service.localImport({ filename: BOOK_NAME, base64: toBase64(BOOK_TEXT) })
    await service.ready
    await service.store.save({ apiKey: 'wrk-test-key' })
    service.gateway = stubGateway({
      bookmarks: {
        updated: [{ markText: '内容C', range: '0-1', chapterUid: 2, bookmarkId: 'bm-2' }],
        chapters: [{ chapterUid: 2, title: '第二章 继续' }],
      },
    })

    const marks = await service.chapterMarks({ bookId: record.bookId, chapterUid: 1 })
    const chapter = await service.localChapter({ bookId: record.bookId, chapterUid: 1 })
    assert.equal(marks.configured, true)
    assert.equal(marks.highlightCount, 0)
    assert.deepEqual(marks.spans, chapter.paragraphs.map((text) => [{ start: 0, end: text.length, text }]))
    assert.deepEqual(marks.unmatched, [])
  })
})

test('bookMarks wraps the notebook and flags whether marks exist', async () => {
  await withTempDir(async (dataDir) => {
    const service = makeService(dataDir)
    await service.ready
    await service.store.save({ apiKey: 'wrk-test-key' })
    service.gateway = stubGateway({
      bookmarks: {
        updated: [{ markText: '一句话', range: '0-3', chapterUid: 7, bookmarkId: 'bm-7', colorStyle: 1, type: 2 }],
        chapters: [{ chapterUid: 7, title: '第七章' }],
        book: { bookId: 'wr123', title: '云书', author: '某人', cover: 'https://example.com/c.jpg' },
      },
      reviews: [{ review: { reviewId: 'r1', chapterUid: 7, chapterName: '第七章', content: '想法', star: 5 } }],
    })

    const whole = await service.bookMarks({ bookId: 'wr123' })
    assert.equal(whole.configured, true)
    assert.equal(whole.bookId, 'wr123')
    assert.equal(whole.book.title, '云书')
    assert.equal(whole.highlightCount, 1)
    assert.equal(whole.thoughtCount, 1)
    assert.equal(whole.chapters.length, 1)
    assert.equal(whole.chapters[0].chapterUid, 7)
    assert.equal(whole.chapters[0].highlights[0].bookmarkId, 'bm-7')
    assert.equal(whole.chapters[0].highlights[0].colorStyle, 1)
    assert.equal(whole.chapters[0].highlights[0].type, 2)
    assert.equal(whole.chapters[0].thoughts[0].reviewId, 'r1')

    // An imported book has no WeRead notebook, so the answer is empty but configured.
    const imported = await service.localImport({ filename: BOOK_NAME, base64: toBase64(BOOK_TEXT) })
    const local = await service.bookMarks({ bookId: imported.bookId })
    assert.equal(local.configured, true)
    assert.equal(local.bookId, imported.bookId)
    assert.deepEqual(local.chapters, [])
    assert.equal(local.highlightCount, 0)
  })
})

test('notes keep the old fields and add the mark metadata', async () => {
  await withTempDir(async (dataDir) => {
    const service = makeService(dataDir)
    await service.ready
    await service.store.save({ apiKey: 'wrk-test-key' })
    service.gateway = stubGateway({
      bookmarks: {
        updated: [
          {
            markText: '划线',
            range: '12-15',
            chapterUid: 3,
            chapterTitle: 'ignored',
            bookmarkId: 99,
            colorStyle: '4',
            type: '2',
            content: '笔记',
            createTime: 1700000000,
          },
          { markText: '无笔记', range: '', chapterUid: 0, bookmarkId: undefined, createTime: 0 },
        ],
        chapters: [{ chapterUid: 3, title: '第三章' }],
        book: { bookId: 'wr9', title: '书', author: '作者', cover: '' },
      },
    })

    const notes = await service.notes('wr9')
    const chaptered = notes.chapters.find((chapter) => chapter.chapterUid === 3)
    const unknownChapter = notes.chapters.find((chapter) => chapter.chapterUid === 0)
    const [first] = chaptered.highlights
    const [second] = unknownChapter.highlights
    assert.equal(first.range, '12-15')
    assert.equal(first.chapterUid, 3)
    assert.equal(first.chapterTitle, '第三章')
    assert.equal(first.text, '划线')
    assert.equal(first.createTime, 1700000000)
    assert.equal(first.createDate, '2023-11-14')
    // New passthrough fields.
    assert.equal(first.bookmarkId, '99')
    assert.equal(first.colorStyle, 4)
    assert.equal(first.type, 2)
    assert.equal(first.note, '笔记')
    // Empty ones get a stable default rather than undefined.
    assert.equal(second.bookmarkId, '')
    assert.equal(second.colorStyle, -1)
    assert.equal(second.type, 1)
    assert.equal(second.note, undefined)
    assert.equal(second.chapterUid, 0)
    assert.equal(second.createDate, undefined)
    // A chapterless bookmark still lands in the "unknown" group.
    assert.ok(notes.chapters.some((chapter) => chapter.chapterUid === 0))
  })
})

test('resolveBookId treats CB_ and MP_WXS_ ids as ids, not titles', async () => {
  await withTempDir(async (dataDir) => {
    const service = makeService(dataDir)
    await service.ready
    await service.store.save({ apiKey: 'wrk-test-key' })
    let searched = 0
    service.gateway = {
      search: async () => {
        searched += 1
        return { results: [] }
      },
    }

    // Shelf ids for EPUB books — store search cannot resolve these.
    assert.equal(await service.resolveBookId('CB_845GvFGwy9yS6ye6x6AHhFlk'), 'CB_845GvFGwy9yS6ye6x6AHhFlk')
    assert.equal(await service.resolveBookId('23601441'), '23601441')
    assert.equal(await service.resolveBookId('MP_WXS_3089245451'), 'MP_WXS_3089245451')
    assert.equal(searched, 0, 'an id must not cost a store search')

    // A real title still goes through search. The Web store-search is stubbed
    // empty so the case cannot depend on the network.
    service.web = { search: async () => ({ books: [] }) }
    service.gateway.search = async (keyword) => {
      searched += 1
      assert.equal(keyword, '三体')
      return { results: [{ books: [{ bookInfo: { bookId: '695233', title: '三体' } }] }] }
    }
    assert.equal(await service.resolveBookId('三体'), '695233')
    assert.equal(searched, 1)
  })
})

test('notes resolve a CB_ book straight to the gateway bookmark list', async () => {
  await withTempDir(async (dataDir) => {
    const service = makeService(dataDir)
    await service.ready
    await service.store.save({ apiKey: 'wrk-test-key' })
    const seen = []
    service.gateway = {
      bookmarks: async (bookId) => {
        seen.push(bookId)
        return {
          updated: [{ markText: '石窟', range: '0-2', chapterUid: 7, bookmarkId: 'bm-cb', colorStyle: 2 }],
          chapters: [{ chapterUid: 7, title: '1. 葱岭以东的佛光初照' }],
          book: { bookId, title: '中国石窟简史', author: '常青', cover: '' },
        }
      },
      myReviews: async () => ({ reviews: [] }),
    }

    const notes = await service.dispatch('notes', { bookId: 'CB_845GvFGwy9yS6ye6x6AHhFlk' })
    assert.deepEqual(seen, ['CB_845GvFGwy9yS6ye6x6AHhFlk'])
    assert.equal(notes.book.title, '中国石窟简史')
    assert.equal(notes.highlightCount, 1)
    assert.equal(notes.chapters[0].highlights[0].text, '石窟')
  })
})
