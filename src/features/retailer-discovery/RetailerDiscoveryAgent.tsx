import { useState, useRef } from "react";
import {
  SparklesIcon,
  MapPinIcon,
  BuildingOfficeIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import type { RetailerLead, RetailerType, DiscoveryResult } from "./types";

const CATEGORY_OPTIONS = [
  { value: "nutrition", label: "Nutritional Supplements" },
  { value: "maternal_child", label: "Maternal & Child Health" },
  { value: "medications", label: "Essential Medicines" },
  { value: "medical_supplies", label: "Medical Supplies / Equipment" },
  { value: "hygiene", label: "Hygiene & Sanitation" },
  { value: "other", label: "Other Health Products" },
];

const RETAILER_TYPE_LABELS: Record<RetailerType, string> = {
  pharmacy: "Pharmacy",
  supermarket: "Supermarket",
  hospital_supply: "Hospital Supply",
  ngo_network: "NGO Network",
  health_store: "Health Store",
  distributor: "Distributor",
  community_health: "Community Health",
  cooperative: "Cooperative",
};

function fitScoreBadgeClass(score: number): string {
  if (score >= 8) return "bg-green-100 text-green-800";
  if (score >= 6) return "bg-yellow-100 text-yellow-800";
  return "bg-red-100 text-red-800";
}

function RetailerCard({ lead }: { lead: RetailerLead }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-3 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-gray-900 text-base leading-snug">{lead.name}</h3>
        <span
          className={`text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${fitScoreBadgeClass(lead.fitScore)}`}
        >
          {lead.fitScore}/10
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
          {RETAILER_TYPE_LABELS[lead.type]}
        </span>
        <span className="flex items-center gap-1 text-xs text-gray-500">
          <MapPinIcon className="h-3.5 w-3.5 flex-shrink-0" />
          {lead.abujaArea}
        </span>
      </div>

      {lead.address && (
        <p className="text-xs text-gray-400">{lead.address}</p>
      )}

      <p className="text-sm text-gray-600 leading-relaxed">{lead.reasoning}</p>

      <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
        <p className="text-xs font-semibold text-primary mb-1">Contact Strategy</p>
        <p className="text-sm text-gray-700 leading-relaxed">{lead.contactStrategy}</p>
      </div>

      {lead.estimatedReach && (
        <p className="text-xs text-gray-400">
          Estimated reach: <span className="font-medium text-gray-500">{lead.estimatedReach}</span>
        </p>
      )}
    </div>
  );
}

function AgentThinking() {
  const steps = [
    "Analyzing product category...",
    "Scanning Abuja retail landscape...",
    "Scoring distributor fit...",
  ];

  return (
    <div className="flex flex-col items-center justify-center py-16 space-y-5">
      <div className="relative">
        <SparklesIcon className="h-12 w-12 text-primary animate-pulse" />
      </div>
      <p className="text-lg font-medium text-gray-700">AI Agent Searching...</p>
      <div className="space-y-2 w-64">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2 text-sm text-gray-500">
            <div
              className="h-2 w-2 bg-primary rounded-full animate-pulse flex-shrink-0"
              style={{ animationDelay: `${i * 0.35}s` }}
            />
            {step}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RetailerDiscoveryAgent() {
  const [products, setProducts] = useState<string[]>([]);
  const [productInput, setProductInput] = useState("");
  const [category, setCategory] = useState("");
  const [additionalContext, setAdditionalContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  function addProduct(raw: string) {
    const trimmed = raw.trim().replace(/,+$/, "").trim();
    if (trimmed && !products.includes(trimmed)) {
      setProducts((prev) => [...prev, trimmed]);
    }
    setProductInput("");
  }

  function handleProductKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addProduct(productInput);
    } else if (e.key === "Backspace" && productInput === "" && products.length > 0) {
      setProducts((prev) => prev.slice(0, -1));
    }
  }

  function removeProduct(name: string) {
    setProducts((prev) => prev.filter((p) => p !== name));
  }

  async function handleSearch() {
    if (products.length === 0 || !category) return;

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

    if (!supabaseUrl || !supabaseKey) {
      setError(
        "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file to use this feature.",
      );
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 30_000);

    setLoading(true);
    setError(null);
    setResult(null);
    setIsDemo(false);

    try {
      const response = await fetch(
        `${supabaseUrl}/functions/v1/retailer-discovery-agent`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            products,
            productCategory: category,
            targetArea: "Abuja",
            additionalContext: additionalContext.trim() || undefined,
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new Error(`Agent error (${response.status}): ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Discovery failed");
      }

      setResult(data.result);
      setIsDemo(data.demo ?? false);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("Request timed out after 30 seconds. Please try again.");
      } else {
        setError(err instanceof Error ? err.message : "Unknown error occurred");
      }
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }

  const canSearch = products.length > 0 && category !== "" && !loading;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-3 flex-shrink-0">
          <SparklesIcon className="h-7 w-7 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Retailer Discovery Agent</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            AI-powered search for FBF product distribution partners in{" "}
            <span className="font-medium text-gray-700">Abuja, FCT</span>
          </p>
        </div>
      </div>

      {/* Search Form */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
        <h2 className="font-semibold text-gray-800">Product Details</h2>

        {/* Product Tag Input */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            FBF Products <span className="text-red-500">*</span>
          </label>
          <div
            className="flex flex-wrap gap-1.5 items-center min-h-[44px] border border-gray-300 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-primary/30 focus-within:border-primary bg-white"
          >
            {products.map((p) => (
              <span
                key={p}
                className="inline-flex items-center gap-1 bg-primary/10 text-primary text-sm px-2.5 py-0.5 rounded-full font-medium"
              >
                {p}
                <button
                  type="button"
                  onClick={() => removeProduct(p)}
                  aria-label={`Remove ${p}`}
                  className="hover:text-primary/60 transition-colors"
                >
                  <XMarkIcon className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            <input
              type="text"
              value={productInput}
              onChange={(e) => setProductInput(e.target.value)}
              onKeyDown={handleProductKeyDown}
              onBlur={() => productInput.trim() && addProduct(productInput)}
              placeholder={products.length === 0 ? "Type a product name and press Enter..." : "Add another..."}
              className="flex-1 min-w-[140px] text-sm outline-none bg-transparent placeholder-gray-400"
            />
          </div>
          <p className="text-xs text-gray-400 mt-1">Press Enter or comma to add each product</p>
        </div>

        {/* Category Dropdown */}
        <div>
          <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-1.5">
            Product Category <span className="text-red-500">*</span>
          </label>
          <select
            id="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
          >
            <option value="">Select a category...</option>
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Additional Context */}
        <div>
          <label htmlFor="context" className="block text-sm font-medium text-gray-700 mb-1.5">
            Additional Context <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            id="context"
            value={additionalContext}
            onChange={(e) => setAdditionalContext(e.target.value)}
            placeholder="e.g. targeting nursing mothers, price-sensitive market, need cold-chain storage..."
            rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
          />
        </div>

        {/* Search Button */}
        <button
          type="button"
          onClick={handleSearch}
          disabled={!canSearch}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <ArrowPathIcon className="h-4 w-4 animate-spin" />
          ) : (
            <MagnifyingGlassIcon className="h-4 w-4" />
          )}
          {loading ? "Searching..." : "Find Abuja Retailers"}
        </button>
      </div>

      {/* Loading State */}
      {loading && <AgentThinking />}

      {/* Error State */}
      {error && !loading && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
          <ExclamationTriangleIcon className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-800">Discovery Failed</p>
            <p className="text-sm text-red-700 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <div className="space-y-5">
          {/* Demo Mode Banner */}
          {isDemo && (
            <div className="flex items-start gap-3 bg-yellow-50 border border-yellow-200 rounded-xl p-4">
              <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-yellow-800">
                <span className="font-semibold">Demo mode:</span> ANTHROPIC_API_KEY is not set in the
                edge function. Add it to Supabase secrets to enable live AI-powered discovery. Sample
                results are shown below.
              </p>
            </div>
          )}

          {/* Strategic Summary */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <BuildingOfficeIcon className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-blue-900 mb-1">Strategic Overview</p>
                <p className="text-sm text-blue-800 leading-relaxed">{result.summary}</p>
              </div>
            </div>
          </div>

          {/* Priority Channels */}
          {result.priorityChannels.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Priority channels:
              </span>
              {result.priorityChannels.map((ch, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 text-xs bg-primary text-white px-2.5 py-1 rounded-full font-medium"
                >
                  {i + 1}. {ch}
                </span>
              ))}
            </div>
          )}

          {/* Results Count */}
          <p className="text-sm text-gray-500">
            Found{" "}
            <span className="font-semibold text-gray-800">{result.leads.length}</span> retailer
            leads in Abuja
          </p>

          {/* Retailer Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {result.leads.map((lead, i) => (
              <RetailerCard key={i} lead={lead} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
