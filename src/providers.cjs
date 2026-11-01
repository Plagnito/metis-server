"use strict";
const { fail, jsonFetch } = require("./util.cjs");
function createProviders(store, fetchImpl = fetch, binding = {}) {
  const currentConfig=binding.config || (()=>store.config().provider), currentKey=binding.key || (()=>store.secret('provider'));
  const testKey=binding.testKey || 'providerTest';
  const fingerprint=()=>require('./util.cjs').hash(JSON.stringify(currentConfig())+currentKey());
  async function turn(messages, tools, limits, signal) {
    const config = currentConfig(),
      key = currentKey();
    if (!config.model || (config.kind !== "compatible" && !key))
      fail(
        "PROVIDER_NOT_CONFIGURED",
        "Configurez et testez un fournisseur IA.",
      );
    const common = {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
    };
    let url, body;
    if (config.kind === "openai") {
      url = "https://api.openai.com/v1/responses";
      const input = [];
      for (const m of messages) {
        if (m.role === "tool")
          input.push({
            type: "function_call_output",
            call_id: m.id,
            output: m.content,
          });
        else if (m.calls) {
          if (m.content) input.push({ role: "assistant", content: m.content });
          for (const c of m.calls)
            input.push({
              type: "function_call",
              call_id: c.id,
              name: c.name,
              arguments: JSON.stringify(c.arguments),
            });
        } else
          input.push({
            role: m.role === "system" ? "developer" : m.role,
            content: m.content,
          });
      }
      body = {
        model: config.model,
        input,
        store: false,
        max_output_tokens: limits.maxOutputTokens,
        tools: tools.map((t) => ({
          type: "function",
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
          strict: false,
        })),
        parallel_tool_calls: false,
      };
      common.headers.Authorization = "Bearer " + key;
    } else if (config.kind === "anthropic") {
      url = "https://api.anthropic.com/v1/messages";
      const input = [];
      for (const m of messages.filter((x) => x.role !== "system")) {
        let content;
        if (m.role === "tool")
          content = [
            { type: "tool_result", tool_use_id: m.id, content: m.content },
          ];
        else if (m.calls)
          content = [
            ...(m.content ? [{ type: "text", text: m.content }] : []),
            ...m.calls.map((c) => ({
              type: "tool_use",
              id: c.id,
              name: c.name,
              input: c.arguments,
            })),
          ];
        else content = m.content;
        const role = m.role === "tool" ? "user" : m.role;
        if (input.at(-1)?.role === role) {
          const a = input.at(-1);
          a.content = [
            ...(Array.isArray(a.content)
              ? a.content
              : [{ type: "text", text: a.content }]),
            ...(Array.isArray(content)
              ? content
              : [{ type: "text", text: content }]),
          ];
        } else input.push({ role, content });
      }
      body = {
        model: config.model,
        max_tokens: limits.maxOutputTokens,
        system: messages
          .filter((x) => x.role === "system")
          .map((x) => x.content)
          .join("\n"),
        messages: input,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        })),
        tool_choice: { type: "auto", disable_parallel_tool_use: true },
      };
      common.headers["x-api-key"] = key;
      common.headers["anthropic-version"] = "2023-06-01";
    } else {
      url = config.baseUrl + "/chat/completions";
      body = {
        model: config.model,
        max_tokens: limits.maxOutputTokens,
        stream: false,
        messages: messages.map((m) =>
          m.role === "tool"
            ? { role: "tool", tool_call_id: m.id, content: m.content }
            : m.calls
              ? {
                  role: "assistant",
                  content: m.content || null,
                  tool_calls: m.calls.map((c) => ({
                    id: c.id,
                    type: "function",
                    function: {
                      name: c.name,
                      arguments: JSON.stringify(c.arguments),
                    },
                  })),
                }
              : { role: m.role, content: m.content },
        ),
        tools: tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          },
        })),
        parallel_tool_calls: false,
      };
      if (key) common.headers.Authorization = "Bearer " + key;
    }
    // Reserve a conservative token upper bound before any billed request.
    // UTF-8 bytes are intentionally used as a conservative bound, not a tokenizer.
    const inputBound = Buffer.byteLength(JSON.stringify(body));
    if (inputBound + limits.maxOutputTokens > limits.remainingTokens)
      fail(
        "BUDGET_EXCEEDED",
        "Budget de jetons insuffisant pour le prochain appel.",
      );
    if (limits.reserve) limits.reserve(inputBound + limits.maxOutputTokens);
    const response = await jsonFetch(
      fetchImpl,
      url,
      { ...common, body: JSON.stringify(body) },
      2000000,
    );
    let output = "",
      calls = [],
      usage;
    if (config.kind === "openai") {
      if (response.status && response.status !== "completed")
        fail(
          "PROVIDER_INCOMPLETE",
          "Le fournisseur n’a pas terminé sa réponse.",
        );
      for (const item of response.output || []) {
        if (item.type === "function_call")
          calls.push({
            id: item.call_id,
            name: item.name,
            arguments: parseArguments(item.arguments),
          });
        if (item.type === "message")
          for (const c of item.content || [])
            if (c.type === "output_text") output += c.text;
      }
      usage = response.usage?.total_tokens;
    } else if (config.kind === "anthropic") {
      if (
        response.stop_reason === "max_tokens" ||
        response.stop_reason === "refusal"
      )
        fail(
          "PROVIDER_INCOMPLETE",
          "Réponse tronquée ou refusée par le fournisseur.",
        );
      for (const c of response.content || []) {
        if (c.type === "text") output += c.text;
        if (c.type === "tool_use")
          calls.push({ id: c.id, name: c.name, arguments: c.input });
      }
      if (response.usage)
        usage =
          (response.usage.input_tokens || 0) +
          (response.usage.output_tokens || 0) +
          (response.usage.cache_creation_input_tokens || 0) +
          (response.usage.cache_read_input_tokens || 0);
    } else {
      const c = response.choices?.[0];
      if (!c || !["stop", "tool_calls"].includes(c.finish_reason))
        fail("PROVIDER_INCOMPLETE", "Réponse locale absente ou tronquée.");
      output = c.message.content || "";
      calls = (c.message.tool_calls || []).map((x) => ({
        id: x.id,
        name: x.function.name,
        arguments: parseArguments(x.function.arguments),
      }));
      usage = response.usage?.total_tokens;
    }
    if (
      calls.length > 8 ||
      calls.some((c) => typeof c.id !== "string" || typeof c.name !== "string")
    )
      fail("PROVIDER_INVALID", "Appels d’outils invalides.");
    const charged =
      Number.isSafeInteger(usage) && usage > 0
        ? usage
        : inputBound + limits.maxOutputTokens;
    return {
      content: output,
      calls,
      tokens: charged,
      usageReported: Number.isSafeInteger(usage) && usage > 0,
    };
  }
  async function test(signal) {
    const testedFingerprint=fingerprint();
    store.set(testKey, null);
    const tool = {
      name: "connection_check",
      description: "Return the exact value metis-ok to verify tool calling.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { value: { type: "string", enum: ["metis-ok"] } },
        required: ["value"],
      },
    };
    const r = await turn(
      [
        {
          role: "system",
          content:
            "Call connection_check with value metis-ok. This is a tool capability check.",
        },
        { role: "user", content: "Test the connection now." },
      ],
      [tool],
      { maxOutputTokens: 256, remainingTokens: 6000 },
      signal,
    );
    if (
      !r.calls.some(
        (c) =>
          c.name === "connection_check" && c.arguments?.value === "metis-ok",
      )
    )
      fail(
        "TOOLS_UNAVAILABLE",
        "La connexion répond, mais le test d’appel d’outil n’a pas réussi.",
      );
    if(testedFingerprint!==fingerprint())fail('REVISION_CONFLICT','Le modèle ou la clé a changé pendant le test. Relancez-le.',409);
    store.set(testKey, {
      at: new Date().toISOString(),
      fingerprint: testedFingerprint,
    });
    return { ok: true, tokens: r.tokens, usageReported: r.usageReported };
  }
  function verified() {
    return (
      store.get(testKey)?.fingerprint === fingerprint()
    );
  }
  return { turn, test, verified, fingerprint };
}
function parseArguments(value) {
  try {
    return JSON.parse(value);
  } catch {
    fail("PROVIDER_INVALID", "Arguments d’outil JSON invalides.");
  }
}
module.exports = { createProviders };
