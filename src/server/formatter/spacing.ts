import { OPERATORS, type FormatToken } from './scanner.js';

const CONTROL_PARENS = new Set(['if', 'for', 'while', 'switch', 'assert']);
const PREFIX_CONTEXT = new Set(['(', '[', '{', ',', ';', ':', '?', 'return', 'case']);
const BOUNDARY_OPERATORS = [...OPERATORS, '//', '/*'];

function isPrefix(tokens: FormatToken[], index: number): boolean {
    if (!['+', '-', '!', '~', '++', '--'].includes(tokens[index].text)) return false;
    const previous = tokens[index - 1];
    return !previous || previous.endLine < tokens[index].line
        || PREFIX_CONTEXT.has(previous.text)
        || (OPERATORS.has(previous.text) && previous.text !== '++' && previous.text !== '--');
}

/** Change gaps only: token spellings, comments, and literals remain untouched. */
export function formatTokenGap(tokens: FormatToken[], index: number, original: string): string {
    const left = tokens[index - 1];
    const right = tokens[index];
    const a = left.text;
    const b = right.text;
    if (left.kind === 'directive' || right.kind === 'directive') return original;
    if (left.kind === 'comment' || right.kind === 'comment') return original;

    let gap: string;
    // Colons can denote tags, labels, case labels, or ternaries. Preserve them
    // until a full expression reader can distinguish these reliably.
    if (a === ':' && b === '{') return ' ';
    if (a === ':' || b === ':' || a === '.' || b === '.' || a === '\\' || b === '\\') return original;
    if (right.kind === 'literal' && (a === '!' || a === right.escapeCharacter)) return original;
    if (b === ',' || b === ';' || b === ')' || b === ']') gap = '';
    else if (a === '(' || a === '[') gap = '';
    else if (a === ',' || a === ';') gap = ' ';
    else if (b === '(') {
        gap = CONTROL_PARENS.has(a) || a === 'return' || OPERATORS.has(a) ? ' ' : '';
    } else if (b === '[') gap = OPERATORS.has(a) ? ' ' : '';
    else if (a === '{' || b === '}') gap = a === '{' && b === '}' ? '' : ' ';
    else if (b === '{' || a === '}') gap = ' ';
    else if (isPrefix(tokens, index - 1)) gap = '';
    else if (b === '++' || b === '--') gap = isPrefix(tokens, index) ? ' ' : '';
    else if (OPERATORS.has(a) || OPERATORS.has(b)) gap = ' ';
    else gap = original ? ' ' : '';

    // Removing a gap must never create a different operator or a comment.
    if (!gap && original && BOUNDARY_OPERATORS.some((operator) => operator.length > a.length && (a + b).startsWith(operator))) return ' ';
    return gap;
}
