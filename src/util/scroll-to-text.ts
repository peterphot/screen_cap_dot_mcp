import type { Page } from "puppeteer-core";

export async function scrollToText(page: Page, text: string, timeoutMs?: number): Promise<void> {
  const searchText = text.toLowerCase();
  const effectiveTimeout = timeoutMs ?? 10_000;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const scrollPromise = (async () => {
    const found = await page.evaluate(
      (txt: string) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const content = node.textContent ?? "";
          if (content.toLowerCase().includes(txt)) {
            const el = node.parentElement;
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "center" });
              return true;
            }
          }
        }
        return false;
      },
      searchText,
    );

    if (!found) {
      throw new Error(`Text "${text}" not found on page`);
    }

    // Brief settle time for smooth scroll to complete
    await new Promise((resolve) => setTimeout(resolve, 250));
  })();

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`scroll_to_text timed out after ${effectiveTimeout}ms`)), effectiveTimeout);
  });

  try {
    await Promise.race([scrollPromise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
