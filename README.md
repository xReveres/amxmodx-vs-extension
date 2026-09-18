# AmxModX Language

Modern VS Code language support for [AMX Mod X](https://www.amxmodx.org/) Pawn — completion, signature help, hover, go-to-definition, `#include` navigation, in-editor diagnostics, and a one-key path to `amxxpc` compilation.

Built on the Language Server Protocol, ships a bundled TypeScript client + server, understands both flat workspaces and [node-amxxpack](https://github.com/hedgefog/node-amxxpack) projects, and localizes into English and Ukrainian.

## Highlights

- **Fluent editing** — completion with parameter tab-stops, signature help, hover documentation, symbol outline, go-to-definition on both identifiers and `#include` targets.
- **Live diagnostics** — a custom Pawn parser flags unmatched braces, malformed `#include`s, unresolved include paths, illegal specifier combinations, and more, as you type.
- **Document formatting** — block and control-body indentation, operator spacing, and argument spacing for `.sma` and `.inc`, using the editor's tab or space settings.
- **amxxpc integration** — compile the current file with one command, with output routed to a dedicated channel and warnings/errors surfaced in the Problems panel.
- **node-amxxpack aware** — auto-detects `.amxxpack.json` at the workspace root and merges its `input.include` / `include[]` entries into the include-resolution path.
- **Path variables** — `${workspaceFolder}`, `${env:VarName}`, and the rest are expanded in include paths, compiler paths, and output paths.
- **Localized** — UI (settings, commands) and runtime messages (diagnostics, compile output) available in English and Ukrainian; VS Code's UI language picks automatically.

## Requirements

- VS Code `>= 1.95`
- Node `>= 20` (only needed for building from source)
- An `amxxpc` binary for compilation (part of the AMX Mod X scripting distribution)

## Getting started

1. Install the extension from the Marketplace, or build a VSIX from source (see [Development](#development)).
2. Open a folder containing a `.sma` or `.inc` file — the extension activates automatically.
3. Point `amxmodx.compiler.executablePath` at your `amxxpc` binary (or drop `amxxpc` next to your `.sma` and use the *Compile Local* variant).
4. Run **AmxModX: Compile plugin** from the command palette. Output lands in the "AmxModX Compiler" output channel; warnings and errors show up in the Problems panel.

For workspaces built with [node-amxxpack](https://github.com/hedgefog/node-amxxpack), just drop a `.amxxpack.json` at the root — the extension picks up the include paths defined there without any extra configuration. See the [zombie-panic sample project](https://github.com/hedgefog/cs-zombie-panic) for a real-world layout.

## Commands

| Command ID | Title | What it does |
| --- | --- | --- |
| `amxmodx.compile` | AmxModX: Compile plugin | Compiles the active `.sma` with `amxmodx.compiler.executablePath`. |
| `amxmodx.compileLocal` | AmxModX: Compile plugin (local amxxpc) | Same, but uses an `amxxpc` binary sitting next to the source file. Useful for portable AMX Mod X distributions. |

## Settings

### Formatting

Run **Format Document** or **Format Selection** with a `.sma` or `.inc` file in
**AmxModX** language mode.
To select this extension as the formatter and optionally format on save, add:

```json
"[amxmodx]": {
    "editor.defaultFormatter": "MrCatOff.amxmodx-language",
    "editor.formatOnSave": true,
    "editor.insertSpaces": true,
    "editor.tabSize": 4
}
```

The first version keeps existing line breaks, blank lines, brace placement,
semicolons, line endings, and literal/comment contents. Preprocessor directives
and their continuation lines are preserved. Lines containing multiline comments,
multiline strings, or explicit continuations are also preserved verbatim.

Formatting does not expand macros or evaluate conditional compilation. Uncertain
or incomplete structure retains its existing indentation; incomplete strings or
comments and unsupported `#pragma ctrlchar` settings leave the document unchanged.
Spacing around tag and label colons is preserved; a ternary colon is spaced only
when it cannot be a tag (`a ? 1 : 2`, but `a?b:c` is left as written). Single-line
array initializers, tag groups, and packed-array indexes hug their braces
(`{0.0, 1.0}`, `{Float,_}:`, `name{i}`). Trailing whitespace is kept when
`files.trimTrailingWhitespace` is off. Automatic line wrapping and configurable
brace styles are not included yet.

### Extension settings

All settings live under the `amxmodx.*` namespace.

### Project

| Setting | Type | Default | Purpose |
| --- | --- | --- | --- |
| `amxmodx.project.type` | `"auto" \| "default" \| "amxxpack"` | `"auto"` | How the workspace layout should be interpreted. `auto` uses amxxpack if a config file is present, otherwise falls back to `amxmodx.compiler.*`. `default` ignores the config file; `amxxpack` requires it. |
| `amxmodx.project.configFile` | `string` | `.amxxpack.json` | Path (relative to the workspace root, or absolute) to the amxxpack config file. |

### Language service

| Setting | Type | Default | Purpose |
| --- | --- | --- | --- |
| `amxmodx.language.reparseInterval` | `number` (ms) | `1500` | Debounce window before the server reparses on typing. |
| `amxmodx.language.webApiLinks` | `boolean` | `true` | Turn `#include` filenames into clickable document links. |

### Compiler

| Setting | Type | Default | Purpose |
| --- | --- | --- | --- |
| `amxmodx.compiler.executablePath` | `string` | `""` | Path to `amxxpc`. Supports `${workspaceFolder}`, `${env:VarName}`, and the other standard VS Code path variables. |
| `amxmodx.compiler.includePaths` | `string[]` | `[]` | Extra directories searched for `#include` files. Merged with amxxpack-derived paths when applicable. |
| `amxmodx.compiler.options` | `string[]` | `[]` | Extra command-line flags forwarded to `amxxpc`. |
| `amxmodx.compiler.outputType` | `"source" \| "path"` | `"source"` | Where the compiled `.amxx` file lands — next to the source, or in the directory named by `outputPath`. |
| `amxmodx.compiler.outputPath` | `string` | `""` | Destination directory when `outputType` is `path`. |
| `amxmodx.compiler.showInfoMessages` | `boolean` | `false` | Show information-level messages in addition to warnings and errors. |
| `amxmodx.compiler.reformatOutput` | `boolean` | `true` | Rewrite `amxxpc`'s output into a cleaner, VS Code-friendly form in the output channel. |
| `amxmodx.compiler.switchToOutput` | `boolean` | `true` | Focus the output channel automatically when a compile starts. |

## Localization

The extension ships with two locale bundles:

- **English** — `package.nls.json` + `l10n/bundle.l10n.json` (default, always loaded).
- **Ukrainian** — `package.nls.uk.json` + `l10n/bundle.l10n.uk.json`.

VS Code picks the right bundle based on the installed language pack (Command Palette → *Configure Display Language*). To contribute another locale, drop `package.nls.<locale>.json` at the repo root and `l10n/bundle.l10n.<locale>.json` alongside — no code changes required.

## Development

The client and server are both TypeScript, bundled with esbuild.

```bash
npm install          # install dependencies
npm run build        # bundle client + server into dist/
npm run watch        # rebuild on change
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint 9 flat config
npm test             # Vitest unit tests
npm run test:integration   # @vscode/test-electron integration tests
npm run package      # produce a .vsix via @vscode/vsce
```

Layout:

```
src/
  client/            # VS Code extension host code (activation, commands, LSP client)
    compiler/        # amxxpc invocation, output routing
  server/            # LSP server: parser + feature providers
    features/        # completion, definition, hover, signature help, ...
    parser/          # tokenizer + parser
    workspace/       # include resolver, dependency manager, symbol collector
  shared/            # cross-boundary code (settings, path variables, l10n, amxxpack config)
l10n/                # runtime string bundles (l10n.t())
package.nls*.json    # static contribution translations
syntaxes/            # TextMate grammars
snippets/            # user-facing code snippets
```

Loading the extension in a debug window: open this folder in VS Code and press `F5`.

## License

Distributed under the terms of the **GNU General Public License v3.0**. See [LICENSE.md](./LICENSE.md) for the full text.
