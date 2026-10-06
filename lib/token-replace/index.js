import { tokenize, tokenTypes, tokenNames } from '../tokenizer/index.js';
import syntax from '../syntax/index.js';

const { parse, lexer, walk } = syntax;

// Only numeric and identifier tokens are replaceable. In particular
// string and comment tokens are never touched, so look-alike words
// inside strings stay intact.
const REPLACEABLE_TYPES = new Set([
    tokenTypes.Number,
    tokenTypes.Dimension,
    tokenTypes.Percentage,
    tokenTypes.Ident
]);

export class TokenReplacementError extends Error {
    constructor(code, message, details) {
        super(message);
        this.name = 'TokenReplacementError';
        this.code = code;

        if (details !== undefined) {
            this.details = details;
        }
    }
}

// Source fingerprint used to bind a plan to the exact source text it was
// created for. Pure JS (no node builtins) so the module stays portable.
// cyrb53-style hash over char codes, prefixed with the source length.
export function fingerprint(source) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;

    for (let i = 0; i < source.length; i++) {
        const ch = source.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }

    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    return source.length.toString(16) + ':' +
        (h2 >>> 0).toString(16).padStart(8, '0') +
        (h1 >>> 0).toString(16).padStart(8, '0');
}

function getTokens(source) {
    const tokens = [];

    tokenize(source, (type, start, end) => tokens.push({ type, start, end }));

    return tokens;
}

function describeToken(source, token) {
    return `${tokenNames[token.type]} token ${JSON.stringify(source.slice(token.start, token.end))} at ${token.start}..${token.end}`;
}

function resolveEdit(source, tokens, edit, index) {
    let token = null;

    if (!edit || typeof edit !== 'object') {
        throw new TokenReplacementError('bad-edit', `edit #${index}: an edit must be an object`);
    }

    if (Number.isInteger(edit.start) && Number.isInteger(edit.end)) {
        // locate by the real lexer range: the range must match a token exactly
        token = tokens.find(({ start, end }) => start === edit.start && end === edit.end) || null;

        if (token === null) {
            throw new TokenReplacementError(
                'token-not-found',
                `edit #${index}: no token with exact range ${edit.start}..${edit.end}`
            );
        }
    } else if (Number.isInteger(edit.offset)) {
        token = tokens.find(({ start, end }) => start <= edit.offset && edit.offset < end) || null;

        if (token === null) {
            throw new TokenReplacementError(
                'token-not-found',
                `edit #${index}: no token at offset ${edit.offset}`
            );
        }
    } else {
        throw new TokenReplacementError(
            'bad-edit',
            `edit #${index}: provide either an "offset" or a "start"/"end" pair`
        );
    }

    if (!REPLACEABLE_TYPES.has(token.type)) {
        throw new TokenReplacementError(
            'not-replaceable',
            `edit #${index}: ${describeToken(source, token)} is not replaceable; ` +
            'only number, dimension, percentage and ident tokens can be replaced'
        );
    }

    if (typeof edit.value !== 'string') {
        throw new TokenReplacementError('bad-edit', `edit #${index}: "value" must be a string`);
    }

    return {
        index,
        start: token.start,
        end: token.end,
        type: token.type,
        value: edit.value
    };
}

// The replacement value must encode to exactly one replaceable token and
// nothing else, so it can't silently turn into several tokens or glue
// itself to neighbours.
function validateValue(edit) {
    const { value, index } = edit;

    if (value === '') {
        throw new TokenReplacementError('bad-value', `edit #${index}: value must not be empty`);
    }

    const tokens = getTokens(value);

    if (tokens.length !== 1 || tokens[0].start !== 0 || tokens[0].end !== value.length) {
        throw new TokenReplacementError(
            'bad-value-encoding',
            `edit #${index}: value ${JSON.stringify(value)} must encode to exactly one token`
        );
    }

    if (!REPLACEABLE_TYPES.has(tokens[0].type)) {
        throw new TokenReplacementError(
            'bad-value-encoding',
            `edit #${index}: value ${JSON.stringify(value)} encodes to a ${tokenNames[tokens[0].type]} token; ` +
            'only number, dimension, percentage and ident tokens are allowed'
        );
    }

    return tokens[0].type;
}

function checkOverlaps(edits) {
    for (let i = 1; i < edits.length; i++) {
        if (edits[i].start < edits[i - 1].end) {
            throw new TokenReplacementError(
                'overlap',
                `edits #${edits[i - 1].index} and #${edits[i].index} overlap ` +
                `(${edits[i - 1].start}..${edits[i - 1].end} vs ${edits[i].start}..${edits[i].end})`
            );
        }
    }
}

/**
 * Create a replacement plan for a source text. Each edit targets a single
 * token (by exact { start, end } lexer range or by an { offset } inside it)
 * and provides a new { value }. The plan is bound to the source via a
 * fingerprint; once the source changes the plan is rejected as stale.
 */
export function createReplacementPlan(source, edits) {
    if (typeof source !== 'string') {
        throw new TokenReplacementError('bad-source', 'source must be a string');
    }

    if (!Array.isArray(edits) || edits.length === 0) {
        throw new TokenReplacementError('bad-plan', 'a plan needs a non-empty edits array');
    }

    const tokens = getTokens(source);
    const resolved = edits.map((edit, index) => resolveEdit(source, tokens, edit, index));
    const sorted = resolved.slice().sort((a, b) => a.start - b.start || a.end - b.end);

    // overlapping edits are rejected up front, before any value checks
    checkOverlaps(sorted);

    for (const edit of sorted) {
        edit.valueType = validateValue(edit);
    }

    return {
        version: 1,
        source: fingerprint(source),
        edits: sorted.map(({ index, start, end, type, value, valueType }) => ({
            index,
            start,
            end,
            type: tokenNames[type],
            value,
            valueType: tokenNames[valueType]
        }))
    };
}

// Splice edits into the original source. Everything outside the edited
// ranges (unselected tokens, comments, whitespace) is kept byte for byte.
function splice(source, edits) {
    let result = source;

    for (const edit of edits.slice().sort((a, b) => b.start - a.start)) {
        result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
    }

    return result;
}

// Re-tokenize the result and make sure the token stream is exactly the
// original one with the edited tokens swapped 1:1. This catches a new
// value that would merge with a neighbour into a single token (or split
// into several), and proves every unselected token is unchanged.
function verifyTokenStream(source, beforeTokens, result, edits) {
    const afterTokens = getTokens(result);

    if (afterTokens.length !== beforeTokens.length) {
        throw new TokenReplacementError(
            'token-stream-changed',
            `replacement changes the token count (${beforeTokens.length} -> ${afterTokens.length}); ` +
            'the new value would merge with or split into adjacent tokens'
        );
    }

    const editByStart = new Map(edits.map(edit => [edit.start, edit]));

    for (let i = 0; i < beforeTokens.length; i++) {
        const before = beforeTokens[i];
        const after = afterTokens[i];
        const edit = editByStart.get(before.start);

        if (after.type !== before.type && !edit) {
            throw new TokenReplacementError(
                'token-stream-changed',
                `token #${i} changed type from ${tokenNames[before.type]} to ${tokenNames[after.type]}`
            );
        }

        const afterText = result.slice(after.start, after.end);

        if (edit) {
            if (afterText !== edit.value) {
                throw new TokenReplacementError(
                    'token-stream-changed',
                    `edited token at ${before.start}..${before.end} does not round-trip`
                );
            }

            edit.afterStart = after.start;
            edit.afterEnd = after.end;
        } else if (afterText !== source.slice(before.start, before.end)) {
            throw new TokenReplacementError(
                'token-stream-changed',
                `unselected token #${i} (${tokenNames[before.type]}) was modified`
            );
        }
    }
}

// The replaced value must still match the syntax of the declaration it
// lives in (e.g. width: 20px is fine, width: red is not). Unknown and
// custom properties accept any value, so they are not checked.
function validateDeclarations(result, edits) {
    let ast;

    try {
        ast = parse(result, { positions: true });
    } catch (error) {
        throw new TokenReplacementError(
            'parse-error',
            `replacement produces CSS that does not parse: ${error.message}`
        );
    }

    const declarations = [];

    walk(ast, node => {
        if (node.type === 'Declaration') {
            declarations.push(node);
        }
    });

    for (const edit of edits) {
        const declaration = declarations.find(({ loc }) =>
            loc.start.offset <= edit.afterStart && edit.afterEnd <= loc.end.offset
        );

        if (!declaration || lexer.getProperty(declaration.property) === null) {
            continue;
        }

        const match = lexer.matchDeclaration(declaration);

        if (match.error) {
            throw new TokenReplacementError(
                'syntax-mismatch',
                `edit #${edit.index}: value ${JSON.stringify(edit.value)} does not match the syntax of ` +
                `declaration "${declaration.property}": ${match.error.message}`,
                { property: declaration.property }
            );
        }
    }
}

/**
 * Apply a plan created by createReplacementPlan() to a source text.
 * The plan is rejected when the source has changed since the plan was
 * created. Returns { css, edits } on success, throws TokenReplacementError
 * otherwise. No AST is mutated – the result is produced by splicing the
 * original source text and validated with a freshly parsed AST.
 */
export function applyReplacementPlan(source, plan) {
    if (typeof source !== 'string') {
        throw new TokenReplacementError('bad-source', 'source must be a string');
    }

    if (!plan || !Array.isArray(plan.edits) || plan.edits.length === 0) {
        throw new TokenReplacementError('bad-plan', 'a plan needs a non-empty edits array');
    }

    if (plan.source !== fingerprint(source)) {
        throw new TokenReplacementError(
            'stale-plan',
            'the plan was created for a different source text; re-create the plan for the current source'
        );
    }

    const tokens = getTokens(source);
    const edits = plan.edits.map((edit, index) =>
        resolveEdit(source, tokens, { start: edit.start, end: edit.end, value: edit.value }, index)
    );
    const sorted = edits.slice().sort((a, b) => a.start - b.start || a.end - b.end);

    checkOverlaps(sorted);

    for (const edit of sorted) {
        validateValue(edit);
    }

    const result = splice(source, sorted);

    verifyTokenStream(source, tokens, result, sorted);
    validateDeclarations(result, sorted);

    return {
        css: result,
        edits: sorted.map(({ index, start, end, afterStart, afterEnd, value }) => ({
            index,
            start,
            end,
            value,
            resultStart: afterStart,
            resultEnd: afterEnd
        }))
    };
}

/**
 * One-shot helper: create a plan for the given edits and apply it.
 */
export function replaceTokens(source, edits) {
    return applyReplacementPlan(source, createReplacementPlan(source, edits));
}
