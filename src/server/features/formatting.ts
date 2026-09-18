import { TextEdit, type FormattingOptions, type Range } from 'vscode-languageserver/node.js';
import { computeIndentation } from '../formatter/indentation.js';
import { scanFormattingTokens } from '../formatter/scanner.js';
import { analyzeSpacing, formatTokenGap } from '../formatter/spacing.js';

/**
 * Conservative whole-document formatting; each edit stays on one source line.
 * A range limits which lines are edited, while layout is still read from the whole document.
 */
export function provideDocumentFormatting(text: string, options: FormattingOptions, range?: Range): TextEdit[] {
    // LSP line positions here follow LF/CRLF. Leave legacy CR-only files intact.
    if (/\r(?!\n)/.test(text)) return [];
    if (!Number.isInteger(options.tabSize) || options.tabSize < 1 || options.tabSize > 256) return [];
    const scan = scanFormattingTokens(text);
    if (!scan) return [];
    const indentation = computeIndentation(scan.tokens);
    const context = analyzeSpacing(scan.tokens);
    const unit = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
    const lines = text.split('\n');
    const firstLine = range?.start.line ?? 0;
    // A selection ending at column 0 does not include that line.
    const lastLine = !range ? lines.length - 1
        : range.end.character === 0 && range.end.line > range.start.line ? range.end.line - 1 : range.end.line;
    const edits: TextEdit[] = [];
    let offset = 0;
    let tokenIndex = 0;

    for (let line = 0; line < lines.length && line <= lastLine; line++) {
        const original = lines[line].replace(/\r$/, '');
        const end = offset + original.length;
        while (tokenIndex < scan.tokens.length && scan.tokens[tokenIndex].end <= offset) tokenIndex++;
        const firstIndex = tokenIndex;
        while (tokenIndex < scan.tokens.length && scan.tokens[tokenIndex].start < end) tokenIndex++;

        if (line >= firstLine && !scan.protectedLines.has(line)) {
            let formatted = original;
            for (let i = tokenIndex - 1; i > firstIndex; i--) {
                const left = scan.tokens[i - 1];
                const right = scan.tokens[i];
                if (left.endLine !== line || right.line !== line) continue;
                const start = left.end - offset;
                const finish = right.start - offset;
                const gap = original.slice(start, finish);
                formatted = formatted.slice(0, start) + formatTokenGap(scan.tokens, i, gap, context) + formatted.slice(finish);
            }
            const depth = indentation?.get(line);
            if (depth !== undefined) formatted = formatted.replace(/^[\t ]*/, unit.repeat(depth));
            // Preserve comment contents, including intentional trailing spaces.
            const last = scan.tokens[tokenIndex - 1];
            const trim = options.trimTrailingWhitespace !== false;
            if (trim && (!last || last.endLine !== line || last.kind !== 'comment')) formatted = formatted.replace(/[\t ]+$/, '');
            if (formatted !== original) edits.push(TextEdit.replace({
                start: { line, character: 0 },
                end: { line, character: original.length },
            }, formatted));
        }
        offset += lines[line].length + 1;
    }
    return edits;
}
