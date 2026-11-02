export const title = "acme request processing";
export const reader = "A maintainer";
export const question = "How does a request reach stored data?";
export const label = { outer: "Service boundary", inner: "Application process", leaf: "Worker group", client: "Client", router: "Request router", worker: "Worker", store: "Stored data" };
export const colors = { Entry: "blue", Work: "teal", Storage: "purple" };
export const group = { client: "Entry", router: "Work", worker: "Work", store: "Storage" };
export const step = (edge) => edge.from === "client" ? "Uses." : edge.to === "store" ? "Writes the result" : "Queues a work item";
