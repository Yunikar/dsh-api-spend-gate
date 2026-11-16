/**
 * API spend gate.
 *
 * A Host plugin that hard-gates tools which start additional model inference or
 * paid external work. Before such a tool runs, the user is asked once through
 * the approval seam; an `allowed-once` decision is remembered for the rest of
 * the current turn, so the remaining calls in that turn run without prompting.
 * The next user message closes that turn and starts a fresh approval.
 */

/** Tools gated by default. Override with `config.tools` in the patch. */
const DEFAULT_GATED_TOOLS = ['subagent', 'subagent_fork', 'workflow']

/** Services this plugin needs before it can gate anything. */
export const inject = ['agents', 'approval']

/**
 * Install the pre-execution gate.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ tools?: string[] } | undefined} config
 */
export function apply(ctx, config) {
  const configured = Array.isArray(config?.tools) ? config.tools.filter(t => typeof t === 'string' && t.length > 0) : []
  const gated = new Set(configured.length > 0 ? configured : DEFAULT_GATED_TOOLS)

  // Session -> turn number whose API calls the user already approved.
  const grantedTurn = new WeakMap()

  /** Fail-closed denial with a clear, non-retry instruction for the model. */
  const denied = (toolName) => ({
    kind: 'deny',
    reason: `The user did not approve the API call "${toolName}". Do not retry it and do not work around it; explain what you wanted to do and why, then let the user decide.`,
  })

  const listener = async (exec, next) => {
    const agent = exec.agent
    // No agent context means there is no one to ask; leave the call alone.
    if (agent === undefined) return next()
    if (!gated.has(exec.name)) return next()
    if (exec.signal.aborted) return { kind: 'cancel' }

    const session = agent.session
    let turn
    try {
      turn = ctx.agents.turnBoundaryOf(session).lastTurn
    } catch {
      // Without a reliable turn boundary we cannot remember an approval, so fail closed.
      return denied(exec.name)
    }

    // Already approved for this turn: run without another prompt.
    if (grantedTurn.get(session) === turn) return next()

    let outcome
    try {
      outcome = await ctx.approval.request({
        agent,
        toolName: exec.name,
        callId: exec.callId,
        reason: `API spend gate: "${exec.name}" may consume account balance; asking the user once for this turn.`,
        displayReason: {
          en: `Allow "${exec.name}"? It calls an external API and may consume your balance. Approving covers the rest of this turn.`,
          zh: `是否允许执行「${exec.name}」？该操作会调用外部 API，可能消耗你的账户余额。批准后本轮内不再询问。`,
        },
        signal: exec.signal,
      })
    } catch {
      // Missing/closed approval channel: fail closed rather than spend silently.
      return denied(exec.name)
    }

    if (outcome === 'allowed-once') {
      grantedTurn.set(session, turn)
      return next()
    }
    if (outcome === 'cancelled') return { kind: 'cancel' }
    return denied(exec.name)
  }

  ctx.on('tools/pre-execute', listener, { prepend: true })
}
