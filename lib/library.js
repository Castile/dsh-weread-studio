/**
 * The local book library: books the user imported from their own files.
 *
 * A local book is stored as its own JSON document under
 * <dataDir>/library/books/, beside a small index at <dataDir>/library/index.json
 * that the panel can list without reading any book body. Everything is read
 * defensively: a missing, half-written or hand-edited file degrades to "no
 * books" instead of breaking the panel.
 *
 * This module never parses a book itself. It asks lib/import.js (or a parse
 * function injected for tests) and only owns the on-disk shape, so the parser
 * can be replaced without touching the library.
 *
 * @module dsh-weread/lib/library
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/** Index format written by this module. */
const INDEX_VERSION = 1

/** Prefix that keeps local ids from colliding with WeRead book ids. */
const ID_PREFIX = 'local-'

/**
 * A well-formed local book id. Checked before any id becomes a file name so a
 * hand-edited index or a crafted id cannot point outside the library folder.
 */
const BOOK_ID_PATTERN = /^local-[0-9a-f]{12}$/

/** Bumped per write so two writers in one process never share a temp file. */
let temporaryCounter = 0

/** Cached dynamic import of the parser, so repeated imports pay it once. */
let importModulePromise

/**
 * Derive the deterministic id of a local book.
 *
 * Re-importing the same file therefore lands on the same id, which is what
 * makes importing idempotent: the new body overwrites the old one and only
 * importedAt moves.
 *
 * @param filename - the name the user imported, as given.
 * @param title - the parsed title.
 * @param charCount - total characters of body text.
 * @returns a stable id in the form local-xxxxxxxxxxxx.
 */
export function localBookId(filename, title, charCount) {
  const digest = createHash('sha1')
    .update(String(filename) + ':' + String(title) + ':' + String(charCount), 'utf8')
    .digest('hex')
  return ID_PREFIX + digest.slice(0, 12)
}

/** Coerce a stored value to trimmed text, defaulting to an empty string. */
function asText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** Coerce a stored value to a non-negative integer, defaulting to zero. */
function asCount(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}

/** Normalize a book format to the two the parser can report. */
function normalizeFormat(value) {
  return value === 'epub' ? 'epub' : 'txt'
}

/** Coerce one paragraph, dropping everything that is not readable text. */
function asParagraph(value) {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}

/** The file name without its extension, used when a parser reports no title. */
function titleFromFilename(filename) {
  const name = basename(filename)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/** Read and parse one JSON document, or undefined when absent or unreadable. */
async function readJson(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Write one JSON document atomically: a sibling temp file then a rename. */
async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true })
  temporaryCounter += 1
  const temporary = path + '.' + process.pid + '.' + temporaryCounter + '.tmp'
  try {
    await writeFile(temporary, JSON.stringify(value) + '\n', 'utf8')
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

/** Load lib/import.js and return its parseBookFile, or throw a typed error. */
function loadImportModule() {
  if (importModulePromise === undefined) {
    importModulePromise = import('./import.js')
      .then((module) => {
        if (typeof module?.parseBookFile !== 'function') {
          throw new TypeError('lib/import.js 没有导出 parseBookFile。')
        }
        return module
      })
      .catch((error) => {
        importModulePromise = undefined
        const failure = new Error(
          '无法加载本地书籍解析器 lib/import.js：' + (error?.message ?? String(error)),
          { cause: error },
        )
        failure.code = 'library/no-parser'
        throw failure
      })
  }
  return importModulePromise
}

/**
 * Normalize whatever the parser returned into the shape the library stores.
 *
 * Chapter uids are assigned here, in reading order, starting at 1: they are a
 * stable handle for the panel, not something the parser has to invent.
 *
 * @param parsed - the parser result.
 * @param filename - the imported file name, used for the title fallback.
 */
function normalizeParsedBook(parsed, filename) {
  if (parsed === null || typeof parsed !== 'object') {
    throw new TypeError('parseBookFile 的返回值必须是对象。')
  }
  const fallbackTitle = titleFromFilename(filename)
  const title = asText(parsed.title) || fallbackTitle
  const author = asText(parsed.author)
  const format = normalizeFormat(parsed.format)
  const rawChapters = Array.isArray(parsed.chapters) ? parsed.chapters : []
  const chapters = rawChapters.map((chapter, index) => {
    const paragraphs = Array.isArray(chapter?.paragraphs)
      ? chapter.paragraphs.map(asParagraph).filter((line) => line.length > 0)
      : []
    return {
      chapterUid: index + 1,
      title: asText(chapter?.title) || '第 ' + (index + 1) + ' 章',
      paragraphs,
    }
  })
  let charCount = 0
  for (const chapter of chapters) {
    for (const paragraph of chapter.paragraphs) charCount += paragraph.length
  }
  return { title, author, format, chapters, charCount }
}

/** Normalize one index entry, dropping anything that cannot be trusted. */
function normalizeRecord(raw) {
  if (raw === null || typeof raw !== 'object') return undefined
  const bookId = typeof raw.bookId === 'string' ? raw.bookId : ''
  if (!BOOK_ID_PATTERN.test(bookId)) return undefined
  return {
    bookId,
    title: asText(raw.title),
    author: asText(raw.author),
    format: normalizeFormat(raw.format),
    chapterCount: asCount(raw.chapterCount),
    charCount: asCount(raw.charCount),
    importedAt: asCount(raw.importedAt),
    source: 'local',
  }
}

/** Build the catalog entries the panel shows, without any chapter text. */
function toCatalog(chapters) {
  return chapters.map((chapter, index) => {
    let wordCount = 0
    for (const paragraph of chapter.paragraphs) wordCount += paragraph.length
    return {
      chapterUid: chapter.chapterUid,
      title: chapter.title,
      chapterIdx: index,
      wordCount,
    }
  })
}

/**
 * The local imported-book library.
 *
 * The only constructor input is the data directory, so this never depends on
 * the WeRead store class; the optional second argument exists so tests can
 * inject a parser and so a caller can override it deliberately.
 */
export class LocalLibrary {
  /**
   * @param dataDir - absolute path of the plugin data directory.
   * @param options - optional wiring.
   * @param options.parse - parser override; defaults to lib/import.js.
   */
  constructor(dataDir, options = {}) {
    if (typeof dataDir !== 'string' || dataDir.trim().length === 0) {
      throw new TypeError('LocalLibrary 需要一个数据目录路径。')
    }
    this.dataDir = dataDir
    this.parse = typeof options?.parse === 'function' ? options.parse : undefined
    /** Serializes writers so two imports cannot lose each other's index update. */
    this.pending = Promise.resolve()
  }

  /** The library folder under the data directory. */
  get libraryDir() {
    return join(this.dataDir, 'library')
  }

  /** The catalogue index, the only file list() reads. */
  get indexPath() {
    return join(this.libraryDir, 'index.json')
  }

  /** The folder holding one JSON document per book. */
  get booksDir() {
    return join(this.libraryDir, 'books')
  }

  /** Where one book's body lives. Callers must pass a validated id. */
  bodyPath(bookId) {
    return join(this.booksDir, bookId + '.json')
  }

  /** Run one write task after every previously scheduled write. */
  async exclusive(task) {
    const run = this.pending.then(
      () => task(),
      () => task(),
    )
    this.pending = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** Resolve the parser, injecting or loading it on first use. */
  async resolveParse() {
    if (this.parse !== undefined) return this.parse
    const module = await loadImportModule()
    return module.parseBookFile
  }

  /** Read the index, tolerating anything unreadable as an empty library. */
  async readIndex() {
    const parsed = await readJson(this.indexPath)
    if (!Array.isArray(parsed?.books)) return []
    const books = []
    for (const item of parsed.books) {
      const record = normalizeRecord(item)
      if (record !== undefined) books.push(record)
    }
    return books
  }

  /** Persist the index atomically. */
  async writeIndex(books) {
    await writeJsonAtomic(this.indexPath, { version: INDEX_VERSION, books })
  }

  /** Read one book's body, or undefined when missing or unreadable. */
  async readBody(bookId) {
    const raw = await readJson(this.bodyPath(bookId))
    if (raw === undefined || !Array.isArray(raw.chapters)) return undefined
    const chapters = []
    for (const item of raw.chapters) {
      const chapterUid = Number(item?.chapterUid)
      if (!Number.isInteger(chapterUid) || chapterUid <= 0) continue
      const paragraphs = Array.isArray(item?.paragraphs)
        ? item.paragraphs.map(asParagraph).filter((line) => line.length > 0)
        : []
      chapters.push({
        chapterUid,
        title: asText(item?.title) || '第 ' + chapterUid + ' 章',
        paragraphs,
      })
    }
    chapters.sort((a, b) => a.chapterUid - b.chapterUid)
    return {
      bookId: typeof raw.bookId === 'string' ? raw.bookId : bookId,
      title: asText(raw.title),
      author: asText(raw.author),
      format: normalizeFormat(raw.format),
      importedAt: asCount(raw.importedAt),
      chapters,
    }
  }

  /**
   * List every imported book, newest first, without any chapter text.
   * @returns { books: bookRecord[] }
   */
  async list() {
    const books = await this.readIndex()
    books.sort((a, b) => b.importedAt - a.importedAt || a.bookId.localeCompare(b.bookId))
    return { books }
  }

  /**
   * Import one file: parse it, write its body, then update the index.
   *
   * Re-importing the same file replaces the previous body and refreshes
   * importedAt, so the library holds exactly one copy.
   *
   * @param options - the file to import.
   * @param options.buffer - the raw file bytes.
   * @param options.filename - the name shown to the user and hashed into the id.
   * @returns the stored book record.
   */
  async import({ buffer, filename } = {}) {
    if (buffer === undefined || buffer === null) {
      throw new TypeError('导入本地书籍需要 buffer。')
    }
    const name = typeof filename === 'string' && filename.trim().length > 0 ? filename.trim() : 'book.txt'
    const parse = await this.resolveParse()
    const parsed = await parse({ buffer, filename: name })
    const book = normalizeParsedBook(parsed, name)
    const bookId = localBookId(name, book.title, book.charCount)

    return this.exclusive(async () => {
      const books = await this.readIndex()
      // Keep importedAt strictly increasing so a newest-first list stays
      // deterministic even when two imports land in the same millisecond.
      let importedAt = Date.now()
      for (const item of books) {
        if (item.importedAt >= importedAt) importedAt = item.importedAt + 1
      }
      const record = {
        bookId,
        title: book.title,
        author: book.author,
        format: book.format,
        chapterCount: book.chapters.length,
        charCount: book.charCount,
        importedAt,
        source: 'local',
      }
      await writeJsonAtomic(this.bodyPath(bookId), {
        bookId,
        title: book.title,
        author: book.author,
        format: book.format,
        importedAt,
        chapters: book.chapters,
      })
      const next = books.filter((item) => item.bookId !== bookId)
      next.push(record)
      await this.writeIndex(next)
      return record
    })
  }

  /**
   * Remove one book: its index entry first, then its body.
   * @param bookId - the book to drop.
   * @returns whether the index listed it.
   */
  async remove(bookId) {
    if (typeof bookId !== 'string' || !BOOK_ID_PATTERN.test(bookId)) return false
    return this.exclusive(async () => {
      const books = await this.readIndex()
      const next = books.filter((item) => item.bookId !== bookId)
      const listed = next.length !== books.length
      if (listed) await this.writeIndex(next)
      // The body goes even when the index had already lost the entry.
      await rm(this.bodyPath(bookId), { force: true }).catch(() => {})
      return listed
    })
  }

  /**
   * Read one book's catalog, never its text.
   * @param bookId - the book to describe.
   * @returns the book without chapter text, or undefined when unknown.
   */
  async book(bookId) {
    if (typeof bookId !== 'string' || !BOOK_ID_PATTERN.test(bookId)) return undefined
    const record = (await this.readIndex()).find((item) => item.bookId === bookId)
    const body = await this.readBody(bookId)
    if (record === undefined && body === undefined) return undefined
    const chapters = body?.chapters ?? []
    let charCount = 0
    for (const chapter of chapters) {
      for (const paragraph of chapter.paragraphs) charCount += paragraph.length
    }
    return {
      bookId,
      title: body?.title || record?.title || '',
      author: body?.author || record?.author || '',
      format: body?.format ?? record?.format ?? 'txt',
      chapters: toCatalog(chapters),
      chapterCount: body !== undefined ? chapters.length : record?.chapterCount ?? 0,
      charCount: body !== undefined ? charCount : record?.charCount ?? 0,
      importedAt: body?.importedAt || record?.importedAt || 0,
    }
  }

  /**
   * Read one chapter with its neighbours, for the panel's reader.
   * @param bookId - the book to read.
   * @param chapterUid - the chapter handle returned by book().
   * @returns the chapter, its catalog and previous/next, or undefined.
   */
  async chapter(bookId, chapterUid) {
    if (typeof bookId !== 'string' || !BOOK_ID_PATTERN.test(bookId)) return undefined
    const uid = Number(chapterUid)
    if (!Number.isInteger(uid) || uid <= 0) return undefined
    const body = await this.readBody(bookId)
    if (body === undefined) return undefined
    const chapters = body.chapters
    const index = chapters.findIndex((item) => item.chapterUid === uid)
    if (index < 0) return undefined
    const catalog = toCatalog(chapters)
    return {
      bookId,
      book: {
        bookId,
        title: body.title,
        author: body.author,
        format: body.format,
      },
      chapterUid: uid,
      title: chapters[index].title,
      paragraphs: chapters[index].paragraphs.slice(),
      chapterIdx: index,
      chapterCount: chapters.length,
      previous: catalog[index - 1],
      next: catalog[index + 1],
      chapters: catalog,
    }
  }
}
