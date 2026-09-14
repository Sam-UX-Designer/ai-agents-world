# agents/ - agent portraits

Shown in the agent detail panel, the active-agents list and History.

Square, at least 256x256, transparent background.

Agents are created by users and are not a fixed list, so these are keyed by
agent id rather than by a hardcoded name. Ship a small set of stock portraits
and one fallback; the app picks a stock portrait when an agent has no custom
one, and never breaks when a file is absent.

## Needed

```
default.png       the fallback, used when an agent has no portrait
orchestrator.png  the central hub agent
stock-01.png      assigned round-robin to new agents
stock-02.png
stock-03.png
...
```
