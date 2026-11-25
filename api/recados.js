// Mural de recados da Banda Clímax
// Armazenamento: Upstash Redis (Vercel Marketplace). As variáveis de ambiente
// KV_REST_API_URL / KV_REST_API_TOKEN (ou UPSTASH_REDIS_REST_URL / _TOKEN)
// são criadas automaticamente ao conectar o banco ao projeto na Vercel.
// Moderação: defina MURAL_SENHA nas variáveis de ambiente do projeto.

const URL_DB = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const CHAVE = 'climax:recados';
const MAX_RECADOS = 1000;

async function redis(...cmd) {
  const r = await fetch(URL_DB, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

const limpa = (v, max) => String(v || '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_DB || !TOKEN) return res.status(503).json({ erro: 'nao_configurado' });

  try {
    if (req.method === 'GET') {
      const itens = await redis('LRANGE', CHAVE, 0, 199);
      return res.status(200).json({ recados: itens.map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean) });
    }

    if (req.method === 'POST') {
      const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      if (b.site) return res.status(200).json({ ok: true }); // armadilha anti-robô
      const nome = limpa(b.nome, 40);
      const cidade = limpa(b.cidade, 40);
      const msg = limpa(b.msg, 600);
      if (nome.length < 2 || msg.length < 2) return res.status(400).json({ erro: 'Preencha seu nome e a mensagem.' });
      if ((msg.match(/https?:\/\//gi) || []).length > 1) return res.status(400).json({ erro: 'Mensagem com links demais.' });

      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
      const livre = await redis('SET', `climax:rl:${ip}`, '1', 'NX', 'EX', 30);
      if (livre !== 'OK') return res.status(429).json({ erro: 'Aguarde alguns segundos antes de enviar outro recado.' });

      const recado = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), nome, cidade, msg, data: new Date().toISOString() };
      await redis('LPUSH', CHAVE, JSON.stringify(recado));
      await redis('LTRIM', CHAVE, 0, MAX_RECADOS - 1);
      return res.status(201).json({ ok: true, recado });
    }

    if (req.method === 'DELETE') {
      const senha = String(req.headers['x-mural-senha'] || '');
      if (!process.env.MURAL_SENHA || senha !== process.env.MURAL_SENHA) return res.status(401).json({ erro: 'Senha incorreta.' });
      const id = String((req.query && req.query.id) || '');
      const itens = await redis('LRANGE', CHAVE, 0, -1);
      const alvo = itens.find((s) => { try { return JSON.parse(s).id === id; } catch { return false; } });
      if (!alvo) return res.status(404).json({ erro: 'Recado não encontrado.' });
      await redis('LREM', CHAVE, 1, alvo);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ erro: 'Método não permitido.' });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro no servidor. Tente de novo mais tarde.' });
  }
};
