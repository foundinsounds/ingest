import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 25;

export async function POST(req: NextRequest) {
  try {
    const { message, cardContext, history } = await req.json();
    if (!message) return NextResponse.json({ error: 'No message' }, { status: 400 });
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ text: 'API key not configured.' });

    const messages: any[] = [];
    if (history && history.length > 0) {
      for (const h of history.slice(-10)) {
        messages.push({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text });
      }
    }
    messages.push({ role: 'user', content: message });

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514', max_tokens: 800,
        system: `You are the INGEST AI assistant. Help users understand and evaluate saved resources. Context:\n${cardContext}\n\nBe concise, opinionated, actionable. Under 150 words unless depth is needed.`,
        messages,
      }),
    });

    const data = await resp.json();
    const text = (data.content || []).map((b: any) => b.text || '').join('');
    return NextResponse.json({ text: text || 'No response.' });
  } catch (error: any) {
    return NextResponse.json({ text: 'Error: ' + (error.message || 'Chat failed') });
  }
}
