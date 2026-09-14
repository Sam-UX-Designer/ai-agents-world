import { z } from 'zod'

/**
 * The Orchestrator's output shape.
 *
 * This schema is handed to the model as a structured-output format, so the
 * plan comes back already valid rather than as prose we then have to parse.
 * It is also what the planning screen renders and what the runtime executes -
 * one shape, three consumers.
 */

export const plannedTaskSchema = z.object({
  /** Plan-local id, e.g. "t1". The Orchestrator assigns these; we map them
   *  to database ids after validation, so a hallucinated id cannot escape. */
  id: z.string(),
  /** Read by a human, on the island and in the task list. Short and concrete. */
  title: z.string(),
  /** Read by the executing agent. Specific about what to fetch and return. */
  description: z.string(),
  /** Must match a key in the agent registry. Validated, never trusted. */
  agentKey: z.string(),
  /** Plan-local ids this task genuinely needs the output of. */
  dependsOn: z.array(z.string()),
})

export type PlannedTask = z.infer<typeof plannedTaskSchema>

export const taskPlanSchema = z.object({
  /** How the Orchestrator read the goal. Shown before execution starts so
   *  the user can catch a misunderstanding early rather than at the end. */
  interpretation: z.string(),
  tasks: z.array(plannedTaskSchema),
  /** Capabilities the goal needs that no available agent has. Surfaced
   *  honestly instead of being assigned to an agent that will fail. */
  unsupported: z.array(z.string()),
})

export type TaskPlan = z.infer<typeof taskPlanSchema>

export type PlanValidationError =
  | { readonly kind: 'unknown_agent'; readonly taskId: string; readonly agentKey: string }
  | { readonly kind: 'unknown_dependency'; readonly taskId: string; readonly dependsOn: string }
  | { readonly kind: 'duplicate_task_id'; readonly taskId: string }
  | { readonly kind: 'self_dependency'; readonly taskId: string }
  | { readonly kind: 'dependency_cycle'; readonly taskIds: readonly string[] }

/**
 * Check a plan before we execute a single step of it.
 *
 * The model is good at planning and still capable of naming an agent that
 * does not exist or wiring a cycle between two tasks. Catching that here
 * turns a class of silent mid-run hangs into one clear error at plan time,
 * which the Orchestrator can then be asked to fix.
 */
export function validatePlan(
  plan: TaskPlan,
  knownAgentKeys: readonly string[],
): readonly PlanValidationError[] {
  const errors: PlanValidationError[] = []
  const seen = new Set<string>()

  for (const task of plan.tasks) {
    if (seen.has(task.id)) errors.push({ kind: 'duplicate_task_id', taskId: task.id })
    seen.add(task.id)

    if (!knownAgentKeys.includes(task.agentKey)) {
      errors.push({ kind: 'unknown_agent', taskId: task.id, agentKey: task.agentKey })
    }
    if (task.dependsOn.includes(task.id)) {
      errors.push({ kind: 'self_dependency', taskId: task.id })
    }
  }

  for (const task of plan.tasks) {
    for (const dep of task.dependsOn) {
      if (!seen.has(dep)) {
        errors.push({ kind: 'unknown_dependency', taskId: task.id, dependsOn: dep })
      }
    }
  }

  const cycle = findCycle(plan.tasks)
  if (cycle) errors.push({ kind: 'dependency_cycle', taskIds: cycle })

  return errors
}

/** Depth-first search for a dependency cycle. Returns the cycle if one exists. */
function findCycle(tasks: readonly PlannedTask[]): readonly string[] | null {
  const deps = new Map(tasks.map((t) => [t.id, t.dependsOn]))
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []

  const visit = (id: string): readonly string[] | null => {
    const current = state.get(id)
    if (current === 'done') return null
    if (current === 'visiting') return stack.slice(stack.indexOf(id))

    state.set(id, 'visiting')
    stack.push(id)
    for (const dep of deps.get(id) ?? []) {
      if (!deps.has(dep)) continue
      const found = visit(dep)
      if (found) return found
    }
    stack.pop()
    state.set(id, 'done')
    return null
  }

  for (const task of tasks) {
    const found = visit(task.id)
    if (found) return found
  }
  return null
}

/**
 * Group tasks into waves that can run together.
 *
 * Wave 0 is everything with no dependencies; wave N is everything whose
 * dependencies all landed in earlier waves. This is what turns the plan's
 * `dependsOn` edges into actual parallelism at runtime - and what lets the
 * island light up several agents at once instead of marching through them.
 *
 * Assumes `validatePlan` has already passed; a cycle would loop forever.
 */
export function executionWaves(
  tasks: readonly PlannedTask[],
): readonly (readonly PlannedTask[])[] {
  const waves: PlannedTask[][] = []
  const placed = new Set<string>()
  let remaining = [...tasks]

  while (remaining.length > 0) {
    const ready = remaining.filter((t) => t.dependsOn.every((d) => placed.has(d)))
    if (ready.length === 0) {
      throw new Error('Plan has a dependency cycle; call validatePlan first.')
    }
    waves.push(ready)
    for (const t of ready) placed.add(t.id)
    remaining = remaining.filter((t) => !placed.has(t.id))
  }

  return waves
}
