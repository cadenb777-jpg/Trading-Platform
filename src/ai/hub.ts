/** Lets any page open the assistant or hand it a conversation, without importing the app shell. */

type Hub = {
  open(question?: string): void;
  continueConversation(conversation: string, title: string, answer: string): void;
};

let hub: Hub = { open: () => {}, continueConversation: () => {} };

export function setAssistantHub(h: Hub) {
  hub = h;
}

export const openAssistant = (question?: string) => hub.open(question);
export const continueInAssistant = (conversation: string, title: string, answer: string) => hub.continueConversation(conversation, title, answer);
