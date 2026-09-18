import { OPERATORS, type FormatToken } from './scanner.js';

const CONTROL_PARENS = new Set(['if', 'for', 'while', 'switch', 'assert']);
const STATEMENT_CONTROLS = new Set(['if', 'for', 'while', 'switch']);
const PREFIX_CONTEXT = new Set(['(', '[', '{', ',', ';', ':', '?', 'return', 'case', 'else', 'do']);
const REFERENCE_CONTEXT = new Set(['(', ',', 'const']);
const BLOCK_KEYWORDS = new Set(['else', 'do', 'enum']);
const INITIALIZER_CONTEXT = new Set(['=', ',', '(', 'return']);
const UNARY = new Set(['+', '-', '!', '~', '++', '--', '&']);
const BOUNDARY_OPERATORS = [...OPERATORS, '//', '/*'];

/** Token roles that need bracket matching, computed once per document. */
export interface SpacingContext {
    /** `{`/`}` of tag groups and array initializers, which hug their contents. */
    tightBraces: Set<number>;
    /** `<`/`>` around a function's state list. */
    stateAngles: Set<number>;
    /** `:` of a conditional expression. */
    ternaryColons: Set<number>;
    /** `)` closing a control condition; a statement follows it. */
    statementStarts: Set<number>;
    /** `{` of a packed-array index such as `name{i}`. */
    packedIndexes: Set<number>;
}

function previousCode(tokens: FormatToken[], index: number): number {
    let i = index - 1;
    while (i >= 0 && tokens[i].kind === 'comment') i--;
    return i;
}

function nextCode(tokens: FormatToken[], index: number): number {
    let i = index + 1;
    while (i < tokens.length && tokens[i].kind === 'comment') i++;
    return i;
}

/** Index of the `}` closing a `{Tag, ...}:` group opened at index, or -1. */
function tagGroupEnd(tokens: FormatToken[], index: number): number {
    let i = index + 1;
    while (i < tokens.length && (tokens[i].kind === 'word' || tokens[i].text === ',')) i++;
    return i > index + 1 && tokens[i]?.text === '}' && tokens[i + 1]?.text === ':' ? i : -1;
}

function opensInitializer(tokens: FormatToken[], index: number, context: SpacingContext): boolean {
    const token = tokens[index];
    return token !== undefined && (INITIALIZER_CONTEXT.has(token.text)
        || (token.text === '{' && context.tightBraces.has(index)));
}

/** Whether a `{` after the token at previousIndex starts an array literal. */
function isInitializer(tokens: FormatToken[], previousIndex: number, context: SpacingContext): boolean {
    const previous = tokens[previousIndex];
    if (previous?.text !== ':') return opensInitializer(tokens, previousIndex, context);
    // `Float:{...}` retags an array literal inside an expression; `case X:{` opens a body.
    const tag = tokens[previousIndex - 1];
    return tag?.kind === 'word' && tag.end === previous.start
        && opensInitializer(tokens, previousCode(tokens, previousIndex - 1), context);
}

/** Index of the `>` closing a `<state, ...>` list opened at index, or -1. */
function stateListEnd(tokens: FormatToken[], index: number): number {
    let i = index + 1;
    while (i < tokens.length && (tokens[i].kind === 'word' || tokens[i].text === ',' || tokens[i].text === ':')) i++;
    if (tokens[i]?.text !== '>') return -1;
    const next = tokens[nextCode(tokens, i)];
    return !next || next.text === '{' || next.text === ';' || next.line > tokens[i].endLine ? i : -1;
}

export function analyzeSpacing(tokens: FormatToken[]): SpacingContext {
    const context: SpacingContext = {
        tightBraces: new Set(), stateAngles: new Set(), ternaryColons: new Set(), statementStarts: new Set(),
        packedIndexes: new Set(),
    };
    const parens: boolean[] = []; // whether each open `(`/`[` is a control condition
    const braces: { index: number; tight: boolean }[] = [];
    const questions: number[] = [0]; // pending `?` per bracket level
    let enumHeader = false;

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.text === 'enum') enumHeader = true;
        if (token.kind !== 'punct') continue;
        const previousIndex = previousCode(tokens, i);
        const previous = tokens[previousIndex];
        switch (token.text) {
            case '(':
            case '[':
                parens.push(token.text === '(' && STATEMENT_CONTROLS.has(previous?.text ?? ''));
                questions.push(0);
                break;
            case ')':
            case ']':
                if (parens.pop() && token.text === ')') context.statementStarts.add(i);
                if (questions.length > 1) questions.pop();
                break;
            case '{': {
                // `name{index}` reads a packed array; `enum Name{` and `else{` open a body.
                const packed = !enumHeader && previous !== undefined && previous.end === token.start
                    && (previous.text === ']' || (previous.kind === 'word' && !BLOCK_KEYWORDS.has(previous.text)));
                if (packed) context.packedIndexes.add(i);
                const tight = packed || isInitializer(tokens, previousIndex, context) || tagGroupEnd(tokens, i) !== -1;
                if (tight) context.tightBraces.add(i);
                enumHeader = false;
                braces.push({ index: i, tight });
                questions.push(0);
                break;
            }
            case '}': {
                const open = braces.pop();
                if (open?.tight) context.tightBraces.add(i);
                if (questions.length > 1) questions.pop();
                questions[questions.length - 1] = 0;
                break;
            }
            case ';':
                questions[questions.length - 1] = 0;
                enumHeader = false;
                break;
            case '?':
                questions[questions.length - 1]++;
                break;
            case ':':
                // `b:c` may equally be a tag override; only an unambiguous colon is a ternary.
                if (questions[questions.length - 1] > 0 && previous
                    && (previous.kind !== 'word' || previous.end < token.start)) {
                    context.ternaryColons.add(i);
                    questions[questions.length - 1]--;
                }
                break;
            case '<':
                if (previous?.text === ')' && parens.length === 0) {
                    const end = stateListEnd(tokens, i);
                    if (end !== -1) {
                        context.stateAngles.add(i);
                        context.stateAngles.add(end);
                        i = end;
                    }
                }
                break;
        }
    }
    return context;
}

/** Whether the operator at index is unary; 'ambiguous' when only a line break separates it from an operand. */
function prefixKind(tokens: FormatToken[], index: number, context: SpacingContext): 'yes' | 'no' | 'ambiguous' {
    const token = tokens[index];
    if (!UNARY.has(token.text)) return 'no';
    const previousIndex = previousCode(tokens, index);
    const previous = tokens[previousIndex];
    if (!previous) return 'yes';
    if (token.text === '&') {
        if (REFERENCE_CONTEXT.has(previous.text)) return 'yes';
    } else if (PREFIX_CONTEXT.has(previous.text) || context.statementStarts.has(previousIndex)
        || (OPERATORS.has(previous.text) && previous.text !== '++' && previous.text !== '--')) {
        return 'yes';
    }
    return previous.endLine < token.line ? 'ambiguous' : 'no';
}

/** Change gaps only: token spellings, comments, and literals remain untouched. */
export function formatTokenGap(tokens: FormatToken[], index: number, original: string, context: SpacingContext): string {
    const left = tokens[index - 1];
    const right = tokens[index];
    const a = left.text;
    const b = right.text;
    if (left.kind === 'directive' || right.kind === 'directive') return original;
    if (left.kind === 'comment' || right.kind === 'comment') return original;

    if (b === '<' && context.stateAngles.has(index)) return ' ';
    if ((a === '<' && context.stateAngles.has(index - 1)) || (b === '>' && context.stateAngles.has(index))) return '';
    if (context.ternaryColons.has(index) || context.ternaryColons.has(index - 1)) return ' ';
    // An overload such as `operator*(...)` keeps its symbol attached on both sides.
    if (a === 'operator' || (b === '(' && tokens[previousCode(tokens, index - 1)]?.text === 'operator')) return '';

    let gap: string;
    // Colons can denote tags, labels, case labels, or ternaries. Preserve them
    // until a full expression reader can distinguish these reliably.
    if (b === '{' && context.packedIndexes.has(index)) return '';
    if (a === ':' && b === '{') return context.tightBraces.has(index) ? '' : ' ';
    if (a === ':' || b === ':' || a === '.' || b === '.' || a === '\\' || b === '\\') return original;
    if (right.kind === 'literal' && (a === '!' || a === right.escapeCharacter)) return original;
    const leftPrefix = prefixKind(tokens, index - 1, context);
    if (b === ',' || b === ';' || b === ')' || b === ']') gap = '';
    else if (a === '(' || a === '[') gap = '';
    else if (a === ',' || a === ';') gap = ' ';
    else if (leftPrefix === 'ambiguous') return original;
    else if (leftPrefix === 'yes') gap = '';
    else if (b === '(') {
        gap = CONTROL_PARENS.has(a) || a === 'return' || OPERATORS.has(a) ? ' ' : '';
    } else if (b === '[') gap = OPERATORS.has(a) ? ' ' : '';
    else if (a === '{' || b === '}') {
        const tight = (a === '{' && b === '}') || context.tightBraces.has(a === '{' ? index - 1 : index);
        gap = tight ? '' : ' ';
    } else if (b === '{' || a === '}') gap = ' ';
    else if (b === '++' || b === '--') {
        const rightPrefix = prefixKind(tokens, index, context);
        if (rightPrefix === 'ambiguous') return original;
        gap = rightPrefix === 'yes' ? ' ' : '';
    } else if (OPERATORS.has(a) || OPERATORS.has(b)) gap = ' ';
    else gap = original ? ' ' : '';

    // Removing a gap must never create a different operator or a comment.
    if (!gap && original && BOUNDARY_OPERATORS.some((operator) => operator.length > a.length && (a + b).startsWith(operator))) return ' ';
    return gap;
}
