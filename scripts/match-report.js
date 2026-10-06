import cli from 'clap';
import { lexer } from '../lib/index.js';

// Three built-in value examples:
// 1. an extra tail token in a margin value – the report locates the tail
// 2. two candidate branches fail at the same position – expectations are merged, sources kept
// 3. an unknown var() reference – reported as undecided, not as passed
const examples = [
    {
        title: 'margin: 1px 2px 3px 4px 5px (extra tail token)',
        run: () => lexer.matchPropertyReport('margin', '1px 2px 3px 4px 5px')
    },
    {
        title: '<length> | <percentage> = red (two candidate branches)',
        run: () => lexer.matchReport('<length> | <percentage>', 'red')
    },
    {
        title: 'margin: var(--gap) 1px (unknown var())',
        run: () => lexer.matchPropertyReport('margin', 'var(--gap) 1px')
    }
];

function printReport(title, result) {
    console.log(`# ${title}`);
    console.log(`status: ${result.status}`);

    if (result.reason) {
        console.log(`reason: ${result.reason}`);
    }

    if (result.note) {
        console.log(`note: ${result.note}`);
    }

    if (result.report) {
        const { position, expected } = result.report;

        console.log(`mismatch at offset ${position.offset} (token ${JSON.stringify(position.token)})`);
        console.log('expected:');

        for (const item of expected) {
            const what = item.value !== null ? `${item.category} ${JSON.stringify(item.value)}` : item.category;
            console.log(`  - ${what} (from ${item.sources.join(', ')})`);
        }
    }

    console.log();
}

cli.command('match-report', '[syntax] [value]')
    .option('-p, --property', 'treat the syntax argument as a property name')
    .action(function(args) {
        const [syntax, value = ''] = args;

        if (this.values.property) {
            printReport(`${syntax}: ${value}`, lexer.matchPropertyReport(syntax, value));
        } else if (syntax !== undefined) {
            printReport(`${syntax} = ${value}`, lexer.matchReport(syntax, value));
        } else {
            for (const example of examples) {
                printReport(example.title, example.run());
            }
        }
    })
    .run();
