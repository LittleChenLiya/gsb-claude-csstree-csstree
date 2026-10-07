import { isCustomProperty } from '../utils/names.js';

// CSS math functions. Inside these functions a signed zero may carry
// a meaning (e.g. `calc(-0 * 1px)` may evaluate to -0 and `1 / -0`
// to -Infinity), so negative zero must be preserved there.
const MATH_FUNCTIONS = new Set([
    'calc',
    'min',
    'max',
    'clamp',
    'round',
    'mod',
    'rem',
    'sin',
    'cos',
    'tan',
    'asin',
    'acos',
    'atan',
    'atan2',
    'pow',
    'sqrt',
    'hypot',
    'log',
    'exp',
    'abs',
    'sign'
]);

// Number and Dimension node values are guaranteed to be valid
// <number-token> values, so parseFloat() is safe to use
function isZeroValue(value) {
    return parseFloat(value) === 0;
}

function isMathFunction(node) {
    return node.type === 'Function' && MATH_FUNCTIONS.has(node.name.toLowerCase());
}

// Collect zero valued Number/Dimension nodes for a declaration value.
// Anything inside a math function is left untouched to preserve
// negative zero (and units) in calculations.
function collectZeroCandidates(value, walk) {
    const candidates = [];

    walk(value, function(node) {
        if (isMathFunction(node)) {
            return walk.skip;
        }

        if (node.type === 'Dimension') {
            if (isZeroValue(node.value)) {
                candidates.push(node);
            }
        } else if (node.type === 'Number') {
            if (node.value !== '0' && isZeroValue(node.value)) {
                candidates.push(node);
            }
        }
    });

    return candidates;
}

// Tentatively normalize a zero valued node:
// - Dimension "0<unit>" -> Number "0" (unit is dropped)
// - Number "-0" / "+0" / "0.0" etc -> canonical "0"
// Returns a revert function to restore the original state.
function applyNormalization(node) {
    if (node.type === 'Dimension') {
        const { type, value, unit } = node;

        node.type = 'Number';
        node.value = '0';
        delete node.unit;

        return () => {
            node.type = type;
            node.value = value;
            node.unit = unit;
        };
    }

    const value = node.value;
    node.value = '0';

    return () => {
        node.value = value;
    };
}

/**
 * Conservative numeric normalization for CSS AST.
 *
 * The strategy:
 * - zero valued dimensions (e.g. "0px") are replaced with a unitless "0"
 *   only when the property grammar (via the lexer) accepts the result;
 * - zero valued numbers are canonicalized to "0";
 * - negative zero (and everything else) inside CSS math functions such as
 *   calc() is preserved as is;
 * - custom properties and unparsed (Raw) values are never rewritten.
 *
 * All rewrites are performed on the AST and the result is produced by
 * the AST generator, no source string replacement is used.
 *
 * The feature is opt-in: parse()/generate() behavior is unchanged unless
 * normalizeNumbers() is called explicitly.
 *
 * @param {object} ast - AST to normalize (mutated in place)
 * @param {object} [options]
 * @param {string} [options.output] - "css" (default) returns generated CSS,
 *                                    "ast" returns the mutated AST
 * @param {object} tools - { walk, generate, lexer } of the host syntax
 * @returns {string|object}
 */
export function normalizeNumbers(ast, options, { walk, generate, lexer }) {
    const { output = 'css' } = options || {};

    walk(ast, {
        visit: 'Declaration',
        enter(declaration) {
            // never rewrite custom properties – their values are kept
            // as unparsed text and must stay untouched
            if (isCustomProperty(declaration.property)) {
                return walk.skip;
            }

            // never rewrite unparsed values
            if (!declaration.value || declaration.value.type === 'Raw') {
                return walk.skip;
            }

            const candidates = collectZeroCandidates(declaration.value, walk);

            if (candidates.length === 0) {
                return;
            }

            const revertAll = candidates.map(applyNormalization);

            // zero units may be dropped only when the syntax still matches;
            // otherwise restore the declaration to its original state
            if (!lexer || !lexer.matchDeclaration(declaration).matched) {
                for (const revert of revertAll) {
                    revert();
                }
            }
        }
    });

    return output === 'ast' ? ast : generate(ast);
}
