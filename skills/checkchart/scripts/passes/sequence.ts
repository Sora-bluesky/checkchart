import { messagesOf, participantsOf, type Bug, type Check, type Message, type Sequence } from "../ir.ts";

export const SEQUENCE_RULES = ["Declared", "Answered", "ReplyMatches", "Recovered", "SelfIsSelf"];

export function checkSequence(model: Sequence): Check {
  const messages = messagesOf(model.messages);
  const declared = new Set(model.participants);
  const used = new Set(messages.flatMap(participantsOf));
  const byId = new Map<string, { message: Message; index: number }>();
  for (const [index, message] of messages.entries()) if (message.id !== undefined) byId.set(message.id, { message, index });
  const answered = new Set<string>();
  const bugs: Bug[] = [];
  const add = (rule: string, index: number, detail: string) => {
    const involved = [...new Set(participantsOf(messages[index]))];
    bugs.push({
      rule, marks: involved.filter((id) => declared.has(id)).map((id) => ({ kind: "participant", id })),
      evidence: { kind: "sequence", index, involved, detail },
    });
  };
  for (const id of model.participants) if (!used.has(id)) bugs.push({
    rule: "Declared", marks: [{ kind: "participant", id }],
    evidence: { kind: "sequence", involved: [id], participant: id, detail: "This participant appears in no message." },
  });
  for (const [index, message] of messages.entries()) {
    if (participantsOf(message).some((id) => !declared.has(id))) add("Declared", index, "This message names an undeclared participant.");
    if (message.type === "call" && !message.timeout) {
      const reply = message.id !== undefined && messages.slice(index + 1).some((reply) => reply.type === "reply" && reply.answers === message.id);
      if (!reply) add("Answered", index, "No later reply answers this call, and the call declares no timeout.");
    }
    if (message.type === "reply") {
      const call = message.answers === undefined ? undefined : byId.get(message.answers);
      if (!call || call.index >= index || call.message.type !== "call") {
        add("ReplyMatches", index, "This reply does not name an earlier call.");
      } else if (answered.has(message.answers ?? "")) {
        add("ReplyMatches", index, "The call already has a reply.");
      } else if (message.from !== call.message.to || message.to !== call.message.from) {
        add("ReplyMatches", index, "This reply does not go back from the receiver to the caller.");
      } else if (message.answers !== undefined) answered.add(message.answers);
    }
    if (message.type === "lost") {
      const recovery = message.recovery === undefined ? undefined : byId.get(message.recovery);
      if (!recovery || recovery.index <= index) add("Recovered", index, "No later message has the declared recovery id.");
    }
    if (message.type !== "note" && (message.type === "self" ? message.from !== message.to : message.from === message.to)) {
      add("SelfIsSelf", index, message.type === "self" ? "A self message must go back to the same participant." : "Only a self message can go back to the same participant.");
    }
  }
  return { rules: SEQUENCE_RULES, bugs, unchecked: [] };
}
