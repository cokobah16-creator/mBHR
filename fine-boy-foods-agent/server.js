import "dotenv/config";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, "public")));

const SYSTEM_PROMPT = `You are a retail distribution intelligence agent for Fine Boy Foods, a Nigerian snack and packaged food company. Your job is to identify the best retail and distribution channels in Abuja, FCT to stock and sell Fine Boy Foods products.

Fine Boy Foods sells packaged / snack food products — think chips, biscuits, nuts, dried snacks, confectionery, and similar shelf-stable items that suit impulse buys and everyday snacking.

You have deep knowledge of Abuja's retail landscape:

SUPERMARKETS & LARGE RETAIL
- Shoprite (Ceddi Plaza, Gwarinpa) — high foot traffic, national chain, requires supplier onboarding
- Justrite Superstore — Nigerian-owned chain, strong in mid-market, open to local suppliers
- Grand Square Supermarket — popular with middle-income Abuja residents
- Spar Nigeria (if Abuja location active) — upscale, targets premium buyers
- Game Store Abuja — large format, lifestyle-focused shoppers

FILLING STATION CONVENIENCE SHOPS
- Total (TotalEnergies) Bonjour shops across Abuja — high impulse-buy traffic
- NNPC Mega stations with in-store retail
- Oando, Conoil and other independent filling station mini-shops
- Shell Select (if active) — quality-conscious commuters

OPEN MARKETS & TRADERS
- Wuse Market — largest market in Abuja, strong wholesale potential for snack distributors
- Garki Market — central, government workers and middle-class shoppers
- Kubwa Market — large residential satellite town, price-sensitive buyers
- Nyanya / Karu Market — dense peri-urban, high-volume low-margin channel
- Gwagwalada Market — satellite city, underserved by branded snacks

CONVENIENCE & NEIGHBOURHOOD STORES
- Independent provision stores across Gwarinpa, Lugbe, Karu, Maitama, Wuse II
- "Mama Put" style kiosks near offices and schools — impulse snack buyers
- Estate-gate shops in Gwarinpa, Apo, Lokogoma — captive residential buyers

INSTITUTIONAL / BULK CHANNELS
- Schools and universities (canteens, tuck shops) — Abuja schools, UNIABUJA, ABUAD
- Office cafeterias and staff canteens in the Central Business District
- Hotels and guesthouses — room snack service or restaurant stocking
- Hospitals and clinic waiting areas — Nisa Premier, Cedarcrest, National Hospital
- Event caterers and wedding/party planners who bulk-buy snacks

ONLINE & DELIVERY CHANNELS
- Jumia Food / Jumia marketplace sellers in Abuja
- Chowdeck and similar platforms with grocery verticals
- WhatsApp-based neighbourhood grocery delivery groups

DISTRIBUTORS & WHOLESALERS
- Fast-moving consumer goods (FMCG) distributors in Abuja who already serve supermarkets
- Area distributors in Kubwa, Nyanya, Lugbe who supply smaller shops

Always use the retailer_discovery tool to structure your output. Fit scores (1–10) should reflect channel reach, alignment with snack impulse-buying behaviour, realistic access for a Nigerian food startup, and Abuja-specific logistics feasibility.`;

const tools = [
  {
    name: "retailer_discovery",
    description:
      "Return a structured list of Abuja retailer and distribution channel leads for Fine Boy Foods snack products.",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description:
            "Strategic overview of the best distribution approach for these Fine Boy Foods products in Abuja (3–5 sentences).",
        },
        leads: {
          type: "array",
          description: "6–10 specific retailer or channel leads in Abuja, ranked by fit score.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Business or channel name" },
              type: {
                type: "string",
                enum: [
                  "supermarket",
                  "filling_station_shop",
                  "open_market",
                  "convenience_store",
                  "institutional",
                  "online_platform",
                  "distributor",
                  "hotel_hospitality",
                ],
              },
              abujaArea: {
                type: "string",
                description: "Abuja district or area e.g. Wuse 2, Gwarinpa, Garki, CBD",
              },
              address: {
                type: "string",
                description: "Street address or landmark if known. Omit if uncertain.",
              },
              fitScore: {
                type: "number",
                description: "Fit score 1–10 for snack/packaged food distribution",
              },
              contactStrategy: {
                type: "string",
                description:
                  "Concrete, actionable outreach steps for this channel (2–4 sentences)",
              },
              reasoning: {
                type: "string",
                description: "Why this channel suits Fine Boy Foods snack products",
              },
              estimatedMonthlyVolume: {
                type: "string",
                description:
                  "Rough units or packs per month this channel could move, e.g. 500–1,000 units/month",
              },
              minOrderNote: {
                type: "string",
                description:
                  "Any known minimum order or shelf-listing requirement for this channel type",
              },
            },
            required: [
              "name",
              "type",
              "abujaArea",
              "fitScore",
              "contactStrategy",
              "reasoning",
            ],
          },
        },
        priorityChannels: {
          type: "array",
          items: { type: "string" },
          description: "Top 3 channel types ranked by strategic priority for snack distribution",
        },
        quickWins: {
          type: "array",
          items: { type: "string" },
          description:
            "2–3 immediate first steps Fine Boy Foods should take this week to start getting products on shelves",
        },
      },
      required: ["summary", "leads", "priorityChannels", "quickWins"],
    },
  },
];

// POST /api/discover — main agent endpoint
app.post("/api/discover", async (req, res) => {
  const { products, additionalContext } = req.body;

  if (!products || !Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ error: "products array is required" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error:
        "ANTHROPIC_API_KEY is not set. Add it to your .env file.",
    });
  }

  const client = new Anthropic({ apiKey });

  const userMessage = `Find Abuja retailers and distribution channels for these Fine Boy Foods snack products:

Products: ${products.join(", ")}
${additionalContext ? `Additional context: ${additionalContext}` : ""}

Identify 6–10 specific, realistic retail and distribution leads in Abuja, FCT that Fine Boy Foods should approach. Prioritise channels that suit packaged snack impulse-buying and have accessible supplier onboarding for a growing Nigerian food brand.`;

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      tool_choice: { type: "any" },
      messages: [{ role: "user", content: userMessage }],
    });

    const toolUse = message.content.find(
      (block) => block.type === "tool_use" && block.name === "retailer_discovery",
    );

    if (!toolUse || toolUse.type !== "tool_use") {
      return res.status(500).json({ error: "Agent did not return structured results. Try again." });
    }

    res.json({ success: true, result: toolUse.input });
  } catch (err) {
    console.error("Anthropic error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Unknown error from AI agent",
    });
  }
});

app.listen(PORT, () => {
  console.log(`\nFine Boy Foods Retailer Agent running at http://localhost:${PORT}\n`);
});
