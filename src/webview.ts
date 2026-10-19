import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

export function html(webview: vscode.Webview, extensionUri: vscode.Uri, script: string, title: string): string {
  const nonce = randomBytes(16).toString('base64');
  const media = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', file));
  const csp = [
    "default-src 'none'",
    `img-src https: data: ${webview.cspSource}`,
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${media('style.css')}">
  <title>${title.replace(/[<>&"]/g, '')}</title>
</head>
<body>
  <main id="app"></main>
  <script nonce="${nonce}" src="${media('render.js')}"></script>
  <script nonce="${nonce}" src="${media(script)}"></script>
</body>
</html>`;
}
