const ELLIPSIS = '…';          // …
const TAB_REPLACEMENT = '    ';     // 4 spaces
const LINE_BREAKS = new Set([10, 12, 13]); // \n \f \r

export const DEFAULT_ERROR_CONTEXT_MAX_LENGTH = 160;

/**
 * Build a bounded source context for a given offset: the line containing
 * the offset (sliced by the original offset, capped to `maxLength` code points)
 * plus a caret line indicating the column.
 *
 * - CRLF is treated as a single line break, so line boundaries and the caret
 *   are not shifted by `\r\n` sequences;
 * - slicing and caret positioning are code point based, so astral characters
 *   (e.g. emoji) are never split and don't shift the caret;
 * - the result never contains more than `maxLength` code points of the source
 *   (plus up to two ellipsis markers), no matter how big the stylesheet is.
 */
export function createSourceContext(source, offset, maxLength = DEFAULT_ERROR_CONTEXT_MAX_LENGTH) {
    source = String(source);
    offset = Math.min(Math.max(Number(offset) || 0, 0), source.length);
    maxLength = Math.floor(maxLength) > 0 ? Math.floor(maxLength) : DEFAULT_ERROR_CONTEXT_MAX_LENGTH;

    // find the boundaries of the line containing the offset;
    // \r\n is a single line break since a \r is always followed by \n check
    let lineStart = offset;
    while (lineStart > 0 && !LINE_BREAKS.has(source.charCodeAt(lineStart - 1))) {
        lineStart--;
    }
    let lineEnd = offset;
    while (lineEnd < source.length && !LINE_BREAKS.has(source.charCodeAt(lineEnd))) {
        lineEnd++;
    }

    // 1-based line number, counting \r\n as a single line break
    let line = 1;
    for (let i = 0; i < lineStart; i++) {
        const code = source.charCodeAt(i);
        if (code === 13) {
            line++;
            if (source.charCodeAt(i + 1) === 10) {
                i++;
            }
        } else if (code === 10 || code === 12) {
            line++;
        }
    }

    // operate on code points (not UTF-16 code units) so surrogate pairs
    // (emoji and other astral characters) stay intact and don't shift the caret
    const chars = Array.from(source.slice(lineStart, lineEnd).replace(/\t/g, TAB_REPLACEMENT));
    const caret = Array.from(source.slice(lineStart, offset).replace(/\t/g, TAB_REPLACEMENT)).length;

    // cap the line to maxLength code points, keeping the caret visible
    let start = 0;
    if (chars.length > maxLength) {
        start = Math.min(Math.max(caret - (maxLength >> 1), 0), chars.length - maxLength);
    }
    const end = Math.min(start + maxLength, chars.length);

    const sourceLine =
        (start > 0 ? ELLIPSIS : '') +
        chars.slice(start, end).join('') +
        (end < chars.length ? ELLIPSIS : '');
    const pointer = ' '.repeat((start > 0 ? ELLIPSIS.length : 0) + caret - start) + '^';

    return {
        line,
        column: caret + 1,
        sourceLine,
        pointer,
        context: sourceLine + '\n' + pointer
    };
}
