export const title = "acme request processing";
export const reader = "A maintainer";
export const question = "Which service sends each request and response?";
export const label = {
  local: "Local services", remote: "External service",
  client: "Client", api: "acme Web API\nReceives requests", worker: "Processing service\nPrepares requests",
  store: "Request store", service: "Remote service",
};
const words = {
  submit: "Submit request", process: "Process request", save: "Save request",
  request: "Send remote request", notify: "Payment result, Webhook",
};
export const step = (connection) => words[connection.id];
