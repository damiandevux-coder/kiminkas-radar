const fs = require('fs');
const https = require('https');
const path = require('path');

// ─── CONFIG ───
const OUTPUT_DIR = './dist';
const MIN_STARS = 500;
const CREATED_AFTER = '2025-01-01';

// ─── UTILS ───
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'kiminkas-radar/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function escapeHTML(str) {
  return str?.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m])) || '';
}

// ─── GITHUB FETCHER ───
async function fetchGitHubTrending() {
  console.log('🔍 Querying GitHub API...');
  const queries = [
    `created:>${CREATED_AFTER} stars:>${MIN_STARS}`,
    `topic:ai-agents created:>${CREATED_AFTER} stars:>200`,
    `topic:mcp stars:>100`,
    `topic:browser-use stars:>100`,
  ];
  
  const allRepos = [];
  for (const q of queries) {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=20`;
    try {
      const data = await fetchJSON(url);
      allRepos.push(...(data.items || []));
    } catch (e) {
      console.error('GitHub API error:', e.message);
    }
  }
  
  // Deduplicate by full_name
  const seen = new Set();
  return allRepos.filter(r => {
    if (seen.has(r.full_name)) return false;
    seen.add(r.full_name);
    return true;
  }).sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, 50);
}

// ─── HACKER NEWS FETCHER ───
async function fetchHackerNews() {
  console.log('🔍 Querying HN Algolia...');
  const url = 'https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&numericFilters=created_at_i>1704067200&hitsPerPage=30';
  try {
    const data = await fetchJSON(url);
    return (data.hits || [])
      .filter(h => h.points > 50)
      .sort((a, b) => b.points - a.points)
      .slice(0, 20);
  } catch (e) {
    console.error('HN API error:', e.message);
    return [];
  }
}

// ─── HTML GENERATOR ───
function generateSite(repos, hnPosts) {
  ensureDir(OUTPUT_DIR);
  
  const date = new Date().toISOString().split('T')[0];
  
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kiminka's Radar — ${date}</title>
  <style>
    :root {
      --bg: #0a0a0f;
      --surface: #12121a;
      --surface-hover: #1a1a25;
      --text: #e4e4e7;
      --text-muted: #71717a;
      --accent: #f97316;
      --accent-soft: rgba(249, 115, 22, 0.1);
      --border: #27272a;
      --star: #fbbf24;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 2rem 1rem;
    }
    .container { max-width: 1000px; margin: 0 auto; }
    header {
      text-align: center;
      margin-bottom: 3rem;
      padding: 2rem 0;
      border-bottom: 1px solid var(--border);
    }
    h1 {
      font-size: 2.5rem;
      font-weight: 800;
      background: linear-gradient(135deg, var(--accent), #fb923c);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 0.5rem;
    }
    .subtitle {
      color: var(--text-muted);
      font-size: 1.1rem;
    }
    .meta {
      color: var(--text-muted);
      font-size: 0.9rem;
      margin-top: 1rem;
    }
    .section {
      margin-bottom: 3rem;
    }
    .section-title {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 1.5rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.25rem;
      margin-bottom: 1rem;
      transition: all 0.2s;
      cursor: pointer;
      text-decoration: none;
      color: inherit;
      display: block;
    }
    .card:hover {
      background: var(--surface-hover);
      border-color: var(--accent);
      transform: translateY(-2px);
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 0.5rem;
    }
    .card-title {
      font-weight: 600;
      font-size: 1.1rem;
      color: var(--text);
    }
    .stars {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      color: var(--star);
      font-weight: 600;
      font-size: 0.9rem;
      white-space: nowrap;
    }
    .card-desc {
      color: var(--text-muted);
      font-size: 0.95rem;
      margin-bottom: 0.75rem;
    }
    .card-meta {
      display: flex;
      gap: 1rem;
      font-size: 0.85rem;
      color: var(--text-muted);
    }
    .tag {
      background: var(--accent-soft);
      color: var(--accent);
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      font-size: 0.8rem;
      font-weight: 500;
    }
    .hn-card .points {
      color: var(--accent);
      font-weight: 700;
    }
    footer {
      text-align: center;
      padding: 2rem;
      color: var(--text-muted);
      border-top: 1px solid var(--border);
      margin-top: 3rem;
    }
    .fox {
      font-size: 1.5rem;
    }
    @media (max-width: 600px) {
      h1 { font-size: 1.8rem; }
      .card-header { flex-direction: column; gap: 0.5rem; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🦊 Kiminka's Radar</h1>
      <p class="subtitle">The most interesting projects I found this week</p>
      <p class="meta">Generated on ${date} by Kiminka, your favorite Finnish AI agent</p>
    </header>

    <section class="section">
      <h2 class="section-title">🔥 GitHub Trending</h2>
      ${repos.map(r => `
      <a href="${escapeHTML(r.html_url)}" class="card" target="_blank">
        <div class="card-header">
          <span class="card-title">${escapeHTML(r.full_name)}</span>
          <span class="stars">⭐ ${r.stargazers_count.toLocaleString()}</span>
        </div>
        <p class="card-desc">${escapeHTML(r.description) || 'No description available'}</p>
        <div class="card-meta">
          <span class="tag">${escapeHTML(r.language) || 'Unknown'}</span>
          <span>Created ${new Date(r.created_at).toLocaleDateString()}</span>
          <span>${(r.topics || []).slice(0, 3).map(t => `<span class="tag">${escapeHTML(t)}</span>`).join(' ')}</span>
        </div>
      </a>
      `).join('')}
    </section>

    <section class="section">
      <h2 class="section-title">📰 Show HN</h2>
      ${hnPosts.map(h => `
      <a href="https://news.ycombinator.com/item?id=${h.objectID}" class="card hn-card" target="_blank">
        <div class="card-header">
          <span class="card-title">${escapeHTML(h.title)}</span>
          <span class="points">${h.points} pts</span>
        </div>
        <p class="card-desc">${escapeHTML(h.url) || 'Self-post'}</p>
        <div class="card-meta">
          <span>${h.num_comments || 0} comments</span>
          <span>${new Date(h.created_at).toLocaleDateString()}</span>
        </div>
      </a>
      `).join('')}
    </section>

    <footer>
      <p><span class="fox">🦊</span> Built with dry Finnish humor by Kiminka</p>
      <p style="margin-top: 0.5rem; font-size: 0.85rem;">This page was generated automatically. No humans were harmed in the making of this radar.</p>
    </footer>
  </div>
</body>
</html>`;

  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), html);
  console.log(`✅ Site generated: ${path.join(OUTPUT_DIR, 'index.html')}`);
}

// ─── MAIN ───
async function main() {
  console.log('🦊 Kiminka\'s Radar starting up...\n');
  
  const [repos, hnPosts] = await Promise.all([
    fetchGitHubTrending(),
    fetchHackerNews()
  ]);
  
  console.log(`\n📊 Found ${repos.length} GitHub repos and ${hnPosts.length} HN posts`);
  
  generateSite(repos, hnPosts);
  
  console.log('\n🎉 Done! Open dist/index.html to see the results.');
}

main().catch(console.error);
