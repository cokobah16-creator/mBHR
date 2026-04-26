import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SYSTEM_PROMPT = `You are a retail distribution intelligence agent for the Dr. Isioma Okobah Foundation (mBHR), operating in Abuja, Nigeria's Federal Capital Territory. Your task is to identify the most suitable retail and distribution channels to supply FBF (Foundation-distributed health) products.

You have deep knowledge of Abuja's commercial landscape across all Area Councils and districts:

- GARKI: Major pharmacies, government hospitals (Garki Hospital, National Hospital, NICON Hospital), NNPC cooperative shops, Garki Market traders
- WUSE: Wuse Market (largest open market in Abuja), Wuse 2 upscale retail strip, pharmacies like Medplus and HealthPlus, supermarkets near Area 1
- MAITAMA: High-income residential area, specialty health stores, private clinics, premium supermarkets, corporate wellness programmes
- GWARINPA: Largest residential estate in SSA, community pharmacies, Shoprite Gwarinpa, supermarkets serving large middle-income families
- ASOKORO: Diplomatic zone, high-end retail, embassy supply chains, Aso Rock Medical Centre vicinity
- KUBWA: Dense residential satellite town, bustling Kubwa Market, cooperative societies, community health centres
- ABUJA CENTRAL DISTRICT (CBD): Federal Secretariat area, NGO/INGO offices, ministry supply chains, Area 11 retail
- LUGBE / AIRPORT ROAD: Growing commercial corridor, pharmacies serving transient population, wholesale distributors
- KARU / NYANYA: Dense peri-urban area, large open markets, price-sensitive consumer base, community pharmacies

Retailer types to evaluate for FBF product supply:
1. Pharmacies & chemist shops — national chains: HealthPlus, Medplus, Bloomsford Pharmacy; independents across all districts
2. Supermarkets — Shoprite Abuja (Ceddi Plaza, Gwarinpa), Justrite Superstore, Grand Square, Spar (if present), Game Store
3. Health food & nutrition stores — specialty outlets in Maitama, Wuse 2, Jabi
4. Hospital pharmacy supply chains — National Hospital Abuja, Garki Hospital, Nisa Premier Hospital, Cedarcrest Hospital, Nizamiye Hospital
5. NGO / foundation distribution networks — UNICEF Abuja office supply chains, Action Against Hunger, Save the Children, Catholic Caritas Foundation
6. Community health centers & PHCs — Primary Health Centres managed by AMAC in each ward
7. Medical supply distributors & wholesalers — Wuse Market medical section, Area 1 wholesale distributors
8. Maternal & child health retailers — Mother-and-child shops near Maitama General Hospital, Wuse General Hospital

Always use the retailer_discovery tool to return your structured analysis. Fit scores (1–10) should reflect product-channel alignment, realistic reach into target demographics, distributor reliability, and accessibility of the location for Foundation staff to follow up.`;

const DEMO_RESULT = {
  summary:
    "Demo mode: ANTHROPIC_API_KEY not configured. Sample Abuja retailers shown. Configure the key in Supabase Edge Function secrets to enable live AI discovery.",
  leads: [
    {
      name: "HealthPlus Pharmacy — Wuse 2",
      type: "pharmacy",
      abujaArea: "Wuse 2",
      address: "Plot 1038, Ahmadu Bello Way, Wuse 2, Abuja",
      fitScore: 9,
      contactStrategy:
        "Contact the branch manager directly. HealthPlus runs a central buying team in Lagos — reach out to their procurement department with a product dossier and NAFDAC numbers. Offer a consignment arrangement for the first 3 months.",
      reasoning:
        "HealthPlus is a well-trusted national pharmacy chain with strong foot traffic in Wuse 2, Abuja's main commercial district. High-income and middle-income customers match FBF product demographics.",
      estimatedReach: "400–700 customers/month",
    },
    {
      name: "Shoprite Abuja — Gwarinpa",
      type: "supermarket",
      abujaArea: "Gwarinpa",
      address: "Gwarinpa Shopping Centre, 1st Avenue, Gwarinpa Estate",
      fitScore: 8,
      contactStrategy:
        "Approach Shoprite's local supplier onboarding programme. Prepare NAFDAC registration, product samples, and competitive pricing sheet. Request shelf-space in the health & wellness aisle.",
      reasoning:
        "Shoprite Gwarinpa serves one of the largest residential estates in Sub-Saharan Africa. Extremely high foot traffic from families — ideal for nutritional supplements and maternal health products.",
      estimatedReach: "1,000–2,000 shoppers/month",
    },
    {
      name: "National Hospital Abuja — Pharmacy Unit",
      type: "hospital_supply",
      abujaArea: "Central District",
      address: "Plot 132, Central Business District, Abuja",
      fitScore: 7,
      contactStrategy:
        "Submit a formal product tender through the hospital's pharmacy procurement office. Provide clinical data sheets and certifications. The Foundation's medical reputation strengthens credibility here.",
      reasoning:
        "National Hospital is the premier federal tertiary hospital. Their pharmacy unit supplies thousands of outpatients monthly. Partnership lends institutional credibility to FBF products.",
      estimatedReach: "500–900 patients/month",
    },
  ],
  priorityChannels: [
    "pharmacy",
    "supermarket",
    "hospital_supply",
  ],
};

interface DiscoveryRequest {
  products: string[];
  productCategory: string;
  targetArea: "Abuja";
  additionalContext?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { products, productCategory, targetArea, additionalContext }: DiscoveryRequest =
      await req.json();

    if (!products?.length || !productCategory) {
      return new Response(
        JSON.stringify({ success: false, error: "products and productCategory are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");

    if (!anthropicApiKey) {
      console.warn("ANTHROPIC_API_KEY not configured. Running in demo mode.");
      return new Response(
        JSON.stringify({ success: true, demo: true, result: DEMO_RESULT }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const tools = [
      {
        name: "retailer_discovery",
        description:
          "Return a structured list of Abuja retailer leads best suited to distribute the specified FBF health products.",
        input_schema: {
          type: "object",
          properties: {
            summary: {
              type: "string",
              description: "Strategic overview of the recommended Abuja distribution approach (2–4 sentences).",
            },
            leads: {
              type: "array",
              description: "6–10 specific retailer or distribution channel leads in Abuja.",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "Business or retailer name" },
                  type: {
                    type: "string",
                    enum: [
                      "pharmacy",
                      "supermarket",
                      "hospital_supply",
                      "ngo_network",
                      "health_store",
                      "distributor",
                      "community_health",
                      "cooperative",
                    ],
                  },
                  abujaArea: {
                    type: "string",
                    description: "Abuja district or LGA, e.g. Wuse 2, Garki II, Gwarinpa, Maitama",
                  },
                  address: {
                    type: "string",
                    description: "Street address or landmark if known. Omit if uncertain.",
                  },
                  fitScore: {
                    type: "number",
                    description: "Fit score 1–10 for this product/channel match",
                  },
                  contactStrategy: {
                    type: "string",
                    description: "Concrete, actionable outreach approach for this specific retailer (2–4 sentences)",
                  },
                  reasoning: {
                    type: "string",
                    description: "Why this retailer is a strong fit for these FBF products",
                  },
                  estimatedReach: {
                    type: "string",
                    description: "Estimated monthly consumer/patient reach, e.g. 200–500 customers/month",
                  },
                },
                required: ["name", "type", "abujaArea", "fitScore", "contactStrategy", "reasoning"],
              },
            },
            priorityChannels: {
              type: "array",
              items: { type: "string" },
              description: "Top 3 channel types ranked by strategic priority for these products",
            },
          },
          required: ["summary", "leads", "priorityChannels"],
        },
      },
    ];

    const userMessage = `Find Abuja retailers for these FBF health products:

Products: ${products.join(", ")}
Category: ${productCategory}
Target Area: ${targetArea || "Abuja"}, FCT, Nigeria
${additionalContext ? `Additional context: ${additionalContext}` : ""}

Identify 6–10 specific retailers or distribution channels best suited to carry and supply these products across Abuja. Focus on realistic, actionable leads with specific Abuja locations, concrete contact strategies, and accurate fit scores.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools,
        tool_choice: { type: "any" },
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Anthropic API error:", errorText);
      return new Response(
        JSON.stringify({ success: false, error: "AI agent failed to respond. Try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const anthropicData = await response.json();

    // Find the tool_use block in the content array
    const toolUseBlock = anthropicData.content?.find(
      (block: { type: string; name?: string }) =>
        block.type === "tool_use" && block.name === "retailer_discovery",
    );

    if (!toolUseBlock) {
      console.error("No tool_use block in Anthropic response:", JSON.stringify(anthropicData));
      return new Response(
        JSON.stringify({ success: false, error: "Agent did not return structured results. Try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, demo: false, result: toolUseBlock.input }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error in retailer-discovery-agent:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
