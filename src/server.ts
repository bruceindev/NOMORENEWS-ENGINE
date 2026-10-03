import "dotenv/config";
import express from "express";
import axios from "axios";
import cors from "cors";
import fs from "fs";
import path from "path";

const app = express();
const COMPANIES = ["Apple", "OpenAI Anthropic Claude", "Microsoft", "Google", "Meta"];
const MODELS = [
  "minimax/minimax-m2.7:free",
  "poolside/laguna-s-2.1:free",
  "poolside/laguna-xs-2.1:free",
  "google/gemma-4-31b-it:free",
];
const OUTPUT_FILE = path.resolve(process.cwd(), "output.json");

// Cache em memória
let cachedNews: any = null;

// Carrega o cache inicial do disco, se existir
if (fs.existsSync(OUTPUT_FILE)) {
  try {
    const data = fs.readFileSync(OUTPUT_FILE, "utf-8");
    cachedNews = JSON.parse(data);
    console.log("💾 Cache inicial de notícias carregado a partir do output.json");
  } catch (err: any) {
    console.warn("⚠️ Não foi possível carregar output.json ao iniciar:", err?.message || err);
    cachedNews = null;
  }
}

function salvarCacheEmDisco(data: any) {
  try {
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2), "utf-8");
    console.log("💾 Cache de notícias salvo com sucesso em output.json");
  } catch (err: any) {
    console.error("⚠️ Erro ao salvar output.json em disco:", err?.message || err);
  }
}

// CORS liberado para qualquer porta de localhost / 127.0.0.1 (ex: 3001, 5173, etc.)
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Bloqueado pelo CORS"));
      }
    },
  })
);

function extrairJson(texto: string) {
  let limpo = texto.replace(/```json/gi, "").replace(/```/g, "").trim();
  
  const primeiroBracket = limpo.indexOf("{");
  const ultimoBracket = limpo.lastIndexOf("}");
  
  if (primeiroBracket !== -1 && ultimoBracket !== -1 && ultimoBracket > primeiroBracket) {
    limpo = limpo.slice(primeiroBracket, ultimoBracket + 1);
  }

  return JSON.parse(limpo);
}

async function buscarNoticias() {
  console.log("🔍 Buscando notícias na Tavily em paralelo...");

  const searchPromises = COMPANIES.map(async (company) => {
    try {
      const { data } = await axios.post("https://api.tavily.com/search", {
        api_key: process.env.TAVILY_API_KEY,
        query: `${company} technology news`,
        time_range: "day",
        max_results: 2,
      });

      return (data.results || []).map((r: any) => ({ ...r, empresa: company }));
    } catch (err: any) {
      console.error(`Erro ao buscar notícias da ${company}:`, err?.message || err);
      return [];
    }
  });

  const resultsArray = await Promise.all(searchPromises);
  const rawResults = resultsArray.flat();

  if (rawResults.length === 0) {
    throw new Error("Nenhuma notícia encontrada na Tavily.");
  }

  console.log(`✅ ${rawResults.length} notícias brutas encontradas. Processando com IA...`);

  // 2. Monta o contexto para a IA
  const context = rawResults
    .map((r) => `Empresa: ${r.empresa}\nTítulo: ${r.title}\nConteúdo: ${r.content}\nLink: ${r.url}`)
    .join("\n\n---\n\n");

  const prompt = `Com base nessas notícias, gere um JSON com até 10 notícias (até duas por empresa).

IMPORTANTE: TANTO o "title" quanto o "summary" DEVEM ser SEMPRE em português do Brasil (pt-BR), mesmo que a notícia original esteja em inglês. NUNCA deixe o título em inglês. O summary deve ser um resumo em 4-5 linhas, trazendo contexto, o que aconteceu, e por que é relevante.

Responda APENAS com JSON válido, neste formato:
{
  "updatedAt": "data e hora em ISO string",
  "news": [
    { "title": "título em pt-BR", "summary": "resumo em 4-5 linhas em pt-BR, com contexto e relevância", "source": "fonte", "url": "link", "company": "empresa" }
  ]
}

Notícias:
${context}`;

  // 3. Tenta processar com fallback entre modelos gratuitos
  for (const model of MODELS) {
    try {
      console.log(`🤖 Tentando modelo: ${model}`);
      const { data } = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
        },
        {
          headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
          timeout: 20000,
        }
      );

      const content = data.choices?.[0]?.message?.content;
      if (!content) continue;

      const parsed = extrairJson(content);
      if (parsed && parsed.news) {
        console.log(`🎉 Notícias formatadas com sucesso pelo modelo ${model}`);
        return {
          updatedAt: new Date().toISOString(),
          news: parsed.news,
        };
      }
    } catch (err: any) {
      console.warn(`⚠️ Modelo ${model} falhou (${err?.response?.status || err?.message}). Tentando próximo...`);
    }
  }

  // 4. Fallback de emergência (caso todos os modelos gratuitos estejam temporariamente ocupados)
  console.log("⚠️ Usando fallback direto dos dados brutos da Tavily...");
  return {
    updatedAt: new Date().toISOString(),
    news: rawResults.slice(0, 10).map((r) => ({
      title: r.title,
      summary: r.content ? r.content.slice(0, 200) + "..." : "Sem resumo disponível",
      source: r.url ? new URL(r.url).hostname : "Web",
      url: r.url,
      company: r.empresa,
    })),
  };
}

// Rota para forçar atualização do cache
app.get("/news/refresh", async (req, res) => {
  try {
    console.log("🔄 Forçando atualização de notícias (/news/refresh)...");
    cachedNews = await buscarNoticias();
    salvarCacheEmDisco(cachedNews);
    res.json(cachedNews);
  } catch (error: any) {
    console.error("Erro na rota /news/refresh:", error?.message || error);
    res.status(500).json({
      error: "Erro ao atualizar notícias",
      details: error?.message || "Erro desconhecido",
    });
  }
});

// Rota principal com cache em memória
app.get("/news", async (req, res) => {
  try {
    if (cachedNews) {
      console.log("⚡ Retornando notícias do cache em memória");
      return res.json(cachedNews);
    }

    console.log("🔄 Cache vazio. Buscando notícias pela primeira vez...");
    cachedNews = await buscarNoticias();
    salvarCacheEmDisco(cachedNews);
    res.json(cachedNews);
  } catch (error: any) {
    console.error("Erro na rota /news:", error?.message || error);
    res.status(500).json({
      error: "Erro ao buscar e processar notícias",
      details: error?.message || "Erro desconhecido",
    });
  }
});

app.listen(3333, () => console.log("motor rodando em http://localhost:3333"));