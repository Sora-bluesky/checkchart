export const title = "acme nested workers";
export const reader = "A maintainer";
export const question = "How does a request reach the nested workers?";
export const label = {
  outer: "acme request coordination boundary\nOuter region",
  inner: "acme nested coordination boundary\nInner region",
  workers: "acme processing coordination boundary\nWorker region",
  first: "First worker",
  second: "Second worker",
  innerHelper: "Inner coordinator",
  outerHelper: "Outer coordinator",
  outside: "Request source",
};
export const step = () => "Passes the request";
