import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { FormattingOptions, Range } from 'vscode-languageserver/node.js';
import { scanFormattingTokens } from '../formatter/scanner.js';
import { provideDocumentFormatting } from './formatting.js';

function format(source: string, options: FormattingOptions = { tabSize: 4, insertSpaces: true }): string {
    const document = TextDocument.create('file:///plugin.sma', 'amxmodx', 1, source);
    return TextDocument.applyEdits(document, provideDocumentFormatting(source, options));
}

const examples: [string, string, string][] = [
    ['blocks and operators',
        'public plugin_init( )\n{\nnew x=1+2;\nif(x>0){\nx+=1;\n}\n}\n',
        'public plugin_init()\n{\n    new x = 1 + 2;\n    if (x > 0) {\n        x += 1;\n    }\n}\n'],
    ['optional semicolons',
        'public test()\n{\nnew x=1\nnew y=2\nx=x+y\n}\n',
        'public test()\n{\n    new x = 1\n    new y = 2\n    x = x + y\n}\n'],
    ['unbraced nested controls and dangling else',
        'public test() {\nif(a)\nif(b)\nfoo()\nelse\nbar()\nbaz()\n}',
        'public test() {\n    if (a)\n        if (b)\n            foo()\n        else\n            bar()\n    baz()\n}'],
    ['else if and braced bodies',
        'public test()\n{\nif(a)\n{\na()\n}\nelse if(b)\nb()\nelse\n{\nc()\n}\n}',
        'public test()\n{\n    if (a)\n    {\n        a()\n    }\n    else if (b)\n        b()\n    else\n    {\n        c()\n    }\n}'],
    ['for and do while',
        'public test(){\nfor(new i=0;i<3;i++)\nwork(i);\ndo\nwork();\nwhile(ready);\n}',
        'public test() {\n    for (new i = 0; i < 3; i++)\n        work(i);\n    do\n        work();\n    while (ready);\n}'],
    ['multiline calls',
        'public test()\n{\ncall(\n1,2,\n3\n)\n}',
        'public test()\n{\n    call(\n        1, 2,\n        3\n    )\n}'],
    ['array literals and indices',
        'new values[ ]={\n1,2,3\n};\npublic test(){\nvalues[ 1 ]=4;\n}',
        'new values[] = {\n    1, 2, 3\n};\npublic test() {\n    values[1] = 4;\n}'],
    ['tags and unary operators',
        'public Float:test(Float:value){\nnew Float:x=-1.0;\nx=value*-2.0;\nreturn !ready;\n}',
        'public Float:test(Float:value) {\n    new Float:x = -1.0;\n    x = value * -2.0;\n    return !ready;\n}'],
    ['switch labels',
        'public test(){\nswitch(x){\ncase 1,2:\nfoo();\ncase 3:{\nbar();\n}\ndefault:\nbaz();\n}\n}',
        'public test() {\n    switch (x) {\n        case 1, 2:\n            foo();\n        case 3: {\n            bar();\n        }\n        default:\n            baz();\n    }\n}'],
    ['single-line blocks stay on one line',
        'public test( ){new x=1;call(x,2);}',
        'public test() { new x = 1; call(x, 2); }'],
    ['comments retain their text and separation',
        'public test(){\n// a  comment   \nnew x=1;  // keep  alignment   \n/* block  comment */\n}',
        'public test() {\n    // a  comment   \n    new x = 1;  // keep  alignment   \n    /* block  comment */\n}'],
    ['include guards and macros',
        '#if defined _test_included\n  #endinput\n#endif\n#define _test_included\n#define SUM(%1,%2) ((%1)+(%2))\npublic test(){\nfoo(1,2);\n}',
        '#if defined _test_included\n  #endinput\n#endif\n#define _test_included\n#define SUM(%1,%2) ((%1)+(%2))\npublic test() {\n    foo(1, 2);\n}'],
    ['unary operators before parentheses',
        'public test(){\nif(!(a&&b)) x=-(a+b);\nx=(a)-(b);\nx=!!(a);\nreturn -(x);\n}',
        'public test() {\n    if (!(a && b)) x = -(a + b);\n    x = (a) - (b);\n    x = !!(a);\n    return -(x);\n}'],
    ['prefix operators after control conditions',
        'public test(){\nif(a) ++i;\nelse --i;\nwhile(x) -y;\nfor(;;) ++i;\ndo ++i; while(i<3);\n}',
        'public test() {\n    if (a) ++i;\n    else --i;\n    while (x) -y;\n    for (;;) ++i;\n    do ++i; while (i < 3);\n}'],
    ['reference parameters',
        'stock foo(&x,const &Float:y){\nx=a&b;\nfoo(a,&b);\nif(a&&b){}\n}',
        'stock foo(&x, const &Float:y) {\n    x = a & b;\n    foo(a, &b);\n    if (a && b) {}\n}'],
    ['tag groups',
        'stock foo({Float,_}:...){\n}\nnative bar(const {Float,_}:value);',
        'stock foo({Float, _}:...) {\n}\nnative bar(const {Float, _}:value);'],
    ['single-line initializers hug their braces',
        'new Float:v[3]={0.0,1.0,2.0};\nnew m[2][2]={ {1,2},{3,4} };\nstock f(a[]={1,2}){\nif(a){x();}\n}\nenum E {A,B}',
        'new Float:v[3] = {0.0, 1.0, 2.0};\nnew m[2][2] = {{1, 2}, {3, 4}};\nstock f(a[] = {1, 2}) {\n    if (a) { x(); }\n}\nenum E { A, B }'],
    ['state declarations',
        'public a() <idle> {\n}\npublic b()<idle,busy>{\n}\npublic c() <> {\n}\npublic d(){\nx=(a)<b;\nif((a)<b>c){}\n}',
        'public a() <idle> {\n}\npublic b() <idle, busy> {\n}\npublic c() <> {\n}\npublic d() {\n    x = (a) < b;\n    if ((a) < b > c) {}\n}'],
    ['ternary colons when unambiguous',
        'public test(){\nx=a?1:2;\nx=a?(b):c;\nx=a ? Float:b : c;\nx=a?b:c;\nx=f(a?-1:2);\n}',
        'public test() {\n    x = a ? 1 : 2;\n    x = a ? (b) : c;\n    x = a ? Float:b : c;\n    x = a ? b:c;\n    x = f(a ? -1 : 2);\n}'],
    ['operator overloads',
        'native Float:operator*(Float:a,Float:b)=floatmul;\nstock bool:operator ! (Float:a)\n{\nreturn a==0.0;\n}\nstock bool:operator==(Float:a,Float:b)\n{\nreturn a!=b;\n}',
        'native Float:operator*(Float:a, Float:b) = floatmul;\nstock bool:operator!(Float:a)\n{\n    return a == 0.0;\n}\nstock bool:operator==(Float:a, Float:b)\n{\n    return a != b;\n}'],
    ['packed array indexes and retagged literals',
        'public test(){\nflags{ id }=true;\nif(flags{id}&&rows[1]{2}){}\nfoo(Float:{0.0,1.0},Float:{1.0});\nnew Float:v[3]=Float:{0.0,0.0,0.0};\nswitch(x){\ncase X:{\n}\n}\n}\nenum Data{A,B}\nenum _:Info{C}',
        'public test() {\n    flags{id} = true;\n    if (flags{id} && rows[1]{2}) {}\n    foo(Float:{0.0, 1.0}, Float:{1.0});\n    new Float:v[3] = Float:{0.0, 0.0, 0.0};\n    switch (x) {\n        case X: {\n        }\n    }\n}\nenum Data { A, B }\nenum _:Info { C }'],
    ['operators leading a continued line keep their gap',
        'public test(){\nnew x=a\n- b;\nnew y=c\n-d;\nfoo();\n-x;\n}',
        'public test() {\n    new x = a\n        - b;\n    new y = c\n        -d;\n    foo();\n    -x;\n}'],
];

describe('document formatting', () => {
    it.each(examples)('%s', (_name, source, expected) => {
        const result = format(source);
        expect(result).toBe(expected);
        expect(format(result)).toBe(result);
        expect(scanFormattingTokens(result)?.tokens.map((token) => [token.kind, token.text]))
            .toEqual(scanFormattingTokens(source)?.tokens.map((token) => [token.kind, token.text]));
    });

    it('uses editor indentation settings', () => {
        const source = 'public test(){\ncall();\n}\n';
        expect(format(source, { tabSize: 2, insertSpaces: true })).toContain('\n  call();');
        expect(format(source, { tabSize: 8, insertSpaces: false })).toContain('\n\tcall();');
    });

    it('keeps CRLF, blank lines, and a missing final newline', () => {
        expect(format('public test(){\r\n\r\ncall(1,2);\r\n}'))
            .toBe('public test() {\r\n\r\n    call(1, 2);\r\n}');
    });

    it('preserves Pawn escapes, character literals, and backslashes', () => {
        const source = 'public test(){\nprint("a ^"quoted^" string // { }");\nnew c=\'^\'\';\nprint("C:\\folder\\");\n}';
        const result = format(source);
        expect(result).toContain('    print("a ^"quoted^" string // { }");');
        expect(result).toContain("    new c = '^\'';");
        expect(result).toContain('    print("C:\\folder\\");');
        expect(format(result)).toBe(result);
    });

    it.each(["'\\'", '92', '0x5c'])('respects ctrlchar %s', (value) => {
        const source = `#pragma ctrlchar ${value}\npublic test(){\nprint("escaped \\" quote");\n}`;
        expect(format(source)).toContain('    print("escaped \\" quote");');
    });

    it('preserves multiline macros, comments, and strings byte-for-byte', () => {
        const macro = '#define EXAMPLE(%1) \\\n  if (%1) { \\\n work(); }';
        const comment = '/* comment\n   uneven  text\n */';
        const literal = 'print("first \\\n  second");';
        const source = `${macro}\npublic test(){\n${comment}\n${literal}\nnew x=1;\n}`;
        const result = format(source);
        expect(result).toContain(macro);
        expect(result).toContain(comment);
        expect(result).toContain(literal);
        expect(result).toContain('    new x = 1;');
        expect(format(result)).toBe(result);
    });

    it('preserves continuation lines with trailing spaces after the backslash', () => {
        const macro = '#define EXAMPLE(%1) \\   \n   work(%1);';
        const literal = 'print("first \\   \n  second");';
        const source = `${macro}\npublic test(){\n${literal}\nnew x=1;\n}`;
        const result = format(source);
        expect(result).toContain(macro);
        expect(result).toContain(literal);
        expect(result).toContain('    new x = 1;');
        expect(format(result)).toBe(result);
    });

    it('leaves legacy CR-only documents unchanged', () => {
        const source = 'public test(){\rcall(1,2);\r}';
        expect(format(source)).toBe(source);
    });

    it.each([0, -1, 1.5, Infinity, NaN, 1000000])('declines invalid or excessive tabSize %s', (tabSize) => {
        expect(format('new x=1;', { tabSize, insertSpaces: true })).toBe('new x=1;');
    });

    it('never merges separate operators', () => {
        const source = 'public test(){\nnew x=a+ +b;\nnew y=a- -b;\nnew z=+ +a;\nnew w=+ ++a;\n}';
        const result = format(source);
        expect(result).toContain('a + +b');
        expect(result).toContain('a - -b');
        expect(result).toContain('+ +a');
        expect(result).toContain('+ ++a');
        expect(scanFormattingTokens(result)?.tokens.map((t) => t.text))
            .toEqual(scanFormattingTokens(source)?.tokens.map((t) => t.text));
    });

    it('preserves multiline comments that start inside a directive', () => {
        const directive = '#define VALUE 1 /* comment\n  comment with { and x=1\n*/';
        const source = `${directive}\npublic test(){\ncall();\n}`;
        expect(format(source)).toBe(`${directive}\npublic test() {\n    call();\n}`);
    });

    it('preserves continued line comments', () => {
        const source = 'public test(){\n// comment \\\ntext=unchanged;\ncall();\n}';
        expect(format(source)).toBe('public test() {\n// comment \\\ntext=unchanged;\n    call();\n}');
    });

    it('keeps literal prefixes attached or separated as originally written', () => {
        const source = 'new a[]=!"packed";\nnew b=! "other";';
        expect(format(source)).toBe('new a[] = !"packed";\nnew b = ! "other";');
    });

    it.each(['^', '!', '!^', '^!'])('preserves the string prefix %s', (prefix) => {
        const source = `new text[]=${prefix}"raw ^n text";`;
        expect(format(source)).toBe(`new text[] = ${prefix}"raw ^n text";`);
        expect(format(format(source))).toBe(format(source));
    });

    it('preserves raw string prefixes with a custom escape character', () => {
        const source = '#pragma ctrlchar 64\nnew text[]=@!"raw @n text";';
        expect(format(source)).toBe('#pragma ctrlchar 64\nnew text[] = @!"raw @n text";');
    });

    it('retains indentation when conditional branches share an opening brace', () => {
        const source = '#if TEST\npublic foo(){\n#else\npublic bar(){\n#endif\n  call(1,2);\n}';
        expect(format(source)).toContain('\n  call(1, 2);\n');
    });

    it('formats independently balanced conditional branches', () => {
        const source = 'public test(){\n#if TEST\nif(a){\ncall();\n}\n#else\nother();\n#endif\n}';
        expect(format(source)).toBe('public test() {\n#if TEST\n    if (a) {\n        call();\n    }\n#else\n    other();\n#endif\n}');
    });

    it.each(['"unfinished', '/* unfinished', '#pragma ctrlchar UNKNOWN\nnew x=1;',
        '#if TEST\n#pragma ctrlchar 92\n#endif\nnew x=1;'])('declines unsafe lexical input: %s', (source) => {
        expect(provideDocumentFormatting(source, { tabSize: 4, insertSpaces: true })).toEqual([]);
    });

    it('keeps existing indentation when delimiters are incomplete', () => {
        expect(format('public test(){\n  new x=1;')).toBe('public test() {\n  new x = 1;');
    });

    it('indents long else-if chains', () => {
        const source = 'public test(){\nif(a) x();\n' + 'else if(a) x();\n'.repeat(300) + 'call(1,2);\n}';
        const lines = format(source).split('\n');
        expect(lines.slice(1, -1).every((line) => line.startsWith('    ') && !line.startsWith('     '))).toBe(true);
    });

    it('formats only the lines of a range', () => {
        const source = 'public test(){\nnew a=1;\nnew b=2;\nnew c=3;\n}';
        const edits = (range: Range) => TextDocument.applyEdits(
            TextDocument.create('file:///plugin.sma', 'amxmodx', 1, source),
            provideDocumentFormatting(source, { tabSize: 4, insertSpaces: true }, range));
        expect(edits({ start: { line: 2, character: 0 }, end: { line: 2, character: 3 } }))
            .toBe('public test(){\nnew a=1;\n    new b = 2;\nnew c=3;\n}');
        expect(edits({ start: { line: 1, character: 0 }, end: { line: 3, character: 0 } }))
            .toBe('public test(){\n    new a = 1;\n    new b = 2;\nnew c=3;\n}');
    });

    it('keeps trailing whitespace when trimTrailingWhitespace is false', () => {
        expect(format('new x=1;   ', { tabSize: 4, insertSpaces: true, trimTrailingWhitespace: false }))
            .toBe('new x = 1;   ');
    });

    it('returns no edits for an already formatted document', () => {
        const source = examples[0][2];
        expect(provideDocumentFormatting(source, { tabSize: 4, insertSpaces: true })).toEqual([]);
        expect(format('')).toBe('');
    });
});
