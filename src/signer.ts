import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { baseUrl } from './config';

// Port of the official https://dev-null.sh/commit script: no login, signed with an SSH key on your GitHub account.

export const MIN_BODY = 3;
export const MAX_BODY = 4000;
export const MAX_IMAGES = 3;
export const MAX_IMAGE_BYTES = 10_240_000;
export const IMAGE_TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

export interface CommitRequest {
  body: string;
  replyTo?: string;
  images?: string[];
  askPassphrase: (keyPath: string) => Promise<string | undefined>;
}

export class SignError extends Error {}

function run(file: string, args: string[], input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    // Own session and no askpass: a passphrase can only come from stdin, never a terminal or a GUI prompt.
    const options = { timeout: 120_000, detached: process.platform !== 'win32', env: { ...process.env, SSH_ASKPASS_REQUIRE: 'never' } };
    const child = execFile(file, args, options, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
    child.stdin?.end(input ?? '');
  });
}

// "<type> <base64>", without the comment.
function keyId(line: string): string {
  return line.trim().split(/\s+/).slice(0, 2).join(' ');
}

const SUPPORTED = /^(ssh-ed25519|ssh-rsa) /;

async function agentKeys(): Promise<string[]> {
  const { code, stdout } = await run('ssh-add', ['-L']);
  return code === 0 ? stdout.split('\n').filter(l => SUPPORTED.test(l)).map(keyId) : [];
}

async function fileKeys(): Promise<Map<string, string>> {
  const dir = path.join(os.homedir(), '.ssh');
  const keys = new Map<string, string>();
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return keys;
  }
  for (const entry of entries.filter(e => e.endsWith('.pub'))) {
    const pub = path.join(dir, entry);
    const priv = pub.slice(0, -4);
    try {
      await fs.access(priv);
      const first = (await fs.readFile(pub, 'utf8')).split('\n')[0];
      if (SUPPORTED.test(first) && !keys.has(keyId(first))) {
        keys.set(keyId(first), priv);
      }
    } catch {
      // No private key next to it, or unreadable.
    }
  }
  return keys;
}

async function postText(url: string, init: RequestInit): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(init.body instanceof FormData ? 600_000 : 30_000) });
  } catch (err) {
    throw new SignError(`Could not reach ${baseUrl()}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const text = await response.text();
  if (!response.ok) {
    let message = text.trim();
    try {
      const parsed = JSON.parse(text) as { message?: string; errors?: Record<string, string[]> };
      message = Object.values(parsed.errors ?? {})[0]?.[0] ?? parsed.message ?? message;
    } catch {
      // Plain text already.
    }
    throw new SignError(message || `Unexpected answer from ${baseUrl()} (HTTP ${response.status}).`);
  }
  return text;
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function validateReplyTo(replyTo: string): string | undefined {
  return /^[A-Za-z0-9:/._@-]*$/.test(replyTo) ? undefined : 'Reply to takes the hash of a commit or its link.';
}

export async function readImage(file: string): Promise<Buffer> {
  const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
  if (!type) {
    throw new SignError(`${path.basename(file)} is not a JPEG, PNG or WebP image.`);
  }
  const data = await fs.readFile(file).catch(() => {
    throw new SignError(`Could not read the image ${file}.`);
  });
  if (data.length > MAX_IMAGE_BYTES) {
    throw new SignError(`The image ${path.basename(file)} is larger than 10 MB.`);
  }
  return data;
}

/** Signs and sends a commit; resolves with the server's answer, e.g. "Committed: <url>". */
export async function sendCommit(req: CommitRequest): Promise<string> {
  const base = baseUrl();
  if (!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) {
    throw new SignError(`Refusing to send your commit to ${base}: it is not an https:// URL.`);
  }

  const replyTo = (req.replyTo ?? '').trim();
  const replyError = validateReplyTo(replyTo);
  if (replyError) {
    throw new SignError(replyError);
  }

  const images = req.images ?? [];
  if (images.length > MAX_IMAGES) {
    throw new SignError(`A commit can carry up to ${MAX_IMAGES} images.`);
  }
  const imageData = await Promise.all(images.map(readImage));

  if (req.body.trim() === '' && images.length === 0) {
    throw new SignError('Aborting commit due to empty commit message.');
  }

  // 1. Find a local key that is on the GitHub account of a dev-null.sh user.
  const agent = await agentKeys();
  const files = await fileKeys();
  const candidates = [...new Set([...agent, ...files.keys()])];
  if (candidates.length === 0) {
    throw new SignError('No Ed25519 or RSA SSH key found in your SSH agent or in ~/.ssh.');
  }

  const lookup = await postText(`${base}/api/cli/key-lookups`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: candidates.join('\n') + '\n',
  });
  const key = keyId(lookup.split('\n')[0] ?? '');
  if (!candidates.includes(key)) {
    throw new SignError(`Unexpected answer from ${base}.`);
  }

  // 2. Sign through the agent if it has the key, otherwise with the private key file.
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devnull.'));
  try {
    let signingKey = files.get(key);
    let ask: CommitRequest['askPassphrase'] | undefined = req.askPassphrase;
    if (agent.includes(key)) {
      signingKey = path.join(tmp, 'key.pub');
      await fs.writeFile(signingKey, key + '\n', { mode: 0o600 });
      ask = undefined;
    }
    if (!signingKey) {
      throw new SignError(`Could not find the private key of ${key}.`);
    }

    const signed = await signCommit(signingKey, req.body, replyTo, imageData, ask);

    // 3. Commit.
    return await postCommit(base, signed, imageData.map((data, i) => ({ data, type: IMAGE_TYPES[path.extname(images[i]).toLowerCase()] })));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

export interface SignedCommit {
  payload: string;
  signature: string;
}

/** Builds "<ts>\n<nonce>\n<reply_to>\n[<image hashes>\n]<body>" and signs it with `ssh-keygen -Y sign`. */
export async function signCommit(
  signingKey: string,
  body: string,
  replyTo: string,
  images: Buffer[],
  askPassphrase?: CommitRequest['askPassphrase'],
): Promise<SignedCommit> {
  const nonce = randomBytes(16).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const namespace = images.length > 0 ? 'devnull-commit-images' : 'devnull-commit';
  const payload = images.length > 0
    ? [timestamp, nonce, replyTo, images.map(sha256).join(','), body].join('\n')
    : [timestamp, nonce, replyTo, body].join('\n');

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devnull.'));
  try {
    const message = path.join(tmp, 'commit');
    await fs.writeFile(message, payload, { mode: 0o600 });

    const args = ['-Y', 'sign', '-n', namespace, '-f', signingKey, message];
    let signed = await run('ssh-keygen', args);
    if (signed.code !== 0 && /passphrase/i.test(signed.stderr) && askPassphrase) {
      const passphrase = await askPassphrase(signingKey);
      if (passphrase === undefined) {
        throw new SignError('Commit cancelled.');
      }
      signed = await run('ssh-keygen', args, passphrase + '\n');
    }
    if (signed.code !== 0) {
      const reason = signed.stderr.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim().split('\n').pop()?.replace(/^.*?: (?=[^:]*$)/, '') ?? '';
      throw new SignError(`Could not sign your commit with ${signingKey}${reason ? `: ${reason}` : '.'}`);
    }

    const signature = (await fs.readFile(message + '.sig', 'utf8'))
      .split('\n')
      .filter(l => !l.includes('-----'))
      .join('');
    if (!/^[A-Za-z0-9+/=]+$/.test(signature)) {
      throw new SignError('ssh-keygen produced an unexpected signature.');
    }
    return { payload, signature };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** Sends the raw payload, or a multipart form with the payload next to the images. */
export async function postCommit(base: string, signed: SignedCommit, images: { data: Buffer; type: string }[]): Promise<string> {
  const headers: Record<string, string> = { 'X-SSH-Signature': signed.signature };
  let body: string | FormData = signed.payload;
  if (images.length > 0) {
    const form = new FormData();
    form.append('payload', new Blob([signed.payload]), 'commit');
    images.forEach(({ data, type }, i) => form.append('images[]', new Blob([new Uint8Array(data)], { type }), `image-${i + 1}`));
    body = form;
  } else {
    headers['Content-Type'] = 'text/plain; charset=utf-8';
  }
  return (await postText(`${base}/api/cli/commits`, { method: 'POST', headers, body })).trim();
}
