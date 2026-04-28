export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.status(403).send('Forbidden');
  }
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const body = req.body;
    console.log('Binnenkomend bericht:', JSON.stringify(body));
    const messages = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!messages) return res.status(200).json({ status: 'ok' });
    const from = messages.from;
    const type = messages.type;
    console.log('Type:', type, 'Keys:', Object.keys(messages));
    const DIALOG_KEY = process.env.DIALOG_API_KEY;
    const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;
    let claudeMessages;

    if (type === 'text') {
      const userText = messages.text?.body || '';
      claudeMessages = [{ type: 'text', text: `Je bent juridisch assistent voor Pretty Lawsome. Analyseer dit bericht in het Nederlands. Geen markdown. Eindig met: Wil je verder? Kies rechtenstudent (25 euro) of advocaat (75 euro). Bericht: ${userText}` }];
    } else if (type === 'image' || type === 'document') {
      const mediaObj = messages[type] || {};
      const mediaId = mediaObj.id;
      const mime = mediaObj.mime_type || (type === 'image' ? 'image/jpeg' : 'application/pdf');
      const caption = mediaObj.caption || '';
      console.log('Media ID:', mediaId, 'Mime:', mime);
      if (!mediaId) {
        await send(from, 'Stuur ook even een tekstbeschrijving van wat je wilt controleren.', DIALOG_KEY);
        return res.status(200).end();
      }
      const mediaResp = await fetch(`https://waba-v2.360dialog.io/media/${mediaId}`, {
        headers: { 'D360-API-Key': DIALOG_KEY }
      });
      console.log('Media response status:', mediaResp.status);
      if (!mediaResp.ok) {
        await send(from, 'Kon je bestand niet verwerken. Probeer opnieuw of stuur je vraag als tekst.', DIALOG_KEY);
        return res.status(200).end();
      }
      const base64 = Buffer.from(await mediaResp.arrayBuffer()).toString('base64');
      const isImage = mime.startsWith('image/');
      claudeMessages = [
        isImage
          ? { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } }
          : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: `Je bent juridisch assistent voor Pretty Lawsome. Analyseer dit ${isImage ? 'document' : 'PDF'} in het Nederlands. ${caption} Geen markdown. Eindig met: Wil je verder? Kies rechtenstudent (25 euro) of advocaat (75 euro).` }
      ];
    } else {
      console.log('Onbekend type:', type, JSON.stringify(messages));
      await send(from, 'Stuur je vraag als tekst of upload een PDF of foto van je document.', DIALOG_KEY);
      return res.status(200).end();
    }

    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 1024, messages: [{ role: 'user', content: claudeMessages }] })
    });
    const claudeData = await claudeResp.json();
    console.log('Claude response:', JSON.stringify(claudeData).substring(0, 200));
    const text = claudeData?.content?.[0]?.text || 'Even geduld, we kijken ernaar.';
    await send(from, text, DIALOG_KEY);
    return res.status(200).json({ status: 'ok' });
  } catch (e) {
    console.error('Fout:', e.message);
    return res.status(200).end();
  }
}

async function send(to, text, key) {
  const resp = await fetch('https://waba-v2.360dialog.io/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'D360-API-Key': key },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: text } })
  });
  console.log('Send response:', resp.status);
}
