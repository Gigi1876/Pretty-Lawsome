export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.status(403).send('Forbidden');
  }
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const messages = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!messages) return res.status(200).json({ status: 'ok' });
    const from = messages.from;
    const type = messages.type;
    const DIALOG_KEY = process.env.DIALOG_API_KEY;
    const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;
    let content;
    if (type === 'text') {
      content = [{ type: 'text', text: `Je bent juridisch assistent voor Pretty Lawsome. Analyseer dit bericht in het Nederlands. Geen markdown. Eindig met: Wil je verder? Kies rechtenstudent (25 euro) of advocaat (75 euro). Bericht: ${messages.text.body}` }];
    } else if (type === 'image' || type === 'document') {
      const mediaId = messages[type]?.id;
      const mime = messages[type]?.mime_type || 'image/jpeg';
      const caption = messages[type]?.caption || '';
      const mediaResp = await fetch(`https://waba-v2.360dialog.io/media/${mediaId}`, { headers: { 'D360-API-Key': DIALOG_KEY } });
      if (!mediaResp.ok) { await send(from, 'Kon je bestand niet verwerken. Probeer opnieuw.', DIALOG_KEY); return res.status(200).end(); }
      const base64 = Buffer.from(await mediaResp.arrayBuffer()).toString('base64');
      const isImage = mime.startsWith('image/');
      content = [
        isImage ? { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } } : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: `Je bent juridisch assistent voor Pretty Lawsome. Analyseer dit ${isImage ? 'document' : 'PDF'} in het Nederlands. ${caption} Geen markdown. Eindig met: Wil je verder? Kies rechtenstudent (25 euro) of advocaat (75 euro).` }
      ];
    } else {
      await send(from, 'Stuur je vraag als tekst of upload een PDF of foto van je document.', DIALOG_KEY);
      return res.status(200).end();
    }
    const claude = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 1024, messages: [{ role: 'user', content }] }) });
    const text = (await claude.json())?.content?.[0]?.text || 'Even geduld, we kijken ernaar.';
    await send(from, text, DIALOG_KEY);
    return res.status(200).json({ status: 'ok' });
  } catch (e) { console.error(e); return res.status(200).end(); }
}
async function send(to, text, key) {
  await fetch('https://waba-v2.360dialog.io/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'D360-API-Key': key }, body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: text } }) });
}
