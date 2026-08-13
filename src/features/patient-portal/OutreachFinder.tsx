import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import {
  MapPinIcon,
  CalendarIcon,
  ArrowPathIcon,
  WifiIcon,
} from "@heroicons/react/24/outline";

interface OutreachEvent {
  id: string;
  event_name: string;
  event_date: string;
  start_time?: string;
  end_time?: string;
  status?: string;
  notes?: string;
  sites?: {
    name: string;
    address: string;
    lga: string;
    state: string;
  } | null;
}

export function OutreachFinder() {
  const [events, setEvents] = useState<OutreachEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const isOffline = !supabase;

  useEffect(() => {
    loadEvents();
  }, []);

  const loadEvents = async () => {
    setLoading(true);
    try {
      if (!supabase) {
        const cached = localStorage.getItem("patient_cached_outreach");
        setEvents(cached ? JSON.parse(cached) : []);
        return;
      }

      const { data, error } = await supabase
        .from("outreach_events")
        .select(
          "id, event_name, event_date, start_time, end_time, status, notes, sites(name, address, lga, state)",
        )
        .gte("event_date", new Date().toISOString().split("T")[0])
        .in("status", ["planned", "active"])
        .order("event_date", { ascending: true })
        .limit(20);
      if (error) throw error;

      const result = (data || []) as unknown as OutreachEvent[];
      setEvents(result);
      localStorage.setItem("patient_cached_outreach", JSON.stringify(result));
    } catch {
      const cached = localStorage.getItem("patient_cached_outreach");
      setEvents(cached ? JSON.parse(cached) : []);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <MapPinIcon className="w-7 h-7 text-blue-600" />
            Find Outreach Near Me
          </h1>
          <p className="mt-2 text-gray-600">
            Upcoming community health events and outreach programmes
          </p>
        </div>
        <button
          onClick={loadEvents}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          <ArrowPathIcon className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {isOffline && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-3">
          <WifiIcon className="w-5 h-5 text-amber-600 flex-shrink-0" />
          <p className="text-sm text-amber-800">
            Offline mode — showing cached events. Connect to the internet to see the latest outreach events near you.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl shadow-sm">
          <MapPinIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 mb-2">
            No upcoming events found
          </h3>
          <p className="text-gray-500 max-w-sm mx-auto">
            {isOffline
              ? "Outreach events near you will appear here once you connect and refresh."
              : "There are no outreach events scheduled in your area right now. Check back soon."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {events.map((event) => (
            <div
              key={event.id}
              className="bg-white rounded-xl shadow-sm p-6 border border-gray-100"
            >
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {event.event_name}
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-600">
                    <span className="flex items-center gap-1">
                      <MapPinIcon className="w-4 h-4 text-red-500" />
                      {event.sites
                        ? `${event.sites.name}, ${event.sites.lga}, ${event.sites.state}`
                        : "Location to be announced"}
                    </span>
                    <span className="flex items-center gap-1">
                      <CalendarIcon className="w-4 h-4 text-blue-500" />
                      {event.event_date}
                      {event.start_time
                        ? ` · ${event.start_time.slice(0, 5)}${event.end_time ? `–${event.end_time.slice(0, 5)}` : ""}`
                        : ""}
                    </span>
                  </div>
                  {event.notes && (
                    <p className="mt-3 text-sm text-gray-600">{event.notes}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
