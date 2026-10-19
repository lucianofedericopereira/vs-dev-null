import * as vscode from 'vscode';
import * as api from './api';
import { html } from './webview';

type Target = { kind: 'user'; username: string } | { kind: 'commit'; id: string };

interface State {
  kind: Target['kind'];
  user?: api.User;
  commits: api.Commit[];
  commit?: api.Commit;
  nextCursor: string | null;
  replies: boolean;
  loading: boolean;
  started: boolean;
  error?: string;
}

type Message =
  | { type: 'ready' | 'more' | 'refresh' | 'replies' }
  | { type: 'user'; username: string }
  | { type: 'commit'; id: string }
  | { type: 'reply'; commit: api.Commit }
  | { type: 'browser' | 'copy'; url: string };

export class FeedPanel {
  private static panels = new Map<string, FeedPanel>();
  private static extensionUri: vscode.Uri;
  private static onReply: (commit: api.Commit) => void;

  private state: State;

  static init(extensionUri: vscode.Uri, onReply: (commit: api.Commit) => void): void {
    FeedPanel.extensionUri = extensionUri;
    FeedPanel.onReply = onReply;
  }

  static openUser(username: string): void {
    FeedPanel.open({ kind: 'user', username: username.replace(/^@/, '') });
  }

  static openCommit(ref: string): void {
    FeedPanel.open({ kind: 'commit', id: ref.match(/commits\/([\w-]+)/)?.[1] ?? ref.trim() });
  }

  /** Refreshes an open profile, e.g. after committing as that user. */
  static refreshUser(username: string): void {
    FeedPanel.panels.get(`user:${username.toLowerCase()}`)?.refresh();
  }

  private static open(target: Target): void {
    const key = target.kind === 'user' ? `user:${target.username.toLowerCase()}` : `commit:${target.id}`;
    const existing = FeedPanel.panels.get(key);
    if (existing) {
      existing.panel.reveal();
      return;
    }
    const title = target.kind === 'user' ? `@${target.username}` : `commit ${target.id.slice(-7)}`;
    const panel = vscode.window.createWebviewPanel('devnull.feed', title, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(FeedPanel.extensionUri, 'media')],
    });
    panel.iconPath = vscode.Uri.joinPath(FeedPanel.extensionUri, 'images', 'activity.svg');
    FeedPanel.panels.set(key, new FeedPanel(panel, target, key));
  }

  private constructor(private readonly panel: vscode.WebviewPanel, private readonly target: Target, key: string) {
    this.state = { kind: target.kind, commits: [], nextCursor: null, replies: false, loading: false, started: false };
    panel.webview.html = html(panel.webview, FeedPanel.extensionUri, 'feed.js', panel.title);
    panel.webview.onDidReceiveMessage((m: Message) => this.handle(m));
    panel.onDidDispose(() => FeedPanel.panels.delete(key));
  }

  private post(): void {
    void this.panel.webview.postMessage({ type: 'state', state: this.state });
  }

  private fail(err: unknown): void {
    this.state.error = err instanceof Error ? err.message : String(err);
  }

  private async handle(m: Message): Promise<void> {
    switch (m.type) {
      case 'ready':
      case 'refresh':
        return this.refresh();
      case 'more':
        return this.loadMore();
      case 'replies':
        this.state.replies = !this.state.replies;
        return this.refresh();
      case 'user':
        return FeedPanel.openUser(m.username);
      case 'commit':
        return FeedPanel.openCommit(m.id);
      case 'reply':
        return FeedPanel.onReply(m.commit);
      case 'browser':
        void vscode.env.openExternal(vscode.Uri.parse(m.url));
        return;
      case 'copy':
        await vscode.env.clipboard.writeText(m.url);
        void vscode.window.setStatusBarMessage(`Copied ${m.url}`, 3000);
        return;
    }
  }

  private async refresh(): Promise<void> {
    this.state.error = undefined;
    if (this.target.kind === 'commit') {
      this.state.commit = undefined;
      this.state.loading = true;
      this.post();
      try {
        this.state.commit = await api.commit(this.target.id);
      } catch (err) {
        this.fail(err);
      }
      this.state.loading = false;
      return this.post();
    }

    const username = this.target.username;
    this.state.commits = [];
    this.state.nextCursor = null;
    this.state.started = false;
    const profile = api.user(username).then(
      u => { this.state.user = u; },
      err => this.fail(err),
    );
    await Promise.all([profile, this.loadMore()]);
    this.post();
  }

  private async loadMore(): Promise<void> {
    if (this.target.kind !== 'user' || this.state.loading || (this.state.started && !this.state.nextCursor)) {
      return;
    }
    this.state.loading = true;
    this.state.started = true;
    this.post();
    try {
      const page = await api.commits(this.target.username, { cursor: this.state.nextCursor ?? undefined, replies: this.state.replies });
      this.state.commits.push(...page.data);
      this.state.nextCursor = page.meta.next_cursor;
    } catch (err) {
      // A missing user is already reported by the profile request.
      if (!(err instanceof Error && err.message === 'not found')) {
        this.fail(err);
      }
    }
    this.state.loading = false;
    this.post();
  }
}
