/**
 * Tests for the local imported-book library.
 *
 * The library is exercised twice: once with an injected parser so the disk
 * shape can be checked without depending on lib/import.js, and once with the
 * real parseBookFile on a tiny hand-written TXT. The second case is skipped
 * while the sibling parser module is not in place yet.
 */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, mkdir, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { LocalLibrary, localBookId } from '../lib/library.js'

/** Create a throwaway data directory and hand it to the test body. */
async function withTempDir(body) {
  const dir = await mkdtemp(join(tmpdir(), 'weread-library-'))
  try {
    return await body(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** A parser shaped exactly like lib/import.js's parseBookFile. */
async function fakeParse({ filename }) {
  if (filename === 'broken.txt') throw new Error('解析失败')
  return {
    title: '测试书',
    author: '某人',
    format: 'txt',
    chapters: [
      { title: '第一章', paragraphs: ['第一段', '第二段'] },
      { title: '第二章', paragraphs: ['第三段'] },
      { title: '第三章', paragraphs: [] },
    ],
  }
}

test('localBookId is stable, prefixed and short', () => {
  const id = localBookId('a.txt', '书', 10)
  assert.match(id, /^local-[0-9a-f]{12}$/)
  assert.equal(id, localBookId('a.txt', '书', 10))
  assert.notEqual(id, localBookId('a.txt', '书', 11))
})

test('a fresh library lists nothing and reads no book', async () => {
  await withTempDir(async (dataDir) => {
    const library = new LocalLibrary(dataDir, { parse: fakeParse })
    assert.deepEqual(await library.list(), { books: [] })
    assert.equal(await library.book('local-000000000000'), undefined)
    assert.equal(await library.chapter('local-000000000000', 1), undefined)
  })
})

test('import writes index and body, and lists newest first', async () => {
  await withTempDir(async (dataDir) => {
    const library = new LocalLibrary(dataDir, { parse: fakeParse })
    const record = await library.import({ buffer: Buffer.from('x'), filename: 'fixture.txt' })

    const expectedId = localBookId('fixture.txt', '测试书', 9)
    assert.equal(record.bookId, expectedId)
    assert.equal(record.title, '测试书')
    assert.equal(record.author, '某人')
    assert.equal(record.format, 'txt')
    assert.equal(record.chapterCount, 3)
    assert.equal(record.charCount, 9)
    assert.equal(record.source, 'local')
    assert.ok(record.importedAt > 0)

    // The index holds no chapter text at all.
    const index = JSON.parse(await readFile(join(dataDir, 'library', 'index.json'), 'utf8'))
    assert.equal(index.version, 1)
    assert.equal(index.books.length, 1)
    assert.deepEqual(index.books[0], record)
    assert.equal(JSON.stringify(index).includes('第一段'), false)

    // The body holds the paragraphs, with uids counted from 1.
    const body = JSON.parse(await readFile(join(dataDir, 'library', 'books', expectedId + '.json'), 'utf8'))
    assert.equal(body.bookId, expectedId)
    assert.equal(body.chapters.length, 3)
    assert.deepEqual(
      body.chapters.map((chapter) => chapter.chapterUid),
      [1, 2, 3],
    )
    assert.deepEqual(body.chapters[0].paragraphs, ['第一段', '第二段'])

    const second = await library.import({ buffer: Buffer.from('y'), filename: 'other.txt' })
    const list = await library.list()
    assert.equal(list.books.length, 2)
    // Newest first, even though both imports landed in the same millisecond.
    assert.equal(list.books[0].bookId, second.bookId)
    assert.equal(list.books[1].bookId, record.bookId)
    assert.ok(list.books[0].importedAt > list.books[1].importedAt)
  })
})

test('re-importing the same file is idempotent and refreshes importedAt', async () => {
  await withTempDir(async (dataDir) => {
    const library = new LocalLibrary(dataDir, { parse: fakeParse })
    const first = await library.import({ buffer: Buffer.from('x'), filename: 'fixture.txt' })
    const again = await library.import({ buffer: Buffer.from('x'), filename: 'fixture.txt' })

    assert.equal(again.bookId, first.bookId)
    const list = await library.list()
    assert.equal(list.books.length, 1)
    assert.ok(list.books[0].importedAt >= first.importedAt)

    const entries = await readFile(join(dataDir, 'library', 'index.json'), 'utf8')
    assert.equal(JSON.parse(entries).books.length, 1)
  })
})

test('a parser failure leaves the library untouched', async () => {
  await withTempDir(async (dataDir) => {
    const library = new LocalLibrary(dataDir, { parse: fakeParse })
    await assert.rejects(() => library.import({ buffer: Buffer.from('x'), filename: 'broken.txt' }), /解析失败/)
    assert.deepEqual(await library.list(), { books: [] })
  })
})

test('book() returns the catalog without any chapter text', async () => {
  await withTempDir(async (dataDir) => {
    const library = new LocalLibrary(dataDir, { parse: fakeParse })
    const record = await library.import({ buffer: Buffer.from('x'), filename: 'fixture.txt' })
    const book = await library.book(record.bookId)

    assert.equal(book.bookId, record.bookId)
    assert.equal(book.title, '测试书')
    assert.equal(book.author, '某人')
    assert.equal(book.format, 'txt')
    assert.equal(book.chapterCount, 3)
    assert.equal(book.charCount, 9)
    assert.equal(book.importedAt, record.importedAt)
    assert.deepEqual(
      book.chapters.map((chapter) => [chapter.chapterUid, chapter.title, chapter.chapterIdx, chapter.wordCount]),
      [
        [1, '第一章', 0, 6],
        [2, '第二章', 1, 3],
        [3, '第三章', 2, 0],
      ],
    )
    assert.equal('paragraphs' in book.chapters[0], false)
    assert.equal(JSON.stringify(book).includes('第一段'), false)
  })
})

test('chapter() returns text, catalog and neighbours', async () => {
  await withTempDir(async (dataDir) => {
    const library = new LocalLibrary(dataDir, { parse: fakeParse })
    const record = await library.import({ buffer: Buffer.from('x'), filename: 'fixture.txt' })

    const middle = await library.chapter(record.bookId, 2)
    assert.equal(middle.bookId, record.bookId)
    assert.deepEqual(middle.book, {
      bookId: record.bookId,
      title: '测试书',
      author: '某人',
      format: 'txt',
    })
    assert.equal(middle.title, '第二章')
    assert.deepEqual(middle.paragraphs, ['第三段'])
    assert.equal(middle.chapterIdx, 1)
    assert.equal(middle.chapterCount, 3)
    assert.equal(middle.previous.chapterUid, 1)
    assert.equal(middle.next.chapterUid, 3)
    assert.deepEqual(
      middle.chapters.map((chapter) => chapter.chapterUid),
      [1, 2, 3],
    )

    const first = await library.chapter(record.bookId, 1)
    assert.equal(first.previous, undefined)
    assert.deepEqual(first.paragraphs, ['第一段', '第二段'])

    const last = await library.chapter(record.bookId, 3)
    assert.equal(last.next, undefined)
    assert.deepEqual(last.paragraphs, [])

    assert.equal(await library.chapter(record.bookId, 99), undefined)
  })
})

test('remove() drops the index entry and the body', async () => {
  await withTempDir(async (dataDir) => {
    const library = new LocalLibrary(dataDir, { parse: fakeParse })
    const record = await library.import({ buffer: Buffer.from('x'), filename: 'fixture.txt' })

    assert.equal(await library.remove(record.bookId), true)
    assert.deepEqual(await library.list(), { books: [] })
    assert.equal(await library.book(record.bookId), undefined)
    assert.equal(await library.chapter(record.bookId, 1), undefined)
    await assert.rejects(() => access(join(dataDir, 'library', 'books', record.bookId + '.json')))

    // Removing twice, or a malformed id, is a no-op rather than a throw.
    assert.equal(await library.remove(record.bookId), false)
    assert.equal(await library.remove('../../etc/passwd'), false)
  })
})

test('a corrupt index reads as an empty library and can be rewritten', async () => {
  await withTempDir(async (dataDir) => {
    const library = new LocalLibrary(dataDir, { parse: fakeParse })
    await mkdir(join(dataDir, 'library'), { recursive: true })
    await writeFile(join(dataDir, 'library', 'index.json'), '{not json', 'utf8')
    assert.deepEqual(await library.list(), { books: [] })

    const record = await library.import({ buffer: Buffer.from('x'), filename: 'fixture.txt' })
    assert.equal((await library.list()).books.length, 1)
    assert.equal((await library.book(record.bookId)).title, '测试书')

    // A corrupt body degrades to the index-only view, never a throw.
    await writeFile(join(dataDir, 'library', 'books', record.bookId + '.json'), '[]', 'utf8')
    const book = await library.book(record.bookId)
    assert.equal(book.bookId, record.bookId)
    assert.deepEqual(book.chapters, [])
  })
})

test('the real parser imports a minimal TXT into two chapters', async (t) => {
  let parseBookFile
  try {
    const module = await import('../lib/import.js')
    parseBookFile = module.parseBookFile
  } catch {
    parseBookFile = undefined
  }
  if (typeof parseBookFile !== 'function') {
    t.skip('lib/import.js 尚未就绪')
    return
  }

  await withTempDir(async (dataDir) => {
    const library = new LocalLibrary(dataDir)
    const text = '第一章 开始\n内容A\n内容B\n第二章 继续\n内容C'
    const record = await library.import({ buffer: Buffer.from(text, 'utf8'), filename: 'mini.txt' })

    assert.equal(record.source, 'local')
    assert.equal(record.format, 'txt')
    assert.equal(record.chapterCount, 2)
    // The parser owns how it counts characters; the library only has to keep
    // its own count consistent with the text it stored.
    assert.ok(record.charCount > 0)

    const book = await library.book(record.bookId)
    assert.equal(book.chapterCount, 2)
    assert.equal(book.chapters.length, 2)
    assert.equal(book.charCount, book.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0))

    const first = await library.chapter(record.bookId, book.chapters[0].chapterUid)
    assert.ok(first.title.includes('第一章'))
    assert.deepEqual(first.paragraphs, ['内容A', '内容B'])
    assert.equal(first.next.chapterUid, book.chapters[1].chapterUid)

    const second = await library.chapter(record.bookId, book.chapters[1].chapterUid)
    assert.ok(second.title.includes('第二章'))
    assert.deepEqual(second.paragraphs, ['内容C'])
    assert.equal(second.previous.chapterUid, book.chapters[0].chapterUid)
  })
})
