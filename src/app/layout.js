import { Inter } from "next/font/google";
import "material-symbols/outlined.css";
import "./globals.css";
import { ThemeProvider } from "@/shared/components/ThemeProvider";
import "@/lib/network/initOutboundProxy"; // Auto-initialize outbound proxy env
import "@/shared/services/bootstrap"; // Auto-run initializeApp (watchdog, auto-resume tunnel)
import { initConsoleLogCapture } from "@/lib/consoleLogBuffer";
import { RuntimeI18nProvider } from "@/i18n/RuntimeI18nProvider";

// Hook console immediately at module load time (server-side only, runs once)
initConsoleLogCapture();

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata = {
  title: "9Router - AI Infrastructure Management",
  description: "One endpoint for all your AI providers. Manage keys, monitor usage, and scale effortlessly.",
  icons: {
    icon: "/favicon.svg",
  },
};

export const viewport = {
  themeColor: "#0a0a0a",
};

/** 在 React 注水前移除浏览器扩展注入的 data-* 属性，避免 dev  hydration 警告 */
const STRIP_EXTENSION_ATTRS_SCRIPT = `
(function () {
  var PREFIXES = ["data-atm-", "data-extension-", "data-darkreader-"];
  function shouldStrip(name) {
    for (var i = 0; i < PREFIXES.length; i++) {
      if (name.indexOf(PREFIXES[i]) === 0) return true;
    }
    return false;
  }
  function strip(node) {
    if (!node || !node.getAttributeNames) return;
    node.getAttributeNames().forEach(function (name) {
      if (shouldStrip(name)) node.removeAttribute(name);
    });
  }
  function run() {
    strip(document.documentElement);
    strip(document.body);
  }
  var obs = null;
  function watch() {
    run();
    if (obs) return;
    obs = new MutationObserver(run);
    if (document.documentElement) {
      obs.observe(document.documentElement, { attributes: true });
    }
    if (document.body) {
      obs.observe(document.body, { attributes: true });
    }
  }
  function stop() {
    if (obs) { obs.disconnect(); obs = null; }
  }
  run();
  watch();
  document.addEventListener("DOMContentLoaded", watch);
  window.addEventListener("load", stop, { once: true });
  setTimeout(stop, 10000);
})();
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: STRIP_EXTENSION_ATTRS_SCRIPT,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `if(document.fonts&&document.fonts.ready){document.fonts.ready.then(function(){document.documentElement.classList.add('fonts-loaded')})}else{document.documentElement.classList.add('fonts-loaded')}`,
          }}
        />
      </head>
      <body
        className={`${inter.variable} font-sans antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider>
          <RuntimeI18nProvider>
            {children}
          </RuntimeI18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
