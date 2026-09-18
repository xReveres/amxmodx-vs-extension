import { OPERATORS, type FormatToken } from './scanner.js';

const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const CONTROLS = new Set(['if', 'while', 'for', 'switch']);

/**
 * A small layout reader, not a semantic parser. It recognizes statement bodies
 * so an unbraced if/else is indented without moving physical line boundaries.
 * Ambiguous or incomplete structure leaves the original indentation intact.
 */
export function computeIndentation(tokens: FormatToken[]): Map<number, number> | null {
    // Branches that open/close a shared scope need preprocessor evaluation.
    // Only reindent branches whose delimiters are independently balanced.
    const delimiters: string[] = [];
    const branches: number[] = [];
    for (const token of tokens) {
        if (token.kind === 'directive') {
            if (/^#\s*if(?:def|ndef)?\b/.test(token.text)) branches.push(delimiters.length);
            else if (/^#\s*(?:else|elseif|endif)\b/.test(token.text)) {
                if (branches.length === 0 || branches[branches.length - 1] !== delimiters.length) return null;
                if (/^#\s*endif\b/.test(token.text)) branches.pop();
            }
        } else if (token.kind === 'punct') {
            if (PAIRS[token.text]) delimiters.push(PAIRS[token.text]);
            else if (/^[)\]}]$/.test(token.text)) {
                if (branches.length && delimiters.length <= branches[branches.length - 1]) return null;
                if (delimiters.pop() !== token.text) return null;
            }
        }
    }
    if (branches.length || delimiters.length) return null;
    const reader = new LayoutReader(tokens);
    return reader.read() ? reader.lines : null;
}

class LayoutReader {
    readonly lines = new Map<number, number>();
    private index = 0;
    private recursion = 0;

    constructor(private readonly tokens: FormatToken[]) {}

    read(): boolean {
        while (this.index < this.tokens.length) {
            if (!this.statement(0)) return false;
        }
        return true;
    }

    private text(): string {
        return this.tokens[this.index]?.text ?? '';
    }

    private take(depth: number): FormatToken {
        const token = this.tokens[this.index++];
        if (!this.lines.has(token.line)) this.lines.set(token.line, depth);
        return token;
    }

    private comments(depth: number): void {
        while (this.tokens[this.index]?.kind === 'comment') this.take(depth);
    }

    private group(depth: number): boolean {
        if (++this.recursion > 128) return false;
        const result = this.groupInner(depth);
        this.recursion--;
        return result;
    }

    private groupInner(depth: number): boolean {
        const close = PAIRS[this.take(depth).text];
        while (this.index < this.tokens.length && this.text() !== close) {
            const token = this.tokens[this.index];
            if (token.kind === 'punct' && PAIRS[token.text]) {
                if (!this.group(depth + 1)) return false;
            } else if (/^[)\]}]$/.test(token.text) || token.kind === 'directive') {
                return false;
            } else this.take(depth + 1);
        }
        if (this.text() !== close) return false;
        this.take(depth);
        return true;
    }

    private body(depth: number): boolean {
        this.comments(depth + 1);
        // A directive between a control and its body makes ownership uncertain.
        if (this.index === this.tokens.length || this.tokens[this.index]?.kind === 'directive') return false;
        return this.statement(this.text() === '{' ? depth : depth + 1);
    }

    private statement(depth: number): boolean {
        if (++this.recursion > 128) return false;
        const result = this.statementInner(depth);
        this.recursion--;
        return result;
    }

    private statementInner(depth: number): boolean {
        this.comments(depth);
        if (this.index === this.tokens.length) return true;
        const first = this.tokens[this.index];
        if (first.kind === 'directive') {
            this.take(depth);
            return true;
        }
        if (first.text === '{') {
            this.take(depth);
            let caseBody = false;
            while (this.index < this.tokens.length) {
                this.comments(depth + 1 + Number(caseBody));
                if (this.text() === '}') {
                    this.take(depth);
                    return true;
                }
                if (this.text() === 'case' || this.text() === 'default') {
                    while (this.index < this.tokens.length && this.text() !== ':') {
                        if (/^[{}]$/.test(this.text())) return false;
                        this.take(depth + 1);
                    }
                    if (this.text() !== ':') return false;
                    this.take(depth + 1);
                    caseBody = this.text() !== '{';
                    continue;
                }
                if (!this.statement(depth + 1 + Number(caseBody))) return false;
            }
            return false;
        }
        if (CONTROLS.has(first.text)) {
            // Iterate `else if` chains so their length does not count toward the recursion limit.
            let keyword = first.text;
            for (;;) {
                this.take(depth);
                this.comments(depth);
                if (this.text() !== '(' || !this.group(depth)) return false;
                if (!this.body(depth)) return false;
                if (keyword !== 'if') return true;
                this.comments(depth);
                if (this.text() !== 'else') return true;
                this.take(depth);
                this.comments(depth);
                if (this.text() !== 'if') return this.body(depth);
                keyword = 'if';
            }
        }
        if (first.text === 'do') {
            this.take(depth);
            if (!this.body(depth)) return false;
            this.comments(depth);
            if (this.text() !== 'while') return false;
            this.take(depth);
            if (this.text() !== '(' || !this.group(depth)) return false;
            if (this.text() === ';') this.take(depth);
            return true;
        }

        let initializer = first.text === 'enum';
        let previous = '';
        let previousLine = first.line;
        while (this.index < this.tokens.length) {
            const token = this.tokens[this.index];
            if (token.kind === 'directive' || token.text === '}') break;
            if (token.line > previousLine && previous && token.text !== '{'
                && previous !== ',' && previous !== '\\'
                && !(OPERATORS.has(previous) && previous !== '++' && previous !== '--')
                && !OPERATORS.has(token.text)) break;
            const tokenDepth = depth + Number(token.line > first.line);
            if (token.text === ';') {
                this.take(depth);
                return true;
            }
            if (token.text === '{' && !initializer) return this.statement(depth);
            if (token.text === '(' || token.text === '[' || token.text === '{') {
                if (!this.group(depth)) return false;
                previous = this.tokens[this.index - 1].text;
                previousLine = this.tokens[this.index - 1].endLine;
                continue;
            }
            if (/^[)\]]$/.test(token.text)) return false;
            if (token.text === '=') initializer = true;
            this.take(tokenDepth);
            if (token.kind !== 'comment') previous = token.text;
            previousLine = token.endLine;
        }
        return this.tokens[this.index] !== first;
    }
}
