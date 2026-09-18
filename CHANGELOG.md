# Changelog

All notable changes to the **AmxModX Language** extension are documented in this
file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Pawn document formatter for `.sma` and `.inc` through LSP, available through
  **Format Document**, **Format Selection**, and opt-in format-on-save. Uses
  editor indentation settings, formats block/control-body indentation and token
  spacing, and preserves physical line breaks, comments, literals, and
  preprocessor directives.
- `// #region <label>` / `// #endregion` folding markers, matched with or
  without the leading `#` (`// region` also works). The bare `#region`
  preprocessor form is **not** used, since `amxxpc` rejects it as an unknown
  directive.
- Banner-comment folding for `/*----[ Label ]----*/` and the legacy
  `/* = Label = */` shape. Each banner folds to the line before the next
  banner (or to EOF for the last one), so collapsing a section keeps the
  following banner visible.
- LSP `FoldingRangeProvider` that handles both region pairs (with nesting)
  and banner comments.
- Grammar scope `comment.block.banner.amxmodx` for dash-bracket banner
  comments, with the label captured as `meta.toc-list.banner.block.amxmodx`.
- Grammar scope `comment.line.region.amxmodx` /
  `keyword.control.import.region.amxmodx` for region markers, so themes can
  distinguish them from ordinary line comments.

### Fixed
- `#include <name> // trailing comment` (and the `/* … */` block-comment
  variant) no longer reports *"No extra characters are allowed after an
  #include statement"*. Trailing line and block comments are stripped
  before the tail is validated.
- Function names preceded by a tag prefix — e.g. `bool:funcName(...)` or
  `Float: compute(...)` — now receive the `entity.name.function.amxmodx`
  scope. The `labels-and-tags` rule previously consumed the tag and left
  the function name unstyled.

## [1.0.1] — 2026-07-19

### Added
- Modernized TextMate grammar rewritten as `amxmodx.tmLanguage.json`
  (replacing the plist XML). Improvements include split numeric-literal
  scopes (hex / binary / float / decimal with `_` separators), format
  specifier highlighting inside strings (`%d`, `%s`, `%.2f`, `%-5s`, the
  AMX Mod X `%L`, etc.), and dedicated `native`/`forward` name capture.

### Fixed
- False-positive **"Unmatched closing brace"** on files that use Pawn's
  optional-semicolon (`-;+`) style. The parser now treats another
  storage-class specifier, a preprocessor directive, or a `{` / `}` as an
  implicit terminator for a value declaration, so semicolon-less
  `new g_x` no longer swallows the following block.
- Assorted tag-related parsing problems (declarations, calls, and
  documentation comments involving `Tag:name` prefixes).

## [1.0.0] — 2026-07-17

Initial public release.

### Added
- Language server (LSP) for `.sma` and `.inc` files: diagnostics,
  document symbols / outline, hover, go-to-definition, signature help.
- Auto-completion with function-signature snippets: selecting a callable
  inserts its full parameter list as tab stops (`bind_pcvar_num(${1:pcvar}, ${2:&any:var})$0`).
- Syntax highlighting for AMX Mod X / Pawn (TextMate grammar).
- Compiler integration via the `amxmodx.compile` and
  `amxmodx.compileLocal` commands, with configurable executable path,
  include paths, and output handling.
- Auto-detection of [`amxxpack`](https://github.com/hedgefog/node-amxxpack)
  projects via `.amxxpack.json`.
- Localization: English and Ukrainian message bundles.
- README with setup / configuration guide and GPL-3.0 `LICENSE.md`.

[Unreleased]: https://github.com/MrCatOff/amxmodx-vs-extension/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/MrCatOff/amxmodx-vs-extension/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/MrCatOff/amxmodx-vs-extension/releases/tag/v1.0.0
