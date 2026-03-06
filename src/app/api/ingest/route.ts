import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const { url, intent } = await req.json();
    if (!url) return NextResponse.json({ error: 'No URL provided' }, { status: 400 });

    let pageTitle = '';
    let pageDescription = '';
    let ogTags: Record<string, string> = {};
    let bodyText = '';
    let fetchError = '';

    try {
      const pageResp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; IngestBot/1.0)', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      });
      if (pageResp.ok) {
        const html = await pageResp.text();
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) pageTitle = titleMatch[1].trim();
        const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
        if (descMatch) pageDescription = descMatch[1].trim();
        const ogRegex = /<meta[^>]*property=["']og:([^"']+)["'][^>]*content=["']([^"']+)["']/gi;
        let ogMatch;
        while ((ogMatch = ogRegex.exec(html)) !== null) { ogTags[ogMatch[1]] = ogMatch[2]; }
        const ogRegex2 = /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:([^"']+)["']/gi;
        while ((ogMatch = ogRegex2.exec(html)) !== null) { ogTags[ogMatch[2]] = ogMatch[1]; }
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
        if (bodyMatch) {
          bodyText = bodyMatch[1].replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<nav[\s\S]*?<\/nav>/gi, '').replace(/<footer[\s\S]*?<\/footer>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 3000);
        }
        if (url.includes('github.com') && !url.includes('/issues') && !url.includes('/pull')) {
          try {
            const parts = new URL(url).pathname.split('/').filter(Boolean);
            if (parts.length >= 2) {
              const readmeResp = await fetch(`https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/main/README.md`, { signal: AbortSignal.timeout(3000) });
              if (readmeResp.ok) bodyText = (await readmeResp.text()).substring(0, 3000);
            }
          } catch {}
        }
      } else { fetchError = `HTTP ${pageResp.status}`; }
    } catch (e: any) { fetchError = e.message || 'Fetch failed'; }

    let host = 'link';
    try { host = new URL(url).hostname.replace('www.', ''); } catch {}

    const context = [
      `URL: ${url}`, `Domain: ${host}`,
      pageTitle ? `Page Title: ${pageTitle}` : '',
      pageDescription ? `Meta Description: ${pageDescription}` : '',
      Object.keys(ogTags).length > 0 ? `OG Tags: ${JSON.stringify(ogTags)}` : '',
      bodyText ? `Page Content (excerpt):\n${bodyText}` : '',
      fetchError ? `Note: Could not fully fetch page (${fetchError}).` : '',
      intent ? `User intent: ${intent}` : '',
    ].filter(Boolean).join('\n\n');

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ data: { title: pageTitle || host, sub: pageDescription || '', type: host.includes('github') ? 'GITHUB' : host.includes('youtube') ? 'VIDEO' : 'OTHER', summary: pageDescription || 'Saved link.', details: [], pros: [], cons: [], bestFor: [], tags: [], category: 'Saved', score: 50, longevity: '6-12mo', concepts: [] } });
    }

    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514', max_tokens: 1200,
        messages: [{ role: 'user', content: `You are INGEST, an expert link intelligence analyst. Analyze this link using all page data below. Return ONLY valid JSON.\n\n${context}\n\nReturn: {"title":"2-5 words","sub":"one-line","type":"TOOL|ARTICLE|VIDEO|SOCIAL|GITHUB|OTHER","summary":"3-4 sentences, specific and opinionated using actual content","details":["insight 1","insight 2","insight 3","insight 4"],"pros":["advantage 1","advantage 2","advantage 3"],"cons":["limitation 1","limitation 2"],"bestFor":["use case 1","use case 2"],"tags":["tag1","tag2","tag3","tag4"],"category":"Developer Tools|AI Frameworks|Design|Marketing|Learning|Music|Social Media|News|Research","score":75,"longevity":"3-6mo|6-12mo|12mo+","concepts":["concept 1","concept 2","concept 3"]}\n\nScore ruthlessly. Use actual page content.` }],
      }),
    });

    const aiData = await aiResp.json();
    const aiText = (aiData.content || []).map((b: any) => b.text || '').join('');
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return NextResponse.json({ data: { title: pageTitle || host, sub: pageDescription || '', type: 'OTHER', summary: pageDescription || 'Analysis incomplete.', details: [], pros: [], cons: [], bestFor: [], tags: [], category: 'Saved', score: 50, longevity: '6-12mo', concepts: [] } });

    return NextResponse.json({ data: JSON.parse(jsonMatch[0]) });
  } catch (error: any) {
    console.error('Ingest error:', error);
    return NextResponse.json({ error: error.message || 'Ingest failed' }, { status: 500 });
  }
}
