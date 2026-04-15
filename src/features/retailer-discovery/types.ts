export type RetailerType =
  | "pharmacy"
  | "supermarket"
  | "hospital_supply"
  | "ngo_network"
  | "health_store"
  | "distributor"
  | "community_health"
  | "cooperative";

export interface RetailerLead {
  name: string;
  type: RetailerType;
  abujaArea: string;
  address?: string;
  fitScore: number;
  contactStrategy: string;
  reasoning: string;
  estimatedReach?: string;
}

export interface DiscoveryResult {
  summary: string;
  leads: RetailerLead[];
  priorityChannels: string[];
}

export interface DiscoveryResponse {
  success: boolean;
  result?: DiscoveryResult;
  demo?: boolean;
  error?: string;
}
