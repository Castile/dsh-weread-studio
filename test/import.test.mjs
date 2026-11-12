import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { deflateRawSync } from 'node:zlib'
import { TextDecoder } from 'node:util'
import { parseBookFile, parseEpub, parseTxt, sniffFormat } from '../lib/import.js'

/* -------------------------------------------------------------------------- */
/* fixture helpers: a minimal, dependency-free ZIP writer                      */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * Build a ZIP archive in memory.
 * @param entries - [{ name, data, method? }] stored (0) unless method is 8.
 * @param options.deflate - force method 8 for every entry.
 * @param options.entryCountOverride - patch the EOCD entry count (ZIP64 probe).
 */
function buildZip(entries, options = {}) {
  const locals = []
  const centrals = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8')
    const method = options.deflate === true ? 8 : (entry.method ?? 0)
    const payload = method === 8 ? deflateRawSync(raw) : raw
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBytes, payload)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBytes)

    offset += local.length + nameBytes.length + payload.length
  }

  const centralBuffer = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(options.entryCountOverride ?? entries.length, 10)
  eocd.writeUInt32LE(centralBuffer.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...locals, centralBuffer, eocd])
}

const CONTAINER_XML =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n' +
  '  <rootfiles>\n' +
  '    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n' +
  '  </rootfiles>\n' +
  '</container>'

const OPF_XML =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">\n' +
  '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
  '    <dc:identifier id="bookid">urn:uuid:test-book</dc:identifier>\n' +
  '    <dc:title>测试 &amp; 之书</dc:title>\n' +
  '    <dc:creator><![CDATA[张三]]></dc:creator>\n' +
  '    <dc:language>zh-CN</dc:language>\n' +
  '  </metadata>\n' +
  '  <manifest>\n' +
  '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n' +
  '    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>\n' +
  '    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>\n' +
  '  </manifest>\n' +
  '  <spine>\n' +
  '    <itemref idref="ch1"/>\n' +
  '    <itemref idref="ch2"/>\n' +
  '  </spine>\n' +
  '</package>'

const CH1_XHTML =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<html xmlns="http://www.w3.org/1999/xhtml">\n' +
  '<head><title>第一章 起</title></head>\n' +
  '<body>\n' +
  '  <h1>第一章 起</h1>\n' +
  '  <p>汤姆 &amp; 杰瑞</p>\n' +
  '  <p>  3 &lt; 5 &gt; 1  </p>\n' +
  '  <p>他说：&#39;你好&#39;</p>\n' +
  '  <p>空白&nbsp;间隔</p>\n' +
  '  <p>&#31532;&#19968;&#31456;</p>\n' +
  '  <div>第一行<br/>第二行</div>\n' +
  '  <script>alert(1)</script>\n' +
  '  <p>   </p>\n' +
  '</body>\n' +
  '</html>'

const CH2_XHTML =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<html xmlns="http://www.w3.org/1999/xhtml">\n' +
  '<body>\n' +
  '  <h2>第二章 承</h2>\n' +
  '  <p>第二章的正文。</p>\n' +
  '</body>\n' +
  '</html>'

function epubEntries(overrides = {}) {
  return [
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: CONTAINER_XML },
    { name: 'OEBPS/content.opf', data: OPF_XML },
    { name: 'OEBPS/ch1.xhtml', data: CH1_XHTML },
    { name: 'OEBPS/ch2.xhtml', data: CH2_XHTML },
  ].map((entry) => ({ ...entry, ...(overrides[entry.name] ?? {}) }))
}

function makeEpub(overrides = {}) {
  return buildZip(epubEntries(overrides))
}

/* -------------------------------------------------------------------------- */
/* EPUB                                                                       */
/* -------------------------------------------------------------------------- */

test('parseEpub: reads title, author and both spine chapters', () => {
  const book = parseEpub(makeEpub())

  assert.equal(book.format, 'epub')
  assert.equal(book.title, '测试 & 之书')
  assert.equal(book.author, '张三')
  assert.equal(book.chapters.length, 2)
  assert.equal(book.chapters[0].title, '第一章 起')
  assert.equal(book.chapters[1].title, '第二章 承')
})

test('parseEpub: decodes entities and splits block elements into paragraphs', () => {
  const [first] = parseEpub(makeEpub()).chapters

  assert.deepEqual(first.paragraphs, [
    '第一章 起',
    '汤姆 & 杰瑞',
    '3 < 5 > 1',
    "他说：'你好'",
    '空白 间隔',
    '第一章',
    '第一行',
    '第二行',
  ])
})

test('parseEpub: honours spine order even when the manifest lists nav first', () => {
  const book = parseEpub(makeEpub())
  assert.deepEqual(
    book.chapters.map((chapter) => chapter.title),
    ['第一章 起', '第二章 承'],
  )
})

test('parseEpub: inflates deflate (method 8) entries', () => {
  const book = parseEpub(buildZip(epubEntries(), { deflate: true }))
  assert.equal(book.chapters.length, 2)
  assert.equal(book.chapters[0].paragraphs[1], '汤姆 & 杰瑞')
})

test('parseEpub: resolves ../ and percent-encoded hrefs against the OPF directory', () => {
  const nestedOpf =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<package xmlns="http://www.idpf.org/2007/opf" version="2.0">\n' +
    '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
    '    <dc:title>相对路径</dc:title>\n' +
    '  </metadata>\n' +
    '  <manifest>\n' +
    '    <item id="a" href="../Text/ch%201.xhtml" media-type="application/xhtml+xml"/>\n' +
    '    <item id="b" href="../Text/ch 2.xhtml" media-type="application/xhtml+xml"/>\n' +
    '  </manifest>\n' +
    '  <spine>\n' +
    '    <itemref idref="a"/>\n' +
    '    <itemref idref="b"/>\n' +
    '  </spine>\n' +
    '</package>'
  const container =
    '<container><rootfiles><rootfile full-path="OEBPS/package/book.opf"/></rootfiles></container>'
  const archive = buildZip([
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: container },
    { name: 'OEBPS/package/book.opf', data: nestedOpf },
    { name: 'OEBPS/Text/ch 1.xhtml', data: '<html><body><p>空格编码</p></body></html>' },
    { name: 'OEBPS/Text/ch 2.xhtml', data: '<html><body><p>裸空格</p></body></html>' },
  ])

  const book = parseEpub(archive)
  assert.equal(book.title, '相对路径')
  assert.equal(book.chapters.length, 2)
  assert.deepEqual(
    book.chapters.map((chapter) => chapter.paragraphs[0]),
    ['空格编码', '裸空格'],
  )
})

test('parseEpub: a <p> wrapped across source lines stays one paragraph', () => {
  const wrapped =
    '<html><head><title>软换行</title></head><body>\n' +
    '  <p>这是一段\n  被源码换行拆开的\n  正文。</p>\n' +
    '  <p>另一段  <span>带行内标签</span> 的文字。</p>\n' +
    '</body></html>'
  const archive = buildZip(epubEntries({ 'OEBPS/ch1.xhtml': { data: wrapped } }))

  const [chapter] = parseEpub(archive).chapters
  assert.deepEqual(chapter.paragraphs, ['这是一段 被源码换行拆开的 正文。', '另一段 带行内标签 的文字。'])
})

test('parseEpub: chapter title falls back to h2 then 第 N 章', () => {
  const noTitle =
    '<html><body><h2>小节标题</h2><p>正文</p></body></html>'
  const noHeading = '<html><body><p>只有正文</p></body></html>'
  const opf =
    '<package><metadata><dc:title>T</dc:title></metadata><manifest>' +
    '<item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>' +
    '<item id="b" href="b.xhtml" media-type="application/xhtml+xml"/>' +
    '</manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>'
  const archive = buildZip([
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: CONTAINER_XML },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/a.xhtml', data: noTitle },
    { name: 'OEBPS/b.xhtml', data: noHeading },
  ])

  assert.deepEqual(
    parseEpub(archive).chapters.map((chapter) => chapter.title),
    ['小节标题', '第 2 章'],
  )
})

test('parseTxt: keeps a line as written, only trimming its edges', () => {
  const book = parseTxt(Buffer.from('第一章 A\n  缩进的   一段  文字  \n', 'utf8'), 'x.txt')
  assert.deepEqual(book.chapters[0].paragraphs, ['缩进的   一段  文字'])
})

test('parseEpub: keeps at least one chapter when every spine item is empty', () => {
  const emptyOpf =
    '<package><metadata><dc:title>空书</dc:title></metadata>' +
    '<manifest><item id="e" href="empty.xhtml" media-type="application/xhtml+xml"/></manifest>' +
    '<spine><itemref idref="e"/></spine></package>'
  const archive = buildZip([
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: CONTAINER_XML },
    { name: 'OEBPS/content.opf', data: emptyOpf },
    { name: 'OEBPS/empty.xhtml', data: '<html><head><title>空章</title></head><body> </body></html>' },
  ])

  const book = parseEpub(archive)
  assert.equal(book.chapters.length, 1)
  assert.equal(book.chapters[0].title, '空章')
  assert.deepEqual(book.chapters[0].paragraphs, [])
})

test('parseEpub: unsupported compression method raises a Chinese error', () => {
  const archive = buildZip(epubEntries({ 'OEBPS/ch1.xhtml': { method: 12 } }))
  assert.throws(() => parseEpub(archive), /unsupported zip method: 12/)
})

test('parseEpub: ZIP64 sentinel in the EOCD is rejected explicitly', () => {
  const archive = buildZip(epubEntries(), { entryCountOverride: 0xffff })
  assert.throws(() => parseEpub(archive), /ZIP64/)
})

test('parseEpub: missing container.xml is reported, not swallowed', () => {
  const archive = buildZip([{ name: 'mimetype', data: 'application/epub+zip' }])
  assert.throws(() => parseEpub(archive), /container\.xml/)
})

test('parseEpub: non-ZIP bytes are reported as an unreadable container', () => {
  assert.throws(() => parseEpub(Buffer.from('这不是压缩包', 'utf8')), /ZIP|EOCD/)
})

/* -------------------------------------------------------------------------- */
/* TXT                                                                        */
/* -------------------------------------------------------------------------- */

test('parseTxt: splits an UTF-8 book on chapter headings', () => {
  const text =
    '第一章 初见\n' +
    '他推开门。\n' +
    '\n' +
    '屋里没有人。\n' +
    '第二章 重逢\n' +
    '三年后。\n'

  const book = parseTxt(Buffer.from(text, 'utf8'), '我的小说.txt')

  assert.equal(book.format, 'txt')
  assert.equal(book.title, '我的小说')
  assert.equal(book.author, '')
  assert.equal(book.chapters.length, 2)
  assert.equal(book.chapters[0].title, '第一章 初见')
  assert.deepEqual(book.chapters[0].paragraphs, ['他推开门。', '屋里没有人。'])
  assert.equal(book.chapters[1].title, '第二章 重逢')
  assert.deepEqual(book.chapters[1].paragraphs, ['三年后。'])
})

test('parseTxt: recognises 序章/楔子 and Chapter N headings', () => {
  const text = '楔子\n很久以前。\nChapter 1\nThe beginning.\n'
  const book = parseTxt(Buffer.from(text, 'utf8'), 'x.txt')

  assert.deepEqual(
    book.chapters.map((chapter) => chapter.title),
    ['楔子', 'Chapter 1'],
  )
})

test('parseTxt: a long heading-less book becomes fixed-size chunks', () => {
  const line = '字'.repeat(500)
  const lines = []
  for (let i = 0; i < 20; i += 1) lines.push(line)
  const book = parseTxt(Buffer.from(lines.join('\n'), 'utf8'), '无标题.txt')

  assert.ok(book.chapters.length > 1, 'expected several chunks, got ' + book.chapters.length)
  assert.match(book.chapters[0].title, /^正文 1$/)
  assert.match(book.chapters[1].title, /^正文 2$/)
  const total = book.chapters.reduce((sum, chapter) => sum + chapter.paragraphs.length, 0)
  assert.equal(total, lines.length)
})

test('parseTxt: heading-less short text stays a single chunk', () => {
  const book = parseTxt(Buffer.from('只有一行。\n又一行。\n', 'utf8'), 'a.txt')
  assert.equal(book.chapters.length, 1)
  assert.equal(book.chapters[0].title, '正文 1')
  assert.deepEqual(book.chapters[0].paragraphs, ['只有一行。', '又一行。'])
})

test('parseTxt: strips a UTF-8 BOM and normalises CRLF', () => {
  const bytes = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('第一章 A\r\n正文甲\r\n', 'utf8'),
  ])
  const book = parseTxt(bytes, 'bom.txt')

  assert.equal(book.chapters.length, 1)
  assert.equal(book.chapters[0].title, '第一章 A')
  assert.deepEqual(book.chapters[0].paragraphs, ['正文甲'])
})

test('parseTxt: falls back to GB18030 when the bytes are not valid UTF-8', () => {
  // 第一章 开始 encoded as GB18030.
  const gbk = Buffer.from('b5dad2bbd5c220bfaacabc', 'hex')
  assert.equal(new TextDecoder('gb18030').decode(gbk), '第一章 开始')

  const book = parseTxt(Buffer.concat([gbk, Buffer.from('\r\n', 'latin1')]), 'gbk.txt')
  assert.equal(book.chapters[0].title, '第一章 开始')
})

/* -------------------------------------------------------------------------- */
/* sniffFormat / parseBookFile                                                */
/* -------------------------------------------------------------------------- */

test('sniffFormat: ZIP magic wins, then the .epub extension', () => {
  assert.equal(sniffFormat(makeEpub(), 'whatever.bin'), 'epub')
  assert.equal(sniffFormat(Buffer.from('纯文本', 'utf8'), 'book.epub'), 'epub')
  assert.equal(sniffFormat(Buffer.from('纯文本', 'utf8'), 'book.txt'), 'txt')
  assert.equal(sniffFormat(Buffer.from('纯文本', 'utf8')), 'txt')
  assert.equal(sniffFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), 'a.txt'), 'epub')
})

test('parseBookFile: dispatches on the sniffed format', async () => {
  const epub = await parseBookFile({ buffer: makeEpub(), filename: 'book.epub' })
  assert.equal(epub.format, 'epub')
  assert.equal(epub.title, '测试 & 之书')

  const txt = await parseBookFile({
    buffer: Buffer.from('第一章 一\n内容\n', 'utf8'),
    filename: 'plain.txt',
  })
  assert.equal(txt.format, 'txt')
  assert.equal(txt.title, 'plain')
  assert.equal(txt.chapters[0].title, '第一章 一')
})

test('parseBookFile: result shape is exactly the host contract', async () => {
  const book = await parseBookFile({ buffer: makeEpub(), filename: 'book.epub' })
  assert.deepEqual(Object.keys(book).sort(), ['author', 'chapters', 'format', 'title'])
  for (const chapter of book.chapters) {
    assert.deepEqual(Object.keys(chapter).sort(), ['paragraphs', 'title'])
    for (const paragraph of chapter.paragraphs) {
      assert.equal(typeof paragraph, 'string')
      assert.equal(paragraph, paragraph.trim())
      assert.ok(paragraph.length > 0)
    }
  }
})
