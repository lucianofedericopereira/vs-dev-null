import * as vscode from 'vscode';

export function baseUrl(): string {
  return vscode.workspace.getConfiguration('devnull').get<string>('baseUrl', 'https://dev-null.sh').replace(/\/+$/, '');
}

export function username(): string {
  return vscode.workspace.getConfiguration('devnull').get<string>('username', '').trim().replace(/^@/, '');
}
