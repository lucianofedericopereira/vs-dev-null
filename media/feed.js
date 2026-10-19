const app = document.getElementById('app');
const send = (type, extra = {}) => vscode.postMessage({ type, ...extra });

function avatar(user, size) {
  return user.avatar_url ? el('img', { class: 'avatar', src: user.avatar_url, width: size, height: size, alt: '' }) : null;
}

function preview(lp, full) {
  const image = lp.image_url || (lp.embed && lp.embed.poster);
  return el('a', {
    class: 'card',
    href: lp.url,
    onclick: e => { e.preventDefault(); e.stopPropagation(); send('browser', { url: lp.url }); },
  },
    image ? el('img', { src: image, alt: '' }) : null,
    el('div', { class: 'card-text' },
      el('strong', {}, lp.title || lp.url),
      full && lp.description ? el('span', { class: 'muted' }, lp.description) : null,
      el('span', { class: 'muted small' }, lp.site_name || new URL(lp.url).hostname),
    ),
  );
}

function commitView(c, full) {
  const author = c.author ? c.author.username : '?';
  const stop = fn => e => { e.stopPropagation(); fn(); };

  return el('article', { class: full ? 'commit full' : 'commit', onclick: full ? undefined : () => send('commit', { id: c.id }) },
    el('header', {},
      c.author ? avatar(c.author, 28) : null,
      el('a', { class: 'author', href: '#', onclick: stop(() => send('user', { username: author })) }, `@${author}`),
      c.parent_id ? el('span', { class: 'reply-mark', title: 'Reply' }, '↳') : null,
      el('span', { class: 'muted' }, `· ${relativeTime(c.created_at)}`),
      el('code', { class: 'hash' }, c.short_hash),
    ),
    body(c.body || ''),
    c.link_preview ? preview(c.link_preview, full) : null,
    c.images && c.images.length
      ? el('div', { class: `images n${c.images.length}` }, c.images.map(img =>
        el('img', { src: img.url, alt: img.description || '', width: img.width, height: img.height, onclick: stop(() => send('browser', { url: img.url })) })))
      : null,
    el('footer', {},
      el('span', { class: 'stat stars', title: 'Stars' }, `★ ${c.stars_count}`),
      el('span', { class: 'stat', title: 'Replies' }, `↩ ${c.replies_count}`),
      el('span', { class: 'spacer' }),
      c.parent_id ? el('button', { class: 'link', onclick: stop(() => send('commit', { id: c.parent_id })) }, 'Parent') : null,
      el('button', { class: 'link', onclick: stop(() => send('reply', { commit: c })) }, 'Reply'),
      el('button', { class: 'link', title: 'Star, bookmark or see replies on dev-null.sh', onclick: stop(() => send('browser', { url: c.html_url })) }, 'Open on web'),
      el('button', { class: 'link', onclick: stop(() => send('copy', { url: c.html_url })) }, 'Copy link'),
    ),
  );
}

function profile(u) {
  const meta = [u.company, u.location].filter(Boolean);
  return el('section', { class: 'profile' },
    avatar(u, 64),
    el('div', {},
      el('h1', {}, u.name || u.username),
      el('div', { class: 'muted' }, `@${u.username}`),
      u.bio ? el('p', {}, prose(u.bio)) : null,
      el('div', { class: 'muted small' }, meta.join(' · '), meta.length && u.website ? ' · ' : '', u.website ? link(u.website) : null),
      el('div', { class: 'counts' },
        el('span', {}, el('strong', {}, u.commits_count ?? 0), ' commits'),
        el('span', {}, el('strong', {}, u.followers_count ?? 0), ' followers'),
        el('span', {}, el('strong', {}, u.following_count ?? 0), ' following'),
      ),
      el('div', { class: 'actions' },
        el('button', { title: 'Follow, mute or block on dev-null.sh', onclick: () => send('browser', { url: u.html_url }) }, 'Follow on web'),
        el('button', { class: 'secondary', onclick: () => send('browser', { url: u.github_url }) }, 'GitHub'),
        el('button', { class: 'secondary', onclick: () => send('copy', { url: u.feed_url }) }, 'Copy Atom feed'),
      ),
    ),
  );
}

function render(s) {
  const nodes = [];
  if (s.error) nodes.push(el('div', { class: 'error' }, s.error));

  if (s.kind === 'user') {
    if (s.user) nodes.push(profile(s.user));
    nodes.push(el('div', { class: 'toolbar' },
      el('label', {}, el('input', { type: 'checkbox', checked: s.replies, onchange: () => send('replies') }), ' Include replies'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'secondary', onclick: () => send('refresh') }, 'Refresh'),
    ));
    nodes.push(...s.commits.map(c => commitView(c, false)));
    if (s.loading) nodes.push(el('div', { class: 'muted center' }, 'Loading…'));
    else if (s.nextCursor) nodes.push(el('div', { class: 'center' }, el('button', { class: 'secondary', onclick: () => send('more') }, 'Load more')));
    else if (s.commits.length) nodes.push(el('div', { class: 'muted center' }, '── end ──'));
    else if (!s.error) nodes.push(el('div', { class: 'muted center' }, 'No commits.'));
  } else if (s.commit) {
    nodes.push(commitView(s.commit, true));
  } else if (s.loading) {
    nodes.push(el('div', { class: 'muted center' }, 'Loading…'));
  }

  app.replaceChildren(...nodes);
}

window.addEventListener('message', e => {
  if (e.data.type === 'state') render(e.data.state);
});
send('ready');
