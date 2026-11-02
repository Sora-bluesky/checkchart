export const reader = "A maintainer";
export const question = "Which components exchange a request and its data?";
export const title = "acme connections";
export const product = "acme";
export const colors = { People: "tan", Application: "teal", Storage: "purple", Outside: "orange" };
export const label = (id, kind) => kind === "zone"
  ? { machine: "Your machine", app: "Application process", web: "Remote service" }[id]
  : { user: "You", app: "acme", db: "Saved data", api: "Remote endpoint" }[id];
export const group = { user: "People", app: "Application", db: "Storage", api: "Outside" };
export const step = (connection) => connection.from === "api" ? "Returns a result"
  : connection.to === "app" ? "Submits a request"
  : connection.to === "db" ? "Reads and writes data" : "Requests a result";
