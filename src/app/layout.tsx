import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import NextTopLoader from "nextjs-toploader";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    template: "%s | Distroline - Your Distribution Management System",
    default: "Distroline - Your Distribution Management System",
  },
  description: "Distroline Distribution Management System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${poppins.variable} h-full antialiased`}>
        <body className="h-full min-h-screen flex flex-col bg-background text-foreground">
          <NextTopLoader color="#e51e2a" showSpinner={false} />
            {children}
        </body>
      </html>
    </ClerkProvider>
  );
}

