import { GoogleGenAI, Part } from "@google/genai";

let aiInstance: GoogleGenAI | null = null;
let currentKey: string | null = null;

export function getGeminiClient(customKey?: string) {
  const apiKey = customKey || currentKey || (process.env.GEMINI_API_KEY as string);
  
  if (!apiKey) {
    throw new Error("No Gemini API Key provided.");
  }

  if (!aiInstance || apiKey !== currentKey) {
    aiInstance = new GoogleGenAI({ apiKey });
    currentKey = apiKey;
  }
  
  return aiInstance;
}

export async function sendMessageStream(
  message: string,
  history: { role: "user" | "model"; parts: { text: string }[] }[],
  attachments?: { name: string, type: string, data: string }[],
  customKey?: string
) {
  const ai = getGeminiClient(customKey);
  const modelName = "gemini-3-flash-preview";

  const chat = ai.chats.create({
    model: modelName,
    history: history.length > 0 ? history : undefined,
    config: {
      systemInstruction: "You are Vortex AI, a powerful and sleek assistant. Your responses are well-formatted Markdown. If a file is provided, analyze its content if possible (images, text, etc).",
    }
  });

  const messageParts: Part[] = [{ text: message }];

  if (attachments && attachments.length > 0) {
    attachments.forEach(att => {
      // Data is usually "data:image/png;base64,..."
      const base64Data = att.data.split(',')[1] || att.data;
      messageParts.push({
        inlineData: {
          mimeType: att.type,
          data: base64Data
        }
      });
    });
  }

  return await chat.sendMessageStream({ message: messageParts });
}
