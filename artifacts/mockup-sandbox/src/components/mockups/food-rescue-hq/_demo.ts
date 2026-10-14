type Incident = {
  id: string; food: string; total: number; location: string;
  deadline: string; status: string; assignments: never[];
};

// Each mounted canvas frame has its own state. Never calls the application API.
export function createDemo() {
  const volunteers = [
    { id: "v1", name: "Alex Rivera", optedIn: true },
    { id: "v2", name: "Jordan Lee", optedIn: true },
    { id: "v3", name: "Sam Taylor", optedIn: true },
    { id: "v4", name: "Morgan Chen", optedIn: true },
    { id: "v5", name: "Casey Brooks", optedIn: false },
  ];
  let incident: Incident | null = null;
  let feed: { id: string; at: string; text: string }[] = [];
  const addEntry = (text: string) => feed.unshift({
    id: crypto.randomUUID(), at: new Date().toISOString(), text,
  });
  return async (url: string, options?: RequestInit) => {
    if (incident && ["open", "in_progress"].includes(incident.status) &&
        Date.now() >= Date.parse(incident.deadline)) {
      incident.status = "expired";
      addEntry("Safety window ended. Remaining food is no longer available for rescue.");
    }
    if (options?.method === "POST") {
      if (url === "/api/incidents") {
        incident = {
          id: crypto.randomUUID(), food: "tacos", total: 400, location: "Main hall",
          deadline: new Date(Date.now() + 45 * 60000).toISOString(),
          status: "open", assignments: [],
        };
        addEntry("Incident opened: 400 tacos at Main hall. 45-minute safety window.");
      } else if (url === "/api/demo/fast-forward" && incident) {
        incident.deadline = new Date(Date.now() + 60000).toISOString();
        addEntry("Demo fast-forward: safety deadline set to 60 seconds from now.");
      } else if (url === "/api/demo/reset") {
        incident = null;
        feed = [];
      }
    }
    return new Response(JSON.stringify({
      volunteers, incident, feed,
      totals: { total: incident?.total ?? 0, unclaimed: incident?.total ?? 0, claimed: 0, rescued: 0 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}
