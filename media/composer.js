const app = document.getElementById('app');
const send = (type, extra = {}) => vscode.postMessage({ type, ...extra });

const textarea = el('textarea', { rows: 10, placeholder: "What's on your mind?", spellcheck: 'true' });
const replyInput = el('input', { type: 'text', placeholder: 'Commit hash or link (optional)' });
const counter = el('span', { class: 'muted small' });
const status = el('div', { class: 'status' });
const images = el('div', { class: 'attachments' });
const quoted = el('div');
const attach = el('button', { class: 'secondary', onclick: () => send('pickImages') }, 'Attach images');
const submit = el('button', { onclick: () => commit() }, 'Commit');
let state = { limits: { min: 3, max: 4000, images: 3 }, images: [] };

function valid() {
  const len = textarea.value.trim().length;
  return len <= state.limits.max && (state.images.length > 0 || len >= state.limits.min);
}

function update() {
  const len = textarea.value.trim().length;
  counter.textContent = `${len} / ${state.limits.max}`;
  counter.classList.toggle('over', len > state.limits.max);
  submit.disabled = state.sending || !valid();
  attach.disabled = state.sending || state.images.length >= state.limits.images;
}

function commit() {
  if (submit.disabled) return;
  send('send', { body: textarea.value, replyTo: replyInput.value.trim() });
}

textarea.addEventListener('input', update);
textarea.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
});

app.append(
  el('h1', { class: 'title' }, mark(), 'New commit'),
  quoted,
  textarea,
  el('div', { class: 'row' }, counter, el('span', { class: 'spacer' }), el('span', { class: 'muted small' }, 'Ctrl+Enter to commit')),
  el('label', { class: 'field' }, el('span', { class: 'muted small' }, 'Reply to'), replyInput),
  images,
  el('div', { class: 'row' }, attach, el('span', { class: 'spacer' }), submit),
  status,
  el('p', { class: 'muted small' }, 'Signed locally with the SSH key on your GitHub account, as the official dev-null.sh commit script does. No login, no token stored.'),
);

window.addEventListener('message', e => {
  if (e.data.type !== 'state') return;
  state = e.data;

  if (state.reset) {
    textarea.value = state.draft.body || '';
    replyInput.value = state.draft.replyTo ? state.draft.replyTo.id : '';
    quoted.replaceChildren(state.draft.replyTo
      ? el('blockquote', {},
        el('div', { class: 'muted small' }, `Replying to @${state.draft.replyTo.author.username} · ${state.draft.replyTo.short_hash}`),
        body(state.draft.replyTo.body))
      : '');
    textarea.focus();
    textarea.setSelectionRange(0, 0);
  }

  images.replaceChildren(...state.images.map((name, index) =>
    el('span', { class: 'chip' }, name, el('button', { class: 'link', title: 'Remove', onclick: () => send('removeImage', { index }) }, '×'))));

  status.className = `status ${state.status ? state.status.kind : ''}`;
  status.textContent = state.status ? state.status.text : '';
  textarea.disabled = replyInput.disabled = !!state.sending;
  update();
});
send('ready');
