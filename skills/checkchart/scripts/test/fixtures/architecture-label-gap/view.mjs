export const title = "acme startup";
export const reader = "A maintainer";
export const question = "How does the screen connect to a separate core?";
export const label = { x: "Zone X", y: "Zone Y", main: "Main process", renderer: "Local renderer\nGPU and utility", core: "Worker core" };
export const step = (edge) => edge.to === "core" ? "Start or connect to acme" : "Starts acme";
