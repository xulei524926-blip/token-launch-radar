/* Token Launch Radar: renders window.RADAR (written beside this page as
   data.js by the radar program). No network, no framework: filtering,
   sorting and the per-protocol detail view all run on the snapshot's own
   figures, so the page works exactly as handed in. */
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) return;

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var money = function (n) {
    if (n == null) return '-';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  };
  var pct = function (x) {
    if (x == null) return '<span class="chains">n/a</span>';
    var cls = x >= 0 ? 'up' : 'down';
    var v = Math.max(-999, Math.min(999, x));
    return '<span class="' + cls + '">' + (x >= 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  };
  var age = function (days) {
    if (days == null) return 'n/a';
    if (days < 60) return days + 'd';
    if (days < 730) return Math.round(days / 30.4) + 'mo';
    return (days / 365.25).toFixed(1) + 'y';
  };

  /* header stats */
  var watchCount = R.rows.filter(function (r) { return r.watchlist; }).length;
  $('stats').innerHTML = [
    [R.scanned, 'protocols scanned'],
    [R.pre_token, 'record no token'],
    [R.early_size, 'on the board'],
    [watchCount + ' / ' + 40, 'watchlist covered'],
    [R.live_size, 'already trading'],
  ].map(function (s) {
    return '<div class="stat"><b>' + s[0] + '</b><span>' + s[1] + '</span></div>';
  }).join('');

  /* the model, stated on the page so the numbers can be checked */
  $('model-band').innerHTML =
    '<div class="formula">Implied value = <b>TVL</b> x <b>peer multiple</b> x <b>momentum</b> x <b>maturity</b>' +
    ' &nbsp;-&nbsp; global peer multiple ' + R.global_multiple.toFixed(2) + 'x, snapshot of ' + esc(R.as_of) + '</div>' +
    '<ul>' + R.model_note.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>';

  $('foot').textContent =
    'Source: ' + R.source + '. "Records no token" is what the snapshot says, not a promise that a token is coming. ' +
    'Implied values are a ranking device built from the snapshot\'s own figures; farm plans carry real cost and real risk.';

  /* filter options, from the board itself */
  var chains = {}, cats = {};
  R.rows.forEach(function (r) {
    r.chains.forEach(function (c) { chains[c] = true; });
    if (r.category) cats[r.category] = true;
  });
  Object.keys(chains).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; $('chain').appendChild(o);
  });
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; $('category').appendChild(o);
  });

  var state = { key: 'rank', dir: 1, q: '', chain: '', category: '', watch: false };

  function visible() {
    var q = state.q.trim().toLowerCase();
    return R.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.category && r.category !== state.category) return false;
      if (q) {
        var hay = (r.name + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    }).sort(function (a, b) {
      var k = state.key;
      var av = a[k], bv = b[k];
      if (av == null && bv == null) return a.rank - b.rank;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return state.dir * av.localeCompare(bv) || a.rank - b.rank;
      return state.dir * (av - bv) || a.rank - b.rank;
    });
  }

  function render() {
    var rows = visible();
    $('count').textContent = 'Showing ' + rows.length + ' of ' + R.rows.length + ' ranked protocols';
    $('empty').hidden = rows.length > 0;
    $('rows').innerHTML = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) + (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</td>' +
        '<td>' + esc(r.category || '-') + '</td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td>' +
        '<td class="num">' + r.multiple.toFixed(2) + 'x</td>' +
        '<td class="num implied">' + money(r.implied_value_usd) + '</td>' +
        '<td class="farm">' + esc(r.farm_cost_usd) + '</td>' +
        '<td class="farm">' + esc(r.farm_weeks) + '</td>' +
        '</tr>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('#rows tr'), function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-slug')); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('th.sortable'), function (th) {
      var k = th.getAttribute('data-key');
      th.innerHTML = th.textContent.replace(/ [▲▼]$/, '') + (state.key === k ? ' <span class="dir">' + (state.dir === 1 ? '▲' : '▼') + '</span>' : '');
    });
  }

  /* detail view: the arithmetic, the peers it came from, the farm plan */
  function openDetail(slug) {
    var r = null;
    R.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    var peers = r.peers.length
      ? '<table class="peers"><thead><tr><th>Trading peer</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Cap / TVL</th></tr></thead><tbody>' +
        r.peers.map(function (p) {
          return '<tr><td>' + esc(p.name) + (p.symbol ? ' (' + esc(p.symbol) + ')' : '') + '</td><td class="num">' + money(p.tvl_usd) + '</td><td class="num">' + money(p.mcap_usd) + '</td><td class="num">' + p.multiple.toFixed(2) + 'x</td></tr>';
        }).join('') + '</tbody></table>'
      : '<p class="note">No protocol in this category has a priced token in the snapshot, so the global peer multiple was used.</p>';
    $('detail').innerHTML =
      '<button class="close" id="close" aria-label="Close">x</button>' +
      '<h2>' + esc(r.name) + (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</h2>' +
      '<p class="sub">Rank #' + r.rank + ' - ' + esc(r.category || 'Uncategorised') + ' - ' + esc(r.chains.join(', ')) +
      '<br>Records no token in the snapshot of ' + esc(R.as_of) + (r.listed_at ? '; tracked since ' + esc(r.listed_at) : '') + '.</p>' +
      '<div class="math">TVL ' + money(r.tvl_usd) + ' x peer ' + r.multiple.toFixed(2) + 'x x momentum ' + r.momentum.toFixed(2) +
      ' x maturity ' + r.maturity.toFixed(2) + ' = <span class="result">' + money(r.implied_value_usd) + '</span> implied launch value</div>' +
      '<div class="kv">' +
      '<div><span>TVL</span><b>' + money(r.tvl_usd) + '</b></div>' +
      '<div><span>7-day TVL change</span><b>' + (r.change_7d == null ? 'n/a' : r.change_7d.toFixed(1) + '%') + '</b></div>' +
      '<div><span>Time with no token</span><b>' + age(r.age_days) + '</b></div>' +
      '<div><span>Implied / TVL</span><b>' + (r.implied_value_usd / r.tvl_usd).toFixed(2) + 'x</b></div>' +
      '</div>' +
      '<h3>Where the multiple comes from</h3>' + peers +
      '<h3>Farm plan</h3>' +
      '<p class="note">Budget: ' + esc(r.farm_cost_usd) + ' - Season: ' + esc(r.farm_weeks) + '. Nothing here guarantees a token or an allocation; it is the work a genuine early user would be doing anyway.</p>' +
      '<ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    $('detail').hidden = false;
    $('scrim').hidden = false;
    $('close').addEventListener('click', closeDetail);
  }
  function closeDetail() { $('detail').hidden = true; $('scrim').hidden = true; }
  $('scrim').addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });

  /* controls */
  $('q').addEventListener('input', function () { state.q = this.value; render(); });
  $('chain').addEventListener('change', function () { state.chain = this.value; render(); });
  $('category').addEventListener('change', function () { state.category = this.value; render(); });
  $('watch').addEventListener('change', function () { state.watch = this.checked; render(); });
  Array.prototype.forEach.call(document.querySelectorAll('th.sortable'), function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-key');
      if (state.key === k) state.dir = -state.dir;
      else { state.key = k; state.dir = (k === 'name' || k === 'category') ? 1 : -1; }
      render();
    });
  });

  /* shareable views: ?detail=<slug>, ?chain=, ?category=, ?q=, ?watch=1 */
  var params = new URLSearchParams(location.search);
  if (params.get('q')) { state.q = params.get('q'); $('q').value = state.q; }
  if (params.get('chain')) { state.chain = params.get('chain'); $('chain').value = state.chain; }
  if (params.get('category')) { state.category = params.get('category'); $('category').value = state.category; }
  if (params.get('watch') === '1') { state.watch = true; $('watch').checked = true; }
  render();
  if (params.get('detail')) openDetail(params.get('detail'));
})();
