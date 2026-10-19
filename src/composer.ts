import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Commit } from './api';
import { username } from './config';
import { FeedPanel } from './feed';
import { IMAGE_TYPES, MAX_BODY, MAX_IMAGES, MIN_BODY, sendCommit, SignError } from './signer';
import { html } from './webview';

interface Draft {
  body?: string;
  replyTo?: Commit;
}

type Message =
  | { type: 'ready' | 'pickImages' }
  | { type: 'removeImage'; index: number }
  | { type: 'send'; body: string; replyTo: string }
  | { type: 'user'; username: string }
  | { type: 'commit'; id: string };

export class Composer {
  private static current: Composer | undefined;
  private static extensionUri: vscode.Uri;

  private images: string[] = [];
  private sending = false;

  static init(extensionUri: vscode.Uri): void {
    Composer.extensionUri = extensionUri;
  }

  static open(draft: Draft = {}): void {
    if (Composer.current) {
      Composer.current.draft = draft;
      Composer.current.panel.reveal();
      Composer.current.images = [];
      Composer.current.post(undefined, true);
      return;
    }
    const panel = vscode.window.createWebviewPanel('devnull.composer', 'New Commit', vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(Composer.extensionUri, 'media')],
    });
    panel.iconPath = vscode.Uri.joinPath(Composer.extensionUri, 'images', 'activity.svg');
    Composer.current = new Composer(panel, draft);
  }

  private constructor(private readonly panel: vscode.WebviewPanel, private draft: Draft) {
    panel.webview.html = html(panel.webview, Composer.extensionUri, 'composer.js', 'New Commit');
    panel.webview.onDidReceiveMessage((m: Message) => this.handle(m));
    panel.onDidDispose(() => { Composer.current = undefined; });
  }

  private post(status?: { kind: 'error' | 'sending'; text: string }, reset = false): void {
    void this.panel.webview.postMessage({
      type: 'state',
      draft: this.draft,
      images: this.images.map(f => path.basename(f)),
      limits: { min: MIN_BODY, max: MAX_BODY, images: MAX_IMAGES },
      sending: this.sending,
      status,
      reset,
    });
  }

  private async handle(m: Message): Promise<void> {
    switch (m.type) {
      case 'ready':
        return this.post(undefined, true);
      case 'pickImages': {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: true,
          openLabel: 'Attach',
          filters: { Images: Object.keys(IMAGE_TYPES).map(e => e.slice(1)) },
        });
        this.images = [...this.images, ...(picked ?? []).map(u => u.fsPath)].slice(0, MAX_IMAGES);
        return this.post();
      }
      case 'removeImage':
        this.images.splice(m.index, 1);
        return this.post();
      case 'user':
        return FeedPanel.openUser(m.username);
      case 'commit':
        return FeedPanel.openCommit(m.id);
      case 'send':
        return this.send(m.body, m.replyTo);
    }
  }

  private async send(body: string, replyTo: string): Promise<void> {
    if (this.sending) {
      return;
    }
    this.sending = true;
    this.post({ kind: 'sending', text: 'Signing…' });

    try {
      const answer = await sendCommit({
        body,
        replyTo,
        images: this.images,
        askPassphrase: key => Promise.resolve(vscode.window.showInputBox({
          title: 'dev-null: SSH key passphrase',
          prompt: `Passphrase for ${key}`,
          password: true,
          ignoreFocusOut: true,
        })),
      });
      this.panel.dispose();
      const url = answer.match(/https?:\/\/\S+/)?.[0];
      const choice = await vscode.window.showInformationMessage(answer, ...(url ? ['Open', 'Copy Link'] : []));
      if (url && choice === 'Open') {
        FeedPanel.openCommit(url);
      } else if (url && choice === 'Copy Link') {
        await vscode.env.clipboard.writeText(url);
      }
      if (username()) {
        FeedPanel.refreshUser(username());
      }
    } catch (err) {
      this.sending = false;
      const text = err instanceof SignError || err instanceof Error ? err.message : String(err);
      this.post({ kind: 'error', text });
    }
  }
}
