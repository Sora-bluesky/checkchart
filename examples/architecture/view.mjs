export const reader = "A maintainer";
export const question = "Where does data enter acme, and where does it end up?";
export const title = "acme connections";
export const product = "acme";
export const colors = { People: "tan", Application: "teal", Storage: "purple", Outside: "orange" };
export const label = (id, kind) => kind === "zone"
  ? { machine: "Your machine", web: "Remote service" }[id]
  : { user: "You", app: "acme", db: "Saved data", api: "Remote API" }[id];
export const group = { user: "People", app: "Application", db: "Storage", api: "Outside" };
export const step = (connection) => connection.from === "api" ? "Sends a result"
  : connection.to === "db" ? "Saves data" : "Submits a request";
