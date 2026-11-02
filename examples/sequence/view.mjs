export const reader = "A maintainer";
export const question = "How does a request receive a result or recover?";
export const title = "acme receives requests";
export const product = "acme";
export const colors = { Screen: "blue", Service: "teal" };
export const label = { ui: "You", main: "Application", core: "Worker", show: "Show the result", acknowledge: "Acknowledge the update" };
export const group = { ui: "Screen", main: "Service", core: "Service" };
export const step = (message) => {
  if (message.id === "hello") return "Asks for the result";
  if (message.type === "reply") return "Returns the result";
  if (message.type === "self") return "Updates its cache";
  if (message.type === "note") return "The result is ready";
  if (message.id === "ack") return "Acknowledges, with a timeout";
  if (message.id === "gone") return "The update is lost";
  if (message.id === "resync") return "Sends a fresh copy";
  return "Shows the result";
};
