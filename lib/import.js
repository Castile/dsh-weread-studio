/**
 * Zero-dependency EPUB / TXT book import.
 *
 * The host plugin hands us the raw bytes of a file the user picked. We must
 * turn them into chapters without pulling in any npm package: Node's own zlib
 * handles deflate, and the ZIP container is parsed by hand.
 *
 * Supported input: unencrypted EPUB 2/3 (non-ZIP64) and plain text in UTF-8,
 * GB18030 or UTF-16LE.
 */

import { inflateRawSync } from 'node:zlib'
import { Buffer } from 'node:buffer'
import { TextDecoder } from 'node:util'

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const EOCD_MIN_SIZE = 22
const MAX_ZIP_COMMENT = 0xffff
const CHUNK_SIZE = 3000

/* -------------------------------------------------------------------------- */
/* byte helpers                                                               */
/* -------------------------------------------------------------------------- */

/** Accept Buffer / Uint8Array / ArrayBuffer and return a Buffer view. */
function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  if (input instanceof ArrayBuffer) return Buffer.from(input)
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  throw new TypeError('buffer 必须是 Buffer / Uint8Array / ArrayBuffer')
}

/** Strip a leading U+FEFF left over from a UTF-8 BOM. */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** Read encoding="..." from an XML prolog, restricted to known labels. */
function sniffXmlEncoding(buffer) {
  const head = buffer.subarray(0, 256).toString('latin1')
  const match = /encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head)
  if (!match) return null
  const label = match[1].toLowerCase()
  const allowed = /^(utf-8|utf8|gbk|gb2312|gb18030|big5|euc-jp|shift_jis|iso-8859-1|windows-1252)$/
  return allowed.test(label) ? label : null
}

/**
 * Decode a text payload: strict UTF-8 first, then the encoding declared in an
 * XML prolog, then GB18030 (the common legacy Chinese encoding).
 */
function decodeText(input) {
  const buffer = toBuffer(input)
  if (buffer.length === 0) return ''
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer.subarray(2))
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(3))
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    // not valid UTF-8 - fall through to the declared / legacy encodings.
  }
  const declared = sniffXmlEncoding(buffer)
  if (declared !== null && declared !== 'utf-8' && declared !== 'utf8') {
    try {
      return new TextDecoder(declared).decode(buffer)
    } catch {
      // label unknown to this Node build - keep falling back.
    }
  }
  try {
    return new TextDecoder('gb18030').decode(buffer)
  } catch {
    return new TextDecoder('latin1').decode(buffer)
  }
}

/* -------------------------------------------------------------------------- */
/* entity / markup helpers                                                    */
/* -------------------------------------------------------------------------- */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  middot: '·',
  copy: '©',
}

function safeCodePoint(code) {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '\uFFFD'
  try {
    return String.fromCodePoint(code)
  } catch {
    return '\uFFFD'
  }
}

/** Decode numeric and the handful of named entities XHTML books actually use. */
function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec) => safeCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]{1,8});/g, (match, name) => {
      const key = name.toLowerCase()
      return Object.hasOwn(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : match
    })
}

/** Flatten inline markup, unwrap CDATA and decode entities into one line. */
function cleanText(value) {
  const unwrapped = String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
  return decodeEntities(unwrapped)
    .replace(/[\s\u3000]+/gu, ' ')
    .trim()
}

/**
 * Flatten chapter XHTML into readable paragraphs.
 *
 * Same contract as lib/reader.js#htmlToParagraphs: block level tags end a
 * paragraph, every remaining tag is dropped, and the result is plain text so
 * the panel never needs a sanitizer.
 * @param html - decoded chapter XHTML.
 * @returns one string per non-empty paragraph.
 */
function htmlToParagraphs(html) {
  // A <p> in a real EPUB wraps across source lines, so a literal newline is
  // formatting, not a paragraph break. Block boundaries and <br> are marked
  // with a sentinel instead, which survives whitespace collapsing.
  const BREAK = '\u0000'
  const text = String(html ?? '')
    .replace(/\u0000/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, BREAK)
    .replace(/<hr\s*\/?>/gi, BREAK)
    .replace(
      /<\/(p|div|h[1-6]|li|blockquote|section|article|tr|td|th|pre|dd|dt|figure|figcaption|table|ul|ol|caption)>/gi,
      BREAK,
    )
    .replace(/<[^>]*>/g, ' ')
  return decodeEntities(text)
    .replace(/[\s\u3000]+/gu, ' ')
    .split(BREAK)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/** Read one attribute out of a raw tag attribute string. */
function getAttribute(attrs, name) {
  const pattern = new RegExp(
    '(?:^|\\s)(?:[\\w.-]+:)?' + name + '\\s*=\\s*(?:"([^"]*)"|' + "'([^']*)'" + ')',
    'i',
  )
  const match = pattern.exec(attrs)
  if (!match) return null
  return match[1] ?? match[2] ?? ''
}

/* -------------------------------------------------------------------------- */
/* ZIP reader                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Locate the End Of Central Directory record.
 *
 * The record sits in the last 64KB of the file (its comment field can be up to
 * 0xffff bytes, hence the 22 + 65535 window).
 */
function findEndOfCentralDirectory(buffer) {
  if (buffer.length < EOCD_MIN_SIZE) return -1
  const stop = Math.max(0, buffer.length - (MAX_ZIP_COMMENT + EOCD_MIN_SIZE))
  for (let offset = buffer.length - EOCD_MIN_SIZE; offset >= stop; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== EOCD_SIGNATURE) continue
    const commentLength = buffer.readUInt16LE(offset + 20)
    if (offset + EOCD_MIN_SIZE + commentLength <= buffer.length) return offset
  }
  return -1
}

/** Decode a ZIP entry name: UTF-8 when flagged, else UTF-8 if it validates. */
function decodeZipName(bytes, flags) {
  if ((flags & 0x0800) !== 0) return bytes.toString('utf8')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return bytes.toString('latin1')
  }
}

/** Walk the central directory and return one record per stored entry. */
function readZipDirectory(buffer) {
  if (buffer.length < EOCD_MIN_SIZE) {
    throw new Error('无法解析 EPUB：文件太小，不是有效的 ZIP 容器')
  }
  const eocd = findEndOfCentralDirectory(buffer)
  if (eocd < 0) {
    throw new Error('无法解析 EPUB：没有找到 ZIP 中央目录结束记录（EOCD），文件可能已损坏或不是 EPUB')
  }
  const entryCount = buffer.readUInt16LE(eocd + 10)
  const centralSize = buffer.readUInt32LE(eocd + 12)
  const centralOffset = buffer.readUInt32LE(eocd + 16)
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('不支持 ZIP64 格式的 EPUB：中央目录使用了 ZIP64 扩展字段')
  }
  if (centralOffset + 4 > buffer.length) {
    throw new Error('无法解析 EPUB：中央目录偏移超出文件范围')
  }

  const entries = []
  let cursor = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error('无法解析 EPUB：ZIP 中央目录记录损坏')
    }
    const flags = buffer.readUInt16LE(cursor + 8)
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const nameStart = cursor + 46
    const nameEnd = nameStart + nameLength
    if (nameEnd > buffer.length) {
      throw new Error('无法解析 EPUB：ZIP 条目名超出文件范围')
    }
    const name = decodeZipName(buffer.subarray(nameStart, nameEnd), flags)
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('不支持 ZIP64 格式的 EPUB：条目 ' + name + ' 使用了 ZIP64 扩展字段')
    }
    if (!name.endsWith('/')) {
      entries.push({ name, method, flags, compressedSize, uncompressedSize, localOffset })
    }
    cursor = nameEnd + extraLength + commentLength
  }
  return entries
}

/** Extract (and inflate, if needed) the payload of one central-directory entry. */
function readZipEntryData(buffer, entry) {
  const name = entry.name
  const localOffset = entry.localOffset
  if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
    throw new Error('无法解析 EPUB：条目 ' + name + ' 的本地文件头损坏')
  }
  if ((entry.flags & 0x0001) !== 0) {
    throw new Error('不支持加密的 ZIP 条目：' + name + '（本模块无法读取带密码或 DRM 的 EPUB）')
  }
  const nameLength = buffer.readUInt16LE(localOffset + 26)
  const extraLength = buffer.readUInt16LE(localOffset + 28)
  const dataStart = localOffset + 30 + nameLength + extraLength
  const dataEnd = dataStart + entry.compressedSize
  if (dataEnd > buffer.length) {
    throw new Error('无法解析 EPUB：条目 ' + name + ' 的数据超出文件范围')
  }
  const raw = buffer.subarray(dataStart, dataEnd)
  if (entry.method === 0) return Buffer.from(raw)
  if (entry.method === 8) {
    try {
      return inflateRawSync(raw)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error('无法解压 EPUB 条目 ' + name + '：' + reason)
    }
  }
  throw new Error(
    'unsupported zip method: ' +
      entry.method +
      '（不支持的 ZIP 压缩方式，条目 ' +
      name +
      '；目前仅支持 0=stored 与 8=deflate）',
  )
}

/** Collapse "./", "//" and ".." segments of an archive path. */
function normalizeArchivePath(path) {
  const parts = []
  for (const segment of String(path).replace(/\\/g, '/').split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  return parts.join('/')
}

function dirname(path) {
  const normalized = normalizeArchivePath(path)
  const index = normalized.lastIndexOf('/')
  return index < 0 ? '' : normalized.slice(0, index)
}

/** Decode and resolve an OPF-relative href against the OPF's own directory. */
function resolveHref(baseDir, href) {
  const cleaned = String(href).split('#')[0].split('?')[0].trim()
  const decoded = cleaned
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })
    .join('/')
  const relative = decoded.startsWith('/')
    ? decoded.slice(1)
    : baseDir === ''
      ? decoded
      : baseDir + '/' + decoded
  return normalizeArchivePath(relative)
}

/** Tiny read-only view over the ZIP, with tolerant name lookup. */
class ZipArchive {
  constructor(buffer) {
    this.buffer = buffer
    this.entries = readZipDirectory(buffer)
    this.index = new Map()
    for (const entry of this.entries) this.index.set(normalizeArchivePath(entry.name), entry)
  }

  /** Exact match, then case-insensitive, then suffix match. */
  find(path) {
    const wanted = normalizeArchivePath(path)
    if (wanted === '') return null
    const direct = this.index.get(wanted)
    if (direct) return direct
    const lower = wanted.toLowerCase()
    for (const [key, entry] of this.index) {
      if (key.toLowerCase() === lower) return entry
    }
    for (const [key, entry] of this.index) {
      if (key.toLowerCase().endsWith('/' + lower)) return entry
    }
    return null
  }

  /** Read an entry, or null when the archive does not contain it. */
  read(path) {
    const entry = this.find(path)
    return entry ? readZipEntryData(this.buffer, entry) : null
  }

  /** Read a required entry, throwing a Chinese explanation when missing. */
  readRequired(path, label) {
    const entry = this.find(path)
    if (!entry) {
      const what = label === undefined ? '必需文件' : label
      throw new Error('EPUB 结构无效：缺少' + what + ' ' + path)
    }
    return readZipEntryData(this.buffer, entry)
  }
}

/* -------------------------------------------------------------------------- */
/* EPUB                                                                       */
/* -------------------------------------------------------------------------- */

function parseOpfManifest(opfXml) {
  const items = new Map()
  for (const match of opfXml.matchAll(/<item\b([^>]*?)\/?>/gi)) {
    const attrs = match[1]
    const id = getAttribute(attrs, 'id')
    const href = getAttribute(attrs, 'href')
    if (!id || !href) continue
    items.set(id, { id, href, mediaType: getAttribute(attrs, 'media-type') ?? '' })
  }
  return items
}

function parseOpfSpine(opfXml) {
  const order = []
  for (const match of opfXml.matchAll(/<itemref\b([^>]*?)\/?>/gi)) {
    const idref = getAttribute(match[1], 'idref')
    if (idref) order.push(idref)
  }
  return order
}

/** First <dc:title>/<dc:creator>-style value from the package document. */
function parseMetadataField(opfXml, name) {
  const prefix = '(?:[\\w.-]+:)?'
  const pattern = new RegExp('<' + prefix + name + '\\b[^>]*>([\\s\\S]*?)</' + prefix + name + '\\s*>', 'i')
  const match = pattern.exec(opfXml)
  return match ? cleanText(match[1]) : ''
}

/** Chapter heading: <title>, else the first h1-h3, else "第 N 章". */
function chapterTitle(html, index) {
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)
  const fromTitle = titleMatch ? cleanText(titleMatch[1]) : ''
  if (fromTitle) return fromTitle
  const headingMatch = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1\s*>/i.exec(html)
  const fromHeading = headingMatch ? cleanText(headingMatch[2]) : ''
  if (fromHeading) return fromHeading
  return '第 ' + index + ' 章'
}

function basenameWithoutExtension(filename) {
  if (typeof filename !== 'string') return ''
  const segments = filename.replace(/\\/g, '/').split('/')
  const base = segments[segments.length - 1] ?? ''
  return base.replace(/\.[^.]+$/u, '').trim()
}

/**
 * Parse an EPUB container.
 * @param buffer - raw file bytes.
 * @param filename - optional original name, used as a title fallback.
 */
export function parseEpub(buffer, filename) {
  const data = toBuffer(buffer)
  const archive = new ZipArchive(data)

  const containerXml = decodeText(archive.readRequired('META-INF/container.xml', 'EPUB 容器描述文件'))
  const rootfileMatch = /<rootfile\b([^>]*?)\/?>/i.exec(containerXml)
  if (!rootfileMatch) {
    throw new Error('EPUB 结构无效：container.xml 中没有 rootfile 的 full-path 声明')
  }
  const rawOpfPath = getAttribute(rootfileMatch[1], 'full-path')
  const opfPath = rawOpfPath ? normalizeArchivePath(decodeEntities(rawOpfPath)) : ''
  if (opfPath === '') {
    throw new Error('EPUB 结构无效：container.xml 中的 rootfile 缺少 full-path 属性')
  }

  const opfBuffer = archive.read(opfPath)
  if (!opfBuffer) {
    throw new Error('EPUB 结构无效：找不到 OPF 包文件 ' + opfPath)
  }
  const opfXml = decodeText(opfBuffer)
  const title = parseMetadataField(opfXml, 'title')
  const author = parseMetadataField(opfXml, 'creator')

  const manifest = parseOpfManifest(opfXml)
  const spine = parseOpfSpine(opfXml)
  const baseDir = dirname(opfPath)

  const chapters = []
  /** First spine document, kept so an all-empty book still yields one chapter. */
  let emptyChapter = null

  spine.forEach((idref, index) => {
    const item = manifest.get(idref)
    if (!item) return
    const mediaType = item.mediaType.toLowerCase()
    if (mediaType !== '' && !mediaType.includes('html') && !mediaType.includes('xml')) return
    const target = resolveHref(baseDir, item.href)
    const raw = archive.read(target)
    if (!raw) return
    const html = decodeText(raw)
    const paragraphs = htmlToParagraphs(html)
    if (paragraphs.length === 0) {
      if (emptyChapter === null) {
        emptyChapter = { title: chapterTitle(html, index + 1), paragraphs: [] }
      }
      return
    }
    chapters.push({ title: chapterTitle(html, index + 1), paragraphs })
  })

  if (chapters.length === 0) {
    chapters.push(emptyChapter ?? { title: '正文', paragraphs: [] })
  }

  return {
    title: title || basenameWithoutExtension(filename) || '未命名',
    author,
    format: 'epub',
    chapters,
  }
}

/* -------------------------------------------------------------------------- */
/* TXT                                                                        */
/* -------------------------------------------------------------------------- */

const CHAPTER_HEADING =
  /^\s*(第[一二三四五六七八九十百千零〇0-9]+[章节回卷篇]|Chapter\s+\d+|CHAPTER\s+[IVXLC0-9]+)/
const SHORT_HEADING = /^\s*(序章|楔子|前言|后记|尾声|目录)/
const MAX_HEADING_LENGTH = 40

/** True when a line looks like a chapter heading rather than body text. */
function isChapterHeading(line) {
  if (line.length > 200) return false
  if (CHAPTER_HEADING.test(line)) return true
  return line.length <= MAX_HEADING_LENGTH && SHORT_HEADING.test(line)
}

/** Split into lines, normalising CRLF and lone CR. */
function splitLines(text) {
  return text.replace(/\r\n?/g, '\n').split('\n')
}

/** Strip leading/trailing blanks only: a TXT line is kept as written. */
function trimmed(line) {
  return line.replace(/^[\s\u3000]+/u, '').replace(/[\s\u3000]+$/u, '')
}

/** Split a heading-less book into fixed-size chunks (spec fallback). */
function chunkParagraphs(lines) {
  const chunks = []
  let current = []
  let length = 0
  const flush = () => {
    if (current.length === 0) return
    chunks.push(current)
    current = []
    length = 0
  }
  for (const line of lines) {
    const value = trimmed(line)
    if (value === '') {
      flush()
      continue
    }
    current.push(value)
    length += value.length
    if (length >= CHUNK_SIZE) flush()
  }
  flush()
  return chunks
}

/**
 * Parse a plain text book.
 * @param buffer - raw file bytes (UTF-8 / GB18030 / UTF-16LE).
 * @param filename - original name, used for the title.
 */
export function parseTxt(buffer, filename) {
  const text = stripBom(decodeText(toBuffer(buffer)))
  const lines = splitLines(text)

  const headingIndexes = []
  lines.forEach((line, index) => {
    const value = trimmed(line)
    if (value !== '' && isChapterHeading(value)) headingIndexes.push(index)
  })

  const chapters = []
  if (headingIndexes.length > 0) {
    const preface = lines.slice(0, headingIndexes[0]).map(trimmed).filter((line) => line !== '')
    if (preface.length > 0) chapters.push({ title: '正文', paragraphs: preface })
    headingIndexes.forEach((start, position) => {
      const end = position + 1 < headingIndexes.length ? headingIndexes[position + 1] : lines.length
      const paragraphs = lines
        .slice(start + 1, end)
        .map(trimmed)
        .filter((line) => line !== '')
      chapters.push({ title: trimmed(lines[start]), paragraphs })
    })
  } else {
    chunkParagraphs(lines).forEach((paragraphs, index) => {
      chapters.push({ title: '正文 ' + (index + 1), paragraphs })
    })
  }

  if (chapters.length === 0) chapters.push({ title: '正文 1', paragraphs: [] })

  return {
    title: basenameWithoutExtension(filename) || '未命名',
    author: '',
    format: 'txt',
    chapters,
  }
}

/* -------------------------------------------------------------------------- */
/* public entry points                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Sniff the container format from the ZIP magic or the .epub extension.
 * @returns 'epub' or 'txt'.
 */
export function sniffFormat(buffer, filename) {
  if (buffer !== undefined && buffer !== null) {
    const data = toBuffer(buffer)
    const isZip =
      data.length >= 4 &&
      data[0] === 0x50 &&
      data[1] === 0x4b &&
      (data[2] === 0x03 || data[2] === 0x05 || data[2] === 0x07) &&
      (data[3] === 0x04 || data[3] === 0x06 || data[3] === 0x08)
    if (isZip) return 'epub'
  }
  if (typeof filename === 'string' && /\.epub\s*$/i.test(filename)) return 'epub'
  return 'txt'
}

/**
 * Parse a picked book file into the host's chapter shape.
 * @param options.buffer - raw file bytes.
 * @param options.filename - original file name.
 */
export async function parseBookFile({ buffer, filename } = {}) {
  const data = toBuffer(buffer)
  const format = sniffFormat(data, filename)
  return format === 'epub' ? parseEpub(data, filename) : parseTxt(data, filename)
}
