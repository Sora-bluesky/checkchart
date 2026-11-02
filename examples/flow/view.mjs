export const reader = "A maintainer";
export const question = "How is a submitted form saved?";
export const title = "acme saves a form";
export const product = "acme";
export const colors = { Input: "blue", Work: "teal", Storage: "purple", Result: "tan" };
export const label = { start: "You submit a form", check: "Is the form valid?", save: "Save the form", db: "Saved forms", done: "You see the result" };
export const group = { start: "Input", check: "Work", save: "Work", db: "Storage", done: "Result" };
export const step = (edge) => edge.when === "valid" ? "The form is valid"
  : edge.when === "invalid" ? "The form needs a change"
  : edge.to === "db" ? "Writes the form" : null;
