// Print an explicit failure report for lexer matching of a property value.
//
// Usage:
//   node scripts/match-report.js                  run the built-in examples
//   node scripts/match-report.js margin "1px 1"   report for a given property/value
import { lexer } from '../lib/index.js';

const examples = [
    // an extra trailing token: the tail is located by a CSS byte offset,
    // a matched prefix is not reported as a full value match
    ['margin', '1px 2px 3px 4px 5px'],
    // candidate branches probed at the same furthest position are merged,
    // the source syntax of every branch is preserved
    ['margin', '1px 2px foo'],
    // var() can't be resolved, the value is marked as pending
    // instead of claiming the syntax is passed
    ['margin', 'var(--gap) 4px']
];

const [property, value] = process.argv.slice(2);
const list = property !== undefined ? [[property, value || '']] : examples;

for (const [prop, val] of list) {
    const { matched, error, report } = lexer.matchProperty(prop, val, { report: true });

    console.log(`lexer.matchProperty('${prop}', '${val}', { report: true })`);
    console.log('  matched:', matched === null ? null : '(match tree)');

    if (error) {
        console.log('  error:', error.rawMessage || error.message);
    }

    console.log('  report:', JSON.stringify(report, null, 2).replace(/\n/g, '\n  '));
    console.log();
}
