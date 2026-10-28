const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Strip markdown fences / chitchat the model sometimes adds around the HTML.
function cleanHtml(raw: string): string {
  let s = raw.trim();

  // Remove ```html ... ``` or ``` ... ``` fences, keep the inner content.
  const fence = s.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  // If there's still a stray opening/closing fence, strip them.
  s = s.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "");

  // Extract from <!DOCTYPE html> (case-insensitive) to </html>.
  const start = s.search(/<!DOCTYPE html>/i);
  const endMatch = s.match(/<\/html>/i);
  if (start !== -1 && endMatch) {
    const end = endMatch.index! + endMatch[0].length;
    s = s.slice(start, end);
  }

  return s.trim();
}

const SYSTEM_PROMPT = `You are the App Builder. The user describes a web app in one sentence.
You build it as a SINGLE, SELF-CONTAINED HTML document that runs in a sandboxed iframe.

=== OUTPUT CONTRACT (HARD) ===
1. Output ONLY the HTML. No explanations, no markdown fences, no backticks.
2. Start with <!DOCTYPE html> and end with </html>.
3. ALL CSS inline in a <style> block in <head>.
4. ALL JavaScript inline in ONE <script> block at end of <body>.
5. Use ZERO external deps EXCEPT these pinned CDNs:
   - https://cdn.tailwindcss.com
   - (only if user asks for React) React 18 + ReactDOM 18 + @babel/standalone UMD builds
6. Output the WHOLE document every time. Never truncate. No "..." or TODO.

=== RUNTIME CONSTRAINTS (CRITICAL) ===
- iframe runs with sandbox="allow-scripts" ONLY.
  → <form> and <button type="submit"> are FORBIDDEN. Use onClick/addEventListener.
- localStorage may throw in opaque-origin iframe. Wrap every read/write in try/catch.
  Keep primary state in a normal JS variable so storage failure never blanks the page.
- Put ALL JS in ONE <script>. Declare each identifier once.
- Insert user text with textContent, never innerHTML.
- body { margin: 0 } and fill the viewport.
- Must run with ZERO console errors on first load.

=== QUALITY BAR ===
- Make it look finished: spacing, typography, hover states, responsive.
- The user's core interaction MUST work (add item actually adds, click actually scores).
- Prefer vanilla JS + Tailwind over complex framework setups.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "Prompt is required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY secret is not configured on the server." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const baseURL = (Deno.env.get("OPENAI_BASE_URL") || "").trim() || "https://api.openai.com/v1";
    const model = (Deno.env.get("OPENAI_MODEL") || "").trim() || "gpt-4o-mini";

    const apiRes = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: 0.4,
        stream: false,
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      return new Response(
        JSON.stringify({
          error: `AI provider returned HTTP ${apiRes.status}`,
          detail: errText,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await apiRes.json();
    const raw: string = data?.choices?.[0]?.message?.content ?? "";

    if (!raw.trim()) {
      return new Response(
        JSON.stringify({ error: "模型返回了空内容，请检查模型名称或余额。" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const text = cleanHtml(raw);

    return new Response(
      JSON.stringify({ code: text }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "AI 调用失败",
        detail: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
