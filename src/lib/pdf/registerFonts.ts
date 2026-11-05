import { Font } from "@react-pdf/renderer";
import path from "path";

let isRegistered = false;
let registerPromise: Promise<void> | null = null;

/**
 * Registers Arial font family in @react-pdf/renderer.
 * Works seamlessly in both Node.js server-side PDF rendering and browser client-side.
 */
export async function ensureArialRegistered(): Promise<void> {
  if (isRegistered) return;
  if (registerPromise) return registerPromise;

  registerPromise = (async () => {
    try {
      if (typeof window === "undefined") {
        // Server-side (Node.js runtime)
        const regularPath = path.join(process.cwd(), "public", "fonts", "arial.ttf");
        const boldPath = path.join(process.cwd(), "public", "fonts", "arialbd.ttf");
        Font.register({
          family: "Arial",
          fonts: [
            { src: regularPath, fontWeight: 400 },
            { src: boldPath, fontWeight: 700 },
          ],
        });
      } else {
        // Client-side (Browser runtime)
        const origin = window.location?.origin || "";
        Font.register({
          family: "Arial",
          fonts: [
            { src: `${origin}/fonts/arial.ttf`, fontWeight: 400 },
            { src: `${origin}/fonts/arialbd.ttf`, fontWeight: 700 },
          ],
        });
      }

      // Patch FontFamily resolve for Arial to handle 'bold', '700', etc. seamlessly
      const registeredFonts = (Font as any).getRegisteredFonts?.() || {};
      const arialFamily = registeredFonts["Arial"];
      if (arialFamily) {
        const proto = Object.getPrototypeOf(arialFamily);
        if (proto && !proto.__mdosPatched) {
          const origResolve = proto.resolve;
          proto.resolve = function (descriptor: any) {
            const w = descriptor?.fontWeight;
            if (w === "bold" || w === "700" || w === 700 || w === 600 || w === 800 || w === 900) {
              return origResolve.call(this, { ...descriptor, fontWeight: 700 });
            }
            if (w === "normal" || w === "400" || w === 400 || !w) {
              return origResolve.call(this, { ...descriptor, fontWeight: 400 });
            }
            return origResolve.call(this, descriptor);
          };
          proto.__mdosPatched = true;
        }
      }

      // Preload fonts so they are immediately available before render begins
      await Promise.all([
        Font.load({ fontFamily: "Arial", fontWeight: 400 }),
        Font.load({ fontFamily: "Arial", fontWeight: 700 }),
      ]).catch((err) => {
        console.warn("[PDF Font Register] Font.load warning:", err);
      });

      isRegistered = true;
    } catch (_) {
    } finally {
      registerPromise = null;
    }
  })();

  return registerPromise;
}

let isPoppinsRegistered = false;
let registerPoppinsPromise: Promise<void> | null = null;

export async function ensurePoppinsRegistered(): Promise<void> {
  if (isPoppinsRegistered) return;
  if (registerPoppinsPromise) return registerPoppinsPromise;

  registerPoppinsPromise = (async () => {
    try {
      if (typeof window === "undefined") {
        const regularPath = path.join(process.cwd(), "public", "fonts", "poppins.ttf");
        const semiboldPath = path.join(process.cwd(), "public", "fonts", "poppins-semibold.ttf");
        const boldPath = path.join(process.cwd(), "public", "fonts", "poppinsbd.ttf");
        Font.register({
          family: "Poppins",
          fonts: [
            { src: regularPath, fontWeight: 400 },
            { src: semiboldPath, fontWeight: 600 },
            { src: boldPath, fontWeight: 700 },
          ],
        });
      } else {
        const origin = window.location?.origin || "";
        Font.register({
          family: "Poppins",
          fonts: [
            { src: `${origin}/fonts/poppins.ttf`, fontWeight: 400 },
            { src: `${origin}/fonts/poppins-semibold.ttf`, fontWeight: 600 },
            { src: `${origin}/fonts/poppinsbd.ttf`, fontWeight: 700 },
          ],
        });
      }

      const registeredFonts = (Font as any).getRegisteredFonts?.() || {};
      const poppinsFamily = registeredFonts["Poppins"];
      if (poppinsFamily) {
        const proto = Object.getPrototypeOf(poppinsFamily);
        if (proto && !proto.__mdosPoppinsPatched) {
          const origResolve = proto.resolve;
          proto.resolve = function (descriptor: any) {
            const w = descriptor?.fontWeight;
            if (w === "bold" || w === "700" || w === 700 || w === 800 || w === 900) {
              return origResolve.call(this, { ...descriptor, fontWeight: 700 });
            }
            if (w === "semibold" || w === "600" || w === 600 || w === 500) {
              return origResolve.call(this, { ...descriptor, fontWeight: 600 });
            }
            if (w === "normal" || w === "400" || w === 400 || !w) {
              return origResolve.call(this, { ...descriptor, fontWeight: 400 });
            }
            return origResolve.call(this, descriptor);
          };
          proto.__mdosPoppinsPatched = true;
        }
      }

      await Promise.all([
        Font.load({ fontFamily: "Poppins", fontWeight: 400 }),
        Font.load({ fontFamily: "Poppins", fontWeight: 600 }),
        Font.load({ fontFamily: "Poppins", fontWeight: 700 }),
      ]).catch(() => {});

      isPoppinsRegistered = true;
    } catch (_) {
    } finally {
      registerPoppinsPromise = null;
    }
  })();

  return registerPoppinsPromise;
}

/**
 * Formats a Date object as DD/MM/YYYY - H:MM AM/PM
 * Example: 24/09/2026 - 9:37 AM
 */
export function formatExportDateTime(date: Date = new Date()): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();

  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 hour should be 12

  return `${day}/${month}/${year} - ${hours}:${minutes} ${ampm}`;
}
