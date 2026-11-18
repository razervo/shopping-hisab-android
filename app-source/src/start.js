import { createStart } from "@tanstack/react-start";
import { errorCaptureFunctionMiddleware, errorCaptureRequestMiddleware } from "@/lib/error-capture";

// The UI is hosted on Cloudflare Workers. App data, authentication and AI
// functions are accessed through the external Base44 SDK client.
export const startInstance = createStart(() => ({
  requestMiddleware: [errorCaptureRequestMiddleware],
  functionMiddleware: [errorCaptureFunctionMiddleware],
}));
