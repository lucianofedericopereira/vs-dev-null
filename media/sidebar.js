const app = document.getElementById('app');
const send = (type, extra = {}) => vscode.postMessage({ type, ...extra });

const input = el('input', { type: 'text', placeholder: 'your dev-null.sh username', spellcheck: 'false' });
const save = () => send('username', { value: input.value });
input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });

let followingOpen = (vscode.getState() || {}).followingOpen ?? true;
const remember = open => { followingOpen = open; vscode.setState({ ...(vscode.getState() || {}), followingOpen: open }); };

function person(u, extra) {
  return el('button', { class: 'person', title: u.bio || '', onclick: () => send('user', { username: u.username }) },
    u.avatar_url ? el('img', { class: 'avatar', src: u.avatar_url, width: 24, height: 24, alt: '' }) : null,
    el('span', { class: 'who' }, el('strong', {}, `@${u.username}`), u.name && u.name !== u.username ? el('span', { class: 'muted small' }, u.name) : null),
    extra,
  );
}

function render(s) {
  if (document.activeElement !== input) input.value = s.username;
  const nodes = [
    el('div', { class: 'stack' }, input, el('button', { class: 'secondary', onclick: save }, 'Save')),
  ];
  if (s.error) nodes.push(el('div', { class: 'error' }, s.error));

  if (!s.username) {
    nodes.push(el('p', { class: 'muted small' }, 'Enter your username to see your commits and the people you follow.'));
  } else if (s.me) {
    nodes.push(
      el('h2', {}, 'You'),
      person(s.me, el('span', { class: 'muted small' }, `${s.me.commits_count ?? 0} commits`)),
      el('div', { class: 'row' }, el('button', { onclick: () => send('commit') }, 'New commit')),
      el('details', { open: followingOpen, ontoggle: e => remember(e.target.open) },
        el('summary', {}, el('h2', {}, 'Following', el('span', { class: 'muted small' }, ` ${s.me.following_count ?? s.following.length}`))),
        ...s.following.map(u => person(u)),
        !s.following.length && !s.loading ? el('p', { class: 'muted small' }, "You don't follow anyone yet.") : null,
        s.nextCursor && !s.loading ? el('button', { class: 'link', onclick: () => send('more') }, 'Load more') : null,
      ),
    );
  }
  if (s.loading) nodes.push(el('p', { class: 'muted small' }, 'Loading…'));
  app.replaceChildren(...nodes);
}

window.addEventListener('message', e => {
  if (e.data.type === 'state') render(e.data.state);
  if (e.data.type === 'focusUsername') { input.focus(); input.select(); }
});
send('ready');
