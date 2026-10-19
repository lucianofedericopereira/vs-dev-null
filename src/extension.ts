import * as vscode from 'vscode';
import { Composer } from './composer';
import { username } from './config';
import { FeedPanel } from './feed';
import { SidebarProvider } from './sidebar';

// Menus pass their own context objects as arguments; only strings are ours.
const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

export function activate(context: vscode.ExtensionContext): void {
  FeedPanel.init(context.extensionUri, commit => Composer.open({ replyTo: commit }));
  Composer.init(context.extensionUri);

  const sidebar = new SidebarProvider(context.extensionUri);

  const register = (id: string, fn: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('devnull.sidebar', sidebar),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('devnull')) {
        void sidebar.refresh();
      }
    }),
  );

  register('devnull.openProfile', (name?: unknown) => {
    const target = str(name) ?? username();
    if (target) {
      FeedPanel.openUser(target);
    } else {
      sidebar.focusUsername();
    }
  });

  register('devnull.openCommit', async (ref?: unknown) => {
    const target = str(ref) ?? str(await vscode.window.showInputBox({ prompt: 'Commit id or dev-null.sh commit link' }));
    if (target) {
      FeedPanel.openCommit(target);
    }
  });

  register('devnull.commit', () => Composer.open());

  register('devnull.commitSelection', () => {
    const editor = vscode.window.activeTextEditor;
    const text = editor?.document.getText(editor.selection).replace(/\s+$/, '');
    if (!editor || !text) {
      return Composer.open();
    }
    Composer.open({ body: `\n\n\`\`\`${editor.document.languageId}\n${text}\n\`\`\`` });
  });

  register('devnull.setUsername', () => sidebar.focusUsername());

  register('devnull.refresh', () => sidebar.refresh());
}

export function deactivate(): void {}
