import { Platform } from "react-native";

// On-device text recognition via Google ML Kit (Infinite Red Expo module).
// It is a native module: unavailable on web and in Expo Go. We load it lazily
// and guard every use so the rest of the app keeps working in preview/Expo Go.
type RecognizeFn = (imagePath: string) => Promise<{ text: string }>;

let recognizeText: RecognizeFn | null = null;
if (Platform.OS !== "web") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    recognizeText = require("@infinitered/react-native-mlkit-text-recognition").recognizeText;
  } catch {
    recognizeText = null;
  }
}

// True only inside a real dev/production build that bundles the native module.
export const onDeviceOcrAvailable = !!recognizeText;

export async function recognizeOnDevice(imagePath: string): Promise<string> {
  if (!recognizeText) throw new Error("ON_DEVICE_UNAVAILABLE");
  const res = await recognizeText(imagePath);
  return (res?.text ?? "").trim();
}
