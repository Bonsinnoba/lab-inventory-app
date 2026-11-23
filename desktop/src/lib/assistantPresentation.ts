export function responsePrompts(messages: ReadonlyArray<{ role: 'user' | 'model'; content: string }>) {
  let question = '';
  return messages.flatMap((message, index) => {
    if (message.role === 'user') { question = message.content; return []; }
    if (!question) return [];
    const prompt = { index, question };
    question = '';
    return [prompt];
  });
}

export function canRestorePrompt(draft: string, prompt: string) {
  return !!prompt.trim() && (!draft.trim() || draft === prompt);
}

export function nearConversationEnd(top: number, height: number, viewport: number) {
  return height - top - viewport <= 80;
}
