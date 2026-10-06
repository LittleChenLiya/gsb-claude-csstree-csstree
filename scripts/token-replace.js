import fs from 'fs';
import {
    createReplacementPlan,
    applyReplacementPlan,
    TokenReplacementError
} from '../lib/token-replace/index.js';

const USAGE = `Usage: node scripts/token-replace.js <input.css> <plan.json> [--check]

Explicit token-level replacement for CSS.

  <input.css>   CSS file to transform ("-" reads stdin)
  <plan.json>   JSON file with a replacement plan:
                { "edits": [{ "start": 11, "end": 15, "value": "20px" },
                            { "offset": 40, "value": "dashed" }] }
                An edit targets a single number/dimension/percentage/ident
                token, located by its exact lexer range (start/end) or by
                any offset inside it. A previously created plan (with a
                "source" fingerprint) is rejected when the source changed.
  --check       don't print the result, only validate the plan

The result CSS is printed to stdout. Unselected tokens and comments are
preserved byte for byte; a replacement that no longer matches the
declaration syntax (e.g. width: red) is rejected.`;

function fail(error) {
    if (error instanceof TokenReplacementError) {
        console.error(`token-replace: [${error.code}] ${error.message}`);
    } else {
        console.error(`token-replace: ${error.message}`);
    }

    process.exit(1);
}

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const positional = args.filter(arg => arg !== '--check');

if (positional.length !== 2 || positional.includes('--help') || positional.includes('-h')) {
    console.log(USAGE);
    process.exit(positional.length === 2 ? 1 : 0);
}

const [cssPath, planPath] = positional;
const source = cssPath === '-'
    ? fs.readFileSync(0, 'utf-8')
    : fs.readFileSync(cssPath, 'utf-8');
const planJson = JSON.parse(fs.readFileSync(planPath, 'utf-8'));

try {
    // A plan file may contain raw edits (no fingerprint) or a full plan
    // created earlier. A fingerprinted plan stays bound to its source:
    // applying it to a changed source is rejected as stale.
    const plan = typeof planJson.source === 'string'
        ? planJson
        : createReplacementPlan(source, planJson.edits);
    const { css, edits } = applyReplacementPlan(source, plan);

    if (checkOnly) {
        console.log(`OK: ${edits.length} edit(s) can be applied`);
    } else {
        process.stdout.write(css);
    }
} catch (error) {
    fail(error);
}
