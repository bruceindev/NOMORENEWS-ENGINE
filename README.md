# NoMoreNews Engine

Motor de notícias do projeto **NoMoreNews**. É uma API simples que busca notícias de tecnologia, resume tudo em português (pt-BR) com IA e entrega em JSON para o projeto principal consumir.

## Como funciona

1. Busca as notícias do dia na [Tavily](https://tavily.com) (Apple, OpenAI/Anthropic, Microsoft, Google e Meta).
2. Envia o conteúdo para a [OpenRouter](https://openrouter.ai), que gera título e resumo em pt-BR. Se um modelo falhar, tenta o próximo.
3. Se todos os modelos falharem, devolve os dados brutos da Tavily.
4. Guarda o resultado em cache (memória + `output.json`).

## Requisitos

- Node.js 18+
- pnpm
- Chaves de API da Tavily e da OpenRouter

## Instalação

```bash
pnpm install
```

Crie um arquivo `.env` na raiz:

```env
TAVILY_API_KEY=sua_chave
OPENROUTER_API_KEY=sua_chave
```

## Executando

```bash
pnpm dev     # modo desenvolvimento (watch)
pnpm start   # modo normal
```

O motor sobe em `http://localhost:3333`.

## Endpoints

| Método | Rota            | Descrição                                      |
| ------ | --------------- | ---------------------------------------------- |
| GET    | `/news`         | Retorna as notícias em cache (busca se vazio)  |
| GET    | `/news/refresh` | Força nova busca e atualiza o cache            |

### Exemplo de resposta

```json
{
  "updatedAt": "2026-10-03T12:00:00.000Z",
  "news": [
    {
      "title": "Título em português",
      "summary": "Resumo em 4-5 linhas...",
      "source": "fonte",
      "url": "https://...",
      "company": "Apple"
    }
  ]
}
```

## Integração

No projeto principal, basta consumir a API:

```js
const res = await fetch("http://localhost:3333/news");
const { news } = await res.json();
```

> O CORS está liberado apenas para `localhost` / `127.0.0.1`.
