/** Lossless tokens used only by the formatter, independent of symbol parsing. */
export interface FormatToken {
    kind: 'word' | 'number' | 'literal' | 'comment' | 'directive' | 'punct';
    text: string;
    start: number;
    end: number;
    line: number;
    endLine: number;
    escapeCharacter?: string;
}

export const OPERATORS = new Set([
    '>>>=', '>>>', '<<=', '>>=', '...', '++', '--', '==', '!=', '<=', '>=',
    '&&', '||', '<<', '>>', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
    '+', '-', '*', '/', '%', '=', '<', '>', '&', '|', '^', '!', '~', '?',
]);
const MULTI_OPERATORS = [...OPERATORS].filter((value) => value.length > 1);

export interface ScanResult {
    tokens: FormatToken[];
    protectedLines: Set<number>;
}

/** Return null for incomplete literals/comments or an unknown escape setting. */
export function scanFormattingTokens(source: string): ScanResult | null {
    const tokens: FormatToken[] = [];
    const protectedLines = new Set<number>();
    let offset = 0;
    let line = 0;
    let lineStart = 0;
    let escape = '^'; // AMX Mod X's default, unlike stock Pawn.
    let conditionalDepth = 0;

    const advance = () => {
        if (source[offset++] === '\n') {
            line++;
            lineStart = offset;
        }
    };

    while (offset < source.length) {
        if (/\s/.test(source[offset])) {
            advance();
            continue;
        }
        const start = offset;
        const startLine = line;
        let kind: FormatToken['kind'] = 'punct';
        const char = source[offset];
        const stringPrefix = [`!${escape}"`, `${escape}!"`, '!"', `${escape}"`, '"']
            .find((prefix) => source.startsWith(prefix, offset));

        if (char === '#' && /^[\t \uFEFF]*$/.test(source.slice(lineStart, offset))) {
            kind = 'directive';
            let quote = '';
            let lineComment = false;
            while (offset < source.length) {
                if (source[offset] === '\n') {
                    if (!/\\[\t ]*\r?$/.test(source.slice(start, offset))) break;
                    advance();
                } else if (lineComment) advance();
                else if (quote) {
                    const next = source[offset];
                    advance();
                    if (next === escape && offset < source.length) advance();
                    else if (next === quote) quote = '';
                } else if (source.startsWith('/*', offset)) {
                    advance();
                    advance();
                    while (offset < source.length && !source.startsWith('*/', offset)) advance();
                    if (offset === source.length) return null;
                    advance();
                    advance();
                } else if (source.startsWith('//', offset)) {
                    lineComment = true;
                } else {
                    if (source[offset] === '"' || source[offset] === "'") quote = source[offset];
                    advance();
                }
            }
            const directive = source.slice(start, offset);
            if (/^#\s*if(?:def|ndef)?\b/.test(directive)) conditionalDepth++;
            if (/^#\s*endif\b/.test(directive)) conditionalDepth--;
            const pragma = /^#\s*pragma\s+ctrlchar\b(.*)/.exec(directive);
            if (pragma) {
                // Conditional escape settings require evaluating the preprocessor.
                if (conditionalDepth !== 0) return null;
                const value = pragma[1].replace(/\/\/.*$/, '').trim();
                if (!value) escape = '^';
                else if (/^'.'$/.test(value)) escape = value[1];
                else if (/^(?:0x[\da-f]+|\d+)$/i.test(value)) {
                    const code = Number(value);
                    if (code < 1 || code > 127) return null;
                    escape = String.fromCharCode(code);
                } else return null;
            }
        } else if (source.startsWith('//', offset)) {
            kind = 'comment';
            do {
                while (offset < source.length && !/[\r\n]/.test(source[offset])) advance();
                if (!/\\[\t ]*$/.test(source.slice(start, offset)) || offset === source.length) break;
                if (source[offset] === '\r') advance();
                if (source[offset] === '\n') advance();
            } while (offset < source.length);
        } else if (source.startsWith('/*', offset)) {
            kind = 'comment';
            advance();
            advance();
            while (offset < source.length && !source.startsWith('*/', offset)) advance();
            if (offset === source.length) return null;
            advance();
            advance();
        } else if (stringPrefix || char === "'") {
            kind = 'literal';
            const quote = stringPrefix ? '"' : "'";
            for (let i = 0; i < (stringPrefix?.length ?? 1); i++) advance();
            let closed = false;
            while (offset < source.length) {
                const next = source[offset];
                const continuation = next === '\\' ? /^\\[\t ]*\r?\n/.exec(source.slice(offset)) : null;
                if (continuation) {
                    for (let i = 0; i < continuation[0].length; i++) advance();
                } else if (next === escape) {
                    advance();
                    if (offset < source.length) advance();
                } else if (next === quote) {
                    advance();
                    closed = true;
                    break;
                } else if (next === '\r' || next === '\n') {
                    return null;
                } else advance();
            }
            if (!closed) return null;
        } else if (/[A-Za-z_@]/.test(char)) {
            kind = 'word';
            do { advance(); } while (offset < source.length && /[A-Za-z_@\d]/.test(source[offset]));
        } else if (/\d/.test(char)) {
            kind = 'number';
            const number = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?)/.exec(source.slice(offset))!;
            for (let i = 0; i < number[0].length; i++) advance();
        } else {
            const operator = MULTI_OPERATORS.find((value) => source.startsWith(value, offset));
            for (let i = 0; i < (operator?.length ?? 1); i++) advance();
            // Keep explicit physical-line continuations byte-for-byte.
            if (char === '\\') {
                protectedLines.add(line);
                protectedLines.add(line + 1);
            }
        }

        tokens.push({ kind, text: source.slice(start, offset), start, end: offset, line: startLine, endLine: line,
            escapeCharacter: kind === 'literal' ? escape : undefined });
        if (kind === 'directive' || startLine !== line) {
            for (let i = startLine; i <= line; i++) protectedLines.add(i);
        }
    }
    return { tokens, protectedLines };
}
