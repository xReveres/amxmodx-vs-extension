import * as fs from 'node:fs';
import * as Path from 'node:path';
import {
    createConnection,
    DiagnosticSeverity,
    ProposedFeatures,
    TextDocuments,
    TextDocumentSyncKind,
    type Diagnostic,
    type InitializeParams,
    type InitializeResult,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { initL10n, t } from '../shared/l10n.js';
import { resolveProject, type ResolvedProject } from '../shared/project.js';
import type { SyncedSettings } from '../shared/settings.js';
import { provideCompletions } from './features/completion.js';
import { provideDefinition } from './features/definition.js';
import { buildIncludeLinks } from './features/document-links.js';
import { provideDocumentSymbols } from './features/document-symbols.js';
import { provideFoldingRanges } from './features/folding.js';
import { provideDocumentFormatting } from './features/formatting.js';
import { provideHover } from './features/hover.js';
import { provideSignatureHelp } from './features/signature.js';
import { DIAGNOSTIC_SOURCE, parse } from './parser/parser.js';
import { DocumentData } from './types.js';
import { FileDependencyManager, type FileDependency } from './workspace/dependency-manager.js';
import { resolveIncludePath } from './workspace/include-resolver.js';
import {
    collectSymbols,
    pruneUnreachableDependencies,
    releaseDependencies,
} from './workspace/symbol-collector.js';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

const dependencyManager = new FileDependencyManager();
const documentsData = new WeakMap<TextDocument, DocumentData>();
const dependenciesData = new WeakMap<FileDependency, DocumentData>();

let syncedSettings: SyncedSettings = defaultSettings();
let workspaceRootPath: string | undefined;
let resolvedProject: ResolvedProject = {
    active: false,
    config: undefined,
    configPath: undefined,
    includePaths: [],
    errors: [],
};

function defaultSettings(): SyncedSettings {
    return {
        compiler: {
            executablePath: '',
            includePaths: [],
            options: [],
            outputType: 'source',
            outputPath: '',
            showInfoMessages: false,
            reformatOutput: true,
            switchToOutput: true,
        },
        language: { reparseInterval: 1500, webApiLinks: true },
        project: { type: 'auto', configFile: '.amxxpack.json' },
    };
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
    if (params.rootUri) {
        workspaceRootPath = URI.parse(params.rootUri).fsPath;
    } else if (params.workspaceFolders && params.workspaceFolders.length > 0) {
        workspaceRootPath = URI.parse(params.workspaceFolders[0].uri).fsPath;
    }

    const opts = params.initializationOptions as
        | { locale?: string; l10nBundlePath?: string }
        | undefined;
    const locale = params.locale ?? opts?.locale;
    if (opts?.l10nBundlePath) initL10n(opts.l10nBundlePath, locale);

    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Full,
            documentLinkProvider: { resolveProvider: false },
            definitionProvider: true,
            signatureHelpProvider: { triggerCharacters: ['(', ','] },
            documentSymbolProvider: true,
            foldingRangeProvider: true,
            documentFormattingProvider: true,
            completionProvider: {
                resolveProvider: false,
                triggerCharacters: ['(', ',', '=', '@'],
            },
            hoverProvider: true,
        },
    };
});

connection.onInitialized(() => {
    // Settings arrive via didChangeConfiguration; do an initial best-effort
    // resolution here so amxxpack is picked up even before the client pushes
    // its first configuration change.
    refreshProjectResolution();
});

connection.onDidChangeConfiguration((params) => {
    const raw = params.settings?.amxmodx as Partial<SyncedSettings> | undefined;
    if (!raw) return;

    const defaults = defaultSettings();
    syncedSettings = {
        compiler: { ...defaults.compiler, ...raw.compiler },
        language: { ...defaults.language, ...raw.language },
        project: { ...defaults.project, ...raw.project },
    };

    refreshProjectResolution();
    for (const doc of documents.all()) reparseDocument(doc);
});

connection.onDidChangeWatchedFiles((params) => {
    if (!syncedSettings.project) return;
    if (!resolvedProject.configPath) return;
    const configUri = URI.file(resolvedProject.configPath).toString();

    const configChanged = params.changes.some((c) => c.uri === configUri);
    if (!configChanged) return;

    connection.console.info(
        t('amxxpack config changed at {0}; reloading.', resolvedProject.configPath),
    );
    refreshProjectResolution();
    for (const doc of documents.all()) reparseDocument(doc);
});

function refreshProjectResolution(): void {
    resolvedProject = resolveProject(syncedSettings.project, syncedSettings.compiler, workspaceRootPath);
    for (const err of resolvedProject.errors) connection.console.warn(err);
    if (resolvedProject.active) {
        connection.console.info(
            t(
                'amxxpack mode active ({0}); {1} include path(s).',
                resolvedProject.configPath ?? '',
                String(resolvedProject.includePaths.length),
            ),
        );
    }
}

connection.onDocumentLinks((params) => {
    if (!syncedSettings.language.webApiLinks) return null;
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    const data = documentsData.get(document);
    if (!data) return null;
    return buildIncludeLinks(data.resolvedInclusions);
});

connection.onDefinition((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    const data = documentsData.get(document);
    if (!data) return null;

    for (const inc of data.resolvedInclusions) {
        if (
            params.position.line === inc.descriptor.start.line &&
            params.position.character > inc.descriptor.start.character &&
            params.position.character < inc.descriptor.end.character
        ) {
            return {
                uri: inc.uri,
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 1 },
                },
            };
        }
    }

    return provideDefinition(document.getText(), params.position, data, dependenciesData);
});

connection.onSignatureHelp((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    const data = documentsData.get(document);
    if (!data) return null;
    const { callables } = collectSymbols(data, dependenciesData);
    return provideSignatureHelp(document.getText(), params.position, callables);
});

connection.onDocumentSymbol((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    const data = documentsData.get(document);
    if (!data) return [];
    return provideDocumentSymbols(params.textDocument.uri, data);
});

connection.onFoldingRanges((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    return provideFoldingRanges(document.getText());
});

connection.onDocumentFormatting((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    return provideDocumentFormatting(document.getText(), params.options);
});

connection.onCompletion((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    const data = documentsData.get(document);
    if (!data) return null;
    const items = provideCompletions(document.getText(), params.position, data, dependenciesData);
    return items ? { isIncomplete: true, items } : null;
});

connection.onHover((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    const data = documentsData.get(document);
    if (!data) return null;
    return provideHover(document.getText(), params.position, data, dependenciesData);
});

documents.onDidOpen((ev) => {
    documentsData.set(ev.document, new DocumentData(ev.document.uri));
    reparseDocument(ev.document);
});

documents.onDidClose((ev) => {
    const data = documentsData.get(ev.document);
    if (data) {
        releaseDependencies(data.dependencies, dependencyManager, dependenciesData);
        pruneUnreachableDependencies(openDocumentData(), dependencyManager, dependenciesData);
    }
    documentsData.delete(ev.document);
});

documents.onDidChangeContent((ev) => {
    const data = documentsData.get(ev.document);
    if (!data) return;
    if (data.reparseTimer === null) {
        data.reparseTimer = setTimeout(
            () => reparseDocument(ev.document),
            syncedSettings.language.reparseInterval,
        );
    }
});

function openDocumentData(): DocumentData[] {
    return documents.all().flatMap((d) => {
        const dd = documentsData.get(d);
        return dd ? [dd] : [];
    });
}

function parseFile(
    fileUri: string,
    content: string,
    data: DocumentData,
    diagnostics: Map<string, Diagnostic[]>,
    isDependency: boolean,
): void {
    const myDiagnostics: Diagnostic[] = [];
    diagnostics.set(data.uri, myDiagnostics);
    const dependencies: FileDependency[] = [];

    const results = parse(fileUri, content, isDependency);

    data.resolvedInclusions = [];
    myDiagnostics.push(...results.diagnostics);

    for (const header of results.headerInclusions) {
        const localTo = header.isLocal ? Path.dirname(URI.parse(data.uri).fsPath) : undefined;
        const resolvedUri = resolveIncludePath(
            header.filename,
            localTo,
            resolvedProject.includePaths,
        );
        if (resolvedUri === data.uri) continue;

        if (resolvedUri !== undefined) {
            let dependency = dependencyManager.getDependency(resolvedUri);
            if (dependency === undefined) {
                dependency = dependencyManager.addReference(resolvedUri);
            } else if (!data.dependencies.includes(dependency)) {
                dependencyManager.addReference(dependency.uri);
            }
            dependencies.push(dependency);

            let depData = dependenciesData.get(dependency);
            if (depData === undefined) {
                depData = new DocumentData(dependency.uri);
                dependenciesData.set(dependency, depData);
                try {
                    const depContent = fs.readFileSync(URI.parse(dependency.uri).fsPath, 'utf-8');
                    parseFile(dependency.uri, depContent, depData, diagnostics, true);
                } catch (err) {
                    connection.console.warn(
                        t('Failed to read dependency {0}: {1}', dependency.uri, String(err)),
                    );
                }
            }

            data.resolvedInclusions.push({ uri: resolvedUri, descriptor: header });
        } else {
            myDiagnostics.push({
                message: t(
                    "Couldn't resolve include path '{0}'. Check compiler include paths.",
                    header.filename,
                ),
                severity: header.isSilent ? DiagnosticSeverity.Information : DiagnosticSeverity.Error,
                source: DIAGNOSTIC_SOURCE,
                range: { start: header.start, end: header.end },
            });
        }
    }

    releaseDependencies(
        data.dependencies.filter((dep) => !dependencies.includes(dep)),
        dependencyManager,
        dependenciesData,
    );
    data.dependencies = dependencies;
    data.callables = results.callables;
    data.values = results.values;
}

function reparseDocument(document: TextDocument): void {
    const data = documentsData.get(document);
    if (data === undefined) return;
    data.reparseTimer = null;

    const diagnostics = new Map<string, Diagnostic[]>();
    parseFile(document.uri, document.getText(), data, diagnostics, false);
    pruneUnreachableDependencies(openDocumentData(), dependencyManager, dependenciesData);
    for (const [uri, ds] of diagnostics) {
        connection.sendDiagnostics({ uri, diagnostics: ds });
    }
}

documents.listen(connection);
connection.listen();
