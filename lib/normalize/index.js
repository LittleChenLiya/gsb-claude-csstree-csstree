import { property as parsePropertyName } from '../utils/names.js';

// CSS math functions (https://www.w3.org/TR/css-values-4/#math).
// Numeric text inside such functions must be kept intact:
// - a unitless zero inside a math function is a <number>, not a <length>,
//   so dropping a unit would change the type of the expression (or break it);
// - a negative zero is observable in calculations (e.g. via sign() or atan2()),
//   so `-0` must not be rewritten to `0`.
const mathFunctions = new Set([
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

// Matches an unsigned literal zero only (e.g. `0`, `00`, `0.0`, `.0`).
// A signed zero (`-0`, `+0`) never matches and is preserved as is.
const positiveZero = /^(?:0+(?:\.0+)?|\.0+)$/;

export function createNormalizer({ walk, lexer }) {
    // cache of "property name → its grammar allows a unitless zero"
    const zeroUnitlessAllowed = new Map();

    function isZeroUnitlessAllowed(propertyName) {
        let allowed = zeroUnitlessAllowed.get(propertyName);

        if (allowed === undefined) {
            // syntax based check: a unitless zero is valid for a property
            // only when its grammar matches `0` (e.g. via <length> which
            // allows a zero with no unit, unlike <angle> or <time>)
            allowed = Boolean(lexer.matchProperty(propertyName, '0').matched);
            zeroUnitlessAllowed.set(propertyName, allowed);
        }

        return allowed;
    }

    function normalizeDeclaration(declaration) {
        // a custom property value is kept as unparsed text (Raw node)
        // and must not be rewritten
        if (parsePropertyName(declaration.property).custom) {
            return;
        }

        // drop zero-value units only when the property grammar
        // allows a unitless zero
        if (!isZeroUnitlessAllowed(declaration.property)) {
            return;
        }

        walk(declaration.value, function(node) {
            switch (node.type) {
                case 'Function':
                    // don't touch anything inside math functions,
                    // in particular keep negative zero as is
                    if (mathFunctions.has(node.name.toLowerCase())) {
                        return walk.skip;
                    }
                    break;

                case 'Dimension':
                    if (positiveZero.test(node.value)) {
                        // turn `0px` into `0` by mutating the node in place;
                        // the output is produced by the regular AST generator,
                        // no string replacement on the source is involved
                        node.type = 'Number';
                        delete node.unit;
                    }
                    break;
            }
        });
    }

    // normalize(ast, options) → ast
    // Applies a conservative numeric normalization to declaration values.
    // Options:
    //   zeroUnit: boolean – drop units on unsigned zero dimensions
    //   when the property grammar allows a unitless zero (default: false).
    // When no option is enabled the function is a no-op and returns
    // the AST unchanged, so the regular parse/generate flow is unaffected.
    return function normalize(ast, options) {
        if (!options || options.zeroUnit !== true) {
            return ast;
        }

        walk(ast, {
            visit: 'Declaration',
            enter: normalizeDeclaration
        });

        return ast;
    };
}
