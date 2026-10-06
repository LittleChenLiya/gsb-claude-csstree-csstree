import { tokenize } from '../tokenizer/index.js';
import tokenNames from '../tokenizer/names.js';
import { Ident, Number, Percentage, Dimension, WhiteSpace, Comment, BadString, BadUrl } from '../tokenizer/types.js';
import { encode as encodeIdent } from '../utils/ident.js';
import { property as getPropertyDescriptor } from '../utils/names.js';
import { createCustomError } from '../utils/create-custom-error.js';
import defaultSyntax from '../syntax/index.js';

// Token types an edit is allowed to target: numeric values and identifiers.
// Strings, comments, delimiters and any other tokens are never replaceable,
// so a look-alike word inside a string or comment can't be rewritten.
const REPLACEABLE_TYPES = new Set([Ident, Number, Percentage, Dimension]);

const BAD_TOKEN_TYPES = new Set([BadString, BadUrl]);

function tokenReplaceError(message) {
    return createCustomError('TokenReplaceError', message);
}

// FNV-1a (32-bit) - small dependency-free fingerprint used to bind a plan
// to the exact source text it was created from.
function fingerprint(source) {
    let hash = 0x811c9dc5;

    for (let i = 0; i < source.length; i++) {
        hash ^= source.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0;
    }

    return ('0000000' + hash.toString(16)).slice(-8);
}

function tokenizeText(text, offsetBase) {
    const tokens = [];

    tokenize(text, (type, start, end) => tokens.push({
        type,
        name: tokenNames[type],
        start: start + offsetBase,
        end: end + offsetBase
    }));

    return tokens;
}

/**
 * Tokenize a range of the source with the real CSS lexer and return
 * the tokens with absolute offsets. This is the only supported way to
 * locate replaceable tokens, so ranges always match real token boundaries.
 */
export function tokenizeValue(source, valueStart, valueEnd) {
    const tokens = tokenizeText(source.slice(valueStart, valueEnd), valueStart);

    for (const token of tokens) {
        token.text = source.slice(token.start, token.end);
        token.replaceable = REPLACEABLE_TYPES.has(token.type);
    }

    return tokens;
}

// Build the list of candidate encodings for a replacement value.
// The raw text comes first; whitespace-padded variants follow as a
// fallback so a value that would glue to a neighbour (e.g. `url` right
// before `(` would become a function/url token, or `1` right after a `.`
// delim would become a single number) can still be emitted safely.
function buildCandidates(value) {
    if (Array.isArray(value)) {
        // A list of identifiers. Each entry is encoded as an identifier
        // (so `2px` stays an identifier and doesn't turn into a dimension)
        // and adjacent identifiers are separated by a single space,
        // otherwise they would merge into one token.
        if (value.length === 0) {
            throw tokenReplaceError('Replacement identifier list must not be empty');
        }

        return [value.map(item => {
            if (typeof item !== 'string' || item.length === 0) {
                throw tokenReplaceError('Replacement identifiers must be non-empty strings');
            }

            return encodeIdent(item);
        }).join(' ')];
    }

    if (typeof value !== 'string' || value.length === 0) {
        throw tokenReplaceError('Replacement value must be a non-empty string or a list of identifiers');
    }

    const candidates = [value];

    // last resort: pad with whitespace so the value can't glue to a
    // neighbour (e.g. a `+`/`-`/`%` delim right next to a number)
    candidates.push(value + ' ');
    candidates.push(' ' + value);
    candidates.push(' ' + value + ' ');

    return candidates;
}

function checkReplacementTokens(edit) {
    const tokens = tokenizeText(edit.replacement, 0);
    let meaningful = 0;

    for (const token of tokens) {
        if (BAD_TOKEN_TYPES.has(token.type)) {
            throw tokenReplaceError('Replacement for token at ' + edit.absStart + '..' + edit.absEnd + ' produces a ' + token.name);
        }

        if (token.type !== WhiteSpace && token.type !== Comment) {
            meaningful++;
        }
    }

    if (meaningful === 0) {
        throw tokenReplaceError('Replacement for token at ' + edit.absStart + '..' + edit.absEnd + ' produces no value tokens');
    }
}

// Splice the edits into the original value text and build a segment map
// (untouched gaps vs replaced ranges) in original and new coordinates.
function buildValue(origText, edits) {
    let newText = '';
    let pos = 0;
    const segments = [];

    for (const edit of edits) {
        if (edit.start > pos) {
            segments.push({
                kind: 'gap',
                origStart: pos,
                origEnd: edit.start,
                newStart: newText.length,
                newEnd: newText.length + (edit.start - pos)
            });
            newText += origText.slice(pos, edit.start);
        }

        const newStart = newText.length;
        newText += edit.replacement;
        segments.push({
            kind: 'edit',
            edit,
            origStart: edit.start,
            origEnd: edit.end,
            newStart,
            newEnd: newText.length
        });
        pos = edit.end;
    }

    if (pos < origText.length) {
        segments.push({
            kind: 'gap',
            origStart: pos,
            origEnd: origText.length,
            newStart: newText.length,
            newEnd: newText.length + (origText.length - pos)
        });
        newText += origText.slice(pos);
    }

    return { newText, segments };
}

function segmentStart(segment, space) {
    return space === 'orig' ? segment.origStart : segment.newStart;
}

function segmentEnd(segment, space) {
    return space === 'orig' ? segment.origEnd : segment.newEnd;
}

function segmentAt(segments, pos, space) {
    for (const segment of segments) {
        if (pos >= segmentStart(segment, space) && pos < segmentEnd(segment, space)) {
            return segment;
        }
    }

    return null;
}

// The edit a stray token should be blamed on: the edit segment it starts
// in, or the edit segment it crosses into.
function blameEdit(segments, token, space) {
    const segment = segmentAt(segments, token.start, space);

    if (segment) {
        if (segment.kind === 'edit') {
            return segment.edit;
        }

        const index = segments.indexOf(segment);

        if (index + 1 < segments.length && segments[index + 1].kind === 'edit') {
            return segments[index + 1].edit;
        }
    }

    return null;
}

function sameTokenSequence(aTokens, aText, bTokens, bText) {
    if (aTokens.length !== bTokens.length) {
        return false;
    }

    for (let i = 0; i < aTokens.length; i++) {
        if (aTokens[i].type !== bTokens[i].type ||
            aText.slice(aTokens[i].start, aTokens[i].end) !== bText.slice(bTokens[i].start, bTokens[i].end)) {
            return false;
        }
    }

    return true;
}

function tokensWithin(tokens, start, end) {
    return tokens.filter(token => token.start >= start && token.end <= end);
}

// Verify that splicing the edits in keeps every untouched byte inside the
// exact same tokens as before, and that each replacement tokenizes in place
// exactly the same way it tokenizes standalone (i.e. it doesn't glue to a
// neighbour and doesn't leak across its range). Returns the edit that
// breaks the invariant, or null when everything is fine.
function findBoundaryViolation(origText, origTokens, newText, newTokens, segments) {
    // no token may cross a segment boundary
    for (const token of origTokens) {
        const segment = segmentAt(segments, token.start, 'orig');

        if (!segment || token.end > segmentEnd(segment, 'orig')) {
            return blameEdit(segments, token, 'orig');
        }
    }

    for (const token of newTokens) {
        const segment = segmentAt(segments, token.start, 'new');

        if (!segment || token.end > segmentEnd(segment, 'new')) {
            return blameEdit(segments, token, 'new');
        }
    }

    for (const segment of segments) {
        if (segment.kind === 'gap') {
            // untouched ranges must produce the very same tokens as before
            const before = tokensWithin(origTokens, segment.origStart, segment.origEnd);
            const after = tokensWithin(newTokens, segment.newStart, segment.newEnd);

            if (!sameTokenSequence(before, origText, after, newText)) {
                const next = segments[segments.indexOf(segment) + 1];

                return next && next.kind === 'edit' ? next.edit : null;
            }
        } else {
            // a replacement must tokenize in place exactly as standalone
            const standalone = tokenizeText(segment.edit.replacement, 0);
            const inplace = tokensWithin(newTokens, segment.newStart, segment.newEnd);

            if (!sameTokenSequence(standalone, segment.edit.replacement, inplace, newText)) {
                return segment.edit;
            }
        }
    }

    return null;
}

/**
 * Create a replacement plan for a value inside `source`.
 *
 * edits: [{ start, end, value }] where [start, end) is a range previously
 * obtained from tokenizeValue() (or a `token` object from it) and `value`
 * is either a CSS text string or an array of identifier strings.
 *
 * options:
 *   - property: declaration property name; when given, the resulting value
 *     is validated against the property grammar and the plan is rejected
 *     if it no longer matches
 *   - value: { start, end } range of the value inside source
 *     (defaults to the whole source)
 *   - lexer: a Lexer instance to validate with (defaults to css-tree's)
 *
 * The plan is bound to the exact source text; it carries no reference to
 * the source and never mutates anything.
 */
export function createReplacementPlan(source, edits, options = {}) {
    if (!Array.isArray(edits) || edits.length === 0) {
        throw tokenReplaceError('At least one edit is required');
    }

    const valueStart = options.value ? options.value.start : 0;
    const valueEnd = options.value ? options.value.end : source.length;
    const property = options.property || null;
    const lexer = options.lexer || defaultSyntax.lexer;
    const tokens = tokenizeValue(source, valueStart, valueEnd);

    // resolve and validate edit ranges against real lexer tokens
    const resolved = edits.map(edit => {
        const token = edit.token || null;
        const start = edit.start !== undefined ? edit.start : (token ? token.start : NaN);
        const end = edit.end !== undefined ? edit.end : (token ? token.end : NaN);
        const target = tokens.find(t => t.start === start && t.end === end);

        if (!target || !REPLACEABLE_TYPES.has(target.type)) {
            throw tokenReplaceError(
                'No replaceable token (number, percentage, dimension or identifier) at ' +
                start + '..' + end
            );
        }

        return {
            start: start - valueStart,
            end: end - valueStart,
            absStart: start,
            absEnd: end,
            target,
            candidates: buildCandidates(edit.value),
            replacement: null
        };
    });

    // sort by range and reject overlapping plans up front
    resolved.sort((a, b) => a.start - b.start);

    for (let i = 1; i < resolved.length; i++) {
        if (resolved[i].start < resolved[i - 1].end) {
            throw tokenReplaceError(
                'Overlapping replacement ranges at ' +
                resolved[i].absStart + '..' + resolved[i].absEnd + ' and ' +
                resolved[i - 1].absStart + '..' + resolved[i - 1].absEnd
            );
        }
    }

    for (const edit of resolved) {
        edit.replacement = edit.candidates[0];
        checkReplacementTokens(edit);
    }

    // splice edits into the value and make sure no replacement glues to its
    // neighbours; retry with whitespace-padded encodings when it does
    const origText = source.slice(valueStart, valueEnd);
    const origTokens = tokenizeText(origText, 0);
    let newValueText = null;

    for (let attempt = 0; attempt < 16; attempt++) {
        const built = buildValue(origText, resolved);
        const newTokens = tokenizeText(built.newText, 0);
        const violator = findBoundaryViolation(origText, origTokens, built.newText, newTokens, built.segments);

        if (violator === null) {
            newValueText = built.newText;
            break;
        }

        const candidateIndex = violator.candidates.indexOf(violator.replacement);

        if (candidateIndex + 1 < violator.candidates.length) {
            violator.replacement = violator.candidates[candidateIndex + 1];
            continue;
        }

        throw tokenReplaceError(
            'Replacement "' + violator.candidates[0] + '" for token at ' +
            violator.absStart + '..' + violator.absEnd +
            ' can\'t be encoded without merging into an adjacent token'
        );
    }

    if (newValueText === null) {
        throw tokenReplaceError('Failed to encode replacements');
    }

    // the new value must still match the declaration grammar
    if (property !== null && !getPropertyDescriptor(property).custom) {
        const match = lexer.matchProperty(property, newValueText);

        if (match.error) {
            throw tokenReplaceError(
                'Replacement doesn\'t match the grammar of "' + property + '": ' +
                String(match.error.message).split('\n')[0]
            );
        }
    }

    return Object.freeze({
        property,
        valueStart,
        valueEnd,
        value: newValueText,
        sourceLength: source.length,
        sourceHash: fingerprint(source),
        edits: Object.freeze(resolved.map(edit => Object.freeze({
            start: edit.absStart,
            end: edit.absEnd,
            text: source.slice(edit.absStart, edit.absEnd),
            replacement: edit.replacement
        })))
    });
}

/**
 * Apply a plan to a source text. The plan is rejected when the text
 * differs from the one the plan was created for.
 */
export function applyReplacementPlan(plan, source) {
    if (source.length !== plan.sourceLength || fingerprint(source) !== plan.sourceHash) {
        throw tokenReplaceError('Stale plan: the source has changed since the plan was created');
    }

    for (const edit of plan.edits) {
        if (source.slice(edit.start, edit.end) !== edit.text) {
            throw tokenReplaceError(
                'Stale plan: token at ' + edit.start + '..' + edit.end +
                ' no longer matches the planned text'
            );
        }
    }

    let result = source;

    for (let i = plan.edits.length - 1; i >= 0; i--) {
        const edit = plan.edits[i];
        result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
    }

    return result;
}

/**
 * One-shot helper: create a plan and apply it.
 * Returns { plan, source } with the new source text.
 */
export function replaceTokens(source, edits, options) {
    const plan = createReplacementPlan(source, edits, options);

    return { plan, source: applyReplacementPlan(plan, source) };
}

/**
 * Replace tokens of a declaration value. The declaration node is only
 * read (property name and value location); it is never mutated. Parse the
 * returned source to get an updated AST.
 *
 * Requires the AST to be parsed with `positions: true`.
 */
export function replaceDeclaration(source, declaration, edits, options = {}) {
    if (!declaration || declaration.type !== 'Declaration') {
        throw tokenReplaceError('Expected a Declaration node');
    }

    if (!declaration.loc || !declaration.value || !declaration.value.loc) {
        throw tokenReplaceError('Declaration must be parsed with positions: true and have a non-empty value');
    }

    return replaceTokens(source, edits, {
        ...options,
        property: declaration.property,
        value: {
            start: declaration.value.loc.start.offset,
            end: declaration.value.loc.end.offset
        }
    });
}
