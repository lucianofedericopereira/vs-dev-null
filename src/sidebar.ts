import * as vscode from 'vscode';
import * as api from './api';
import { username } from './config';
import { FeedPanel } from './feed';
import { html } from './webview';

type Message =
  | { type: 'ready' | 'refresh' | 'more' | 'commit' }
  | { type: 'username'; value: string }
  | { type: 'user'; username: string };

interface State {
  username: string;
  me?: api.User;
  following: api.User[];
  nextCursor: string | null;
  loading: boolean;
  error?: string;
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private state: State = { username: '', following: [], nextCursor: null, loading: false };

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')] };
    view.webview.html = html(view.webview, this.extensionUri, 'sidebar.js', 'dev-null');
    view.webview.onDidReceiveMessage((m: Message) => this.handle(m));
  }

  focusUsername(): void {
    void vscode.commands.executeCommand('devnull.sidebar.focus').then(() => this.view?.webview.postMessage({ type: 'focusUsername' }));
  }

  private post(): void {
    void this.view?.webview.postMessage({ type: 'state', state: this.state });
  }

  private async handle(m: Message): Promise<void> {
    switch (m.type) {
      case 'ready':
      case 'refresh':
        return this.refresh();
      case 'more':
        return this.loadMore();
      case 'commit':
        return void vscode.commands.executeCommand('devnull.commit');
      case 'user':
        return FeedPanel.openUser(m.username);
      case 'username':
        // The configuration listener refreshes the view.
        return void vscode.workspace.getConfiguration('devnull')
          .update('username', m.value.trim().replace(/^@/, ''), vscode.ConfigurationTarget.Global);
    }
  }

  async refresh(): Promise<void> {
    const me = username();
    this.state = { username: me, following: [], nextCursor: null, loading: !!me };
    this.post();
    if (!me) {
      return;
    }
    try {
      const [user, page] = await Promise.all([api.user(me), api.following(me)]);
      this.state.me = user;
      this.state.following = page.data;
      this.state.nextCursor = page.meta.next_cursor;
    } catch (err) {
      this.state.error = `@${me}: ${err instanceof Error ? err.message : String(err)}`;
    }
    this.state.loading = false;
    this.post();
  }

  private async loadMore(): Promise<void> {
    if (!this.state.nextCursor || this.state.loading) {
      return;
    }
    this.state.loading = true;
    this.post();
    try {
      const page = await api.following(this.state.username, this.state.nextCursor);
      this.state.following.push(...page.data);
      this.state.nextCursor = page.meta.next_cursor;
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : String(err);
    }
    this.state.loading = false;
    this.post();
  }
}
